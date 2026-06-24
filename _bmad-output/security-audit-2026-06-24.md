# Audit de Sécurité — Penya Blaugrana Nantes
**Date :** 24 juin 2026  
**Branche analysée :** `main` (commit HEAD: `003faca`)  
**Périmètre :** Analyse statique du code source, configuration Docker et conventions de sécurité

---

## Résumé des derniers commits

| Hash | Date | Description |
|------|------|-------------|
| `003faca` | 13 avr. 2026 | fix: évaluer les badges immédiatement après chaque action |
| `b1c88f6` | 13 avr. 2026 | feat: Phase 2 — soirée match live, micro-pronos, badges, séries, saisons |
| `d461ee5` | 12 avr. 2026 | Merge branch 'claude/deploy-synology-nas-cLkOL' |
| `554b873` | 12 avr. 2026 | Add deployment guide for Synology NAS updates |
| `68e22d2` | 13 avr. 2026 | feat: menu burger mobile pour la navigation |
| `4a65a7b` | 13 avr. 2026 | Merge pull request #2 — NAS Synology |
| `6aebaf7` | 12 avr. 2026 | Fix Better Auth trusted origins for custom domain support |
| `9823bc5` | 12 avr. 2026 | Add migrate service to docker-compose.prod.yml |
| `2bafc6c` | 12 avr. 2026 | Merge pull request #1 — NAS Synology |
| `8d6e5e9` | 12 avr. 2026 | Add production Docker Compose and backup script for Synology NAS |

**Synthèse :** La Phase 2 est le changement majeur — elle ajoute la soirée match live, les micro-pronostics, le système de badges, les séries de performance et la gestion des saisons. Le déploiement Synology NAS a été finalisé avec guide de migration et service `migrate` Docker.

---

## Analyse Sécurité — Findings par Ordre de Criticité

---

## 🔴 CRITIQUE

### C-1 — Path Traversal sur le endpoint de fichiers uploadés
**Fichier :** `app/routes/uploads-files.ts:5`  
**Criticité :** CRITIQUE  

**Problème :**
```ts
const filePath = path.join(process.cwd(), "uploads", params["*"]);
const file = await readFile(filePath);
```
`path.join()` en Node.js **résout les segments `..`** sans les bloquer. Une requête comme :
- `GET /uploads/../.env` → lit le fichier `.env` (credentials DB, Redis, clé API)
- `GET /uploads/../../etc/passwd` → lit `/etc/passwd`

Confirmé avec test Node.js : `path.join('/app', 'uploads', '../.env')` retourne `/app/.env`.

**Impact :** Lecture de tout fichier accessible par le processus Node.js — credentials de base de données, clé API Football, `AUTH_SECRET`.

**Correction :**
```ts
export async function loader({ params }: { params: { "*": string } }) {
  const uploadDir = path.join(process.cwd(), "uploads");
  const filePath = path.resolve(uploadDir, params["*"]);

  // Bloquer toute tentative de sortir du dossier uploads
  if (!filePath.startsWith(uploadDir + path.sep)) {
    return new Response("Forbidden", { status: 403 });
  }

  // Valider l'extension avant de lire
  const ext = path.extname(filePath).toLowerCase();
  const allowedExts = [".webp", ".jpg", ".jpeg", ".png"];
  if (!allowedExts.includes(ext)) {
    return new Response("Not found", { status: 404 });
  }
  // ... reste inchangé
}
```

---

## 🟠 ÉLEVÉ

### H-1 — Usurpation du header `X-Forwarded-For` pour contourner le rate limiting
**Fichier :** `app/routes/api.auth.$.ts:6-13`  
**Criticité :** ÉLEVÉ  

**Problème :**
```ts
function getClientIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}
```
Le header `X-Forwarded-For` est contrôlé par le client. Un attaquant peut envoyer une valeur arbitraire à chaque requête pour se présenter comme une IP différente, contournant ainsi la protection brute-force sur `/api/auth/sign-in` (10 tentatives / 15 min).

**Impact :** Brute-force illimité des mots de passe sans blocage.

**Correction :** En production derrière un reverse proxy connu (Docker réseau interne), utiliser uniquement la partie ajoutée par le proxy de confiance, ou configurer un blocage au niveau du proxy (Nginx, Traefik) plutôt que dans l'application. Documenter l'architecture proxy dans la config.

---

