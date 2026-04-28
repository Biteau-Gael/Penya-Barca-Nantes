# Audit de sécurité — Penya Blaugrana Nantes

**Date :** 2026-04-28  
**Branche analysée :** `main`  
**Derniers commits analysés :** `003faca` → `fec3e63`  
**Analyste :** Claude Code (audit automatisé + revue manuelle)

---

## Résumé des derniers commits

| Hash | Date | Description |
|------|------|-------------|
| `003faca` | 2026-04-13 | fix: évaluer les badges immédiatement après chaque action |
| `b1c88f6` | 2026-04-13 | feat: Phase 2 — soirée match live, micro-pronos, badges, séries, saisons |
| `d461ee5` | 2026-04-12 | Merge branch `claude/deploy-synology-nas-cLkOL` |
| `554b873` | 2026-04-12 | Add deployment guide for Synology NAS updates |
| `68e22d2` | 2026-04-13 | feat: menu burger mobile pour la navigation |
| `4a65a7b` | 2026-04-13 | Merge PR #2 — deploy Synology NAS |
| `6aebaf7` | 2026-04-12 | Fix Better Auth trusted origins for custom domain support |
| `9823bc5` | 2026-04-12 | Add migrate service to docker-compose.prod.yml |
| `2bafc6c` | 2026-04-12 | Merge PR #1 — deploy Synology NAS |
| `8d6e5e9` | 2026-04-12 | Add production Docker Compose and backup script for Synology NAS |

---

## Résultats de l'audit par ordre de criticité

---

### 🔴 CRITIQUE

#### C-01 — Path Traversal sur le serveur de fichiers statiques

**Fichier :** `app/routes/uploads-files.ts:5`  
**Commit introduisant le problème :** `fec3e63` (commit initial)

**Description :**  
Le paramètre wildcard de la route est concaténé directement dans un chemin de fichier sans aucune validation. Un attaquant peut remonter l'arborescence avec `../` et lire n'importe quel fichier accessible au processus Node.js.

```typescript
// VULNÉRABLE
const filePath = path.join(process.cwd(), "uploads", params["*"]);
```

**Exemple d'attaque :**
```
GET /uploads-files/../../.env
GET /uploads-files/../../../etc/passwd
```

**Correction recommandée :**
```typescript
import { readFile } from "node:fs/promises";
import path from "node:path";

const UPLOADS_DIR = path.resolve(process.cwd(), "uploads");

export async function loader({ params }: { params: { "*": string } }) {
  const requested = path.resolve(UPLOADS_DIR, params["*"]);

  // Bloquer toute tentative de sortie du répertoire uploads
  if (!requested.startsWith(UPLOADS_DIR + path.sep)) {
    return new Response("Forbidden", { status: 403 });
  }

  // Valider l'extension (whitelist)
  const ext = path.extname(requested).toLowerCase();
  const mimeTypes: Record<string, string> = {
    ".webp": "image/webp",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
  };
  if (!mimeTypes[ext]) {
    return new Response("Forbidden", { status: 403 });
  }

  try {
    const file = await readFile(requested);
    return new Response(file, {
      headers: {
        "Content-Type": mimeTypes[ext],
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
```

**Impact :** Lecture de fichiers arbitraires (`.env`, secrets, code source, données utilisateurs).  
**Effort de correction :** Faible (< 30 min).

---

### 🟠 ÉLEVÉ

#### H-01 — Absence de validation et de bornes sur les entrées des micro-pronostics

**Fichier :** `app/routes/api.micro-predictions.ts:20-30`  
**Commit introduisant le problème :** `b1c88f6`

**Description :**  
Les champs `question`, `type`, `answer`, `pointsValue` et `deadlineSeconds` sont utilisés sans validation de format, de longueur ou de plage numérique.

```typescript
// Pas de validation de longueur
const question = formData.get("question") as string;

// parseInt sans contrôle de borne : valeurs négatives ou énormes acceptées
const pointsValue = parseInt(formData.get("pointsValue") as string) || 1;
const deadlineSeconds = parseInt(formData.get("deadlineSeconds") as string) || 120;

// type non contrôlé contre une whitelist
const type = (formData.get("type") as string) || "qcm";

// answer côté joueur : pas de longueur maximale
const answer = formData.get("answer") as string;
```

