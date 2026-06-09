# Audit de Sécurité — Penya Blaugrana Nantes

**Date :** 2026-06-09  
**Branche analysée :** `main` (HEAD : `003faca`)  
**Périmètre :** Commits `16c43e6` → `003faca` (Phase 1 + Phase 2 complètes)

---

## Résumé des derniers commits

| Hash | Auteur | Date | Description |
|------|--------|------|-------------|
| `003faca` | Biteau Gaël | 2026-04-13 | fix: évaluer les badges immédiatement après chaque action |
| `b1c88f6` | Biteau Gaël | 2026-04-13 | feat: Phase 2 — soirée match live, micro-pronos, badges, séries, saisons |
| `68e22d2` | Biteau Gaël | 2026-04-13 | feat: menu burger mobile pour la navigation |
| `d461ee5` | Claude | 2026-04-12 | Merge branch 'claude/deploy-synology-nas-cLkOL' |
| `554b873` | Claude | 2026-04-12 | Add deployment guide for Synology NAS updates |
| `6aebaf7` | Claude | 2026-04-12 | Fix Better Auth trusted origins for custom domain support |
| `9823bc5` | Claude | 2026-04-12 | Add migrate service to docker-compose.prod.yml for database migrations |
| `8d6e5e9` | Claude | 2026-04-12 | Add production Docker Compose and backup script for Synology NAS |
| `3d80133` | Biteau Gaël | 2026-04-12 | docs: roadmap Phase 2 — 8 priorités documentées |
| `aed5841` | Biteau Gaël | 2026-04-12 | security: supprimer credentials du repo et renforcer .gitignore |
| `6583da3` | Biteau Gaël | 2026-04-12 | docs: README complet avec guide de déploiement NAS Synology |
| `ab7fc5d` | Biteau Gaël | 2026-04-12 | feat: intégration API Football + stats enrichies + classement Liga |
| `16c43e6` | Biteau Gaël | 2026-04-11 | feat: MVP Phase 1 — Penya Blaugrana Nantes |

---

## Analyse de sécurité par ordre de criticité

---

### 🔴 CRITIQUE

#### C-01 — Path Traversal sur le serveur de fichiers statiques

**Fichier :** `app/routes/uploads-files.ts` (ligne 5)  
**OWASP :** A05:2021 – Security Misconfiguration / A01:2021 – Broken Access Control

```typescript
const filePath = path.join(process.cwd(), "uploads", params["*"]);
```

`path.join()` résout les séquences `..` nativement en Node.js. Un attaquant peut donc construire une URL comme `/uploads/../../.env` ou `/uploads/../../app/lib/server/auth.server.ts` via un client HTTP direct (curl avec `--path-as-is`) pour lire des fichiers arbitraires sur le système.

**Impact :** Lecture du fichier `.env` (base de données, clés API), lecture du code source, exposition de `AUTH_SECRET`.

**Correction recommandée :**

```typescript
export async function loader({ params }: { params: { "*": string } }) {
  const requestedPath = params["*"];
  const uploadRoot = path.resolve(process.cwd(), "uploads");
  const filePath = path.resolve(uploadRoot, requestedPath);

  // Garantir que le chemin résolu est bien dans le dossier uploads
  if (!filePath.startsWith(uploadRoot + path.sep)) {
    return new Response("Forbidden", { status: 403 });
  }
  // ... suite identique
}
```

---

### 🟠 ÉLEVÉ

#### H-01 — Mots de passe par défaut en production (Docker Compose)

**Fichier :** `docker-compose.prod.yml` (lignes 22, 33)  
**OWASP :** A07:2021 – Identification and Authentication Failures

```yaml
POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-changeme}
redis-server --requirepass ${REDIS_PASSWORD:-changeme}
```

Si les variables d'environnement `POSTGRES_PASSWORD` et `REDIS_PASSWORD` ne sont pas définies dans le `.env` de production, les services démarrent avec le mot de passe `changeme`. Un oubli de configuration expose intégralement la base de données et Redis.