### H-2 — Champ `role` potentiellement injectable lors de l'inscription (Better Auth)
**Fichier :** `app/lib/server/auth.server.ts:26-30`  
**Criticité :** ÉLEVÉ (à vérifier)  

**Problème :**
```ts
role: {
  type: "string",
  defaultValue: "member",
},
```
Le champ `role` est déclaré comme `additionalField` dans Better Auth. Selon la version de Better Auth et sa configuration, un attaquant pourrait tenter de passer `role: "admin"` dans la requête POST `/api/auth/sign-up/email` et obtenir des droits admin.

**Action requise :** Tester manuellement :
```sh
curl -X POST /api/auth/sign-up/email \
  -H "Content-Type: application/json" \
  -d '{"email":"test@test.com","password":"Test123!","name":"test","role":"admin"}'
```
Si le compte créé a le rôle `admin`, ajouter une protection explicite :
```ts
// Dans un middleware post-inscription ou via beforeCreate hook Better Auth
role: {
  type: "string",
  defaultValue: "member",
  // S'assurer que ce champ n'est pas modifiable par le client
}
```

---

## 🟡 MOYEN

### M-1 — Endpoint `/api/health` exposé sans authentification
**Fichier :** `app/routes/api.health.ts`  
**Criticité :** MOYEN  

**Problème :** Le endpoint de santé retourne le statut de PostgreSQL et Redis à tout visiteur non authentifié :
```json
{ "status": "ok", "services": { "db": "ok", "redis": "ok" }, "timestamp": "..." }
```

**Impact :** Cartographie de l'infrastructure interne par un attaquant (quels services tournent, leurs états).

**Correction :** Restreindre à un réseau interne (configuration Nginx/Traefik) ou ajouter un token secret dans le header :
```ts
const token = request.headers.get("x-health-token");
if (token !== process.env.HEALTH_TOKEN) {
  return new Response("Unauthorized", { status: 401 });
}
```

---

### M-2 — Variables d'environnement DB et Redis accédées hors validation Zod
**Fichiers :** `app/lib/server/redis.server.ts:1`, `app/db/client.ts`  
**Criticité :** MOYEN  

**Problème :**
```ts
// redis.server.ts
export const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379", ...);

// db/client.ts  
connectionString: process.env.DATABASE_URL,
```
Ces deux fichiers contournent `getEnv()` qui valide les variables via Zod. Si `DATABASE_URL` ou `REDIS_URL` est absent, le comportement est imprévisible (URL undefined ou fallback non sécurisé vers localhost).

**Correction :**
```ts
// redis.server.ts
import { getEnv } from "~/config/env.server";
export const redis = new Redis(getEnv().REDIS_URL, { ...options });

// db/client.ts
import { getEnv } from "~/config/env.server";
const { DATABASE_URL } = getEnv();
```

---

### M-3 — Mots de passe Docker avec valeur fallback "changeme"
**Fichier :** `docker-compose.prod.yml:16,22`  
**Criticité :** MOYEN  

**Problème :**
```yaml
POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-changeme}
redis-server --requirepass ${REDIS_PASSWORD:-changeme}
```
Si les variables d'environnement ne sont pas définies au démarrage, les services démarrent avec le mot de passe `changeme`.

**Correction :** Retirer les valeurs fallback pour forcer une erreur explicite si le mot de passe n'est pas configuré :
```yaml
POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?POSTGRES_PASSWORD must be set}
```

---

### M-4 — Absence d'en-têtes HTTP de sécurité
**Fichier :** Aucun fichier de configuration middleware trouvé  
**Criticité :** MOYEN  

**Problème :** Aucun en-tête de sécurité HTTP n'est configuré :
- Pas de `Content-Security-Policy` (protection XSS)
- Pas de `X-Frame-Options` (protection clickjacking)
- Pas de `X-Content-Type-Options` (protection MIME sniffing)
- Pas de `Strict-Transport-Security` (HSTS)
- Pas de `Referrer-Policy`

**Correction :** Ajouter un middleware React Router dans `app/root.tsx` ou via Nginx :
```ts
// Dans entry.server.tsx ou un middleware
headers.set("X-Frame-Options", "DENY");
headers.set("X-Content-Type-Options", "nosniff");
headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
headers.set("Content-Security-Policy", "default-src 'self'; img-src 'self' data: https:;");
```

---

## 🟢 FAIBLE / AMÉLIORATION

