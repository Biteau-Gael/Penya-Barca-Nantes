# Rapport d'analyse de sécurité — Penya Barca Nantes

**Date :** 2026-04-23  
**Branche analysée :** `main` (HEAD `003faca`)  
**Commits couverts :** Phase 2 complète (`b1c88f6` → `003faca`)

---

## Résumé des derniers commits

| Hash | Date | Description |
|------|------|-------------|
| `003faca` | 13/04/2026 | fix: évaluer les badges immédiatement après chaque action (feed, match-detail) |
| `b1c88f6` | 13/04/2026 | feat: Phase 2 — soirée match live, micro-pronos, badges, séries, saisons |
| `d461ee5` | 12/04/2026 | Merge branch `claude/deploy-synology-nas-cLkOL` |
| `554b873` | 12/04/2026 | Add deployment guide for Synology NAS updates |
| `68e22d2` | 13/04/2026 | feat: menu burger mobile pour la navigation |

### Périmètre Phase 2 (b1c88f6)
- **Page soirée match** : route `/soiree/:matchId`, score live via polling API 60 s, fil temps réel (buts, cartons, remplacements)
- **Micro-pronostics** : création/clôture admin, vote joueur, attribution automatique des points, suppression admin
- **Séries** : `currentStreak` / `bestStreak` sur le modèle `user`, récompenses aux paliers 3/5/10
- **Badges** : 10 badges de base, page `/badges`, évaluation post-action
- **Saisons** : table `seasons`, filtre par saison sur le classement
- **Migration DB 0007** : 6 nouvelles tables / colonnes

---

## Analyse de sécurité — Résultats par criticité

---

### 🔴 CRITIQUE

#### C1 — Path Traversal sur le serveur de fichiers uploads
**Fichier :** `app/routes/uploads-files.ts:5`

```ts
const filePath = path.join(process.cwd(), "uploads", params["*"]);
```

`params["*"]` est la portion wildcard de l'URL, non filtrée. `path.join` ne neutralise pas les séquences `../`. Une requête vers `/uploads/../../.env` ou `/uploads/../../../../etc/passwd` lit des fichiers hors du répertoire autorisé.

**Risque :** lecture du fichier `.env` (contenant `DATABASE_URL`, `AUTH_SECRET`, `API_FOOTBALL_KEY`) ou de tout fichier accessible au processus Node.

**Correction recommandée :**
```ts
import path from "node:path";

const UPLOAD_DIR = path.resolve(process.cwd(), "uploads");

export async function loader({ params }: { params: { "*": string } }) {
  const requested = path.resolve(UPLOAD_DIR, params["*"]);
  // Vérification anti path-traversal
  if (!requested.startsWith(UPLOAD_DIR + path.sep)) {
    return new Response("Forbidden", { status: 403 });
  }
  // ... suite inchangée
}
```

---

### 🟠 ÉLEVÉ

#### E1 — En-têtes HTTP de sécurité absents
**Fichier :** `app/root.tsx` (aucune fonction `headers` définie)

Aucun des en-têtes de sécurité standards n'est positionné :
- `Content-Security-Policy` — protège contre XSS
- `X-Frame-Options: DENY` — protège contre le clickjacking
- `X-Content-Type-Options: nosniff` — empêche le MIME sniffing
- `Strict-Transport-Security` — force HTTPS
- `Referrer-Policy: strict-origin-when-cross-origin`

**Correction recommandée :** ajouter une fonction `headers` dans `root.tsx` ou dans un middleware React Router :
```ts
export function headers() {
  return {
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Strict-Transport-Security": "max-age=63072000; includeSubDomains",
  };
}
```

---

#### E2 — Accès direct à `process.env` contournant la validation Zod
**Fichiers :** `app/db/client.ts:5`, `app/lib/server/redis.server.ts:3`, `app/lib/server/logger.server.ts:4`

Ces trois fichiers lisent `process.env` directement au lieu de passer par `getEnv()` (qui valide via Zod). Si `DATABASE_URL` est absente, le pool Postgres démarre avec `undefined` et l'erreur n'est détectée qu'à la première requête. Pour Redis, le fallback `redis://localhost:6379` masque une configuration manquante en production.