**Impact :** Accès complet à la base de données, invalidation de sessions, manipulation des données utilisateurs.

**Correction recommandée :** Supprimer les valeurs par défaut pour forcer l'erreur au démarrage si non configuré, ou utiliser `docker-compose config` pour valider avant déploiement :

```yaml
POSTGRES_PASSWORD=${POSTGRES_PASSWORD:?POSTGRES_PASSWORD must be set}
```

---

#### H-02 — Absence de rate limiting sur l'authentification et l'inscription

**Fichiers :** `app/routes/register.tsx`, `app/routes/login.tsx`, `app/routes/api.micro-predictions.ts`  
**OWASP :** A07:2021 – Identification and Authentication Failures

L'infrastructure de rate limiting existe (`app/lib/server/rate-limit.server.ts`) mais elle n'est pas appliquée sur :
- La route d'inscription (`/inscription`) — brute force de création de comptes
- La route de connexion (`/connexion`) — brute force de mots de passe
- L'intent `answer` des micro-pronostics — spam de réponses via des scripts automatisés

**Impact :** Attaque par force brute sur les mots de passe, création massive de faux comptes, spam de réponses aux micro-pronos.

**Correction recommandée :** Appliquer `checkRateLimit` dans les actions de connexion/inscription, par exemple :

```typescript
await checkRateLimit({
  key: `login:${ip}`,
  maxAttempts: 5,
  windowSeconds: 300,
});
```

Pour les micro-pronos :
```typescript
if (intent === "answer") {
  await checkRateLimit({
    key: `micro-answer:${session.user.id}`,
    maxAttempts: 20,
    windowSeconds: 60,
  });
```

---

#### H-03 — Endpoint de santé exposé sans authentification

**Fichier :** `app/routes/api.health.ts`  
**OWASP :** A05:2021 – Security Misconfiguration

```typescript
// Aucune vérification d'auth avant de retourner l'état des services
export async function loader() {
  // Expose: {"status":"ok","services":{"app":"ok","db":"ok","redis":"ok"}}
}
```

L'endpoint `/api/health` est accessible publiquement et révèle l'état des services internes (PostgreSQL, Redis). Cette information aide un attaquant à cartographier l'infrastructure, identifier les fenêtres de maintenance et cibler ses attaques.

**Impact :** Reconnaissance d'infrastructure, détection des périodes de vulnérabilité.

**Correction recommandée :** Restreindre l'accès par IP (réseau local uniquement), ou ajouter un token secret dans l'en-tête de requête :

```typescript
const token = request.headers.get("x-health-token");
if (token !== env.HEALTH_CHECK_TOKEN) {
  return new Response("Unauthorized", { status: 401 });
}
```

---

#### H-04 — Absence de headers de sécurité HTTP et de HTTPS

**Fichiers :** `docker/nginx/nginx.conf`, aucun middleware de headers configuré  
**OWASP :** A05:2021 – Security Misconfiguration / A02:2021 – Cryptographic Failures

**Problème 1 — Nginx en HTTP uniquement (port 80) :** Tout le trafic transite en clair. Les sessions, tokens et données des membres sont transmis sans chiffrement.

**Problème 2 — Aucun header de sécurité dans Nginx :**
```nginx
location / {
    proxy_pass http://app;
    # Absent : X-Frame-Options, Content-Security-Policy,
    #          X-Content-Type-Options, Strict-Transport-Security
}
```

**Impact :** Interception des sessions (MITM), clickjacking, XSS amplifié, sniffing de contenu.

**Correction recommandée pour Nginx :**

```nginx
server {
    listen 443 ssl;
    ssl_certificate /etc/ssl/certs/fullchain.pem;
    ssl_certificate_key /etc/ssl/private/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;

    add_header X-Frame-Options "DENY" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header Content-Security-Policy "default-src 'self'; img-src 'self' https://images.fotmob.com data:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline';" always;
    # ... reste inchangé
}
server {
    listen 80;
    return 301 https://$host$request_uri;
}
```

