# Rapport d'audit de sécurité — Penya Barca Nantes

**Date** : 2026-05-26  
**Branche analysée** : `main` (commit `003faca`)  
**Périmètre** : Application React Router + Node.js, infrastructure Docker, configuration CI/CD

---

## Résumé des derniers commits

| Commit | Message | Impact sécurité |
|--------|---------|-----------------|
| `003faca` | fix: évaluer les badges immédiatement après chaque action | Aucun |
| `b1c88f6` | feat: Phase 2 — soirée match live, micro-pronos, badges, séries, saisons | Ajout de nouvelles routes API — voir findings |
| `d461ee5` | Merge branch deploy-synology-nas | Infrastructure prod |
| `554b873` | Add deployment guide for Synology NAS updates | Documentation |
| `68e22d2` | feat: menu burger mobile | Aucun |
| `6aebaf7` | Fix Better Auth trusted origins for custom domain support | Config auth corrigée |
| `9823bc5` | Add migrate service to docker-compose.prod.yml | Infrastructure |
| `8d6e5e9` | Add production Docker Compose and backup script for Synology NAS | Infrastructure prod |
| `aed5841` | **security: supprimer credentials du repo et renforcer .gitignore** | Correctif sécurité — voir findings |
| `ab7fc5d` | feat: intégration API Football + stats enrichies + classement Liga | Ajout clé API externe |

---

## Findings par ordre de criticité

---

### 🔴 CRITIQUE

#### SEC-01 — Path traversal sur le endpoint de fichiers uploads

**Fichier** : `app/routes/uploads-files.ts:5`  
**Vecteur** : Accès non authentifié possible à n'importe quel fichier du système

```typescript
const filePath = path.join(process.cwd(), "uploads", params["*"]);
```

`params["*"]` capture le wildcard React Router sans aucune sanitisation. La fonction `path.join` de Node.js **résout les segments `..`**, permettant à un attaquant de remonter l'arborescence :

```
GET /uploads/../../etc/passwd
→ filePath = /etc/passwd  ✓ lu et renvoyé
```

Vérification confirmée :
```
path.join('/app/uploads', '../etc/passwd')    → /app/etc/passwd
path.join('/app/uploads', '../../etc/passwd') → /etc/passwd
```

**Impact** : Lecture de fichiers système (`.env`, `package.json`, clés privées, `/etc/shadow`...).

**Correction** :
```typescript
export async function loader({ params }: { params: { "*": string } }) {
  const UPLOAD_DIR = path.join(process.cwd(), "uploads");
  const requested = params["*"];
  const filePath = path.join(UPLOAD_DIR, requested);

  // Empêcher la remontée hors du dossier uploads
  if (!filePath.startsWith(UPLOAD_DIR + path.sep)) {
    return new Response("Not found", { status: 404 });
  }
  // ... reste du code
}
```

---

### 🟠 HAUTE

#### SEC-02 — Credentials en clair dans l'historique git

**Commit concerné** : `fec3e63` puis corrigé en `aed5841`  
**Données exposées** :

```
DATABASE_URL=postgresql://penya:penya_secret@postgres:5432/penya_barca_nantes
POSTGRES_PASSWORD=penya_secret
AUTH_SECRET=${AUTH_SECRET:-change-me-in-production}
```

Ces valeurs sont accessibles via `git show fec3e63` ou `git log -p`. Même si elles semblent être des placeholders de développement, **tout historique git cloné publiquement ou partagé les expose**.

**Impact** : Si ces mots de passe (`penya_secret`, `change-me-in-production`) sont réutilisés en production, les bases de données sont compromises.

**Actions à mener** :
1. Vérifier que la production n'utilise PAS ces valeurs.
2. Si le dépôt est public ou peut être partagé, purger l'historique avec `git filter-repo` ou `BFG Repo-Cleaner`.
3. Faire un audit des accès au dépôt.

---

#### SEC-03 — Absence totale d'en-têtes HTTP de sécurité

**Fichiers** : `docker/nginx/nginx.conf`, `app/root.tsx`

Aucun des en-têtes de sécurité standard n'est configuré :

| En-tête manquant | Risque |
|-----------------|--------|
| `Content-Security-Policy` | XSS, injection de ressources |
| `X-Frame-Options` | Clickjacking |
| `X-Content-Type-Options` | MIME sniffing |
| `Strict-Transport-Security` | Downgrade HTTPS → HTTP |
| `Referrer-Policy` | Fuite d'URL dans les requêtes |
| `Permissions-Policy` | Accès caméra/micro non restreint |

