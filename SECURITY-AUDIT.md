# Audit de sécurité — Penya Blaugrana Nantes

> Date : 2026-05-29  
> Branche analysée : `main` (HEAD `003faca`)  
> Périmètre : code applicatif (TypeScript/React Router), configuration Docker, gestion des secrets

---

## Résumé des derniers commits

| Hash | Type | Description |
|------|------|-------------|
| `003faca` | fix | Évaluation des badges immédiatement après chaque action (feed, match-detail) |
| `b1c88f6` | feat | **Phase 2** — Soirée match live, micro-pronos, badges, séries, saisons (schéma DB + routes) |
| `d461ee5` | merge | Fusion de la branche `deploy-synology-nas-cLkOL` |
| `554b873` | docs | Guide de déploiement pour les mises à jour Synology NAS |
| `68e22d2` | feat | Menu burger mobile pour la navigation (header responsive) |
| `6aebaf7` | fix | Better Auth : trusted origins pour le domaine personnalisé |
| `9823bc5` | feat | Service `migrate` dans `docker-compose.prod.yml` |
| `8d6e5e9` | feat | Docker Compose production + script de sauvegarde Synology NAS |
| `3d80133` | docs | Roadmap Phase 2 documentée |
| `aed5841` | security | Suppression des credentials du repo + renforcement `.gitignore` |

---

## Analyse de sécurité par ordre de criticité

---

### 🔴 CRITIQUE

#### C1 — Path Traversal sur le endpoint de fichiers uploadés

**Fichier :** `app/routes/uploads-files.ts`

```ts
const filePath = path.join(process.cwd(), "uploads", params["*"]);
const file = await readFile(filePath);
```

`params["*"]` est directement contrôlé par l'utilisateur (URL). `path.join` résout les segments `..`, ce qui permet de sortir du répertoire `uploads/` et de lire n'importe quel fichier accessible au processus Node.js (par exemple `../../app/config/env.server.ts` ou `../../etc/passwd`).

**Correction :**

```ts
const UPLOAD_ROOT = path.resolve(process.cwd(), "uploads");
const filePath = path.resolve(UPLOAD_ROOT, params["*"]);

if (!filePath.startsWith(UPLOAD_ROOT + path.sep)) {
  return new Response("Not found", { status: 404 });
}
```

**Priorité :** Corriger avant la mise en production.

---

### 🟠 HAUTE

#### H1 — Absence de headers de sécurité HTTP

