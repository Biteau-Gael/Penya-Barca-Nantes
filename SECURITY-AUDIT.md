# Rapport d'Audit de Sécurité — Penya Blaugrana Nantes

**Date :** 2026-09-02  
**Stack :** React Router v7, TypeScript, Drizzle ORM (PostgreSQL), Better Auth, Redis, Docker/Nginx  
**Branche analysée :** `main` (dernier commit : `003faca` — fix badges, 2026-04-13)

---

## Résumé des derniers commits

| Commit | Date | Description |
|--------|------|-------------|
| `003faca` | 2026-04-13 | fix: évaluer les badges immédiatement après chaque action |
| `b1c88f6` | 2026-04-13 | feat: Phase 2 — soirée match live, micro-pronos, badges, séries, saisons |
| `68e22d2` | 2026-04-13 | feat: menu burger mobile pour la navigation |
| `554b873` | 2026-04-12 | Add deployment guide for Synology NAS updates |
| `6aebaf7` | 2026-04-12 | Fix Better Auth trusted origins for custom domain support |
| `9823bc5` | 2026-04-12 | Add migrate service to docker-compose.prod.yml for database migrations |
| `8d6e5e9` | 2026-04-12 | Add production Docker Compose and backup script for Synology NAS deployment |
| `3d80133` | 2026-04-12 | docs: roadmap Phase 2 — 8 priorités documentées |
| `aed5841` | 2026-04-12 | security: supprimer credentials du repo et renforcer .gitignore |
| `6583da3` | 2026-04-12 | docs: README complet avec guide de déploiement NAS Synology |

---

## Tableau de synthèse — Problèmes par criticité

| # | Criticité | Problème | Fichier(s) |
|---|-----------|----------|------------|
| 1 | 🔴 CRITIQUE | Path traversal dans la route uploads | `app/routes/uploads-files.ts:5` |
| 2 | 🔴 CRITIQUE | Mots de passe "changeme" par défaut dans Docker | `docker-compose.yml:22`, `docker-compose.prod.yml:20,32` |
| 3 | 🟠 ÉLEVÉ | Usurpation d'IP contourne le rate limiting | `app/routes/api.auth.$.ts:6-9` |
| 4 | 🟠 ÉLEVÉ | Pas de HTTPS — credentials en clair sur le réseau | `docker/nginx/nginx.conf` |
| 5 | 🟠 ÉLEVÉ | En-têtes HTTP de sécurité manquants (CSP, X-Frame…) | `docker/nginx/nginx.conf` |
| 6 | 🟠 ÉLEVÉ | `trustedOrigins` vide si APP_URL non défini | `app/lib/server/auth.server.ts:12` |
| 7 | 🟠 ÉLEVÉ | Inscription ouverte sur une app privée membres | `app/routes/register.tsx`, `auth.server.ts` |
| 8 | 🟡 MOYEN | Ports DB et Redis exposés sur le réseau hôte | `docker-compose.yml:24,34` |
| 9 | 🟡 MOYEN | Endpoint de santé public révèle l'état de l'infra | `app/routes/api.health.ts` |
| 10 | 🟡 MOYEN | Vérification d'e-mail non imposée | `app/lib/server/auth.server.ts` |
| 11 | 🟡 MOYEN | `.dockerignore` n'exclut pas `.env` | `.dockerignore` |
| 12 | 🟡 MOYEN | Cast `as any` sur les vérifications de rôle admin | `app/routes/feed.server.ts:99,124,184,204` |
| 13 | 🟡 MOYEN | Pas de rate limiting sur les endpoints utilisateur | `api.micro-predictions.ts`, `feed.server.ts` |
| 14 | 🟡 MOYEN | `db/client.ts` contourne la validation d'env | `app/db/client.ts:6` |
| 15 | 🟡 MOYEN | MIME type contrôlé par le client lors de l'upload | `app/lib/server/upload.ts:13` |
| 16 | 🟢 BAS | `redis.server.ts` contourne la validation d'env | `app/lib/server/redis.server.ts:3` |
| 17 | 🟢 BAS | Script backup sans vérification d'intégrité ni chiffrement | `backup.sh` |
| 18 | 🟢 BAS | `APP_URL` absent de `.env.example` comme champ requis | `.env.example` |
| 19 | 🟢 BAS | `.gitignore` trop restrictif sur les fichiers sensibles | `.gitignore` |

