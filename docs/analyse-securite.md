# Analyse de sécurité — Penya Blaugrana Nantes

**Date :** 2026-05-25  
**Branche analysée :** `claude/sharp-fermi-FetbG`  
**Périmètre :** commits `fec3e63` → `003faca` (Phase 1 + Phase 2 complète)

---

## Résumé des commits récents

| Hash | Description |
|------|-------------|
| `003faca` | fix: évaluation des badges après chaque action (post, commentaire, réaction, pronostic) |
| `b1c88f6` | feat: Phase 2 — soirée match live, micro-pronos, badges, séries, saisons |
| `d461ee5` | Merge branch deploy Synology NAS |
| `68e22d2` | feat: menu burger mobile |
| `6aebaf7` | Fix Better Auth trusted origins pour domaine custom |
| `9823bc5` | Ajout service migrate dans docker-compose.prod.yml |
| `8d6e5e9` | Docker Compose production + script backup Synology |
| `3d80133` | docs: roadmap Phase 2 |
| `aed5841` | **security:** suppression credentials du repo + renforcement .gitignore |
| `6583da3` | docs: README + guide déploiement NAS |
| `ab7fc5d` | feat: intégration API Football + stats enrichies + classement Liga |
| `fec3e63` | feat: MVP Phase 1 — Penya Blaugrana Nantes |

---

## Analyse de sécurité par criticité

---

### CRITIQUE

#### C1 — Path traversal dans le serveur de fichiers statiques

**Fichier :** `app/routes/uploads-files.ts:80`

```typescript
const filePath = path.join(process.cwd(), "uploads", params["*"]);
```

Le paramètre wildcard de l'URL est utilisé directement pour construire le chemin du fichier sans aucune vérification que le chemin résolu reste à l'intérieur du dossier `uploads/`. Un attaquant peut utiliser des séquences de type `../../etc/passwd` ou `../../app/config/env.server.ts` pour lire des fichiers arbitraires sur le serveur.

**Correction à appliquer :**

```typescript
export async function loader({ params }: { params: { "*": string } }) {
  const UPLOAD_DIR = path.join(process.cwd(), "uploads");
  const filePath = path.resolve(UPLOAD_DIR, params["*"]);

  // Vérification anti path-traversal
  if (!filePath.startsWith(UPLOAD_DIR + path.sep)) {
    return new Response("Forbidden", { status: 403 });
  }
  // ... suite inchangée
}
```

---

### ÉLEVÉ

#### E1 — Absence d'en-têtes de sécurité HTTP

**Fichier :** `app/root.tsx` (aucune fonction `headers` exportée)

Aucun des en-têtes de sécurité HTTP standard n'est défini :

- `Content-Security-Policy` (CSP) — protection XSS
- `X-Frame-Options` ou `frame-ancestors` — protection clickjacking
- `X-Content-Type-Options: nosniff` — protection MIME sniffing
- `Strict-Transport-Security` (HSTS) — force HTTPS
- `Referrer-Policy`

**Correction :** Ajouter dans `app/root.tsx` (ou dans la config React Router) :

```typescript
export const headers: Route.HeadersFunction = () => ({
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "Content-Security-Policy": "default-src 'self'; img-src 'self' data: https:; font-src 'self' https://fonts.gstatic.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
});
```

---

#### E2 — Absence de rate limiting sur le fil d'actualité

**Fichier :** `app/routes/feed.server.ts`

Les actions `create-post`, `comment` et `react` ne sont soumises à aucune limitation de débit. Un utilisateur authentifié peut créer un nombre illimité de posts ou commentaires en très peu de temps, causant du spam ou une surcharge de la base de données.

Le rate limiter Redis existe (`rate-limit.server.ts`) mais n'est utilisé que sur `api/auth` (login et register).

**Correction :** Appliquer `checkRateLimit` dans `feedAction` :

```typescript
// Avant chaque intent sensible
await checkRateLimit({
  key: `feed-post:${session.user.id}`,
  maxAttempts: 10,
  windowSeconds: 60,
});
```