**Fichier :** `app/root.tsx` (et l'ensemble du serveur)

Aucun header de sécurité n'est positionné : pas de `Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Options`, `Strict-Transport-Security` ni `Referrer-Policy`. Sans CSP, toute injection de script non détectée devient exploitable.

**Correction recommandée** — ajouter un `headers()` export dans `root.tsx` ou via un middleware React Router :

```ts
export function headers() {
  return {
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Strict-Transport-Security": "max-age=63072000; includeSubDomains",
    "Content-Security-Policy": "default-src 'self'; ...",
  };
}
```

---

#### H2 — Mots de passe par défaut faibles dans Docker Compose production

**Fichier :** `docker-compose.prod.yml`

```yaml
POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-changeme}
redis-server --requirepass ${REDIS_PASSWORD:-changeme}
```

Si le fichier `.env` n'est pas fourni (premier démarrage, CI/CD non configuré), PostgreSQL et Redis démarrent avec le mot de passe `changeme`.

**Correction :** Supprimer les valeurs par défaut ou les remplacer par une erreur explicite :

```yaml
POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?Variable POSTGRES_PASSWORD manquante}
```

---

#### H3 — Conteneur Docker s'exécute en tant que root

**Fichier :** `Dockerfile`

L'image finale n'a pas de directive `USER`. Le processus Node.js s'exécute donc en tant que `root` dans le conteneur, amplifiant l'impact de toute vulnérabilité d'exécution de code.

**Correction :** Ajouter avant `CMD` :

```dockerfile
RUN addgroup -S app && adduser -S app -G app
USER app
```

---

#### H4 — Accès direct à `process.env` sans validation dans les modules critiques

**Fichiers :**
- `app/db/client.ts` — `process.env.DATABASE_URL` (sans validation Zod)
- `app/lib/server/redis.server.ts` — `process.env.REDIS_URL` (sans validation)
- `app/lib/server/logger.server.ts` — `process.env.LOG_LEVEL` et `process.env.NODE_ENV`

Ces modules court-circuitent le schéma de validation centralisé (`config/env.server.ts`). Une variable manquante ou mal typée provoquera une erreur non explicite à l'exécution plutôt qu'au démarrage.

**Correction :** Remplacer les accès directs par `getEnv().DATABASE_URL`, etc.

---

### 🟡 MOYENNE

#### M1 — `trustedOrigins` vide si `APP_URL` non défini

**Fichier :** `app/lib/server/auth.server.ts`

```ts
trustedOrigins: env.APP_URL ? [env.APP_URL] : [],
```

Selon le comportement de Better Auth avec un tableau vide, toutes les origines pourraient être acceptées (mode permissif par défaut) ou aucune (blocage total). Dans les deux cas, le comportement est ambigu et non intentionnel.

**Correction :** Rendre `APP_URL` obligatoire dans `env.server.ts` (retirer `.optional()`) et documenter cette exigence.

---

#### M2 — `pointsScheme` accepté sans liste blanche

**Fichier :** `app/routes/admin.matches.server.ts`

```ts
const pointsScheme = (formData.get("pointsScheme") as string) || "standard";
```

La valeur est stockée en base sans validation contre les valeurs connues (`"standard"`, `"bonus"`, etc.). Une valeur arbitraire pourrait provoquer un comportement inattendu dans `calculatePoints()`.

**Correction :**

```ts
const VALID_SCHEMES = ["standard", "bonus"] as const;
const pointsScheme = VALID_SCHEMES.includes(raw as any) ? raw : "standard";
```

---

#### M3 — `(session.user as any).role` contourne la vérification TypeScript

**Fichiers :** `app/routes/feed.server.ts`, `app/routes/soiree.server.ts`

```ts
const isAdmin = (session.user as any).role === "admin";
```

Ce cast supprime la protection du compilateur TypeScript sur les accès de rôle. Une refactorisation du type `session.user` pourrait supprimer silencieusement la propriété `role` sans erreur de compilation.

**Correction :** Typer correctement `session.user` en étendant le type Better Auth avec les champs additionnels déclarés.

---

#### M4 — IP client extraite de `x-forwarded-for` sans vérification de proxy de confiance

**Fichier :** `app/routes/api.auth.$.ts`

```ts
request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
```

Le header `x-forwarded-for` peut être forgé par n'importe quel client si l'application n'est pas derrière un proxy de confiance. Un attaquant peut contourner le rate limiting en changeant la valeur de ce header à chaque requête.

**Correction :** Documenter que l'application doit impérativement être derrière un reverse-proxy (Nginx/Traefik) qui écrase ce header, et l'ajouter dans le `DEPLOY.md`.

---

### 🟢 FAIBLE / AMÉLIORATION

#### F1 — `AUTH_SECRET` minimum 16 caractères (recommandé : 32+)

**Fichier :** `app/config/env.server.ts`

```ts
AUTH_SECRET: z.string().min(16),
```

16 caractères est le minimum toléré, mais les bonnes pratiques recommandent 32 caractères minimum pour les secrets de session (entropie suffisante contre les attaques par force brute sur les tokens).

---

#### F2 — N+1 requêtes SQL dans `feedLoader`

**Fichier :** `app/routes/feed.server.ts`

Pour chaque post chargé (jusqu'à 50), 3 requêtes SQL sont exécutées séparément (réactions, commentaires, réaction utilisateur). Soit jusqu'à **150 requêtes par chargement de page**.

**Correction :** Utiliser des jointures avec agrégation ou un chargement en batch par liste d'IDs.

---

#### F3 — `.gitignore` exclut tous les fichiers `*.png`

**Fichier :** `.gitignore`

```
*.png
```

Cette règle globale empêche de versionner des assets publics (logos, icônes) présents dans `public/`. Si des images doivent être committées, il faut scoper la règle à un répertoire (`uploads/*.png`).

---

## Bilan

| Criticité | Nombre | Statut |
|-----------|--------|--------|
| Critique  | 1      | A corriger avant mise en production |
| Haute     | 4      | A corriger dans le prochain sprint |
| Moyenne   | 4      | A planifier |
| Faible    | 3      | Améliorations souhaitables |

### Points positifs constatés

- Authentification gérée par Better Auth (bibliothèque éprouvée)
- Rate limiting correctement implémenté sur les routes d'authentification (`/api/auth/sign-in`, `/api/auth/sign-up`)
- Validation Zod des variables d'environnement centralisée
- Validation des données formulaire côté serveur (Zod) sur les routes admin
- ORM Drizzle utilisé partout — aucune requête SQL brute avec interpolation utilisateur détectée
- Protection RBAC cohérente (`requireAuth` + vérification de rôle) sur toutes les routes admin
- Upload d'avatar avec retraitement via Sharp (type MIME vérifié, taille limitée à 2 Mo)
- Logs structurés (pino) sans exposition d'informations sensibles en production
- Stack applicative dans la pile, secrets déjà supprimés du repo (`aed5841`)