---

## 🔴 CRITIQUE

### 1. Path Traversal dans la route uploads
**Fichier :** `app/routes/uploads-files.ts:5`

```ts
const filePath = path.join(process.cwd(), "uploads", params["*"]);
```

`params["*"]` est pris directement de l'URL sans validation de frontière. `path.join` résout les segments `..` : une requête vers `/uploads/../../.env` retourne le fichier `.env` de production. Un attaquant peut lire n'importe quel fichier accessible par le process Node.

**Correction :**
```ts
const uploadsRoot = path.join(process.cwd(), "uploads");
const filePath = path.join(uploadsRoot, params["*"]);
if (!filePath.startsWith(uploadsRoot + path.sep)) {
  return new Response("Forbidden", { status: 403 });
}
```

---

### 2. Mots de passe "changeme" par défaut dans Docker Compose
**Fichiers :** `docker-compose.yml:22`, `docker-compose.prod.yml:20,32-34`

```yaml
POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-changeme}
command: redis-server --requirepass ${REDIS_PASSWORD:-changeme}
```

Tout déploiement qui oublie de définir ces variables se retrouve avec des credentials devinables trivialement pour la base de données et le cache. Le fichier de production a le même fallback que le fichier de développement.

**Correction :** Supprimer entièrement les valeurs par défaut. Docker doit refuser de démarrer si les variables sont manquantes. Utiliser Docker Secrets ou un gestionnaire de secrets.

---

## 🟠 ÉLEVÉ

### 3. Usurpation d'IP contourne le rate limiting
**Fichier :** `app/routes/api.auth.$.ts:6-9`

```ts
request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || ...
```

L'en-tête `X-Forwarded-For` est lu sans vérifier que la requête provient bien du proxy nginx. Un attaquant peut ajouter `X-Forwarded-For: 1.2.3.4` pour toujours apparaître comme une IP différente et contourner les limites (10 tentatives/15 min pour le login, 5/h pour l'inscription).

**Correction :** Configurer nginx pour réécrire/filtrer les en-têtes de proxy. Sinon, utiliser une empreinte de session Redis plutôt que l'IP seule.

---

### 4. Pas de HTTPS — credentials transmis en clair
**Fichier :** `docker/nginx/nginx.conf`

Le nginx n'écoute que sur le port 80 (HTTP). Pas de TLS, pas de redirection HTTPS, pas d'en-tête HSTS. Mots de passe, cookies de session et clés API transitent en clair sur le réseau.

**Correction :** Ajouter TLS avec Let's Encrypt (ou certificat Synology), rediriger HTTP → HTTPS, ajouter `Strict-Transport-Security: max-age=31536000; includeSubDomains`.

---

### 5. En-têtes HTTP de sécurité manquants
**Fichier :** `docker/nginx/nginx.conf`

Aucun en-tête de sécurité n'est configuré (nginx ou application). L'architecture mentionne "Helmet" mais il n'est pas implémenté. En-têtes manquants :
- `Content-Security-Policy` — aucune protection XSS
- `X-Frame-Options: DENY` — vulnérable au clickjacking
- `X-Content-Type-Options: nosniff` — MIME sniffing
- `Referrer-Policy`, `Permissions-Policy`

**Correction (nginx) :**
```nginx
add_header X-Frame-Options "DENY";
add_header X-Content-Type-Options "nosniff";
add_header Referrer-Policy "strict-origin-when-cross-origin";
add_header Content-Security-Policy "default-src 'self'; script-src 'self'; ...";
```

---

### 6. `trustedOrigins` vide si APP_URL non défini
**Fichier :** `app/lib/server/auth.server.ts:12`

