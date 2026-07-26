# Rapport d'audit sécurité — Penya Blaugrana Nantes

**Date :** 26 juillet 2026  
**Branche analysée :** `main` (commit `003faca`)  
**Corrections appliquées :** `app/routes/uploads-files.ts`, `app/lib/server/rate-limit.server.ts`, `.dockerignore`

---

## Résumé des derniers commits

| Hash | Date | Description |
|------|------|-------------|
| `003faca` | 13 avr. 2026 | **fix:** Évaluation immédiate des badges après chaque action (pronostic, post, commentaire, réaction) |
| `b1c88f6` | 13 avr. 2026 | **feat (Phase 2):** Page soirée match live, micro-pronostics, badges (10 de base), séries de scores, gestion des saisons |
| `68e22d2` | 13 avr. 2026 | **feat:** Menu burger mobile pour la navigation |
| `554b873` | 12 avr. 2026 | **docs:** Guide de déploiement pour mises à jour sur NAS Synology |
| `9823bc5` | 12 avr. 2026 | **fix:** Service `migrate` ajouté dans `docker-compose.prod.yml` |
| `6aebaf7` | 12 avr. 2026 | **fix:** Correction des `trustedOrigins` de Better Auth pour support domaine personnalisé |
| `8d6e5e9` | 12 avr. 2026 | **feat:** Docker Compose de production + script de sauvegarde PostgreSQL |
| `aed5841` | antérieur | **security:** Suppression des credentials du dépôt, renforcement du `.gitignore` |

---

## Analyse de sécurité par ordre de criticité

### 🔴 CRITIQUE

#### C-1 — Path traversal dans le serveur de fichiers statiques ✅ CORRIGÉ

**Fichier :** `app/routes/uploads-files.ts:5`

**Problème :** `params["*"]` (wildcard React Router) était passé directement à `path.join` sans validation. `path.join` normalise les séquences `../` — une requête `GET /uploads/../.env` produisait le chemin `{cwd}/.env` et exposait `AUTH_SECRET`, `DATABASE_URL` et `API_FOOTBALL_KEY`.

```
# Exemple d'exploitation
curl https://penya.example.com/uploads/../.env
# → AUTH_SECRET=xxx, DATABASE_URL=postgresql://penya:xxx@...
```

**Correction appliquée :** Validation que le chemin résolu reste dans `uploads/` via `path.resolve` + vérification du préfixe, retour HTTP 403 sinon.

---

#### C-2 — Absence totale de headers de sécurité HTTP

**Fichier :** Configuration Nginx / application (non configurés)

Aucun en-tête de sécurité n'est présent :
- Pas de `Content-Security-Policy` → XSS exploitable librement
- Pas de `X-Frame-Options` → clickjacking possible
- Pas de `X-Content-Type-Options: nosniff` → MIME sniffing navigateur
- Pas de `Strict-Transport-Security` → downgrade HTTPS→HTTP
- Pas de `Referrer-Policy` → fuite de tokens dans les logs tiers

**Recommandation :** Ajouter dans le bloc `server` Nginx (config sur le NAS) :

```nginx
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
add_header X-Frame-Options "DENY" always;
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Content-Security-Policy "default-src 'self'; img-src 'self' data:; script-src 'self'; style-src 'self' 'unsafe-inline';" always;
```

---

### 🟠 ÉLEVÉ

#### E-1 — Contournement du rate limiting par usurpation d'IP

**Fichier :** `app/routes/api.auth.$.ts:7`

**Problème :** Le code prend le **premier** élément de `X-Forwarded-For`. Or Nginx avec `$proxy_add_x_forwarded_for` **ajoute** l'IP réelle à la fin sans supprimer la valeur injectée par le client. Un attaquant envoie `X-Forwarded-For: 1.2.3.4` — Nginx produit `1.2.3.4, real_ip` — le `split(",")[0]` renvoie `1.2.3.4` (contrôlé), permettant de contourner les 10 tentatives/15 min en rotation d'IPs inventées.