**Risques :**
- Stockage de chaînes arbitrairement longues en base de données (DoS, coûts de stockage).
- Valeurs négatives pour `pointsValue` permettant de soustraire des points.
- `type` non whitelisté pouvant provoquer un comportement inattendu.

**Correction recommandée :**
```typescript
import { z } from "zod";

const createMicroSchema = z.object({
  matchId: z.string().min(1).max(128),
  question: z.string().min(3).max(500),
  type: z.enum(["qcm", "boolean", "text"]),
  options: z.string().max(1000).optional(),
  pointsValue: z.coerce.number().int().min(1).max(100),
  deadlineSeconds: z.coerce.number().int().min(30).max(3600),
});

const answerSchema = z.object({
  microId: z.string().min(1).max(128),
  answer: z.string().min(1).max(200),
});
```

**Impact :** Corruption de données, déni de service applicatif, manipulation de points.  
**Effort de correction :** Faible (< 1h).

#### H-02 — Absence de rate limiting sur les endpoints API métier

**Fichiers :** `app/routes/api.micro-predictions.ts`, `app/routes/feed.server.ts`  
**Commit introduisant le problème :** `b1c88f6`, `ab7fc5d`

**Description :**  
Le rate limiting est uniquement appliqué sur `/api/auth` (connexion et inscription). Les actions métier sensibles n'ont aucune limitation :

- Création/réponse aux micro-pronostics
- Création de posts et commentaires dans le fil
- Réactions aux posts

Un attaquant authentifié peut spammer ces endpoints, polluer la base de données et fausser les classements.

**Correction recommandée :**  
Appliquer `checkRateLimit` sur les actions de mutation :

```typescript
// Exemple dans api.micro-predictions.ts (intent "answer")
await checkRateLimit({
  key: `micro-answer:${session.user.id}`,
  maxAttempts: 20,
  windowSeconds: 60,
});
```

**Impact :** Spam, pollution de données, faux classements, surcharge serveur.  
**Effort de correction :** Faible (< 2h pour couvrir tous les endpoints).

#### H-03 — Contournement possible du rate limiting par spoofing IP

**Fichier :** `app/routes/api.auth.$.ts:5-10`  
**Commit introduisant le problème :** `ab7fc5d`

**Description :**  
L'IP client est extraite du header `x-forwarded-for` sans vérification que la requête provient d'un reverse proxy de confiance. Si l'application est directement exposée sur Internet (même temporairement), ce header peut être forgé.

```typescript
function getClientIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}
```

**Risque :** Un attaquant peut envoyer `X-Forwarded-For: 1.2.3.4` pour contourner le rate limiting sur connexion/inscription et mener une attaque par force brute.

**Correction recommandée :**  
Configurer Nginx/Traefik pour écraser le header `X-Forwarded-For` (et ne jamais faire confiance à celui fourni par le client). En complément, ajouter le `user-agent` ou un fingerprint dans la clé de rate limit.

**Impact :** Contournement de la protection brute-force sur l'authentification.  
**Effort de correction :** Moyen (configuration réseau + code).

---

### 🟡 MODÉRÉ

#### M-01 — REDIS_URL sans valeur validée dans redis.server.ts

**Fichier :** `app/lib/server/redis.server.ts:3`  
**Commit introduisant le problème :** `fec3e63`

**Description :**  
Le module Redis lit `process.env.REDIS_URL` directement, en court-circuitant la validation Zod définie dans `env.server.ts`. En production, si la variable n'est pas définie, le client se connecte silencieusement à `redis://localhost:6379`.

```typescript
// redis.server.ts — lit process.env directement
export const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379", ...);

// env.server.ts — validation non utilisée ici
REDIS_URL: z.string().default("redis://localhost:6379"),
```