---

### 🟡 MOYEN

#### M-01 — Redis initialisé hors validation Zod (bypass sécurité)

**Fichier :** `app/lib/server/redis.server.ts` (ligne 3)  
**OWASP :** A05:2021 – Security Misconfiguration

```typescript
export const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379", {
  maxRetriesPerRequest: 3,
  lazyConnect: true,
});
```

`process.env.REDIS_URL` est lu directement, contournant la validation Zod de `env.server.ts`. En production, si `REDIS_URL` est absent ou mal formé, l'application se connecte silencieusement à `localhost:6379` sans mot de passe.

**Impact :** En production sur NAS Synology, si `REDIS_URL` n'est pas injecté dans le conteneur, Redis tourne sans authentification et est accessible depuis tous les services du réseau interne.

**Correction recommandée :**

```typescript
import { getEnv } from "~/config/env.server";
const { REDIS_URL } = getEnv();
export const redis = new Redis(REDIS_URL, { maxRetriesPerRequest: 3, lazyConnect: true });
```

---

#### M-02 — Exposition de messages d'erreur internes dans l'API

**Fichier :** `app/routes/api.sync-matches.ts` (ligne 21)  
**OWASP :** A09:2021 – Security Logging and Monitoring Failures

```typescript
const message = error instanceof Error ? error.message : "Erreur inconnue";
return Response.json({ error: message }, { status: 500 });
```

Si l'API Football répond avec une erreur incluant la clé API dans le corps de la réponse ou dans un message d'exception, cette clé serait exposée au client. De plus, les messages d'erreur internes (stack traces indirectes, noms de tables) peuvent fuiter des informations sur l'architecture.

**Correction recommandée :**

```typescript
logger.error({ error }, "Erreur sync API-Football");
return Response.json({ error: "Synchronisation échouée. Consultez les logs serveur." }, { status: 500 });
```

---

#### M-03 — Session non invalidée lors de la suppression de compte

**Fichier :** `app/routes/profile.server.ts` (lignes 127-131)  
**OWASP :** A07:2021 – Identification and Authentication Failures

```typescript
if (intent === "delete-account") {
  await db.delete(user).where(eq(user.id, session.user.id));
  return { success: true, message: "Compte supprimé.", deleted: true };
}
```

Le compte est supprimé en base mais la session Redis reste active jusqu'à son expiration naturelle. Un token volé ou une session ouverte dans un autre navigateur reste valide après suppression.

**Correction recommandée :**

```typescript
await db.delete(user).where(eq(user.id, session.user.id));
await auth.api.revokeSession({ headers: request.headers });
return { success: true, deleted: true };
```

---

#### M-04 — Dockerfile exécuté en tant que root

**Fichier :** `Dockerfile`  
**OWASP :** A05:2021 – Security Misconfiguration

```dockerfile
FROM node:20-alpine
# Aucune instruction USER — le processus tourne en root dans le conteneur
CMD ["npm", "run", "start"]
```

Le conteneur de production tourne avec les privilèges root. En cas de compromission de l'application (RCE via une dépendance vulnérable), l'attaquant obtient un accès root dans le conteneur.

**Correction recommandée :**

```dockerfile
FROM node:20-alpine
# ...
RUN chown -R node:node /app
USER node
CMD ["npm", "run", "start"]
```

---

#### M-05 — Vérification du type MIME côté client pour les uploads

**Fichier :** `app/lib/server/upload.ts` (ligne 13)  
**OWASP :** A04:2021 – Insecure Design

```typescript
if (!ALLOWED_TYPES.includes(file.type)) {
  throw new Error("Format non supporté.");
}
```

`file.type` provient du navigateur et peut être falsifié. Un fichier malveillant peut être envoyé avec `Content-Type: image/jpeg` alors qu'il contient autre chose.