**Recommandation :**
```typescript
function getClientIp(request: Request): string {
  // X-Real-IP est fixé par Nginx à $remote_addr — non forgeable par le client
  return (
    request.headers.get("x-real-ip") ||
    request.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim() ||
    "unknown"
  );
}
```
Et dans Nginx : `proxy_set_header X-Real-IP $remote_addr;`

---

#### E-2 — Race condition dans le rate limiter Redis ✅ CORRIGÉ

**Fichier :** `app/lib/server/rate-limit.server.ts:16-19`

**Problème :** Deux appels Redis séparés (`INCR` puis `EXPIRE`). Si le processus plante entre les deux, la clé reste sans TTL → ban permanent de l'IP (DoS par erreur de timing).

**Correction appliquée :** Pipeline atomique avec `EXPIRE ... NX` (pose le TTL seulement si absent) pour garantir l'atomicité.

---

#### E-3 — Vérification MIME type basée sur l'en-tête client (upload)

**Fichier :** `app/lib/server/upload.ts:13`

**Problème :** `file.type` reflète le `Content-Type` HTTP fourni par le navigateur — entièrement contrôlable. Un attaquant peut uploader un fichier polyglot malveillant déclaré `image/jpeg`. La conversion Sharp offre un filet partiel mais n'est pas infaillible.

**Recommandation :**
```bash
npm install file-type
```
```typescript
import { fileTypeFromBuffer } from "file-type";

const buffer = Buffer.from(await file.arrayBuffer());
const detected = await fileTypeFromBuffer(buffer);
if (!detected || !ALLOWED_TYPES.includes(detected.mime)) {
  throw new Error("Format non supporté détecté.");
}
```

---

#### E-4 — Rate limiting absent sur les actions utilisateur

**Fichiers :** `app/routes/feed.server.ts`, `app/routes/match-detail.server.ts`, `app/routes/api.micro-predictions.ts`, `app/routes/api.sync-matches.ts`

**Problème :** `checkRateLimit` n'est utilisé que pour la connexion/inscription. Un utilisateur authentifié peut spammer posts, commentaires, pronostics et micro-pronos sans limite. L'endpoint `api.sync-matches.ts` (admin) consomme des crédits API RapidAPI — un spam épuise le quota.

**Recommandation :** Appliquer le rate limiter existant sur chaque action :
```typescript
await checkRateLimit({
  key: `post:${session.user.id}`,
  maxAttempts: 10,
  windowSeconds: 60,
});
```
Limites suggérées : Posts 10/min, Commentaires 20/min, Pronostics 5/min, Sync API 2/heure.

---

#### E-5 — Connexions Redis/DB sans validation par `getEnv()`

**Fichiers :** `app/lib/server/redis.server.ts:3`, `app/db/client.ts:5-6`

**Problème :** Ces modules lisent `process.env` directement, contournant le schéma Zod de `getEnv()`. Redis peut se connecter sans mot de passe si `REDIS_URL` utilise le fallback `redis://localhost:6379`.

**Recommandation :** Remplacer par :
```typescript
import { getEnv } from "~/config/env.server";
const env = getEnv();
export const redis = new Redis(env.REDIS_URL, { ...options });
```

---

#### E-6 — `.dockerignore` incomplet — `.env` inclus dans l'image Docker ✅ CORRIGÉ

**Fichier :** `.dockerignore` + `Dockerfile:4` (`COPY . /app`)

**Problème :** Le `.dockerignore` original n'excluait pas `.env`. Si `.env` existe sur la machine de build, il était copié dans la couche Docker et lisible via `docker history` ou `docker save`.

**Correction appliquée :** Ajout de `.env`, `.env.*`, `.git`, `uploads`, et répertoires non nécessaires dans `.dockerignore`.

---

### 🟡 MOYEN

#### M-1 — `trustedOrigins` vide par défaut si `APP_URL` non défini

**Fichier :** `app/lib/server/auth.server.ts:12`

```typescript
trustedOrigins: env.APP_URL ? [env.APP_URL] : [],
```

`APP_URL` est optionnel — si oublié en production, Better Auth peut appliquer un comportement permissif par défaut.

**Recommandation :** Rendre `APP_URL` obligatoire en production dans `app/config/env.server.ts` :
```typescript
APP_URL: z.string().url(),  // supprimer .optional()
```

