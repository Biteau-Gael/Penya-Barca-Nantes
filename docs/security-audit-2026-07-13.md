# Audit de sécurité — Penya Barca Nantes
**Date :** 13 juillet 2026  
**Branches analysées :** `main` (commits `fec3e63` → `003faca`)  
**Portée :** code applicatif TypeScript/React Router, configuration Docker/NAS

---

## Résumé des derniers commits

| Hash | Message | Impact sécurité |
|------|---------|----------------|
| `003faca` | fix: évaluer les badges immédiatement après chaque action | Aucun |
| `b1c88f6` | feat: Phase 2 — soirée match live, micro-pronos, badges, séries, saisons | Nouvelles surfaces d'attaque (voir ci-dessous) |
| `d461ee5` | Merge: deploy-synology-nas | Déploiement NAS |
| `554b873` | Add deployment guide for Synology NAS updates | Documentation |
| `68e22d2` | feat: menu burger mobile pour la navigation | UI uniquement |
| `6aebaf7` | Fix Better Auth trusted origins for custom domain support | Correction sécurité auth |
| `9823bc5` | Add migrate service to docker-compose.prod.yml | Infrastructure |
| `8d6e5e9` | Add production Docker Compose and backup script for Synology NAS | Infrastructure |
| `aed5841` | security: supprimer credentials du repo et renforcer .gitignore | Correctif sécurité |

---

## Analyse par ordre de criticité

---

### 🔴 CRITIQUE — Path Traversal dans le serveur de fichiers statiques

**Fichier :** `app/routes/uploads-files.ts`  
**Commit introduisant la faille :** `16c43e6` (MVP Phase 1)  
**Statut :** ✅ **Corrigé le 13/07/2026**

**Description**  
Le paramètre wildcard `params["*"]` de la route `/uploads/*` était passé directement à `path.join()` sans validation. `path.join()` résout les segments `..`, permettant à un attaquant de lire n'importe quel fichier du système :

```
GET /uploads/../../../etc/passwd
→ path.join(process.cwd(), "uploads", "../../etc/passwd")
→ /etc/passwd  ✗
```

**Correction appliquée**  
Utilisation de `path.resolve()` et vérification que le chemin résolu commence par `UPLOADS_BASE` avant toute lecture :

```typescript
const filePath = path.resolve(UPLOADS_BASE, params["*"]);
if (!filePath.startsWith(UPLOADS_BASE + path.sep)) {
  return new Response("Not found", { status: 404 });
}
```

**Risque résiduel :** Aucun après correction.

---

### 🟠 HAUT — Absence de validation de la réponse aux micro-pronostics

**Fichier :** `app/routes/api.micro-predictions.ts` (lignes 90–131)  
**Statut :** ⚠️ À corriger

**Description**  
Lorsqu'un joueur répond à un micro-pronostic (intent `"answer"`), la valeur `answer` est enregistrée en base sans être validée contre les options autorisées définies dans `micro.options`. Un joueur peut soumettre une chaîne arbitraire de longueur illimitée.

**Conséquence :** stockage de données non filtrées, comparaison incorrecte lors de la clôture, potentiel injection de contenu affiché si non échappé côté frontend.

**Correction recommandée**  
```typescript
// Valider que la réponse est dans les options autorisées (pour les QCM)
if (micro.type === "qcm" && micro.options) {
  const allowed = JSON.parse(micro.options) as string[];
  if (!allowed.includes(answer.trim())) {
    return Response.json({ error: "Réponse invalide" }, { status: 400 });
  }
}
// Limiter la longueur pour les réponses libres
if (answer.length > 200) {
  return Response.json({ error: "Réponse trop longue" }, { status: 400 });
}
```

---

### 🟠 HAUT — Absence de rate limiting sur les routes de vote et d'action

**Fichiers :** `app/routes/api.micro-predictions.ts`, `app/routes/feed.server.ts`  
**Statut :** ⚠️ À corriger

**Description**  
L'infrastructure de rate limiting existe (`app/lib/server/rate-limit.server.ts`) mais n'est pas appliquée sur :
- Les réponses aux micro-pronostics (intent `"answer"`)
- La création de posts/commentaires et les réactions dans le fil

Un utilisateur authentifié peut soumettre autant d'actions en rafale qu'il le souhaite, ce qui peut surcharger la base de données.

**Correction recommandée**  
```typescript
await checkRateLimit({
  key: `micro-answer:${session.user.id}`,
  maxAttempts: 10,
  windowSeconds: 60,
});
```

---

### 🟡 MOYEN — Champs `type` et `pointsScheme` non validés contre une liste d'autorisation

**Fichiers :**  
- `app/routes/api.micro-predictions.ts` (ligne 21) : `type` sauvegardé sans validation  
- `app/routes/admin.matches.server.ts` (lignes 59, 95) : `pointsScheme` non validé  
**Statut :** ⚠️ À corriger

**Description**  
Ces champs viennent de `formData.get()` et sont insérés en base sans restriction. Si la DB ou la logique applicative s'appuie sur des valeurs attendues, des valeurs inattendues peuvent provoquer des comportements non déterministes.

**Correction recommandée**  
```typescript
const VALID_TYPES = ["qcm", "open"] as const;
const VALID_SCHEMES = ["standard", "bonus"] as const;

if (!VALID_TYPES.includes(type as any)) {
  return Response.json({ error: "Type invalide" }, { status: 400 });
}
```

---

### 🟡 MOYEN — Validation MIME de l'upload basée sur `file.type` (côté client)

**Fichier :** `app/lib/server/upload.ts` (ligne 13)  
**Statut :** ⚠️ À surveiller