**Note :** Sharp retraite le contenu binaire et rejette les fichiers non reconnus — risque significativement atténué. Mais `file.type` seul ne suffit pas comme première ligne de défense.

**Correction recommandée :** S'appuyer sur Sharp comme validateur de contenu réel (déjà en place). Envelopper l'appel dans un `try/catch` explicite renvoyant un message générique (déjà présent — risque mitigé).

---

#### M-06 — Race condition dans le rate limiter Redis

**Fichier :** `app/lib/server/rate-limit.server.ts` (lignes 16-18)  
**OWASP :** A04:2021 – Insecure Design

```typescript
const current = await redis.incr(redisKey);
if (current === 1) {
  await redis.expire(redisKey, windowSeconds);  // Non atomique avec INCR
}
```

Si le processus crash entre `INCR` et `EXPIRE`, la clé reste sans TTL et n'expire jamais → blocage permanent des utilisateurs légitimes.

**Correction recommandée :**

```typescript
const pipeline = redis.pipeline();
pipeline.incr(redisKey);
pipeline.expire(redisKey, windowSeconds, "NX");
const [current] = await pipeline.exec() as [number, ...unknown[]];
```

---

#### M-07 — Utilisation de `as any` pour les vérifications de rôles

**Fichiers :** `app/routes/feed.server.ts` (lignes 99, 124, 184), `app/routes/match-detail.server.ts`  
**OWASP :** A01:2021 – Broken Access Control

```typescript
isAdmin: (session.user as any).role === "admin"
```

Le cast `as any` contourne le système de types TypeScript. Si `session.user` change de structure, cette vérification peut silencieusement retourner `false` sans erreur de compilation.

**Correction recommandée :**

```typescript
import type { Role } from "~/lib/server/auth-utils.server";
const userRole = session.user.role as Role;
const isAdmin = userRole === "admin";
```

---

#### M-08 — Parsing JSON non validé dans le moteur de badges

**Fichier :** `app/lib/server/badges.server.ts` (ligne 172)  
**OWASP :** A03:2021 – Injection

```typescript
const condition = JSON.parse(badge.condition) as { type: string; threshold: number };
```

La condition des badges est stockée en JSON dans la base de données et parsée sans validation du schéma. Si la table `badges` est corrompue ou manipulée (via une injection SQL dans un autre vecteur), ce code peut lever une exception non gérée ou traiter des données inattendues.

**Correction recommandée :** Valider avec Zod :

```typescript
const conditionSchema = z.object({
  type: z.enum(["predictions_count", "exact_scores", "total_points", "best_streak",
                 "comments_count", "reactions_count", "posts_count", "account_created"]),
  threshold: z.number().int().positive(),
});
const condition = conditionSchema.parse(JSON.parse(badge.condition));
```

---

### 🟢 FAIBLE / INFORMATIF

#### L-01 — Niveau de log depuis `process.env` direct (bypass de validation)

**Fichier :** `app/lib/server/logger.server.ts` (ligne 3)  
**OWASP :** Informatif

```typescript
level: process.env.LOG_LEVEL || "info",
```

Cette lecture directe de `process.env` contourne la validation Zod définie dans `env.server.ts`. En production, un `LOG_LEVEL=debug` accidentel exposerait des logs détaillés.

**Correction recommandée :** Utiliser `getEnv().LOG_LEVEL`.

---

#### L-02 — Email retourné dans la réponse profil

**Fichier :** `app/routes/profile.server.ts` (ligne 84)

L'email de l'utilisateur est inclus dans la réponse loader. C'est attendu pour la page de profil personnelle, mais il faut s'assurer que cette route n'est jamais accessible par d'autres utilisateurs (elle est protégée par `requireAuth` sans `memberId` — OK).

---

#### L-03 — `APP_URL` optionnel crée des trusted origins vides

**Fichier :** `app/lib/server/auth.server.ts` (ligne 12)

```typescript
trustedOrigins: env.APP_URL ? [env.APP_URL] : [],
```