---

#### M-2 — Mots de passe par défaut `changeme` dans Docker Compose production

**Fichier :** `docker-compose.prod.yml:22,30`

```yaml
POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-changeme}
redis-server --requirepass ${REDIS_PASSWORD:-changeme}
```

Si les variables ne sont pas définies, les services démarrent avec `changeme`.

**Recommandation :**
```yaml
POSTGRES_PASSWORD=${POSTGRES_PASSWORD:?Variable POSTGRES_PASSWORD manquante en production}
```

---

#### M-3 — Absence de vérification d'email à l'inscription

**Fichier :** `app/lib/server/auth.server.ts:16-18`

`requireEmailVerification` n'est pas activé. N'importe qui peut créer un compte avec l'email d'un tiers et accéder immédiatement à la communauté.

**Recommandation :**
```typescript
emailAndPassword: {
  enabled: true,
  requireEmailVerification: true,
  sendVerificationEmail: async ({ user, url }) => {
    // Nodemailer / Resend
  },
},
```

---

#### M-4 — Posts automatiques dans le fil sans consentement utilisateur

**Fichier :** `app/lib/server/streaks.server.ts:67`

Quand un utilisateur atteint un palier de série (3/5/10 scores exacts), un post `isAnnouncement: true` est publié **dans son nom** sans consultation. Le post est visuellement présenté comme une annonce officielle, ce qui peut prêter à confusion.