**Correction** — Ajouter dans `docker/nginx/nginx.conf` :
```nginx
add_header X-Frame-Options "SAMEORIGIN" always;
add_header X-Content-Type-Options "nosniff" always;
add_header X-XSS-Protection "1; mode=block" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;
add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' https://fonts.gstatic.com;" always;
# En production HTTPS uniquement :
# add_header Strict-Transport-Security "max-age=63072000; includeSubDomains" always;
```

---

### 🟡 MOYENNE

#### SEC-04 — `trustedOrigins` vide si `APP_URL` n'est pas défini

**Fichier** : `app/lib/server/auth.server.ts:12`

```typescript
trustedOrigins: env.APP_URL ? [env.APP_URL] : [],
```

`APP_URL` est optionnel (`z.string().optional()`). Si non défini, `trustedOrigins` est un tableau vide. Selon la version de Better Auth, un tableau vide peut désactiver la vérification d'origine, exposant les endpoints d'authentification aux attaques CSRF cross-origin.

**Correction** : Rendre `APP_URL` obligatoire en production, ou définir une valeur par défaut sécurisée :
```typescript
trustedOrigins: env.APP_URL ? [env.APP_URL] : (env.NODE_ENV === "production" ? [] : ["http://localhost:3000"]),
```
Vérifier dans la doc Better Auth le comportement avec un tableau vide.

---

#### SEC-05 — Usurpation possible de l'IP pour contourner le rate-limiting

**Fichier** : `app/routes/api.auth.$.ts:5-11`

```typescript
function getClientIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}
```

Un attaquant peut envoyer un header `X-Forwarded-For: 1.2.3.4` falsifié, contournant la limite par IP et effectuant un nombre illimité de tentatives de login/inscription.

**Impact** : Brute force sur les mots de passe.

**Correction** : Lire uniquement le **dernier** IP de la chaîne X-Forwarded-For (celui ajouté par le reverse proxy de confiance), ou se baser sur une IP de connexion TCP fournie par l'infrastructure :
```typescript
// Prendre le dernier segment (ajouté par le proxy de confiance, non modifiable par le client)
const forwarded = request.headers.get("x-forwarded-for");
const ip = forwarded 
  ? forwarded.split(",").at(-1)?.trim() ?? "unknown"
  : request.headers.get("x-real-ip") ?? "unknown";
```

---

#### SEC-06 — Mot de passe par défaut "changeme" dans docker-compose.yml

**Fichier** : `docker-compose.yml:22,32`

```yaml
POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-changeme}
redis-server --requirepass ${REDIS_PASSWORD:-changeme}
```

Si le fichier `.env` est absent ou incomplet lors d'un démarrage en production (erreur humaine), les services démarrent avec `changeme` comme mot de passe — un mot de passe trivial.

**Correction** : Supprimer les valeurs par défaut dans `docker-compose.yml` (ne pas mettre de fallback `:-`) pour que Docker Compose échoue explicitement si les variables ne sont pas définies.

---

#### SEC-07 — Dockerfile s'exécute en tant que root

**Fichier** : `Dockerfile`

L'image finale hérite de `node:20-alpine` sans créer d'utilisateur non-privilégié. Si l'application est compromise, l'attaquant dispose des droits root dans le conteneur.

**Correction** :
```dockerfile
FROM node:20-alpine
# ...
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001
USER nextjs
WORKDIR /app
CMD ["npm", "run", "start"]
```

---

#### SEC-08 — Ports PostgreSQL et Redis exposés dans docker-compose.yml

**Fichier** : `docker-compose.yml:23,34`

```yaml
postgres:
  ports:
    - "5432:5432"
redis:
  ports:
    - "6379:6379"
```

Ces ports sont exposés sur l'interface réseau de l'hôte, rendant les bases de données accessibles depuis l'extérieur si le pare-feu n'est pas correctement configuré. `docker-compose.prod.yml` ne les expose pas (correct).

**Correction** : Supprimer ces `ports:` du `docker-compose.yml` de base (utiliser uniquement le réseau interne Docker) ou documenter que ce fichier est exclusivement pour le développement local.

---

### 🔵 BASSE

#### SEC-09 — Connexion DB sans utiliser la validation `getEnv()`

**Fichier** : `app/db/client.ts:6`

```typescript
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});
```

Accès direct à `process.env.DATABASE_URL` au lieu de passer par `getEnv()` qui valide et lève une erreur claire si la variable est absente. Si `DATABASE_URL` est undefined, le pool PostgreSQL démarrera mais échouera silencieusement à chaque requête.

**Correction** :
```typescript
import { getEnv } from "~/config/env.server";
const env = getEnv();
const pool = new pg.Pool({ connectionString: env.DATABASE_URL });
```

---

#### SEC-10 — Endpoint `/api/health` non authentifié exposant l'état de l'infrastructure

