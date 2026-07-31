# Audit de sécurité — Penya Blaugrana Nantes

**Date :** 31 juillet 2026  
**Branche analysée :** `main` (commit `003faca`)  
**Portée :** ensemble du code applicatif (`app/`), configuration Docker, scripts

---

## Résumé des derniers commits

| Hash | Date | Message |
|------|------|---------|
| `003faca` | 13 avr. 2026 | fix: évaluer les badges immédiatement après chaque action |
| `b1c88f6` | 13 avr. 2026 | feat: Phase 2 — soirée match live, micro-pronos, badges, séries, saisons |
| `68e22d2` | 13 avr. 2026 | feat: menu burger mobile pour la navigation |
| `554b873` | 12 avr. 2026 | Add deployment guide for Synology NAS updates |
| `6aebaf7` | 12 avr. 2026 | Fix Better Auth trusted origins for custom domain support |
| `9823bc5` | 12 avr. 2026 | Add migrate service to docker-compose.prod.yml for database migrations |
| `8d6e5e9` | 12 avr. 2026 | Add production Docker Compose and backup script for Synology NAS deployment |
| `aed5841` | 12 avr. 2026 | security: supprimer credentials du repo et renforcer .gitignore |
| `ab7fc5d` | 12 avr. 2026 | feat: intégration API Football + stats enrichies + classement Liga |
| `16c43e6` | 11 avr. 2026 | feat: MVP Phase 1 — Penya Blaugrana Nantes |

---

## Analyse de sécurité — Résultats par ordre de criticité

---

### 🔴 CRITIQUE — Path Traversal dans le serveur de fichiers uploadés

**Fichier :** `app/routes/uploads-files.ts`

**Description :**  
Le paramètre wildcard `params["*"]` est passé directement à `path.join()` sans aucune sanitisation. Un utilisateur malveillant peut forger une URL du type `/uploads/../../etc/passwd` pour lire n'importe quel fichier accessible par le processus Node.js sur le serveur.

**Code vulnérable :**
```ts
const filePath = path.join(process.cwd(), "uploads", params["*"]);
// params["*"] peut contenir "../../etc/passwd"
```

**Scénario d'attaque :**
```
GET /uploads/../../app/config/env.server.ts
GET /uploads/../../.env
```
Ces requêtes aboutissent à la lecture de fichiers arbitraires en dehors du dossier `uploads/`.

**Correction recommandée :**
```ts
const requestedPath = path.normalize(params["*"]);
if (requestedPath.startsWith("..") || path.isAbsolute(requestedPath)) {
  return new Response("Forbidden", { status: 403 });
}
const filePath = path.join(process.cwd(), "uploads", requestedPath);
// Vérification supplémentaire que le chemin résolu est bien dans uploads/
const uploadDir = path.join(process.cwd(), "uploads");
if (!filePath.startsWith(uploadDir + path.sep)) {
  return new Response("Forbidden", { status: 403 });
}
```

**Note :** Ce fichier ne nécessite pas d'authentification, ce qui rend la vulnérabilité exploitable par n'importe qui.

---

### 🟠 ÉLEVÉ — Mots de passe par défaut faibles en production

**Fichiers :** `docker-compose.prod.yml`, `docker-compose.yml`

**Description :**  
Les mots de passe PostgreSQL et Redis utilisent `changeme` comme valeur de repli si les variables d'environnement ne sont pas définies :

```yaml
POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-changeme}
redis-server --requirepass ${REDIS_PASSWORD:-changeme}
```

Si le fichier `.env` n'est pas créé correctement sur le NAS Synology, la base de données et Redis démarrent avec le mot de passe `changeme`. Ce mot de passe est trivial à deviner et apparaît dans le code source public.

**Correction recommandée :**  
Supprimer les valeurs par défaut afin que Docker refuse de démarrer sans variable définie :
```yaml
POSTGRES_PASSWORD=${POSTGRES_PASSWORD:?La variable POSTGRES_PASSWORD doit être définie}
```
Ou documenter explicitement la vérification à effectuer avant le premier démarrage.

---

### 🟡 MOYEN — Accès direct à `process.env` sans validation Zod

**Fichiers :** `app/db/client.ts`, `app/lib/server/redis.server.ts`, `app/lib/server/logger.server.ts`

**Description :**  
Ces fichiers accèdent directement à `process.env` sans passer par la validation centralisée de `app/config/env.server.ts`. Si `DATABASE_URL` ou `REDIS_URL` est absent, le serveur démarre silencieusement mais échoue à la première requête, rendant le diagnostic difficile.

```ts
// app/db/client.ts
connectionString: process.env.DATABASE_URL  // pas de validation

// app/lib/server/redis.server.ts
new Redis(process.env.REDIS_URL || "redis://localhost:6379")  // fallback silencieux
```

**Correction recommandée :**  
Utiliser `getEnv()` partout :
```ts
import { getEnv } from "~/config/env.server";
const env = getEnv();
const pool = new pg.Pool({ connectionString: env.DATABASE_URL });
```

---

### 🟡 MOYEN — Rate limiting absent sur les requêtes GET de l'auth

**Fichier :** `app/routes/api.auth.$.ts`

**Description :**  
Le rate limiting n'est appliqué que sur la fonction `action` (requêtes POST). La fonction `loader` (requêtes GET), qui gère certaines routes Better Auth (vérification de session, tokens email, etc.), ne bénéficie d'aucune protection.