---

#### E3 — `deadlineSeconds` des micro-pronos non appliqué côté serveur

**Fichier :** `app/routes/api.micro-predictions.ts:90-131`

Le champ `deadlineSeconds` est stocké en base et affiché dans l'UI comme un compte à rebours. Cependant, la vérification serveur pour les réponses utilisateur se base **uniquement** sur `closedAt`. Si l'admin oublie de clôturer le micro-prono, les joueurs peuvent continuer à répondre après l'expiration du délai affiché, ou inversement l'UI peut montrer un délai expiré alors que les réponses sont encore acceptées.

**Correction :** Vérifier également l'expiration par `deadlineSeconds` lors de la soumission d'une réponse :

```typescript
const elapsed = (Date.now() - new Date(micro.createdAt).getTime()) / 1000;
if (elapsed > micro.deadlineSeconds) {
  return Response.json({ error: "Délai de réponse expiré" }, { status: 400 });
}
```

---

### MOYEN

#### M1 — Race condition dans le rate limiter Redis

**Fichier :** `app/lib/server/rate-limit.server.ts:105-109`

```typescript
const current = await redis.incr(redisKey);
if (current === 1) {
  await redis.expire(redisKey, windowSeconds);
}
```

`INCR` et `EXPIRE` sont deux commandes non atomiques. Si le processus crashe entre les deux, la clé n'expire jamais et le rate limit reste bloqué définitivement.

**Correction :** Utiliser un pipeline atomique ou `SET ... EX ... NX` :

```typescript
const pipeline = redis.pipeline();
pipeline.incr(redisKey);
pipeline.expire(redisKey, windowSeconds);
const [[, current]] = await pipeline.exec();
```

---

#### M2 — Endpoint `/api/health` public révèle l'état de l'infrastructure

**Fichier :** `app/routes/api.health.ts`

L'endpoint de santé répond sans authentification et expose l'état de PostgreSQL et Redis à n'importe qui. Ces informations peuvent être utiles à un attaquant pour planifier une attaque.

**Correction :** Protéger avec un secret partagé en header (utilisé par le monitoring) ou restreindre via règle Nginx/pare-feu :

```typescript
const token = request.headers.get("x-health-token");
if (token !== process.env.HEALTH_CHECK_TOKEN) {
  return new Response("Unauthorized", { status: 401 });
}
```

---

#### M3 — Validation insuffisante des champs numériques admin (micro-pronos)

**Fichier :** `app/routes/api.micro-predictions.ts:23-24`

```typescript
const pointsValue = parseInt(formData.get("pointsValue") as string) || 1;
const deadlineSeconds = parseInt(formData.get("deadlineSeconds") as string) || 120;
```

Ces valeurs ne sont pas bornées. Un admin (ou une requête forgée) pourrait attribuer des points négatifs ou un délai extrêmement long/court.

**Correction :**

```typescript
const pointsValue = Math.min(Math.max(parseInt(formData.get("pointsValue") as string) || 1, 1), 100);
const deadlineSeconds = Math.min(Math.max(parseInt(formData.get("deadlineSeconds") as string) || 120, 10), 3600);
```

---

#### M4 — Cast `any` pour la vérification de rôle dans le fil

**Fichier :** `app/routes/feed.server.ts:99, 124, 184, 200`

```typescript
const isAdmin = (session.user as any).role === "admin";
```

L'usage de `as any` contourne la vérification de type TypeScript et masque les erreurs potentielles de typage. Si le type de `session.user` évolue, cette vérification ne sera pas signalée par le compilateur.

**Correction :** Importer et utiliser le type `Role` déjà défini :

```typescript
import type { Role } from "~/lib/server/auth-utils.server";
const userRole = session.user.role as Role;
const isAdmin = userRole === "admin";
```

---

### FAIBLE

#### F1 — Cache-Control `immutable` sur les avatars avec nom fixe

**Fichier :** `app/routes/uploads-files.ts:95`

```
"Cache-Control": "public, max-age=31536000, immutable"
```