**Description**  
La vérification du type MIME utilise `file.type`, qui est la valeur déclarée par le navigateur dans le `Content-Type` de la partie multipart. Un client malveillant peut envoyer un fichier `.php` ou `.html` avec `Content-Type: image/jpeg`. Sharp décodera le buffer et échouera pour les formats non-image, mais l'erreur survient après lecture complète du buffer en mémoire.

**Atténuant :** Sharp recompresse tout en WebP, neutralisant les exploits basés sur le contenu du fichier. Le risque est limité à la phase de lecture mémoire.

**Correction recommandée**  
Utiliser un module de magic-bytes (ex: `file-type`) pour vérifier le type réel du fichier avant traitement :
```typescript
import { fileTypeFromBuffer } from "file-type";
const detected = await fileTypeFromBuffer(buffer);
if (!detected || !["image/jpeg", "image/png", "image/webp"].includes(detected.mime)) {
  throw new Error("Contenu non reconnu comme image");
}
```

---

### 🟡 MOYEN — `APP_URL` optionnelle laisse `trustedOrigins` vide en production

**Fichier :** `app/lib/server/auth.server.ts` (ligne 12)  
**Statut :** ⚠️ À vérifier

**Description**  
```typescript
trustedOrigins: env.APP_URL ? [env.APP_URL] : [],
```
Si `APP_URL` n'est pas définie (oubli en production), la liste des origines de confiance est vide. Selon la configuration de Better Auth, cela peut bloquer toutes les requêtes cross-origin légitimes, ou au contraire ne rien vérifier du tout.

**Correction recommandée**  
Rendre `APP_URL` obligatoire en production dans le schéma Zod :
```typescript
APP_URL: z.string().url().optional().refine(
  (v) => process.env.NODE_ENV !== "production" || !!v,
  { message: "APP_URL est requis en production" }
),
```

---

### 🟢 BAS — Cast `as any` pour les vérifications de rôle

**Fichiers :** `app/routes/feed.server.ts` (lignes 99, 124, 184, 203)  
**Statut :** ℹ️ Amélioration recommandée

**Description**  
```typescript
const isAdmin = (session.user as any).role === "admin";
```
Ce pattern court-circuite la vérification de types TypeScript sur le champ `role`. Si le type de session évolue, le compilateur ne détectera pas les incohérences.

**Correction recommandée**  
Utiliser la fonction utilitaire déjà présente :
```typescript
await requireAuth(request, ["admin"]);
```
Ou typer correctement la session via `Session` exporté de `auth.server.ts`.

---

### 🟢 BAS — Endpoint `/api/health` public expose l'état interne de l'infrastructure

**Fichier :** `app/routes/api.health.ts`  
**Statut :** ℹ️ À évaluer selon contexte

**Description**  
L'endpoint health check est accessible sans authentification et révèle le statut de PostgreSQL et Redis. En production sur NAS, si l'application est exposée sur Internet, cela peut aider un attaquant à connaître l'état de l'infrastructure.

**Correction recommandée**  
Soit restreindre l'accès par IP (reverse proxy), soit ajouter un token secret en header :
```typescript
const token = request.headers.get("X-Health-Token");
if (token !== env.HEALTH_CHECK_TOKEN) {
  return new Response("Unauthorized", { status: 401 });
}
```

---

## Points positifs constatés

- ✅ Variables d'environnement validées via Zod au démarrage (`env.server.ts`)
- ✅ ORM Drizzle avec requêtes paramétrées — pas d'injection SQL possible
- ✅ Authentification déléguée à Better Auth (sessions Redis, CSRF géré)
- ✅ Contrôle d'accès admin appliqué côté serveur sur toutes les routes admin (`requireAuth(request, ["admin"])`)
- ✅ Clé API Football stockée en variable d'environnement, jamais exposée côté client
- ✅ Credentials retirés du dépôt (commit `aed5841`) et `.gitignore` renforcé
- ✅ Resize + recompression des avatars via Sharp (neutralise les exploits image)
- ✅ Limite de taille de fichier à 2 Mo sur les uploads
- ✅ Infrastructure de rate limiting disponible (Redis) — à étendre
- ✅ Logger structuré (Pino) sans fuite de données sensibles dans les logs
- ✅ Vérification de la deadline côté serveur pour les pronostics

---

## Tableau récapitulatif

| # | Criticité | Fichier | Description | Statut |
|---|-----------|---------|-------------|--------|
| 1 | 🔴 Critique | `uploads-files.ts` | Path traversal — lecture de fichiers arbitraires | ✅ Corrigé |
| 2 | 🟠 Haut | `api.micro-predictions.ts` | Réponse non validée contre les options autorisées | ⚠️ À corriger |
| 3 | 🟠 Haut | `api.micro-predictions.ts`, `feed.server.ts` | Absence de rate limiting sur actions utilisateur | ⚠️ À corriger |
| 4 | 🟡 Moyen | `api.micro-predictions.ts`, `admin.matches.server.ts` | Champs `type`/`pointsScheme` sans liste d'autorisation | ⚠️ À corriger |
| 5 | 🟡 Moyen | `upload.ts` | MIME check basé sur `file.type` client | ⚠️ À surveiller |
| 6 | 🟡 Moyen | `auth.server.ts` | `APP_URL` optionnelle, risque en production | ⚠️ À vérifier |
| 7 | 🟢 Bas | `feed.server.ts` | Cast `as any` sur les rôles | ℹ️ Amélioration |
| 8 | 🟢 Bas | `api.health.ts` | Health check public expose l'infra | ℹ️ À évaluer |