**Correction recommandée :** utiliser `getEnv()` dans ces modules :
```ts
// db/client.ts
import { getEnv } from "~/config/env.server";
const pool = new pg.Pool({ connectionString: getEnv().DATABASE_URL });
```

---

#### E3 — Mots de passe par défaut "changeme" en production
**Fichier :** `docker-compose.prod.yml:22,30`

```yaml
POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-changeme}
redis-server --requirepass ${REDIS_PASSWORD:-changeme}
```

Si les variables d'environnement ne sont pas définies au démarrage, les services démarrent avec le mot de passe `changeme`. Ce pattern n'échoue pas à l'initialisation — il fonctionne silencieusement avec un secret faible.

**Correction recommandée :** supprimer la valeur par défaut pour forcer une erreur explicite si la variable est absente :
```yaml
POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?POSTGRES_PASSWORD doit être défini}
```

---

#### E4 — Crédentiels précédemment commis dans l'historique git
**Commit :** `aed5841` — *"security: supprimer credentials du repo"*

Des crédentiels ont été supprimés du dépôt à ce commit, mais l'historique git les conserve. Si le dépôt a été ou est public, ces secrets sont considérés comme compromis.

**Actions requises :**
1. Vérifier que tous les secrets visibles dans l'historique ont bien été régénérés (`AUTH_SECRET`, mots de passe DB/Redis, clé API Football).
2. Si nécessaire, purger l'historique avec `git filter-repo` ou BFG Repo Cleaner.

---

### 🟡 MOYEN

#### M1 — Validation du type MIME des uploads basée sur le client
**Fichier :** `app/lib/server/upload.ts:13`

```ts
if (!ALLOWED_TYPES.includes(file.type)) {
  throw new Error("Format non supporté...");
}
```

`file.type` est fourni par le client HTTP et peut être falsifié. Un fichier `.php` ou `.svg` peut être envoyé avec `Content-Type: image/jpeg`.

**Correction recommandée :** vérifier les magic bytes du buffer avec la bibliothèque `file-type` :
```ts
import { fileTypeFromBuffer } from "file-type";
const detected = await fileTypeFromBuffer(buffer);
if (!detected || !ALLOWED_TYPES.includes(detected.mime)) {
  throw new Error("Format non supporté.");
}
```

---

#### M2 — Rate limiting absent sur les routes de mutation non-auth
**Fichiers :** `app/routes/api.micro-predictions.ts`, `app/routes/feed.server.ts`

Le rate limiting n'est implémenté que sur les routes `/api/auth/sign-in` et `/api/auth/sign-up`. Les actions de vote sur les micro-pronostics, de publication de posts et de commentaires ne sont pas limitées, exposant ces endpoints à du spam ou à une exploitation par bot.

**Correction recommandée :** étendre `checkRateLimit` aux routes d'action sensibles, par exemple pour les micro-pronos :
```ts
await checkRateLimit({ key: `micro-answer:${session.user.id}`, maxAttempts: 30, windowSeconds: 60 });
```

---

#### M3 — JSON.parse sur des données stockées en base sans validation de schéma
**Fichiers :** `app/lib/server/badges.server.ts:172`, `app/routes/match-detail.server.ts:83`, `app/routes/soiree.server.ts:250`

