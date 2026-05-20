# Audit de Sécurité — Penya Blaugrana Nantes

**Date :** 20 mai 2026  
**Branche analysée :** `claude/sharp-fermi-lMmB5`  
**Commits couverts :** `fec3e63` → `003faca` (historique complet)  
**Analyste :** Revue automatisée Claude Code

---

## Résumé des derniers commits

| Commit | Date | Description |
|--------|------|-------------|
| `003faca` | 13 avr. 2026 | fix: évaluer les badges immédiatement après chaque action |
| `b1c88f6` | 13 avr. 2026 | feat: Phase 2 — soirée match live, micro-pronos, badges, séries, saisons |
| `d461ee5` | 12 avr. 2026 | Merge branch deploy Synology NAS |
| `554b873` | 12 avr. 2026 | Add deployment guide for Synology NAS updates |
| `68e22d2` | 13 avr. 2026 | feat: menu burger mobile pour la navigation |
| `6aebaf7` | 12 avr. 2026 | Fix Better Auth trusted origins for custom domain support |
| `9823bc5` | 12 avr. 2026 | Add migrate service to docker-compose.prod.yml |
| `8d6e5e9` | 12 avr. 2026 | Add production Docker Compose and backup script |
| `3d80133` | — | docs: roadmap Phase 2 |
| `aed5841` | — | security: supprimer credentials du repo et renforcer .gitignore |

**Périmètre Phase 2 introduit :**
- Route `/soiree/:matchId` avec score live (polling API 60s)
- Micro-pronostics (création admin, vote joueur, clôture avec points auto)
- Séries de scores exacts (`currentStreak` / `bestStreak`)
- 10 badges avec évaluation automatique
- Classement filtré par saison
- Tables DB : `seasons`, `badges`, `user_badges`, `rewards`, `micro_predictions`, `micro_prediction_answers`

---

## Résultats d'audit par ordre de criticité

---

### 🔴 CRITIQUE

---

#### C-01 — Path Traversal sur le serveur de fichiers uploads

**Fichier :** `app/routes/uploads-files.ts` — lignes 4–6  
**Impact :** Lecture de n'importe quel fichier du système de fichiers serveur

```typescript
// CODE ACTUEL — VULNÉRABLE
const filePath = path.join(process.cwd(), "uploads", params["*"]);
```

`params["*"]` provient directement de l'URL et n'est pas validé. Un attaquant peut envoyer une requête telle que :

```
GET /uploads/../../.env
GET /uploads/../../../etc/passwd
```

`path.join` normalise les `..` mais ne bloque pas la sortie du répertoire de base. La concaténation avec `process.cwd()` et `params["*"]` permet de remonter l'arborescence.

**Correction recommandée :**

```typescript
export async function loader({ params }: { params: { "*": string } }) {
  const uploadsDir = path.resolve(process.cwd(), "uploads");
  const filePath = path.resolve(uploadsDir, params["*"]);

  // Rejeter tout chemin qui sort du répertoire uploads/
  if (!filePath.startsWith(uploadsDir + path.sep) && filePath !== uploadsDir) {
    return new Response("Not found", { status: 404 });
  }
  // ... reste du code inchangé
}
```

---

### 🟠 ÉLEVÉ

---

#### H-01 — Mots de passe Docker par défaut en production

**Fichier :** `docker-compose.prod.yml` — lignes 23 et 32  
**Impact :** Compromission de la base de données et de Redis si les variables d'environnement ne sont pas définies

```yaml
POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-changeme}
command: redis-server --requirepass ${REDIS_PASSWORD:-changeme}
```

Si `POSTGRES_PASSWORD` ou `REDIS_PASSWORD` ne sont pas renseignés dans le `.env` de production, Docker utilise le mot de passe `changeme`.

**Correction recommandée :** Supprimer les valeurs par défaut afin que le conteneur échoue explicitement au démarrage si les secrets ne sont pas fournis :

```yaml
POSTGRES_PASSWORD=${POSTGRES_PASSWORD:?Variable POSTGRES_PASSWORD non définie}
command: redis-server --requirepass ${REDIS_PASSWORD:?Variable REDIS_PASSWORD non définie}
```

---

#### H-02 — Absence de rate limiting sur les endpoints métier

**Fichiers concernés :**  
- `app/routes/api.micro-predictions.ts` — intent `answer`  
- `app/routes/feed.server.ts` — intent `create-post`, `comment`, `react`  
- `app/routes/match-detail.server.ts` — soumission de pronostic  
- `app/routes/profile.server.ts` — intent `update-avatar`, `update-pseudo`  

**Impact :** Spam de contenu, abus des systèmes de points et de badges, surcharge des endpoints

