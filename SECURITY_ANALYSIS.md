# Analyse de sécurité — Penya Blaugrana Nantes

**Date :** 23 juin 2026  
**Branche analysée :** `main` (dernier commit : `003faca`)  
**Scope :** Revue complète du code applicatif, infrastructure Docker, configuration

---

## Résumé des derniers commits

| Hash | Type | Description |
|------|------|-------------|
| `003faca` | fix | Évaluation immédiate des badges après chaque action (pronostic, post, commentaire, réaction) |
| `b1c88f6` | feat | **Phase 2** — Soirée match live, micro-pronos, badges, séries, saisons (Sprint 2–5) |
| `d461ee5` | merge | Fusion branche `deploy-synology-nas` |
| `554b873` | docs | Guide de mise à jour et commandes utiles pour le NAS Synology |
| `68e22d2` | feat | Menu burger mobile pour la navigation |
| `6aebaf7` | fix | Better Auth — trusted origins pour domaine personnalisé |
| `aed5841` | security | **Suppression des credentials du repo + renforcement `.gitignore`** |

Le commit `b1c88f6` est le plus volumineux (+2 971 lignes) : il introduit 6 nouvelles tables DB, 3 routes API, la page soirée en temps réel et le système de badges.

---

## Remarques de sécurité — Par ordre de criticité

---

### 🔴 CRITIQUE

#### SEC-01 — Path Traversal sur le serveur de fichiers uploads

**Fichier :** `app/routes/uploads-files.ts` — ligne 5

```ts
const filePath = path.join(process.cwd(), "uploads", params["*"]);
```

Le paramètre wildcard `params["*"]` est injecté directement dans `path.join` sans validation.  
`path.join` ne neutralise pas les séquences `../` : un attaquant peut requêter `/uploads/../../.env` pour lire des fichiers arbitraires hors du dossier `uploads/`.

**Correction recommandée :**

```ts
const UPLOAD_BASE = path.resolve(process.cwd(), "uploads");
const filePath = path.resolve(UPLOAD_BASE, params["*"]);

// Bloquer toute sortie du répertoire autorisé
if (!filePath.startsWith(UPLOAD_BASE + path.sep)) {
  return new Response("Forbidden", { status: 403 });
}
```

---

### 🟠 HAUTE

#### SEC-02 — Rate limiting absent sur les actions utilisateur critiques

**Fichiers :** `app/routes/api.micro-predictions.ts`, `app/routes/feed.server.ts`

Le module `rate-limit.server.ts` existe et est fonctionnel (basé sur Redis), mais il **n'est pas utilisé** sur les endpoints suivants :
- Soumission de micro-pronostics (`intent === "answer"`)
- Création de posts (`intent === "create-post"`)
- Ajout de commentaires (`intent === "comment"`)
- Réactions (`intent === "react"`)

Un utilisateur authentifié peut spammer ces endpoints sans limite, saturant la base de données.

**Correction recommandée :** Appliquer `checkRateLimit` sur chaque `intent` côté action, ex. :

```ts
await checkRateLimit({
  key: `micro-answer:${session.user.id}:${microId}`,
  maxAttempts: 5,
  windowSeconds: 60,
});
```

---

#### SEC-03 — Race condition dans le rate limiter Redis

**Fichier :** `app/lib/server/rate-limit.server.ts` — lignes 16-19

```ts
const current = await redis.incr(redisKey);
if (current === 1) {
  await redis.expire(redisKey, windowSeconds);
}
```