```ts
trustedOrigins: env.APP_URL ? [env.APP_URL] : [],
```

`APP_URL` est déclaré `optional()` et absent de `.env.example` comme champ requis. Si non défini, Better Auth reçoit un tableau vide — selon la version, soit tous les origines sont acceptés (protection CSRF désactivée), soit toutes les requêtes cross-origin sont rejetées (app cassée).

**Correction :** Rendre `APP_URL` obligatoire dans `env.server.ts` :
```ts
APP_URL: z.string().url("APP_URL doit être une URL valide"),
```

---

### 7. Inscription ouverte sur une app privée membres
**Fichiers :** `app/routes/register.tsx`, `app/lib/server/auth.server.ts`

L'inscription est totalement ouverte. N'importe quel internaute peut créer un compte et accéder aux données des membres, pronostics et profils. Pas de code d'invitation, restriction de domaine, validation admin, ni liste blanche.

**Correction :** Désactiver l'inscription publique et implémenter un flux d'invitation admin, ou restreindre à un domaine e-mail, ou imposer une approbation admin avant l'activation du compte.

---

## 🟡 MOYEN

### 8. Ports DB et Redis exposés sur le réseau hôte
**Fichier :** `docker-compose.yml:24,34`

```yaml
ports:
  - "5432:5432"
  - "6379:6379"
```

Ports liés à `0.0.0.0` sur le NAS — accessible depuis internet si le pare-feu ne bloque pas ces ports. Le `docker-compose.prod.yml` supprime correctement ces mappings, mais le fichier de base les expose.

**Correction :** Supprimer les mappings de ports hôte pour `postgres` et `redis` dans `docker-compose.yml`. En dev uniquement : `"127.0.0.1:5432:5432"`.

---

### 9. Endpoint de santé public révèle l'état de l'infra
**Fichier :** `app/routes/api.health.ts`

`/api/health` est public et retourne :
```json
{ "status": "degraded", "services": { "app": "ok", "db": "error", "redis": "ok" }, "timestamp": "..." }
```

Révèle à un attaquant si la base de données ou Redis est en panne — information utile pour planifier une attaque.

**Correction :** Ajouter une authentification (session admin ou bearer token statique), ou restreindre l'accès dans nginx à une IP interne.

---

### 10. Vérification d'e-mail non imposée
**Fichier :** `app/lib/server/auth.server.ts`

Le schéma DB a `emailVerified: boolean` (défaut `false`), mais `requireEmailVerification: true` n'est pas configuré dans Better Auth. Les utilisateurs accèdent immédiatement à toutes les fonctionnalités sans vérifier qu'ils possèdent l'adresse e-mail.

**Correction :**
```ts
emailAndPassword: {
  enabled: true,
  requireEmailVerification: true,
},
```

---

### 11. `.dockerignore` n'exclut pas `.env`
**Fichier :** `.dockerignore`

Si un fichier `.env` est présent lors d'un `docker build`, le `COPY . /app` du Dockerfile le copie dans l'image. Toute image poussée vers un registry contiendrait les secrets de production.

**Correction :**
```
.env
.env.*
!.env.example
```

---

### 12. Cast `as any` sur les vérifications de rôle admin
**Fichier :** `app/routes/feed.server.ts:99,124,184,204`

```ts
const isAdmin = (session.user as any).role === "admin";
```

`as any` désactive la vérification TypeScript sur cette assertion de sécurité critique. Si le type de session change, la régression sera silencieuse. Le helper `requireAuth` dans `auth-utils.server.ts` type déjà correctement le rôle.

**Correction :** Supprimer les casts `as any` et utiliser `requireAuth(request, ["admin"])` ou typer avec `Role`.

---

### 13. Pas de rate limiting sur les endpoints utilisateur
**Fichiers :** `api.micro-predictions.ts`, `feed.server.ts`