Le rate limiting n'est actuellement appliqué qu'à `/api/auth` (connexion et inscription). Tous les endpoints métier authentifiés sont accessibles sans limite de fréquence, permettant à un attaquant avec un compte valide de :
- Gagner des badges artificiellement (50 réactions via bot)
- Inonder le fil d'actualité de posts
- Déclencher des centaines de micro-pronostics en rafale

**Correction recommandée :** Appliquer `checkRateLimit` par `userId` sur chaque intent sensible, par exemple :

```typescript
// Dans feedAction, intent "create-post"
await checkRateLimit({ key: `feed-post:${session.user.id}`, maxAttempts: 10, windowSeconds: 3600 });
```

---

#### H-03 — Contournement du rate limiting par spoofing de X-Forwarded-For

**Fichier :** `app/routes/api.auth.$.ts` — lignes 6–11  
**Impact :** Attaque brute-force sur les comptes en contournant le rate limiting

```typescript
function getClientIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}
```

Le header `X-Forwarded-For` est contrôlé par le client. Sans reverse proxy de confiance qui écrase ce header, un attaquant peut envoyer `X-Forwarded-For: 1.2.3.4` et changer d'IP fictive à chaque tentative, contournant le rate limiting par IP.

**Correction recommandée :**  
- En production derrière un reverse proxy (nginx/Traefik), configurer ce dernier pour définir lui-même le header `X-Real-IP` et ignorer celui envoyé par le client.
- Compléter le rate limiting par `userId` (pour les utilisateurs connectés) afin que la clé ne dépende pas uniquement de l'IP.

---

### 🟡 MOYEN

---

#### M-01 — Absence de headers HTTP de sécurité

**Fichiers :** `app/root.tsx`, `vite.config.ts` (aucune configuration de headers)  
**Impact :** Exposition aux attaques XSS, clickjacking, MIME sniffing

Aucun des headers de sécurité standard n'est configuré :

| Header manquant | Risque |
|-----------------|--------|
| `Content-Security-Policy` | XSS, injection de scripts |
| `X-Frame-Options` | Clickjacking |
| `X-Content-Type-Options` | MIME sniffing |
| `Strict-Transport-Security` | Downgrade HTTP |
| `Referrer-Policy` | Fuite d'URL dans les requêtes externes |

**Correction recommandée :** Ajouter une fonction `headers` dans `root.tsx` :

```typescript
export function headers() {
  return {
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Content-Security-Policy":
      "default-src 'self'; img-src 'self' https://images.fotmob.com data:; font-src 'self' https://fonts.gstatic.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; script-src 'self'",
  };
}
```

---

#### M-02 — Endpoint `/api/health` non authentifié révèle l'infrastructure

**Fichier :** `app/routes/api.health.ts`  
**Impact :** Divulgation de l'état interne (PostgreSQL up/down, Redis up/down) à n'importe qui

```json
{
  "status": "degraded",
  "services": { "db": "error", "redis": "ok" }
}
```

Un attaquant peut surveiller cet endpoint pour identifier des fenêtres de vulnérabilité (ex : Redis hors ligne = pas de rate limiting actif).

**Correction recommandée :** Restreindre l'accès à une IP de confiance ou exiger un token de monitoring :

```typescript
const HEALTH_TOKEN = process.env.HEALTH_TOKEN;
if (HEALTH_TOKEN && request.headers.get("X-Health-Token") !== HEALTH_TOKEN) {
  return new Response("Unauthorized", { status: 401 });
}
```

---

#### M-03 — Race condition dans le rate limiting

**Fichier :** `app/lib/server/rate-limit.server.ts` — lignes 16–19  
**Impact :** La clé de rate limit peut ne jamais expirer si le process crash entre `INCR` et `EXPIRE`

```typescript
const current = await redis.incr(redisKey);
if (current === 1) {
  await redis.expire(redisKey, windowSeconds);  // non atomique
}
```

Si la première requête incrémente le compteur mais que le serveur tombe avant que `EXPIRE` ne soit appelé, la clé restera en mémoire Redis indéfiniment, bloquant définitivement les nouvelles tentatives pour cette clé.

**Correction recommandée :** Utiliser une commande atomique :

```typescript
// Remplacer par une approche SET NX EX
const key = `rate-limit:${options.key}`;
const result = await redis.set(key, 1, "EX", options.windowSeconds, "NX");
if (result === null) {
  // La clé existe déjà, incrémenter
  const current = await redis.incr(key);
  if (current > options.maxAttempts) {
    throw new AppError("RATE_LIMIT_EXCEEDED", "Trop de tentatives.", 429);
  }
}
```

---

#### M-04 — Validation insuffisante des micro-pronostics

**Fichier :** `app/routes/api.micro-predictions.ts` — lignes 18–44 et 91–131  
**Impact :** Données corrompues, manipulation des points, réponse hors liste pour les QCM