Le fichier avatar est nommé `{userId}.webp` (nom fixe). Si un utilisateur change d'avatar, le navigateur continuera à afficher l'ancien pendant 1 an car la ressource est marquée `immutable`.

**Correction :** Utiliser un hash de contenu ou un timestamp dans le nom du fichier, ou supprimer `immutable` et réduire `max-age` :

```typescript
"Cache-Control": "public, max-age=86400",
```

---

#### F2 — IP client extraite sans validation de proxy de confiance

**Fichier :** `app/routes/api.auth.$.ts:6-10`

```typescript
request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
```

Si l'application n'est pas derrière un proxy de confiance (ou si le proxy n'est pas configuré pour filtrer ces headers), un attaquant peut forger le header `X-Forwarded-For` pour contourner le rate limiting par IP.

**Vérification :** S'assurer que Nginx/Traefik (visible dans docker-compose.prod.yml) est configuré pour écraser ce header avec la vraie IP cliente avant de le transmettre à l'application.

---

#### F3 — Journalisation des IDs utilisateurs (RGPD)

**Fichiers :** Multiples fichiers server (`feed.server.ts`, `profile.server.ts`, etc.)

```typescript
logger.info({ action: "post-created", userId: session.user.id }, "Post publié");
```

Les IDs utilisateurs sont des données personnelles au sens du RGPD. Leur présence dans les logs implique une politique de rétention et d'accès définie. Si les logs sont centralisés (ex. Grafana Loki), vérifier que la durée de rétention est conforme.

**Recommandation :** Documenter la politique de rétention des logs ou pseudonymiser les IDs dans les logs applicatifs.

---

## Récapitulatif

| Priorité | ID | Fichier principal | Impact |
|----------|----|-------------------|--------|
| 🔴 CRITIQUE | C1 | `uploads-files.ts:80` | Lecture de fichiers arbitraires sur le serveur |
| 🟠 ÉLEVÉ | E1 | `root.tsx` | Absence de protection XSS, clickjacking, MIME sniffing |
| 🟠 ÉLEVÉ | E2 | `feed.server.ts` | Spam / déni de service applicatif |
| 🟠 ÉLEVÉ | E3 | `api.micro-predictions.ts:90` | Contournement de la règle de délai des micro-pronos |
| 🟡 MOYEN | M1 | `rate-limit.server.ts:105` | Blocage permanent potentiel du rate limiter |
| 🟡 MOYEN | M2 | `api.health.ts` | Exposition de l'état interne de l'infrastructure |
| 🟡 MOYEN | M3 | `api.micro-predictions.ts:23` | Valeurs extrêmes non bornées |
| 🟡 MOYEN | M4 | `feed.server.ts:99` | Contournement potentiel du typage de rôle |
| 🟢 FAIBLE | F1 | `uploads-files.ts:95` | Avatars non mis à jour visuellement pendant 1 an |
| 🟢 FAIBLE | F2 | `api.auth.$.ts:6` | Rate limit IP contournable par header forgé |
| 🟢 FAIBLE | F3 | Multiples fichiers | Journalisation de données personnelles (RGPD) |

---

## Points positifs constatés

- ✅ Toutes les routes sensibles utilisent `requireAuth` avec vérification de rôle
- ✅ Rate limiting en place sur login et register (Redis)
- ✅ Validation Zod sur tous les formulaires admin et utilisateur
- ✅ Drizzle ORM utilisé partout — aucune requête SQL brute (protection injection SQL)
- ✅ Upload d'avatar restreint au type MIME et limité à 2 Mo avec conversion WebP forcée
- ✅ Protection auto-modification : un admin ne peut pas supprimer/modifier son propre rôle
- ✅ Pronos communautaires masqués avant la deadline
- ✅ Credentials supprimés du repo (commit `aed5841`)
- ✅ Variables d'environnement validées par Zod au démarrage (`env.server.ts`)
- ✅ Logs structurés avec `pino` (pas de `console.log` avec données sensibles en clair)