**Recommandation :** Utiliser un compte système dédié (`authorId` d'un "Penya Bot") ou désactiver le flag `isAnnouncement` sur ces posts automatiques.

---

### 🔵 FAIBLE

#### F-1 — Docker dev expose PostgreSQL et Redis sur toutes les interfaces

**Fichier :** `docker-compose.yml:23-24,29-30`

```yaml
ports:
  - "5432:5432"
  - "6379:6379"
```

En dev sur un réseau public, les bases sont accessibles de l'extérieur. Redis dev n'a pas de mot de passe.

**Recommandation :** `"127.0.0.1:5432:5432"` ou supprimer les `ports` et accéder via `docker exec`.

---

#### F-2 — Image Docker exécutée en tant que `root`

**Fichier :** `Dockerfile` (stage final)

Aucun utilisateur non-root n'est défini. En cas de compromission de l'app, l'attaquant dispose des droits root dans le container.

**Recommandation :** Avant `CMD` dans le stage final :
```dockerfile
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser
```

---

#### F-3 — Dumps de backup non chiffrés (données personnelles RGPD)

**Fichier :** `backup.sh:12`

Les sauvegardes SQL en clair dans `/volume1/docker/backups/penya/` contiennent emails, pseudos, mots de passe hashés. Un accès physique au NAS expose l'intégralité.

**Recommandation :**
```bash
pg_dump ... | gzip | gpg --symmetric --batch --passphrase-file /run/secrets/backup_key \
  > "$BACKUP_DIR/penya_$DATE.sql.gz.gpg"
```

---

#### F-4 — Routes publiques potentiellement non intentionnelles

**Fichiers :** `app/routes/calendar.server.ts`, `app/routes/events.server.ts`, `app/routes/liga-standings.server.ts`

Ces pages (calendrier, événements, classement Liga) sont accessibles sans authentification. Probablement intentionnel (vitrine), mais les dates et lieux des soirées pourraient être sensibles.

**Recommandation :** Confirmer explicitement que ces pages sont publiques. Ajouter `requireAuth` si non.

---

## Tableau de synthèse

| ID | Sévérité | Statut | Fichier | Catégorie |
|----|----------|--------|---------|-----------|
| C-1 | 🔴 CRITIQUE | ✅ Corrigé | `uploads-files.ts:5` | Path traversal |
| C-2 | 🔴 CRITIQUE | ⚠️ À faire | Config Nginx | Headers de sécurité absents |
| E-1 | 🟠 ÉLEVÉ | ⚠️ À faire | `api.auth.$.ts:7` | IP spoofing / bypass rate limit |
| E-2 | 🟠 ÉLEVÉ | ✅ Corrigé | `rate-limit.server.ts:16` | Race condition Redis |
| E-3 | 🟠 ÉLEVÉ | ⚠️ À faire | `upload.ts:13` | MIME type client-contrôlé |
| E-4 | 🟠 ÉLEVÉ | ⚠️ À faire | `feed.server.ts`, etc. | Rate limiting absent sur actions |
| E-5 | 🟠 ÉLEVÉ | ⚠️ À faire | `redis.server.ts`, `client.ts` | Env vars sans validation Zod |
| E-6 | 🟠 ÉLEVÉ | ✅ Corrigé | `.dockerignore` | `.env` dans image Docker |
| M-1 | 🟡 MOYEN | ⚠️ À faire | `auth.server.ts:12` | trustedOrigins vide |
| M-2 | 🟡 MOYEN | ⚠️ À faire | `docker-compose.prod.yml` | Mots de passe `changeme` |
| M-3 | 🟡 MOYEN | ⚠️ À faire | `auth.server.ts:16` | Pas de vérification email |
| M-4 | 🟡 MOYEN | ⚠️ À faire | `streaks.server.ts:67` | Posts auto sans consentement |
| F-1 | 🔵 FAIBLE | ⚠️ À faire | `docker-compose.yml` | DB/Redis exposés en dev |
| F-2 | 🔵 FAIBLE | ⚠️ À faire | `Dockerfile` | Docker tourne en root |
| F-3 | 🔵 FAIBLE | ⚠️ À faire | `backup.sh:12` | Dumps non chiffrés (RGPD) |
| F-4 | 🔵 FAIBLE | ℹ️ À confirmer | `calendar.server.ts`, etc. | Routes sans auth |

---

## Bonnes pratiques constatées ✅

- **Authentification centralisée :** `requireAuth()` utilisé systématiquement sur toutes les routes protégées
- **Contrôles d'autorisation :** Vérification du rôle `admin` avant chaque action sensible
- **ORM paramétré (Drizzle) :** Aucune concaténation SQL directe — protection complète contre les injections SQL
- **Validation des entrées (Zod) :** Schémas appliqués sur les formulaires critiques (pseudo, pronostic, post, commentaire)
- **Rate limiting sur auth :** Connexion limitée à 10 tentatives/15 min, inscription à 5/heure
- **Secrets sortis du dépôt :** `.gitignore` configuré, commit `aed5841` de nettoyage effectué
- **Logging structuré :** Pino avec contexte (userId, action) pour la traçabilité et l'audit
- **Validation env vars au démarrage :** `getEnv()` avec Zod valide la configuration avant le démarrage
- **Upload : taille limitée et conversion :** Max 2 Mo, conversion WebP via Sharp (supprime les métadonnées EXIF)
- **Protection auto-modification admin :** Un admin ne peut pas changer son propre rôle ni supprimer son propre compte
- **Unicité des contraintes métier :** Vérification unicité pseudo, unicité réponse micro-prono, unicité réaction

---

## Plan d'action recommandé

| # | Priorité | Action | Effort estimé |
|---|----------|--------|---------------|
| 1 | 🔴 Immédiat | Configurer les headers de sécurité HTTP dans Nginx sur le NAS | 30 min |
| 2 | 🟠 Court terme | Corriger la lecture IP dans `api.auth.$.ts` + configurer `X-Real-IP` Nginx | 1h |
| 3 | 🟠 Court terme | Ajouter `file-type` pour validation magic bytes des uploads | 30 min |
| 4 | 🟠 Court terme | Ajouter rate limiting sur les actions POST (feed, pronos, profil) | 2h |
| 5 | 🟠 Court terme | Migrer `redis.server.ts` et `db/client.ts` vers `getEnv()` | 30 min |
| 6 | 🟡 Moyen terme | Supprimer les mots de passe `changeme` du Docker Compose prod | 15 min |
| 7 | 🟡 Moyen terme | Activer la vérification email à l'inscription (nécessite SMTP) | 2h |
| 8 | 🔵 Long terme | Passer Docker en utilisateur non-root | 30 min |
| 9 | 🔵 Long terme | Chiffrer les dumps de backup (RGPD) | 1h |