**Correction recommandée :**
```typescript
import { getEnv } from "~/config/env.server";
export const redis = new Redis(getEnv().REDIS_URL, { ... });
```

**Impact :** Sessions stockées en local au lieu du Redis partagé, perte de cohérence des sessions en cluster.  
**Effort de correction :** Trivial (5 min).

#### M-02 — APP_URL optionnelle, trustedOrigins potentiellement vide en production

**Fichier :** `app/lib/server/auth.server.ts:12`, `app/config/env.server.ts:15`  
**Commit introduisant le problème :** `6aebaf7`

**Description :**  
`APP_URL` est déclarée optionnelle. Si elle n'est pas définie en production, `trustedOrigins` devient un tableau vide, ce qui peut affaiblir la protection CSRF de Better Auth selon la configuration du framework.

```typescript
trustedOrigins: env.APP_URL ? [env.APP_URL] : [],
```

**Correction recommandée :**  
Rendre `APP_URL` obligatoire en production :
```typescript
APP_URL: z.string().url().optional().refine(
  (val) => process.env.NODE_ENV !== "production" || val !== undefined,
  { message: "APP_URL est requis en production" }
),
```

**Impact :** Potentielle faiblesse CSRF si le domaine de production n'est pas déclaré.  
**Effort de correction :** Faible (< 30 min).

#### M-03 — Absence de filtre sur les données sensibles dans les logs

**Fichier :** `app/lib/server/logger.server.ts`  
**Commit introduisant le problème :** `fec3e63`

**Description :**  
Le logger (pino) n'est pas configuré avec une liste de champs à masquer (`redact`). Si un objet contenant `password`, `token` ou `email` est loggé par erreur, les valeurs apparaissent en clair dans les logs.

**Correction recommandée :**
```typescript
import pino from "pino";
export const logger = pino({
  level: getEnv().LOG_LEVEL,
  redact: ["password", "token", "secret", "authorization", "cookie"],
});
```

**Impact :** Fuite de données personnelles ou de secrets dans les fichiers de log.  
**Effort de correction :** Trivial (10 min).

---

### 🟢 POINTS POSITIFS (conformité constatée)

| Point | Détail |
|-------|--------|
| Pas de credentials dans le dépôt | `.gitignore` couvre `.env`, commit `aed5841` a nettoyé les secrets |
| Validation Zod des variables d'environnement | `env.server.ts` valide `DATABASE_URL`, `AUTH_SECRET` (min 16 chars) |
| Protection CSRF via Better Auth | `trustedOrigins` configuré, sessions via Redis |
| Rate limiting sur auth | 10 tentatives / 15 min (login), 5 / 1h (inscription) |
| ORM paramétré | Drizzle ORM — aucun risque d'injection SQL |
| Upload d'avatar sécurisé | Re-encodage Sharp, whitelist de types MIME, taille limitée à 2 Mo, nom de fichier non contrôlé par l'utilisateur |
| Validation des mots de passe | Min 8 chars, majuscule, minuscule, chiffre |
| Contrôle d'autorisation sur les actions feed | Vérification `userId` avant suppression de post/commentaire |
| Sessions en Redis avec TTL | Gestion correcte via `secondaryStorage` de Better Auth |
| Auth logger en mode `error` uniquement | Réduit la verbosité des logs d'auth en production |

---

## Plan d'action prioritaire

| Priorité | ID | Action | Effort |
|----------|----|--------|--------|
| 1 | C-01 | Corriger le path traversal dans `uploads-files.ts` | < 30 min |
| 2 | H-01 | Ajouter validation Zod sur micro-pronostics | < 1h |
| 3 | M-01 | Faire passer redis.server.ts par `getEnv()` | 5 min |
| 4 | M-03 | Ajouter `redact` dans la config pino | 10 min |
| 5 | H-02 | Ajouter rate limiting sur les endpoints métier | < 2h |
| 6 | H-03 | Configurer le reverse proxy pour écraser X-Forwarded-For | Config Nginx/Traefik |
| 7 | M-02 | Rendre `APP_URL` obligatoire en production | < 30 min |
