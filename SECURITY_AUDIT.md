# Audit de sécurité — Penya Blaugrana Nantes

> Date : 13 mai 2026  
> Branche analysée : `claude/sharp-fermi-NEUCP`  
> Périmètre : code applicatif, configuration Docker, gestion des secrets

---

## 1. Résumé des derniers commits

| Hash | Date | Description |
|------|------|-------------|
| `003faca` | 2026-04-13 | **fix** — Évaluation des badges déclenchée immédiatement après chaque action (feed, match-detail) |
| `b1c88f6` | 2026-04-13 | **feat** — Phase 2 complète : soirée match live, micro-pronostics temps réel, badges, séries, saisons |
| `68e22d2` | 2026-04-13 | **feat** — Menu burger responsive pour la navigation mobile |
| `d461ee5` | 2026-04-12 | **merge** — Intégration de la branche `deploy-synology-nas-cLkOL` |
| `554b873` | 2026-04-12 | **docs** — Guide de mise à jour du déploiement NAS Synology |

---

## 2. Analyse de sécurité par ordre de criticité

---

### 🔴 CRITIQUE

#### C1 — Path Traversal sur le serveur de fichiers statiques
**Fichier :** `app/routes/uploads-files.ts:5`

```ts
const filePath = path.join(process.cwd(), "uploads", params["*"]);
```

Le paramètre wildcard `params["*"]` n'est pas validé avant d'être joint au chemin. Un attaquant peut forger une URL comme `/uploads/../../../etc/passwd` pour lire des fichiers arbitraires sur le serveur.

**Correction recommandée :**

```ts
const uploadsDir = path.join(process.cwd(), "uploads");
const filePath = path.join(uploadsDir, params["*"]);

// Bloquer toute sortie du répertoire uploads
if (!filePath.startsWith(uploadsDir + path.sep)) {
  return new Response("Forbidden", { status: 403 });
}
```

---

### 🟠 ÉLEVÉ

#### E1 — Accès direct à `process.env` hors du schéma de validation
**Fichiers :**
- `app/db/client.ts:6` — `process.env.DATABASE_URL` (sans fallback, sans validation)
- `app/lib/server/redis.server.ts:3` — `process.env.REDIS_URL || "redis://localhost:6379"`
- `app/lib/server/logger.server.ts:4-6` — `process.env.LOG_LEVEL`, `process.env.NODE_ENV`

Le projet dispose d'un schéma Zod centralisé (`app/config/env.server.ts`) mais plusieurs modules l'ignorent et lisent `process.env` directement. Cela contourne la validation au démarrage et peut provoquer des connexions silencieusement mal configurées (ex. Redis en localhost en production si `REDIS_URL` est absent).

**Correction recommandée :** Remplacer les accès directs par `getEnv()` dans ces fichiers.

#### E2 — Mots de passe Docker avec fallback faible
**Fichier :** `docker-compose.prod.yml`

```yaml
POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-changeme}
command: redis-server --requirepass ${REDIS_PASSWORD:-changeme}
```

Si les variables d'environnement ne sont pas définies lors du déploiement, les services démarrent avec le mot de passe `changeme`. Un fichier `.env` manquant ou incomplet en production suffit à exposer la base de données et Redis.

**Correction recommandée :** Supprimer le fallback `:-changeme` pour que Docker Compose échoue explicitement si les variables ne sont pas définies. Documenter cette obligation dans `DEPLOY.md`.

---

### 🟡 MOYEN

#### M1 — Spoofing d'IP possible dans le rate limiting
**Fichier :** `app/routes/api.auth.$.ts:7-11`

```ts
request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
request.headers.get("x-real-ip") ||
"unknown"
```

Ces headers peuvent être falsifiés par un client si l'application n'est pas strictement derrière un reverse proxy de confiance (ex. Nginx). Un attaquant peut contourner le rate limiting en forgeant un `X-Forwarded-For` différent à chaque requête.

**Correction recommandée :** Configurer Nginx/le proxy pour écraser ces headers avec l'IP réelle avant de les transmettre à l'application, ou ajouter une liste blanche de proxies de confiance.

#### M2 — Absence de rate limiting sur les routes de mutation
Seules les routes `/api/auth/sign-in` et `/api/auth/sign-up` sont protégées par rate limiting. Les routes suivantes ne le sont pas :
- `POST /api/micro-predictions` (réponses aux micro-pronos)
- `POST /feed` (création de posts, commentaires, réactions)
- `POST /admin/matches` (synchronisation API Football)

Un utilisateur authentifié pourrait spammer ces endpoints sans limite.

