# Rapport de Sécurité — Penya Blaugrana Nantes

**Date :** 2026-04-15  
**Branche analysée :** `main`  
**Dernier commit :** `003faca` — fix: évaluer les badges immédiatement après chaque action  
**Analysé par :** Claude Sonnet 4.6

---

## Résumé des derniers commits

| Hash | Date | Auteur | Description |
|------|------|--------|-------------|
| `003faca` | 13 avr. 2026 | Biteau Gaël | **fix:** évaluer les badges immédiatement après chaque action (soumission prono, post, commentaire, réaction) |
| `b1c88f6` | 13 avr. 2026 | Biteau Gaël | **feat:** Phase 2 — soirée match live, micro-pronos, badges, séries, saisons |
| `d461ee5` | 12 avr. 2026 | Claude | **merge:** Merge branch `claude/deploy-synology-nas-cLkOL` |
| `554b873` | 12 avr. 2026 | Claude | **docs:** Guide de déploiement Synology NAS |
| `68e22d2` | — | Biteau Gaël | **feat:** menu burger mobile pour la navigation |
| `6aebaf7` | — | Claude | **fix:** Better Auth trusted origins pour le support domaine custom |
| `9823bc5` | — | Claude | **fix:** service migrate dans docker-compose.prod.yml |
| `8d6e5e9` | — | Claude | **feat:** Docker Compose production + script de backup Synology NAS |
| `aed5841` | — | Biteau Gaël | **security:** suppression credentials du repo + renforcement .gitignore |
| `ab7fc5d` | — | Biteau Gaël | **feat:** intégration API Football + stats enrichies + classement Liga |

---

## Analyse de Sécurité

---

## 🔴 CRITIQUE

### [SEC-01] Path Traversal dans le service de fichiers uploadés

**Fichier :** `app/routes/uploads-files.ts:5`  
**Commit introduit :** Phase 1 (MVP)

**Problème :**
```ts
const filePath = path.join(process.cwd(), "uploads", params["*"]);
```
Le paramètre de route `params["*"]` est utilisé directement dans `path.join()` sans aucune sanitisation. Un attaquant peut forger une URL de type `/uploads/../.env` ou `/uploads/../../app/config/env.server.ts` pour lire des fichiers arbitraires hors du répertoire `uploads/`.

`path.join()` résout les segments `..`, ce qui signifie :
```
path.join("/app", "uploads", "../.env")  →  "/app/.env"
```

**Impact :** Lecture de la clé `AUTH_SECRET`, `DATABASE_URL`, `API_FOOTBALL_KEY`, ou tout autre fichier accessible au processus Node.js.

**Correction recommandée :**
```ts
import path from "node:path";

const UPLOADS_DIR = path.join(process.cwd(), "uploads");

export async function loader({ params }: { params: { "*": string } }) {
  const filePath = path.resolve(UPLOADS_DIR, params["*"]);

  // Protection contre le path traversal
  if (!filePath.startsWith(UPLOADS_DIR + path.sep)) {
    return new Response("Forbidden", { status: 403 });
  }

  // ... reste du code
}
```

---

## 🟠 ÉLEVÉ

### [SEC-02] Absence de validation de la réponse aux micro-pronostics QCM

**Fichier :** `app/routes/api.micro-predictions.ts:80-105` (intent `answer`)

**Problème :**
Pour les micro-pronostics de type `qcm`, les options valides sont stockées en base. Cependant, la route `answer` accepte n'importe quelle chaîne sans vérifier qu'elle fait partie des options proposées :
```ts
const answer = formData.get("answer") as string;
// Aucune vérification que answer ∈ micro.options
await db.insert(microPredictionAnswers).values({ ... answer });
```

Un utilisateur peut soumettre une réponse arbitraire. Lors de la clôture, la comparaison `answer.toLowerCase().trim() === correctAnswer.toLowerCase().trim()` est faite, donc une réponse hors-options ne sera jamais correcte — mais cela pollue la base de données et peut induire en erreur les statistiques.

**Correction recommandée :**
```ts
if (micro.type === "qcm" && micro.options) {
  const options = JSON.parse(micro.options) as string[];
  if (!options.includes(answer)) {
    return Response.json({ error: "Réponse invalide" }, { status: 400 });
  }
}
```

---