`checkRateLimit` existe et est bien utilisé sur les endpoints d'authentification, mais pas sur les autres actions. Un utilisateur malveillant peut inonder le fil de milliers de posts, soumettre des micro-pronos en masse, ou déclencher des milliers d'appels `evaluateBadges()` (5 requêtes DB chacun).

**Correction :** Appliquer `checkRateLimit` aux actions mutantes : création de post (10/min), réponses de micro-pronos (20/match).

---

### 14. `db/client.ts` contourne la validation d'environnement
**Fichier :** `app/db/client.ts:6`

```ts
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
```

Lit `process.env` directement, contournant la validation Zod de `getEnv()`. Si `DATABASE_URL` est absent, le pool est créé avec `undefined` et échoue au moment d'une requête avec une erreur opaque plutôt qu'au démarrage.

**Correction :** Utiliser `getEnv().DATABASE_URL`.

---

### 15. MIME type contrôlé par le client lors de l'upload d'avatar
**Fichier :** `app/lib/server/upload.ts:13`

```ts
if (!ALLOWED_TYPES.includes(file.type)) { ... }
```

`file.type` est le `Content-Type` soumis par le client HTTP — librement falsifiable. Un fichier malveillant avec `Content-Type: image/jpeg` mais un contenu arbitraire passe le filtre.

**Correction :** S'appuyer sur `sharp` pour valider le contenu réel (il le fait déjà), et/ou utiliser une détection par magic bytes.

---

## 🟢 BAS

### 16. `redis.server.ts` contourne la validation d'environnement
**Fichier :** `app/lib/server/redis.server.ts:3`

```ts
export const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379", {
```

Même problème que `db/client.ts`. Le fallback vers `redis://localhost:6379` (sans mot de passe) peut se connecter silencieusement à un Redis de développement en production si `REDIS_URL` est mal configuré.

**Correction :** Utiliser `getEnv().REDIS_URL`.

---

### 17. Script backup sans vérification d'intégrité ni chiffrement
**Fichier :** `backup.sh`

Le script ne vérifie pas le code de sortie de `pg_dump`. En cas d'échec partiel, un fichier vide ou tronqué est créé et rotationné dans la liste des 30 derniers — invisible jusqu'au moment où on en a besoin. Les dumps SQL sont en clair sur le volume NAS.

**Correction :** Écrire dans un fichier temporaire, vérifier le code de sortie, renommer si succès. Optionnellement chiffrer avec GPG.

---

### 18. `APP_URL` absent de `.env.example` comme champ requis
**Fichier :** `.env.example`

`APP_URL` n'est que commenté. Étant donné que son absence laisse `trustedOrigins` vide (voir point 6), il devrait figurer comme champ obligatoire non commenté.

**Correction :**
```
APP_URL=https://your-domain.com
```

---

### 19. `.gitignore` trop restrictif sur les fichiers sensibles
**Fichier :** `.gitignore`

Seul `.env` (singulier) est exclu. `.env.local`, `.env.production`, `.env.*.local`, `*.pem`, `*.key`, `*.crt`, fichiers de logs — aucun n'est couvert.

**Correction :**
```
.env.*
!.env.example
*.pem
*.key
*.crt
*.log
```

---

## ✅ Points positifs

- Toutes les requêtes DB utilisent le query builder paramétré de Drizzle ORM — risque d'injection SQL très faible.
- `checkRateLimit` correctement appliqué sur les endpoints d'authentification.
- Validation `zod` cohérente sur tous les inputs de formulaire avant insertion en base.
- Toutes les routes admin appellent `requireAuth(request, ["admin"])` en tête — aucune vérification d'autorisation manquante détectée.
- `AUTH_SECRET` validé à minimum 16 caractères via Zod au démarrage.
- Les noms de fichiers d'avatar sont fixés à `${userId}.webp` — pas de nom de fichier contrôlé par l'utilisateur.
- Les stack traces ne sont exposées qu'en mode `import.meta.env.DEV` (`root.tsx`).
- `session.user.id` toujours utilisé côté serveur — aucun `userId` fourni par le client n'est utilisé tel quel.