Si `APP_URL` n'est pas défini, `trustedOrigins` est vide. Better Auth avec une liste vide pourrait accepter toutes les origines ou au contraire en rejeter. Vérifier le comportement par défaut de la bibliothèque.

**Recommandation :** Rendre `APP_URL` obligatoire dans `env.server.ts` pour la production, ou documenter le comportement exact quand la liste est vide.

---

#### L-04 — Réseau Docker sans isolation inter-services

**Fichier :** `docker-compose.prod.yml`

Les services (`app`, `postgres`, `redis`) partagent le réseau Docker par défaut sans réseau nommé explicite. Un service compromis peut atteindre tous les autres. Ajouter un réseau interne dédié :

```yaml
networks:
  internal:
    driver: bridge
services:
  app:
    networks: [internal]
  postgres:
    networks: [internal]
  redis:
    networks: [internal]
```

---

## Points positifs identifiés

| Élément | Observation |
|---------|-------------|
| `auth-utils.server.ts` | `requireAuth` centralise correctement les contrôles d'accès avec vérification du rôle |
| `admin.dashboard.server.ts` | Toutes les routes admin vérifient explicitement `["admin"]` |
| `upload.ts` | Validation taille + types + retraitement Sharp — bonne approche |
| `env.server.ts` | Validation Zod complète des variables d'environnement au démarrage |
| `aed5841` | Commit explicite de suppression des credentials du repo |
| `.gitignore` | `.env`, `uploads/`, `node_modules/` correctement exclus |
| ORM Drizzle | Requêtes paramétrées par défaut — pas d'injection SQL directe détectée |
| `api.sync-matches.ts` | Route admin-only correctement protégée |
| `feed.server.ts` | Vérification d'ownership avant suppression de post/commentaire |

---

## Matrice de risque résumée

| ID | Sévérité | Fichier principal | Effort de correction | Priorité |
|----|----------|-------------------|----------------------|----------|
| C-01 | 🔴 CRITIQUE | `uploads-files.ts` | Faible (3 lignes) | **Immédiat** |
| H-01 | 🟠 ÉLEVÉ | `docker-compose.prod.yml` | Faible (2 lignes) | Sprint actuel |
| H-02 | 🟠 ÉLEVÉ | `login.tsx`, `register.tsx`, `api.micro-predictions.ts` | Moyen | Sprint actuel |
| H-03 | 🟠 ÉLEVÉ | `api.health.ts` | Faible | Sprint actuel |
| H-04 | 🟠 ÉLEVÉ | `nginx.conf` + configuration globale | Moyen | Sprint actuel |
| M-01 | 🟡 MOYEN | `redis.server.ts` | Trivial (2 lignes) | Sprint actuel |
| M-02 | 🟡 MOYEN | `api.sync-matches.ts` | Trivial (1 ligne) | Sprint actuel |
| M-03 | 🟡 MOYEN | `profile.server.ts` | Faible | Prochain sprint |
| M-04 | 🟡 MOYEN | `Dockerfile` | Faible (2 lignes) | Prochain sprint |
| M-05 | 🟡 MOYEN | `upload.ts` | Faible (mitigé par Sharp) | Prochain sprint |
| M-06 | 🟡 MOYEN | `rate-limit.server.ts` | Faible | Prochain sprint |
| M-07 | 🟡 MOYEN | `feed.server.ts` et autres | Faible | Prochain sprint |
| M-08 | 🟡 MOYEN | `badges.server.ts` | Faible | Prochain sprint |
| L-01 | 🟢 FAIBLE | `logger.server.ts` | Trivial | Backlog |
| L-02 | 🟢 FAIBLE | `profile.server.ts` | N/A (OK) | — |
| L-03 | 🟢 FAIBLE | `auth.server.ts` | Trivial | Backlog |
| L-04 | 🟢 FAIBLE | `docker-compose.prod.yml` | Faible | Backlog |