Les champs suivants ne sont pas validés côté serveur :
- `type` : valeur libre, devrait être `"qcm"` ou `"text"` uniquement
- `pointsValue` : peut être négatif ou excessivement élevé (ex : 999999)
- `deadlineSeconds` : pas de borne minimale/maximale
- `question` : pas de limite de longueur
- `answer` (intent `answer`) : pour un QCM, la réponse n'est pas vérifiée contre les options disponibles

**Correction recommandée :** Introduire un schéma Zod pour chaque intent :

```typescript
const createMicroSchema = z.object({
  matchId: z.string().min(1),
  question: z.string().min(3).max(200),
  type: z.enum(["qcm", "text"]),
  options: z.string().optional(),
  pointsValue: z.coerce.number().int().min(1).max(10),
  deadlineSeconds: z.coerce.number().int().min(30).max(600),
});
```

---

#### M-05 — Dockerfile sans utilisateur non-root

**Fichier :** `Dockerfile`  
**Impact :** Si la container est compromise, l'attaquant a les droits root dans le conteneur

Le `Dockerfile` final ne définit pas d'utilisateur non-root, contrairement aux bonnes pratiques Docker.

**Correction recommandée :**

```dockerfile
# Ajouter avant CMD
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
RUN chown -R appuser:appgroup /app
USER appuser
CMD ["npm", "run", "start"]
```

---

#### M-06 — `trustedOrigins` vide si `APP_URL` non défini

**Fichier :** `app/lib/server/auth.server.ts` — ligne 12  
**Impact :** Protection CSRF potentiellement inactive

```typescript
trustedOrigins: env.APP_URL ? [env.APP_URL] : [],
```

Si `APP_URL` n'est pas défini dans l'environnement de production, `trustedOrigins` est un tableau vide. Selon le comportement de Better Auth, cela peut désactiver la protection CSRF ou l'étendre à toutes les origines.

**Correction recommandée :** Définir `APP_URL` comme variable d'environnement **obligatoire** dans `env.server.ts` :

```typescript
APP_URL: z.string().url("APP_URL doit être une URL valide"),
```

---

### 🔵 FAIBLE

---

#### L-01 — Vérification du type MIME basée sur la valeur fournie par le client

**Fichier :** `app/lib/server/upload.ts` — ligne 13  
**Impact :** Faible — la bibliothèque `sharp` retraitera le fichier et échouera sur les non-images

```typescript
if (!ALLOWED_TYPES.includes(file.type)) { ... }
```

`file.type` est la valeur fournie par le navigateur/client et peut être falsifiée. Cependant, `sharp` retraite l'image et convertirait ou rejetterait un fichier non-image lors du traitement.

**Correction recommandée (optionnelle) :** Pour une défense en profondeur, lire les magic bytes du fichier pour valider le type réel, ou se fier uniquement au rejet de `sharp`.

---

#### L-02 — Connexion Redis sans gestion d'erreur et sans connexion explicite

**Fichier :** `app/lib/server/redis.server.ts`  
**Impact :** Faible — erreurs silencieuses si Redis est indisponible au démarrage

```typescript
export const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379", {
  lazyConnect: true,
});
```

Avec `lazyConnect: true`, la connexion n'est établie qu'à la première utilisation. Si Redis est indisponible ou mal configuré (mauvais mot de passe), aucune erreur ne sera levée au démarrage, mais les appels échoueront silencieusement en production, désactivant le rate limiting sans avertissement.

**Correction recommandée :**

```typescript
export const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379", {
  maxRetriesPerRequest: 3,
  lazyConnect: false,
});
redis.on("error", (err) => logger.error({ err }, "Redis connection error"));
```

---

#### L-03 — Pool PostgreSQL sans configuration explicite

**Fichier :** `app/db/client.ts`  
**Impact :** Faible — risque d'épuisement des connexions sous charge

```typescript
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
```

Le pool est créé avec les paramètres par défaut (10 connexions, pas de timeout). Sous forte charge, le pool peut être épuisé, causant un déni de service.

**Correction recommandée :**

```typescript
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});
```

---

#### L-04 — Exigences de mot de passe insuffisantes

**Fichier :** `app/lib/validation/user.ts` — lignes 14–20  
**Impact :** Faible — mots de passe trop simples acceptés (`password123` est valide)

La validation actuelle accepte 8 caractères avec une majuscule, une minuscule et un chiffre. L'OWASP recommande 12 caractères minimum.

**Correction recommandée :**

```typescript
password: z
  .string()
  .min(12, "Mot de passe : 12 caractères minimum")
  .regex(
    /(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/,
    "Mot de passe : majuscule, minuscule et chiffre requis",
  ),
```

---

#### L-05 — SQL brut dans `badges.server.ts`