### L-1 — Validation du type MIME des uploads basée sur l'en-tête client
**Fichier :** `app/lib/server/upload.ts:12-14`  
**Criticité :** FAIBLE  

**Problème :**
```ts
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
if (!ALLOWED_TYPES.includes(file.type)) { ... }
```
`file.type` est fourni par le client et peut être forgé. Un attaquant pourrait uploader un fichier malveillant avec `Content-Type: image/jpeg`.

**Atténuation existante :** La librairie `sharp` traitera le fichier et échouera si le format n'est pas une image valide, ce qui limite l'impact. Néanmoins, pour une protection plus robuste, utiliser la détection par magic bytes avec `file-type`.

---

### L-2 — Pas de protection CSRF explicite sur les formulaires
**Criticité :** FAIBLE  

**Contexte :** React Router SSR et Better Auth offrent une protection implicite (les données de formulaire sont parsées côté serveur, les mutations nécessitent un `Content-Type: multipart/form-data` ou `application/x-www-form-urlencoded`). Better Auth gère nativement la protection CSRF pour ses endpoints.

**Recommandation :** Pour les routes custom (feed, pronos, profil), envisager l'ajout de tokens CSRF si l'application venait à exposer des endpoints JSON qui acceptent des mutations sans session.

---

### L-3 — `.gitignore` ne couvre pas les fichiers de backup SQL
**Fichier :** `.gitignore`  
**Criticité :** FAIBLE  

**Problème :** Les dumps de backup (`*.sql`) ne sont pas exclus. Si un backup est accidentellement généré dans le répertoire de travail, il pourrait être commité avec les credentials en clair.

**Correction :**
```gitignore
# Backups
*.sql
backups/
```

---

## Points Positifs

Les éléments suivants sont correctement implémentés :

- **Authentification :** Better Auth avec sessions Redis — bonne séparation des responsabilités
- **Rate limiting :** Implémenté sur `sign-in` (10 req/15 min) et `sign-up` (5 req/h) via Redis
- **Validation entrées :** Zod utilisé systématiquement sur toutes les entrées utilisateur (pseudo, email, contenu posts, pronostics)
- **Contrôle d'accès :** `requireAuth(request, ["admin"])` systématique sur toutes les routes admin
- **Autorisation au niveau objet :** Vérification propriétaire avant suppression de posts/commentaires
- **Secrets sortis du repo :** Commit `aed5841` a bien supprimé les credentials et renforcé `.gitignore`
- **Upload sécurisé :** Limite de taille (2 Mo), formats restreints, redimensionnement via `sharp`
- **Logging structuré :** Pino avec niveaux de log, sans exposition de données sensibles
- **Variables d'environnement validées :** `getEnv()` avec Zod schema — AUTH_SECRET min 16 chars imposé
- **Mot de passe fort :** Validation regex en registration (majuscule + minuscule + chiffre requis)
- **Protection auto-suppression admin :** Un admin ne peut pas supprimer/modifier son propre compte admin

---

## Tableau Récapitulatif

| ID | Criticité | Titre | Fichier | Effort correction |
|----|-----------|-------|---------|------------------|
| C-1 | 🔴 CRITIQUE | Path traversal uploads | `uploads-files.ts:5` | Faible (5 lignes) |
| H-1 | 🟠 ÉLEVÉ | IP spoofing rate limit | `api.auth.$.ts:6` | Moyen (config proxy) |
| H-2 | 🟠 ÉLEVÉ | Role injection signup | `auth.server.ts:26` | À vérifier |
| M-1 | 🟡 MOYEN | Health endpoint public | `api.health.ts` | Faible |
| M-2 | 🟡 MOYEN | process.env hors Zod | `redis.server.ts`, `db/client.ts` | Faible |
| M-3 | 🟡 MOYEN | Docker fallback "changeme" | `docker-compose.prod.yml` | Faible |
| M-4 | 🟡 MOYEN | Absence headers HTTP sécurité | (global) | Moyen |
| L-1 | 🟢 FAIBLE | MIME type upload côté client | `upload.ts:12` | Faible |
| L-2 | 🟢 FAIBLE | Pas de token CSRF explicite | (global) | Moyen |
| L-3 | 🟢 FAIBLE | Backup SQL non ignoré | `.gitignore` | Minimal |

---

*Document généré lors de l'audit automatisé du 24 juin 2026.*