Les colonnes `badges.condition`, `matches.matchDetails` et `microPredictions.options` sont parsées directement depuis la DB sans validation de structure. Si une entrée corrompue (ou malveillante via une faille d'écriture admin) contient un JSON malformé, cela provoque une exception non gérée. Si la structure est inattendue, elle peut provoquer un comportement imprévisible.

**Correction recommandée :** utiliser Zod pour valider le résultat après `JSON.parse` :
```ts
const conditionSchema = z.object({ type: z.string(), threshold: z.number() });
const condition = conditionSchema.parse(JSON.parse(badge.condition));
```

---

#### M4 — `trustedOrigins` vide si `APP_URL` non défini
**Fichier :** `app/lib/server/auth.server.ts:12`

```ts
trustedOrigins: env.APP_URL ? [env.APP_URL] : [],
```

Selon la version de Better Auth, une liste vide peut signifier "aucune origine de confiance" (bloquant potentiellement les requêtes légitimes) ou "toutes les origines autorisées". Le comportement exact n'est pas documenté et peut varier selon les versions.

**Correction recommandée :** rendre `APP_URL` obligatoire dans le schéma Zod :
```ts
APP_URL: z.string().url(),
```

---

### 🔵 FAIBLE / OBSERVATION

#### F1 — Secret d'authentification de longueur minimale insuffisante
**Fichier :** `app/config/env.server.ts:10`

`AUTH_SECRET: z.string().min(16)` — Better Auth recommande un secret d'au moins 32 caractères pour garantir une entropie suffisante pour les signatures HMAC-SHA256.

**Correction :** `z.string().min(32, "AUTH_SECRET doit faire au moins 32 caractères")`

---

#### F2 — `rel="noopener noreferrer"` manquant sur certains liens externes
**Fichiers :** `app/routes/match-detail.tsx:316` (présent), mais vérification nécessaire sur les autres routes avec liens `target="_blank"`.

---

#### F3 — Dockerfile copie tout le contexte de build
**Fichier :** `Dockerfile:2`

```dockerfile
COPY . /app
```

Si un fichier `.env` local est présent, il sera inclus dans l'image Docker. Le `.dockerignore` actuel ne liste que des répertoires génériques.

**Correction :** ajouter explicitement `.env*` dans `.dockerignore` :
```
.env
.env.*
!.env.example
```

---

## Tableau de synthèse

| ID | Criticité | Fichier | Problème | Effort correctif |
|----|-----------|---------|----------|-----------------|
| C1 | 🔴 Critique | `uploads-files.ts` | Path traversal — lecture arbitraire de fichiers | Faible |
| E1 | 🟠 Élevé | `root.tsx` | En-têtes HTTP de sécurité absents | Faible |
| E2 | 🟠 Élevé | `db/client.ts`, `redis.server.ts`, `logger.server.ts` | Bypass validation env via `process.env` direct | Faible |
| E3 | 🟠 Élevé | `docker-compose.prod.yml` | Mots de passe par défaut "changeme" | Faible |
| E4 | 🟠 Élevé | Historique git | Crédentiels potentiellement exposés | Moyen |
| M1 | 🟡 Moyen | `upload.ts` | MIME type validé côté client uniquement | Moyen |
| M2 | 🟡 Moyen | `api.micro-predictions.ts`, `feed.server.ts` | Absence de rate limiting sur mutations | Faible |
| M3 | 🟡 Moyen | `badges.server.ts`, `match-detail.server.ts` | JSON.parse sans validation de schéma | Faible |
| M4 | 🟡 Moyen | `auth.server.ts` | `trustedOrigins` vide si `APP_URL` absent | Faible |
| F1 | 🔵 Faible | `env.server.ts` | Longueur minimale `AUTH_SECRET` insuffisante | Trivial |
| F2 | 🔵 Faible | Diverses routes | `noopener noreferrer` à vérifier | Trivial |
| F3 | 🔵 Faible | `Dockerfile`, `.dockerignore` | `.env` potentiellement inclus dans l'image | Trivial |

---

## Points positifs constatés

- **Authentification robuste** : Better Auth avec sessions Redis, `requireAuth` systématiquement appelé sur toutes les routes protégées.
- **Contrôle des rôles** : vérification `session.user.role === "admin"` cohérente sur les actions admin ; un admin ne peut pas modifier son propre rôle.
- **Rate limiting opérationnel** sur les routes d'auth (login 10/15min, register 5/h).
- **Validation des entrées** : Zod utilisé pour les formulaires utilisateur (pseudo, email, mot de passe avec règles de complexité).
- **Prévention SQL injection** : utilisation exclusive de Drizzle ORM avec requêtes paramétrées ; les rares `sql\`...\`` utilisent l'interpolation sécurisée de Drizzle.
- **Gestion des secrets** : `getEnv()` centralise et valide les variables d'environnement au démarrage ; `.env` est dans `.gitignore`.
- **Liens externes sécurisés** : `rel="noopener noreferrer"` présent sur les principales occurrences.
- **Upload d'avatar sécurisé** : retraitement systématique via `sharp` (resize + re-encodage WebP), éliminant les métadonnées et les payloads EXIF/polyglot.