**Fichier :** `app/lib/server/badges.server.ts` — lignes 140–142  
**Impact :** Faible — `userId` provient de la session (source de confiance)

```typescript
const [userRow] = await db.select({ bestStreak: sql<number>`coalesce(best_streak, 0)::int` })
  .from(sql`"user"`)
  .where(sql`id = ${userId}`);
```

Ce pattern mélange du SQL brut avec un paramètre. Bien que `userId` vienne de la session et soit de confiance, la cohérence avec le reste du code (qui utilise les références Drizzle) est préférable.

**Correction recommandée :** Utiliser la référence Drizzle :

```typescript
import { user } from "~/db/schema";
const [userRow] = await db
  .select({ bestStreak: user.bestStreak })
  .from(user)
  .where(eq(user.id, userId));
```

---

#### L-06 — Stack trace exposé dans la boundary d'erreur

**Fichier :** `app/root.tsx` — lignes 92–95  
**Impact :** Faible — limité au mode `DEV`

```typescript
} else if (import.meta.env.DEV && error && error instanceof Error) {
  details = error.message;
  stack = error.stack;
}
```

La condition `import.meta.env.DEV` est correctement appliquée. Vérifier que le build de production ne définit pas `DEV=true` accidentellement.

---

#### L-07 — `gitignore` ne couvre pas `.env.local` et variantes

**Fichier :** `.gitignore`  
**Impact :** Faible — risque de commit accidentel d'un fichier d'environnement local

Le `.gitignore` couvre `.env` mais pas `.env.local`, `.env.production`, `.env.production.local` qui sont des conventions courantes de React/Vite.

**Correction recommandée :**

```gitignore
.env
.env.*
!.env.example
```

---

## Tableau récapitulatif

| ID | Sévérité | Fichier | Description |
|----|----------|---------|-------------|
| C-01 | 🔴 CRITIQUE | `uploads-files.ts` | Path traversal — lecture de fichiers arbitraires |
| H-01 | 🟠 ÉLEVÉ | `docker-compose.prod.yml` | Mots de passe Docker par défaut `changeme` |
| H-02 | 🟠 ÉLEVÉ | Multiples routes | Absence de rate limiting sur les endpoints métier |
| H-03 | 🟠 ÉLEVÉ | `api.auth.$.ts` | Bypass rate limiting par spoofing X-Forwarded-For |
| M-01 | 🟡 MOYEN | `root.tsx` | Absence de headers HTTP de sécurité (CSP, X-Frame, etc.) |
| M-02 | 🟡 MOYEN | `api.health.ts` | Endpoint de santé non authentifié révèle l'infra |
| M-03 | 🟡 MOYEN | `rate-limit.server.ts` | Race condition INCR/EXPIRE non atomique |
| M-04 | 🟡 MOYEN | `api.micro-predictions.ts` | Validation insuffisante des micro-pronostics |
| M-05 | 🟡 MOYEN | `Dockerfile` | Conteneur s'exécute en root |
| M-06 | 🟡 MOYEN | `auth.server.ts` | `trustedOrigins` vide si `APP_URL` absent |
| L-01 | 🔵 FAIBLE | `upload.ts` | Type MIME basé sur la valeur client |
| L-02 | 🔵 FAIBLE | `redis.server.ts` | Connexion Redis silencieuse sans gestion d'erreur |
| L-03 | 🔵 FAIBLE | `db/client.ts` | Pool PostgreSQL sans configuration explicite |
| L-04 | 🔵 FAIBLE | `validation/user.ts` | Exigences de mot de passe insuffisantes (8 chars min) |
| L-05 | 🔵 FAIBLE | `badges.server.ts` | SQL brut pour la récupération du `bestStreak` |
| L-06 | 🔵 FAIBLE | `root.tsx` | Stack trace conditionné à `DEV` (vérifier en prod) |
| L-07 | 🔵 FAIBLE | `.gitignore` | Variantes `.env.*` non ignorées |

---

## Points positifs identifiés

- Authentification via Better Auth avec sessions Redis
- Rate limiting sur login/register (`api.auth.$.ts`)
- Validation Zod systématique sur les formulaires (user, prediction, feed)
- Protection admin sur toutes les routes admin (`requireAuth(request, ["admin"])`)
- Vérification d'ownership avant suppression de posts/commentaires
- Contrainte d'unicité du pronostic par utilisateur et par match
- Images retraitées par `sharp` avant stockage (redimensionnement + conversion WebP)
- Secrets exclus du dépôt (`.gitignore` couvre `.env`)
- Variables d'environnement validées au démarrage via Zod (`env.server.ts`)
- Aucun `dangerouslySetInnerHTML` dans le code front-end
- Logs structurés avec `pino` sans exposition de données sensibles