**Correction recommandée :** Appliquer `checkRateLimit` sur les actions sensibles, avec des fenêtres adaptées (ex. 60 posts/heure, 200 réactions/heure).

#### M3 — Headers de sécurité HTTP absents
Aucun en-tête de sécurité HTTP n'est configuré au niveau applicatif :
- `Content-Security-Policy` (protection XSS)
- `X-Frame-Options` (protection clickjacking)
- `X-Content-Type-Options: nosniff`
- `Strict-Transport-Security` (HSTS)
- `Referrer-Policy`

**Correction recommandée :** Configurer ces headers dans Nginx (reverse proxy) ou ajouter un middleware dans `app/root.tsx` / `entry.server.ts`.

#### M4 — `trustedOrigins` vide si `APP_URL` non défini
**Fichier :** `app/lib/server/auth.server.ts`

```ts
trustedOrigins: env.APP_URL ? [env.APP_URL] : [],
```

Si `APP_URL` n'est pas défini (notamment en développement ou lors d'une mauvaise configuration), `trustedOrigins` est un tableau vide. Le comportement de Better Auth dans ce cas (tout autoriser ou tout bloquer) doit être vérifié dans la documentation de la bibliothèque.

**Correction recommandée :** Rendre `APP_URL` obligatoire dans le schéma Zod, ou définir un fallback explicite basé sur `PORT`.

---

### 🟢 BAS / INFORMATION

#### I1 — Utilisation de `sql\`\`` pour une requête sur table `user`
**Fichier :** `app/lib/server/badges.server.ts:140-142`

```ts
.from(sql`"user"`)
.where(sql`id = ${userId}`)
```

`userId` provient de la session serveur (donnée interne, non contrôlée par l'utilisateur), donc le risque d'injection SQL est nul en pratique. Cependant, utiliser les helpers Drizzle natifs (`from(user).where(eq(user.id, userId))`) serait plus cohérent avec le reste du code et éviterait tout doute.

#### I2 — Fichiers uploadés servis sans authentification
**Fichier :** `app/routes/uploads-files.ts`

Les avatars sont accessibles publiquement à `/uploads/avatars/<userId>.webp`. C'est probablement intentionnel (avatars = données publiques), mais mérite une confirmation explicite selon les exigences RGPD/confidentialité du club.

---

## 3. Tableau récapitulatif

| ID | Criticité | Fichier | Description |
|----|-----------|---------|-------------|
| C1 | 🔴 CRITIQUE | `uploads-files.ts:5` | Path traversal — lecture de fichiers arbitraires |
| E1 | 🟠 ÉLEVÉ | `db/client.ts`, `redis.server.ts`, `logger.server.ts` | `process.env` accédé hors validation Zod |
| E2 | 🟠 ÉLEVÉ | `docker-compose.prod.yml` | Mot de passe Docker fallback `changeme` |
| M1 | 🟡 MOYEN | `api.auth.$.ts:7` | Spoofing IP possible pour contourner le rate limit |
| M2 | 🟡 MOYEN | `api.micro-predictions.ts`, `feed.server.ts` | Absence de rate limiting sur les mutations |
| M3 | 🟡 MOYEN | Configuration serveur | Headers de sécurité HTTP manquants |
| M4 | 🟡 MOYEN | `auth.server.ts` | `trustedOrigins` vide si `APP_URL` absent |
| I1 | 🟢 INFO | `badges.server.ts:142` | SQL brut préférable via helpers Drizzle |
| I2 | 🟢 INFO | `uploads-files.ts` | Avatars publics — à confirmer au regard du RGPD |

---

## 4. Points positifs identifiés

- **Secrets hors dépôt** : `.gitignore` couvre `.env`, commit `aed5841` a supprimé des credentials qui avaient été exposés par erreur.
- **Schéma de validation** : `app/config/env.server.ts` centralise la validation des variables d'environnement via Zod.
- **Authentification robuste** : Better Auth avec sessions Redis, `requireAuth()` systématiquement présent sur les routes protégées.
- **Rate limiting sur l'auth** : Implémentation correcte avec Redis sur sign-in (10 tentatives/15 min) et sign-up (5 tentatives/heure).
- **Contrôle des rôles** : Vérification `session.user.role === "admin"` avant chaque action admin, protection contre l'auto-modification de rôle.
- **Uploads sécurisés** : Validation du type MIME, limite de taille à 2 Mo, conversion systématique en WebP via `sharp`, nom de fichier non contrôlé par l'utilisateur (`userId.webp`).
- **ORM paramétré** : Utilisation de Drizzle ORM pour toutes les requêtes principales — pas de concaténation de SQL brut avec des données utilisateur.
- **Dockerfile multi-stage** : Image de production ne contient pas les dépendances de développement.