Si Redis redémarre entre `INCR` et `EXPIRE`, la clé existe sans TTL et ne sera jamais supprimée (blocage permanent de l'utilisateur).

**Correction recommandée :** Utiliser un pipeline atomique :

```ts
const pipeline = redis.pipeline();
pipeline.incr(redisKey);
pipeline.expire(redisKey, windowSeconds);
const [current] = await pipeline.exec();
```

---

#### SEC-04 — Validation MIME type basée sur le header client (upload avatar)

**Fichier :** `app/lib/server/upload.ts` — ligne 13

```ts
if (!ALLOWED_TYPES.includes(file.type)) { ... }
```

`file.type` est fourni par le client (navigateur) et peut être falsifié. Un attaquant peut envoyer un fichier malveillant (ex. SVG avec XSS, ou exécutable) avec `Content-Type: image/jpeg`.

**Correction recommandée :** Vérifier les magic bytes (signatures binaires) du buffer avant traitement, en plus de la vérification MIME :

```ts
// Exemples de magic bytes
const SIGNATURES: Record<string, number[]> = {
  "image/jpeg": [0xFF, 0xD8, 0xFF],
  "image/png":  [0x89, 0x50, 0x4E, 0x47],
  "image/webp": [0x52, 0x49, 0x46, 0x46],
};
```

Sharp rejettera les fichiers non-images, ce qui atténue partiellement le risque, mais une validation explicite reste recommandée.

---

#### SEC-05 — Mots de passe par défaut faibles en production (Docker Compose)

**Fichier :** `docker-compose.prod.yml` — lignes 23, 32

```yaml
POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-changeme}
redis-server --requirepass ${REDIS_PASSWORD:-changeme}
```

Si le fichier `.env` n'est pas configuré, les services démarrent avec le mot de passe `changeme`. En cas d'exposition réseau accidentelle de PostgreSQL (port 5432) ou Redis (port 6379), la base est compromise immédiatement.

**Correction recommandée :** Supprimer les valeurs de fallback pour forcer une erreur au démarrage si les variables ne sont pas définies :

```yaml
POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?Variable POSTGRES_PASSWORD requise}
```

---

### 🟡 MOYENNE

#### SEC-06 — Endpoint `/api/health` public expose l'état de l'infrastructure

**Fichier :** `app/routes/api.health.ts`

L'endpoint est accessible sans authentification et révèle :
- Si PostgreSQL est en ligne
- Si Redis est en ligne
- Horodatage du check

Ces informations permettent à un attaquant de cartographier l'infrastructure.

**Correction recommandée :** Restreindre l'accès aux IPs internes (reverse proxy Nginx), ou ajouter un token secret dans les headers de la requête :

```ts
const token = request.headers.get("x-health-token");
if (token !== process.env.HEALTH_CHECK_TOKEN) {
  return new Response("Unauthorized", { status: 401 });
}
```

---

#### SEC-07 — `pointsScheme` non validé dans l'action admin matches

**Fichier :** `app/routes/admin.matches.server.ts` — lignes 59 et 95

```ts
const pointsScheme = (formData.get("pointsScheme") as string) || "standard";
```

La valeur est acceptée sans validation contre un ensemble de valeurs autorisées. Un admin malveillant ou une requête forgée peut injecter n'importe quelle chaîne en base.

**Correction recommandée :**

```ts
const VALID_SCHEMES = ["standard", "double", "triple"] as const;
const pointsScheme = VALID_SCHEMES.includes(formData.get("pointsScheme") as any)
  ? formData.get("pointsScheme") as string
  : "standard";
```

---

#### SEC-08 — `trustedOrigins` vide si `APP_URL` non défini

**Fichier :** `app/lib/server/auth.server.ts` — ligne 12

```ts
trustedOrigins: env.APP_URL ? [env.APP_URL] : [],
```

`APP_URL` est marqué `optional()` dans le schéma env. Si absent en production, `trustedOrigins` est `[]`. Le comportement de Better Auth avec un tableau vide n'est pas documenté explicitement et peut soit bloquer toutes les origines, soit les autoriser toutes — le second cas serait une faille CSRF.

**Correction recommandée :** Rendre `APP_URL` obligatoire en production :

```ts
APP_URL: z.string().url().optional(), // en dev
// puis en prod, vérifier au démarrage :
if (env.NODE_ENV === "production" && !env.APP_URL) {
  throw new Error("APP_URL est requis en production");
}
```

---

#### SEC-09 — SQL natif avec interpolation dans `badges.server.ts`

**Fichier :** `app/lib/server/badges.server.ts` — lignes 141-143

```ts
.from(sql`"user"`)
.where(sql`id = ${userId}`)
```

Bien que le template literal `sql` de Drizzle paramétrise les valeurs, cette syntaxe est fragile et contourne les types statiques. `userId` vient de la session (pas d'une entrée utilisateur directe), donc le risque d'injection SQL est faible en pratique, mais l'approche devrait utiliser l'ORM correctement.

**Correction recommandée :**

```ts
import { user } from "~/db/schema";
// ...
.from(user)
.where(eq(user.id, userId))
```

---

### 🟢 BASSE

#### SEC-10 — Absence de headers de sécurité HTTP (CSP, HSTS, X-Frame-Options)

Aucun middleware ne définit les headers de sécurité HTTP standards. En cas de faille XSS, l'absence de CSP amplifie l'impact.

**Correction recommandée :** Ajouter via le reverse proxy Nginx (préférable) ou dans `entry.server.tsx` :

```
Content-Security-Policy: default-src 'self'; img-src 'self' data:; script-src 'self'
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
Strict-Transport-Security: max-age=31536000; includeSubDomains
```

---

#### SEC-11 — `backup.sh` sans chiffrement des archives

**Fichier :** `backup.sh`

Le script crée des dumps PostgreSQL sans les chiffrer. Si les sauvegardes sont stockées sur un NAS partagé ou envoyées vers un stockage cloud, les données sont en clair.

**Correction recommandée :** Chiffrer avec GPG ou `openssl enc` avant stockage.

---

## Points positifs relevés

- **Validation des entrées** : Zod est utilisé systématiquement pour toutes les entrées utilisateur (register, login, pseudo, matchs, feed).
- **ORM Drizzle** : Toutes les requêtes DB passent par l'ORM (pas de SQL brut côté routes), évitant les injections SQL classiques.
- **Contrôle d'accès** : `requireAuth` avec `allowedRoles` est cohérent sur toutes les routes admin et API.
- **Suppression des credentials** : Le commit `aed5841` a correctement purgé les secrets du dépôt et renforcé `.gitignore`.
- **Mots de passe forts** : Validation Zod enforce 8 caractères, majuscule, minuscule, chiffre.
- **Protection auto-modification admin** : Un admin ne peut pas supprimer son propre compte ou changer son propre rôle depuis le panel.
- **Pagination du fil** : Limite de 50 posts côté loader, évitant les requêtes volumineuses.
- **Vérification de deadline** : Les pronostics vérifient que la deadline est antérieure au coup d'envoi.

---

## Tableau récapitulatif

| ID | Criticité | Fichier | Description |
|----|-----------|---------|-------------|
| SEC-01 | 🔴 CRITIQUE | `uploads-files.ts:5` | Path traversal — lecture fichiers arbitraires |
| SEC-02 | 🟠 HAUTE | `api.micro-predictions.ts`, `feed.server.ts` | Rate limiting absent sur actions utilisateur |
| SEC-03 | 🟠 HAUTE | `rate-limit.server.ts:16` | Race condition Redis INCR/EXPIRE non atomique |
| SEC-04 | 🟠 HAUTE | `upload.ts:13` | Validation MIME type côté client falsifiable |
| SEC-05 | 🟠 HAUTE | `docker-compose.prod.yml:23,32` | Mots de passe fallback faibles (`changeme`) |
| SEC-06 | 🟡 MOYENNE | `api.health.ts` | Endpoint health public expose l'infrastructure |
| SEC-07 | 🟡 MOYENNE | `admin.matches.server.ts:59,95` | `pointsScheme` sans validation des valeurs |
| SEC-08 | 🟡 MOYENNE | `auth.server.ts:12` | `trustedOrigins` vide si APP_URL absent |
| SEC-09 | 🟡 MOYENNE | `badges.server.ts:141` | SQL brut contournant les types ORM |
| SEC-10 | 🟢 BASSE | (global) | Absence de headers CSP/HSTS/X-Frame-Options |
| SEC-11 | 🟢 BASSE | `backup.sh` | Archives de backup non chiffrées |