### [SEC-03] Absence de rate limiting sur les endpoints critiques de la Phase 2

**Fichiers :** `app/routes/api.micro-predictions.ts`, `app/routes/soiree.server.ts`

**Problème :**
Les actions `answer` (micro-pronostic) et les loaders de la soirée match (polling live score toutes les 60s) n'ont pas de rate limiting. La fonction `checkRateLimit` existe (`app/lib/server/rate-limit.server.ts`) mais n'est pas appelée sur ces nouvelles routes.

**Risque :**
- Flood du endpoint `/api/micro-predictions` avec des réponses multiples (même si le doublon est protégé en DB, N requêtes avant l'insertion)
- Contournement potentiel si la vérification `existing` a une race condition entre deux requêtes simultanées

**Correction recommandée :**
```ts
// Dans l'intent "answer"
await checkRateLimit({
  key: `micro-answer:${session.user.id}`,
  maxAttempts: 30,
  windowSeconds: 60,
});
```

---

### [SEC-04] `trustedOrigins` vide si `APP_URL` non défini en production

**Fichier :** `app/lib/server/auth.server.ts:13`

**Problème :**
```ts
trustedOrigins: env.APP_URL ? [env.APP_URL] : [],
```
Si `APP_URL` n'est pas défini, Better Auth n'a aucune origine de confiance explicite. Selon la configuration de la bibliothèque, cela peut affaiblir la protection CSRF.

**Le `.env.example` ne marque pas `APP_URL` comme obligatoire en production.** Ce réglage est silencieux et n'est pas validé par le schéma Zod (il est `optional()`).

**Correction recommandée :** Rendre `APP_URL` obligatoire en production dans `env.server.ts` :
```ts
APP_URL: z.string().url().optional().refine(
  (val) => process.env.NODE_ENV !== "production" || val !== undefined,
  { message: "APP_URL est requis en production" }
),
```
Et documenter dans `.env.example` que cette variable est **obligatoire en production**.

---

## 🟡 MODÉRÉ

### [SEC-05] Les clients DB et Redis contournent la validation d'environnement

**Fichiers :** `app/db/client.ts:6`, `app/lib/server/redis.server.ts:3`

**Problème :**
Ces fichiers accèdent directement à `process.env` au lieu d'utiliser la fonction validée `getEnv()` :
```ts
// app/db/client.ts
connectionString: process.env.DATABASE_URL,  // peut être undefined

// app/lib/server/redis.server.ts
new Redis(process.env.REDIS_URL || "redis://localhost:6379")  // fallback silencieux
```
Si `DATABASE_URL` n'est pas défini, le pool Postgres est créé avec `undefined` sans erreur immédiate au démarrage, ce qui peut provoquer des erreurs silencieuses à runtime.

**Correction recommandée :**
```ts
// app/db/client.ts
import { getEnv } from "~/config/env.server";
const env = getEnv();
const pool = new pg.Pool({ connectionString: env.DATABASE_URL });

// app/lib/server/redis.server.ts
import { getEnv } from "~/config/env.server";
const env = getEnv();
export const redis = new Redis(env.REDIS_URL, { ... });
```

---

### [SEC-06] Race condition dans le rate limiter Redis

**Fichier :** `app/lib/server/rate-limit.server.ts:12-16`

**Problème :**
```ts
const current = await redis.incr(redisKey);
if (current === 1) {
  await redis.expire(redisKey, windowSeconds);  // ← deux opérations non atomiques
}
```
Si le serveur crashe entre `incr` et `expire`, la clé n'expire jamais et le rate limit reste bloqué indéfiniment.

**Correction recommandée :** Utiliser `SET ... EX` ou un pipeline Redis atomique :
```ts
const pipeline = redis.pipeline();
pipeline.incr(redisKey);
pipeline.expire(redisKey, windowSeconds); // toujours rafraîchir l'expire
const [[, current]] = await pipeline.exec() as [[null, number]];
```

---

### [SEC-07] Type `any` dans le parseur d'événements de match live

**Fichier :** `app/routes/soiree.server.ts:88`

**Problème :**
```ts
return res.value.json().then((data: any) => {
```
L'absence de typage fort expose la logique à des erreurs silencieuses si l'API externe retourne un format inattendu ou mal formé. Aucune validation de schéma n'est effectuée sur la réponse.

**Correction recommandée :** Définir une interface typée ou utiliser Zod pour parser/valider la réponse de l'API externe.

---

## 🔵 FAIBLE

### [SEC-08] Absence de Content-Security-Policy (CSP)

**Fichier :** `app/root.tsx` (aucun middleware global visible)

**Problème :**
Aucun header `Content-Security-Policy` n'est défini dans l'application. En cas de vulnérabilité XSS (contenu utilisateur affiché sans encodage), l'absence de CSP maximise l'impact.

**Correction recommandée :** Ajouter un middleware dans `app/root.tsx` ou via le serveur Express/Vite pour définir des headers de sécurité minimaux :
```
Content-Security-Policy: default-src 'self'; img-src 'self' data:; script-src 'self'
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
```

---

### [SEC-09] Nom de fichier d'avatar basé sur l'ID utilisateur sans extension forcée

**Fichier :** `app/lib/server/upload.ts:20`

**Problème :**
```ts
const filename = `${userId}.webp`;
```
L'ID utilisateur (généré par Better Auth) est utilisé directement comme nom de fichier. Si un ID contenait des caractères spéciaux (`/`, `..`), cela pourrait mener à un path traversal. Better Auth génère des IDs sûrs (nanoid/UUID), donc le risque est faible mais la dépendance implicite à ce comportement n'est pas documentée.

**Correction recommandée :** Sanitiser le userId avant de l'utiliser comme nom de fichier :
```ts
const safeId = userId.replace(/[^a-zA-Z0-9_-]/g, "_");
const filename = `${safeId}.webp`;
```

---

### [SEC-10] Logger initialise son niveau depuis `process.env` sans validation

**Fichier :** `app/lib/server/logger.server.ts:4`

**Problème :**
```ts
level: process.env.LOG_LEVEL || "info",
```
Contourne le schéma Zod de `env.server.ts`. En production, si `LOG_LEVEL` est mal orthographié ou absent, pino pourrait utiliser un niveau inattendu (risque d'over-logging en production ou sous-logging en debug).

**Correction :** Utiliser `getEnv().LOG_LEVEL`.

---

## Tableau récapitulatif

| ID | Criticité | Fichier | Titre |
|----|-----------|---------|-------|
| SEC-01 | 🔴 CRITIQUE | `uploads-files.ts:5` | Path Traversal dans le service fichiers |
| SEC-02 | 🟠 ÉLEVÉ | `api.micro-predictions.ts:80` | Réponse QCM non validée contre les options |
| SEC-03 | 🟠 ÉLEVÉ | `api.micro-predictions.ts` | Absence de rate limiting Phase 2 |
| SEC-04 | 🟠 ÉLEVÉ | `auth.server.ts:13` | trustedOrigins vide si APP_URL absent |
| SEC-05 | 🟡 MODÉRÉ | `client.ts:6`, `redis.server.ts:3` | Contournement validation env (DB/Redis) |
| SEC-06 | 🟡 MODÉRÉ | `rate-limit.server.ts:12` | Race condition rate limiter Redis |
| SEC-07 | 🟡 MODÉRÉ | `soiree.server.ts:88` | Type `any` parseur API externe |
| SEC-08 | 🔵 FAIBLE | `root.tsx` | Absence de Content-Security-Policy |
| SEC-09 | 🔵 FAIBLE | `upload.ts:20` | Nom de fichier avatar non sanitisé |
| SEC-10 | 🔵 FAIBLE | `logger.server.ts:4` | Logger contourne validation env |

---

## Points positifs constatés

- `AUTH_SECRET` validé avec longueur minimale (16 chars) par Zod
- `.gitignore` couvre `.env`, `uploads/`, et les screenshots
- Commit `aed5841` : suppression historique des credentials du repo
- `requireAuth()` systématiquement utilisé sur toutes les routes admin
- Validation Zod sur les inputs de formulaire (pronos, posts, commentaires, matchs)
- Rate limiter Redis implémenté et utilisé sur les routes sensibles existantes (login, register)
- Mots de passe gérés par Better Auth (hashing délégué à la bibliothèque)
- ORM Drizzle avec requêtes paramétrées → pas d'injection SQL
- Upload d'avatar avec validation de type MIME, taille max et redimensionnement

---

*Rapport généré automatiquement — à réviser par un expert sécurité avant mise en production.*