**Fichier** : `app/routes/api.health.ts`

L'endpoint révèle publiquement si PostgreSQL et Redis sont opérationnels. Un attaquant peut utiliser cette information pour cibler ses tentatives d'exploitation.

**Correction** : Protéger par authentification admin, ou restreindre l'accès à des IPs internes via nginx :
```nginx
location /api/health {
    allow 127.0.0.1;
    allow 172.16.0.0/12; # réseau Docker interne
    deny all;
    proxy_pass http://app;
}
```

---

#### SEC-11 — Contournement TypeScript via `(session.user as any).role`

**Fichiers** : `app/routes/feed.server.ts:99,124,184`, `app/lib/server/badges.server.ts`

```typescript
isAdmin: (session.user as any).role === "admin",
```

Le cast `as any` contourne le typage TypeScript pour Better Auth. Bien que fonctionnel, ce pattern masque d'éventuelles régressions si la structure de session change.

**Correction** : Étendre les types Better Auth pour inclure les champs personnalisés, ou utiliser la fonction `requireAuth` qui retourne déjà une session typée.

---

### ℹ️ INFORMATIF

#### SEC-12 — Longueur minimale de `AUTH_SECRET` insuffisante

**Fichier** : `app/config/env.server.ts:8`

```typescript
AUTH_SECRET: z.string().min(16),
```

16 caractères est le minimum imposé par Better Auth. Pour une robustesse cryptographique optimale (en cas de fuite du secret), 32 caractères aléatoires sont recommandés.

**Recommandation** : Passer à `.min(32)` et régénérer la valeur si elle est trop courte.

---

#### SEC-13 — `APP_URL` optionnel non documenté comme critique en production

**Fichier** : `.env.example`

`APP_URL` n'apparaît pas dans `.env.example` alors qu'il contrôle la liste `trustedOrigins` de Better Auth (voir SEC-04).

**Recommandation** : L'ajouter comme variable obligatoire en production dans `.env.example`.

---

## Tableau récapitulatif

| ID | Criticité | Composant | Description courte | Corrigé ? |
|----|-----------|-----------|-------------------|-----------|
| SEC-01 | 🔴 CRITIQUE | `uploads-files.ts` | Path traversal — lecture arbitraire de fichiers | ❌ Non |
| SEC-02 | 🟠 HAUTE | Git history | Credentials en clair dans l'historique | ⚠️ Partiel |
| SEC-03 | 🟠 HAUTE | nginx / root.tsx | Absence d'en-têtes HTTP de sécurité | ❌ Non |
| SEC-04 | 🟡 MOYENNE | `auth.server.ts` | `trustedOrigins` vide si APP_URL absent | ❌ Non |
| SEC-05 | 🟡 MOYENNE | `api.auth.$.ts` | IP spoofing contourne le rate-limiting | ❌ Non |
| SEC-06 | 🟡 MOYENNE | `docker-compose.yml` | Mot de passe par défaut "changeme" | ❌ Non |
| SEC-07 | 🟡 MOYENNE | `Dockerfile` | Conteneur s'exécute en root | ❌ Non |
| SEC-08 | 🟡 MOYENNE | `docker-compose.yml` | Ports DB/Redis exposés sur l'hôte | ❌ Non |
| SEC-09 | 🔵 BASSE | `db/client.ts` | Connexion DB sans validation `getEnv()` | ❌ Non |
| SEC-10 | 🔵 BASSE | `api.health.ts` | Endpoint health non protégé | ❌ Non |
| SEC-11 | 🔵 BASSE | `feed.server.ts` | Cast `as any` pour accéder au rôle | ❌ Non |
| SEC-12 | ℹ️ INFO | `env.server.ts` | AUTH_SECRET min 16 chars (recommandé 32) | ❌ Non |
| SEC-13 | ℹ️ INFO | `.env.example` | APP_URL absent du .env.example | ❌ Non |

---

## Points positifs

- **Validation des entrées** : Schémas Zod cohérents sur toutes les routes (prediction, match, post, user).
- **Rate limiting** : Présent sur les routes login/inscription via Redis.
- **Autorisation** : `requireAuth(request, ["admin"])` bien utilisé sur toutes les routes admin.
- **Upload d'avatar** : Types MIME vérifiés, taille limitée à 2 Mo, conversion WebP via sharp.
- **Séparation server/client** : Conventions `.server.ts` respectées — les secrets ne fuient pas côté client.
- **Mot de passe** : Politique robuste (min 8 chars, majuscule + minuscule + chiffre) validée côté client ET via Better Auth.
- **Protection de rôle** : Un admin ne peut pas modifier son propre rôle ni se supprimer.
- **Logs structurés** : Pino utilisé avec niveaux configurables.
