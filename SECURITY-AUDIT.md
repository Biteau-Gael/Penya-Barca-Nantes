# Audit de Sécurité — Penya Blaugrana Nantes

**Date :** 2026-05-30  
**Branches analysées :** `main` (jusqu'au commit `003faca`)  
**Commits couverts :** Phase 2 complète (soirée match live, micro-pronos, badges, séries, saisons)

---

## Résumé des commits récents

| Hash | Description | Impact sécurité |
|------|-------------|-----------------|
| `003faca` | fix: évaluer les badges immédiatement après chaque action | Faible |
| `b1c88f6` | feat: Phase 2 — soirée match live, micro-pronos, badges, séries, saisons | **À auditer** |
| `d461ee5` | Merge: deploy-synology-nas | Aucun |
| `68e22d2` | feat: menu burger mobile | Aucun |
| `6aebaf7` | Fix Better Auth trusted origins | Moyen |
| `aed5841` | security: supprimer credentials du repo + renforcer .gitignore | Positif |

---

## Analyse de sécurité par ordre de criticité

---

### 🔴 CRITIQUE

#### C-01 — Path Traversal sur la route `/uploads/*`
**Fichier :** `app/routes/uploads-files.ts:5`

```ts
const filePath = path.join(process.cwd(), "uploads", params["*"]);
```

**Problème :** Le paramètre wildcard de l'URL est utilisé directement pour construire un chemin fichier. `path.join` résout les segments `..` — une requête vers `/uploads/../../etc/passwd` peut lire des fichiers arbitraires sur le système.

**Exemple d'attaque :**
```
GET /uploads/../../app/config/env.server.ts
```

**Correction à appliquer :**
```ts
const UPLOAD_DIR = path.join(process.cwd(), "uploads");
const filePath = path.join(UPLOAD_DIR, params["*"]);

// Vérification que le chemin résolu reste dans uploads/
if (!filePath.startsWith(UPLOAD_DIR + path.sep) && filePath !== UPLOAD_DIR) {
  return new Response("Forbidden", { status: 403 });
}
```

**Priorité :** Corriger immédiatement avant tout déploiement en production.

---

### 🟠 ÉLEVÉ

#### H-01 — Absence de rate limiting sur les actions du fil (feed)
**Fichier :** `app/routes/feed.server.ts`

Le module `rate-limit.server.ts` existe mais n'est jamais appelé dans les actions du fil. Un utilisateur authentifié peut :
- Envoyer des posts/commentaires en masse sans limitation.
- Déclencher des milliers de réactions par seconde.

**Correction :** Ajouter `checkRateLimit` sur les intents `create-post`, `comment`, et `react` :
```ts
await checkRateLimit({
  key: `feed:${session.user.id}`,
  maxAttempts: 10,
  windowSeconds: 60,
});
```

---

#### H-02 — Délai des micro-pronostics non appliqué côté serveur
**Fichier :** `app/routes/api.micro-predictions.ts:99-106`

Lors d'une réponse à un micro-pronostic (intent `answer`), seul le champ `closedAt` est vérifié. Le champ `deadlineSeconds` (durée en secondes après la création) n'est pas comparé à `createdAt`. Si un admin oublie de clôturer manuellement le micro-prono, les joueurs peuvent continuer à répondre indéfiniment.

**Correction :**
```ts
const deadline = new Date(micro.createdAt.getTime() + micro.deadlineSeconds * 1000);
if (micro.closedAt || new Date() > deadline) {
  return Response.json({ error: "Micro-pronostic fermé" }, { status: 400 });
}
```

---

#### H-03 — Endpoint `/api/health` public sans authentification
**Fichier :** `app/routes/api.health.ts`

L'endpoint révèle l'état des services d'infrastructure (PostgreSQL, Redis) sans aucune authentification. Cela expose la topologie interne à tout visiteur.

**Correction :** Restreindre l'accès à un token de monitoring (header `X-Health-Token`) ou limiter par IP, ou au minimum supprimer les détails des services de la réponse publique.

---

#### H-04 — Absence de rate limiting sur les réponses aux micro-pronostics
**Fichier :** `app/routes/api.micro-predictions.ts:90-131`

La vérification de doublon existe (empêche de répondre deux fois au même micro-prono) mais il n'y a pas de rate limiting global. Un script peut envoyer des requêtes sur tous les micro-pronos ouverts simultanément sans délai.

---

### 🟡 MOYEN

#### M-01 — `JSON.parse` sans try/catch dans l'évaluation des badges
**Fichier :** `app/lib/server/badges.server.ts:172`

```ts
const condition = JSON.parse(badge.condition) as { type: string; threshold: number };
```

Si la colonne `condition` en base de données est corrompue ou malformée, cette ligne lève une exception non capturée qui interrompt le processus d'évaluation des badges pour tous les utilisateurs.

**Correction :**
```ts
let condition: { type: string; threshold: number };
try {
  condition = JSON.parse(badge.condition);
} catch {
  logger.error({ badgeId: badge.id }, "Condition de badge JSON invalide");
  continue;
}
```

---

#### M-02 — Toutes les réponses micro-pronos de l'utilisateur exposées dans le loader soirée
**Fichier :** `app/routes/soiree.server.ts:201-208`

```ts
const userMicroAnswers = await db
  .select(...)
  .from(microPredictionAnswers)
  .where(eq(microPredictionAnswers.userId, session.user.id)); // Pas de filtre par matchId
```

Toutes les réponses aux micro-pronostics de l'utilisateur (tous matchs confondus) sont chargées et retournées dans le payload de la page. Seul le filtre côté client (via `answeredMap`) limite l'affichage, mais les données brutes complètes transitent dans la réponse.

**Correction :** Filtrer par `matchId` en joignant la table `microPredictions` :
```ts
.where(
  and(
    eq(microPredictionAnswers.userId, session.user.id),
    inArray(microPredictionAnswers.microPredictionId, activeMicroIds)
  )
)
```

---

#### M-03 — Type cast `as any` sur le rôle utilisateur
**Fichiers :** `app/routes/feed.server.ts:99, 124, 184`

```ts
isAdmin: (session.user as any).role === "admin",
```

Le type `session.user` ne déclare pas le champ `role` nativement, forçant l'utilisation de `as any`. Ce contournement bypass la vérification TypeScript et pourrait masquer des régressions si le modèle `Session` évolue.

**Correction :** Utiliser le type `Role` de `auth-utils.server.ts` et étendre le type `Session` pour inclure le champ `role`.

---

#### M-04 — `trustedOrigins` vide si `APP_URL` non défini
**Fichier :** `app/lib/server/auth.server.ts:12`

```ts
trustedOrigins: env.APP_URL ? [env.APP_URL] : [],
```

Sans `APP_URL`, Better Auth reçoit un tableau vide. Selon la configuration par défaut de la librairie, cela peut permettre des requêtes cross-origin non autorisées (CSRF). À vérifier avec la documentation de Better Auth.

**Recommandation :** Documenter clairement que `APP_URL` est obligatoire en production. Valider cette variable comme `z.string()` (sans `.optional()`) dans `env.server.ts` pour l'environnement `production`.

---

### 🟢 FAIBLE

#### L-01 — `seedBadges` exécuté à chaque évaluation de badge
**Fichier :** `app/lib/server/badges.server.ts:157`

```ts
export async function evaluateBadges(userId: string): Promise<string[]> {
  await seedBadges(); // Appelé à chaque action utilisateur
```

`seedBadges` effectue une requête `SELECT` puis potentiellement plusieurs `INSERT` à chaque évaluation de badge (post, commentaire, réaction, pronostic). À fort volume, cela génère une charge inutile.

**Recommandation :** Initialiser les badges au démarrage de l'application ou via un flag en mémoire.

---

#### L-02 — Absence d'en-têtes de sécurité HTTP
**Fichier :** Configuration globale absente

L'application ne définit pas d'en-têtes de sécurité HTTP standards :
- `Content-Security-Policy` (XSS)
- `X-Frame-Options` (clickjacking)
- `X-Content-Type-Options` (MIME sniffing)
- `Referrer-Policy`

**Recommandation :** Ajouter ces en-têtes via un middleware ou la configuration du reverse proxy Nginx/Caddy sur le NAS Synology.

---

#### L-03 — Champ `answer` sans validation de longueur maximale
**Fichier :** `app/routes/api.micro-predictions.ts:92`

Le champ `answer` soumis par un joueur n'a pas de limite de longueur. Un utilisateur malveillant peut soumettre une chaîne arbitrairement longue, entraînant un stockage excessif en base de données.

**Correction :**
```ts
if (!answer || answer.length > 200) {
  return Response.json({ error: "Réponse invalide" }, { status: 400 });
}
```

---

#### L-04 — Emails des membres accessibles à l'admin dans la réponse loader
**Fichier :** `app/routes/admin.members.server.ts:22`

Les adresses email de tous les membres sont retournées dans le loader admin. C'est probablement intentionnel, mais dans un contexte RGPD, l'accès aux données personnelles doit être tracé et justifié. Aucun log n'est produit sur cet accès en lecture.

**Recommandation :** Ajouter un log d'audit sur l'accès à la liste des membres avec emails.

---

## Points positifs identifiés

- **Commit `aed5841`** : Suppression des credentials du repo et renforcement du `.gitignore` — bonne pratique respectée.
- **`requireAuth`** avec support des rôles (`allowedRoles`) appliqué sur toutes les routes admin.
- **Validation Zod** sur les schémas de création de match, post, commentaire, inscription.
- **ORM Drizzle** utilisé partout — aucune requête SQL brute avec concaténation de chaînes (pas d'injection SQL).
- **Upload d'avatars** : vérification du type MIME, limite à 2 Mo, retraitement via `sharp` (empêche le stockage de fichiers malveillants bruts).
- **Double protection** sur la suppression de compte : l'admin ne peut pas supprimer son propre compte depuis le panel.
- **Vérification de doublon** sur les réponses aux micro-pronostics (`existing` check).
- **Logs structurés** (`pino`) avec niveau configurable — bonne observabilité.

---

## Récapitulatif des corrections prioritaires

| ID | Criticité | Fichier | Effort estimé |
|----|-----------|---------|---------------|
| C-01 | 🔴 Critique | `uploads-files.ts` | 15 min |
| H-01 | 🟠 Élevé | `feed.server.ts` | 30 min |
| H-02 | 🟠 Élevé | `api.micro-predictions.ts` | 20 min |
| H-03 | 🟠 Élevé | `api.health.ts` | 20 min |
| H-04 | 🟠 Élevé | `api.micro-predictions.ts` | 15 min |
| M-01 | 🟡 Moyen | `badges.server.ts` | 15 min |
| M-02 | 🟡 Moyen | `soiree.server.ts` | 20 min |
| M-03 | 🟡 Moyen | `feed.server.ts` | 30 min |
| M-04 | 🟡 Moyen | `auth.server.ts` | 10 min |
| L-01 | 🟢 Faible | `badges.server.ts` | 20 min |
| L-02 | 🟢 Faible | Config Nginx/Caddy | 30 min |
| L-03 | 🟢 Faible | `api.micro-predictions.ts` | 10 min |
| L-04 | 🟢 Faible | `admin.members.server.ts` | 10 min |