```ts
export async function loader({ request }) {
  return auth.handler(request); // pas de rate limiting
}

export async function action({ request }) {
  const rateLimitResponse = await applyRateLimit(request); // protégé
  ...
}
```

**Correction recommandée :**  
Appliquer le rate limiting également dans le loader, ou vérifier quelles routes Better Auth utilisent GET et les cibler spécifiquement.

---

### 🟡 MOYEN — Absence de validation de la réponse aux micro-pronostics

**Fichier :** `app/routes/api.micro-predictions.ts`

**Description :**  
Le champ `answer` soumis par les utilisateurs est inséré en base sans validation de longueur ni de contenu :

```ts
const answer = formData.get("answer") as string;
// Pas de validation, stockage direct en DB
await db.insert(microPredictionAnswers).values({ answer, ... });
```

Un utilisateur peut soumettre une réponse de taille arbitraire (plusieurs Mo), ce qui peut surcharger la base de données ou déclencher des comportements inattendus lors de la comparaison avec `correctAnswer`.

**Correction recommandée :**  
Ajouter une validation Zod :
```ts
const answerSchema = z.string().min(1).max(200).trim();
const result = answerSchema.safeParse(formData.get("answer"));
if (!result.success) return Response.json({ error: "Réponse invalide" }, { status: 400 });
```

---

### 🔵 FAIBLE — Exposition de messages d'erreur internes au client

**Fichiers :** `app/routes/api.sync-matches.ts`, et autres routes API

**Description :**  
En cas d'erreur serveur, le message de l'exception est directement retourné au client :

```ts
const message = error instanceof Error ? error.message : "Erreur inconnue";
return Response.json({ error: message }, { status: 500 });
```

Cela peut exposer des chemins de fichiers, des noms de tables ou d'autres détails d'implémentation exploitables.

**Correction recommandée :**  
En production, ne retourner qu'un message générique et logger l'erreur réelle :
```ts
const isProduction = process.env.NODE_ENV === "production";
const clientMessage = isProduction ? "Une erreur interne s'est produite." : error.message;
return Response.json({ error: clientMessage }, { status: 500 });
```

---

### 🔵 FAIBLE — Vérification du rôle via cast `as any`

**Fichier :** `app/routes/feed.server.ts`

**Description :**  
Le rôle utilisateur est lu avec un cast TypeScript non-typé :

```ts
const isAdmin = (session.user as any).role === "admin";
```

Ce pattern court-circuite la vérification de type de TypeScript. Si la structure de `session.user` change, cette vérification peut silencieusement retourner `false` sans erreur de compilation.

**Correction recommandée :**  
Utiliser `requireAuth(request, ["admin"])` pour les routes admin, ou typer correctement le champ `role` via l'extension de type Better Auth.

---

### 🔵 FAIBLE — Absence d'en-têtes de sécurité HTTP

**Fichiers :** `app/root.tsx`, configuration serveur

**Description :**  
Aucun en-tête de sécurité HTTP n'est configuré (ni dans le code applicatif, ni dans un reverse proxy documenté) :

- `Content-Security-Policy` : absent (risque XSS)
- `X-Frame-Options` : absent (risque clickjacking)
- `Strict-Transport-Security` : absent (risque downgrade HTTPS)
- `X-Content-Type-Options` : absent

**Correction recommandée :**  
Configurer ces en-têtes dans la réponse du serveur React Router ou via le reverse proxy (nginx) sur le NAS Synology :
```nginx
add_header X-Frame-Options "SAMEORIGIN";
add_header X-Content-Type-Options "nosniff";
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains";
add_header Content-Security-Policy "default-src 'self'; ...";
```

---

### 🔵 FAIBLE — Dockerfile exécuté en tant que root

**Fichier :** `Dockerfile`

**Description :**  
L'image Docker finale s'exécute avec l'utilisateur `root` (comportement par défaut de l'image `node:20-alpine`). En cas d'exploitation d'une vulnérabilité applicative, l'attaquant obtient un accès root dans le conteneur.

**Correction recommandée :**  
Ajouter un utilisateur non-privilégié dans le Dockerfile :
```dockerfile
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser
```

---

## Récapitulatif

| Criticité | Nombre | Sujets |
|-----------|--------|--------|
| 🔴 Critique | 1 | Path Traversal uploads |
| 🟠 Élevé | 1 | Mots de passe par défaut en prod |
| 🟡 Moyen | 3 | process.env, rate limiting GET, validation micro-pronos |
| 🔵 Faible | 4 | Messages d'erreur, cast `as any`, headers HTTP, Dockerfile root |

## Points positifs identifiés

- `.gitignore` correctement configuré pour exclure `.env` et les fichiers sensibles ✅
- Validation des variables d'environnement via Zod dans `env.server.ts` ✅
- Rate limiting Redis sur login (10 tentatives / 15 min) et inscription (5 / 1h) ✅
- Upload d'avatar sécurisé : types MIME vérifiés, retraitement via Sharp, taille limitée à 2 Mo ✅
- ORM Drizzle utilisé systématiquement (pas de requêtes SQL brutes) — protection contre l'injection SQL ✅
- Validation Zod sur les formulaires utilisateur (pseudo, email, mot de passe, contenus) ✅
- Vérification des autorisations admin sur toutes les routes sensibles ✅
- Sessions gérées par Better Auth avec stockage Redis ✅
- Logs structurés avec Pino, sans données sensibles visibles ✅
