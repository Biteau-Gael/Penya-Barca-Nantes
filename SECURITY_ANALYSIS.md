# Analyse de sécurité — Penya Blaugrana Nantes

**Date** : 2026-05-14  
**Branch analysée** : `claude/sharp-fermi-EoXEU`  
**Commits couverts** : `4da20f3` → `003faca` (historique complet)

---

## Résumé des derniers commits

| Hash | Date | Auteur | Description |
|------|------|--------|-------------|
| `003faca` | 2026-04-13 | Biteau Gaël | fix: évaluer les badges immédiatement après chaque action |
| `b1c88f6` | 2026-04-13 | Biteau Gaël | feat: Phase 2 — soirée match live, micro-pronos, badges, séries, saisons |
| `d461ee5` | 2026-04-12 | Claude | Merge branch `claude/deploy-synology-nas-cLkOL` |
| `554b873` | 2026-04-12 | Claude | Add deployment guide for Synology NAS updates |
| `68e22d2` | 2026-04-13 | Biteau Gaël | feat: menu burger mobile pour la navigation |
| `6aebaf7` | 2026-04-12 | Claude | Fix Better Auth trusted origins for custom domain support |
| `9823bc5` | 2026-04-12 | Claude | Add migrate service to docker-compose.prod.yml |
| `aed5841` | — | Claude | security: supprimer credentials du repo et renforcer .gitignore |

### Points forts déjà en place
- Credentials retirés du dépôt (`aed5841`) et `.gitignore` renforcé
- Authentification centralisée via `requireAuth` avec vérification du rôle
- Validation des entrées côté serveur avec Zod sur toutes les routes critiques
- Rate limiting sur login/inscription via Redis (`app/routes/api.auth.$.ts`)
- ORM Drizzle utilisé partout (pas de SQL brut → pas d'injection SQL)
- Aucun usage de `dangerouslySetInnerHTML` ou `eval()` détecté

---

## Remarques de sécurité (par ordre de criticité)

---

### 🔴 CRITIQUE

#### C-01 — Path traversal dans la route de fichiers uploadés

**Fichier** : `app/routes/uploads-files.ts:5`

```ts
const filePath = path.join(process.cwd(), "uploads", params["*"]);
```

**Problème** : Le paramètre wildcard `params["*"]` est utilisé directement dans `path.join` sans vérification que le chemin résultant reste à l'intérieur du dossier `uploads/`. Un attaquant peut envoyer une requête comme `/uploads/../../etc/passwd` (selon la normalisation du framework) et potentiellement lire des fichiers arbitraires du système.

**Correction recommandée** :

```ts
const UPLOAD_BASE = path.join(process.cwd(), "uploads");

export async function loader({ params }: { params: { "*": string } }) {
  const filePath = path.resolve(UPLOAD_BASE, params["*"]);

  // Bloquer toute sortie du dossier uploads
  if (!filePath.startsWith(UPLOAD_BASE + path.sep)) {
    return new Response("Not found", { status: 404 });
  }
  // ... suite inchangée
}
```

---

### 🟠 ÉLEVÉ

#### H-01 — Deadline des micro-pronos non appliquée côté serveur

**Fichier** : `app/routes/api.micro-predictions.ts:100-108`

**Problème** : Lors d'une réponse (intent `"answer"`), seul le champ `closedAt` est vérifié. Le délai de réponse (`deadlineSeconds`) stocké en base n'est jamais comparé à `createdAt + deadlineSeconds`. Un utilisateur peut donc soumettre une réponse bien après l'expiration du délai configuré, tant qu'un admin n'a pas clôturé manuellement le micro-pronostic.

**Correction recommandée** :

```ts
// Dans le bloc intent === "answer"
const deadlineAt = new Date(micro.createdAt.getTime() + micro.deadlineSeconds * 1000);
if (micro.closedAt || new Date() > deadlineAt) {
  return Response.json({ error: "Micro-pronostic fermé" }, { status: 400 });
}
```

---

#### H-02 — Rate limiting contournable par usurpation d'IP (IP spoofing)

**Fichier** : `app/routes/api.auth.$.ts:6-10`

```ts
function getClientIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}
```

**Problème** : Si l'application est accessible directement (sans reverse proxy de confiance), n'importe quel client peut forger l'en-tête `X-Forwarded-For` pour contourner le rate limiting sur login/inscription.

**Recommandation** : S'assurer que l'application est toujours derrière un reverse proxy (Nginx/Traefik sur le NAS) qui écrase `X-Forwarded-For`, ou valider que la requête vient d'une IP de proxy connue avant de faire confiance à cet en-tête.

---

### 🟡 MOYEN

#### M-01 — Mots de passe par défaut en production

**Fichier** : `docker-compose.prod.yml:16,22`

```yaml
POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-changeme}
redis-server --requirepass ${REDIS_PASSWORD:-changeme}
```

**Problème** : Si le fichier `.env` est absent ou mal configuré au déploiement, les services démarrent avec le mot de passe `changeme`. Ce risque est particulièrement présent lors d'un premier déploiement ou d'une mise à jour du NAS.

**Recommandation** : Remplacer les valeurs de fallback par une absence de valeur (forcer l'erreur si non défini) :

```yaml
POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?POSTGRES_PASSWORD must be set}
```

---

#### M-02 — Absence d'en-têtes de sécurité HTTP

**Fichier** : aucun middleware de sécurité détecté

**Problème** : Aucun en-tête de sécurité HTTP n'est émis par l'application :
- Pas de `Content-Security-Policy`
- Pas de `X-Frame-Options` (protection clickjacking)
- Pas de `X-Content-Type-Options`
- Pas de `Strict-Transport-Security` (HSTS)
- Pas de `Referrer-Policy`

**Recommandation** : Ajouter un middleware dans `app/root.tsx` (via le loader racine) ou configurer Nginx en amont pour émettre ces en-têtes. Exemple via `entry.server.tsx` :

```ts
responseHeaders.set("X-Frame-Options", "DENY");
responseHeaders.set("X-Content-Type-Options", "nosniff");
responseHeaders.set("Referrer-Policy", "strict-origin-when-cross-origin");
```

---

#### M-03 — Client DB contourne la validation centralisée de l'environnement

**Fichier** : `app/db/client.ts:5`

```ts
connectionString: process.env.DATABASE_URL,
```

**Problème** : La connexion à la base de données lit `DATABASE_URL` directement depuis `process.env` au lieu de passer par `getEnv()` (qui valide via Zod). Si `DATABASE_URL` est absente, le pool Postgres démarre silencieusement avec `undefined` et les erreurs n'apparaissent qu'à la première requête.

**Correction recommandée** :

```ts
import { getEnv } from "~/config/env.server";
const pool = new pg.Pool({ connectionString: getEnv().DATABASE_URL });
```

---

### 🔵 FAIBLE / AMÉLIORATION

#### L-01 — trustedOrigins vide si APP_URL non défini (Better Auth)

**Fichier** : `app/lib/server/auth.server.ts:12`

```ts
trustedOrigins: env.APP_URL ? [env.APP_URL] : [],
```

**Problème** : En l'absence de `APP_URL`, Better Auth accepte toutes les origines, ce qui peut être problématique si des fonctionnalités CSRF sont activées ultérieurement.

**Recommandation** : Documenter dans `.env.example` que `APP_URL` est requis en production, ou ajouter une vérification d'environnement.

---

#### L-02 — Logger lit LOG_LEVEL directement depuis process.env

**Fichier** : `app/lib/server/logger.server.ts:3`

```ts
level: process.env.LOG_LEVEL || "info",
```

**Problème** : Mineur — cohérence avec le reste du projet qui utilise `getEnv()` pour l'accès aux variables d'environnement.

---

## Tableau récapitulatif

| ID | Sévérité | Fichier | Problème |
|----|----------|---------|----------|
| C-01 | 🔴 Critique | `uploads-files.ts:5` | Path traversal possible |
| H-01 | 🟠 Élevé | `api.micro-predictions.ts:100` | Deadline micro-pronos non appliquée |
| H-02 | 🟠 Élevé | `api.auth.$.ts:6` | Rate limit contournable par IP spoofing |
| M-01 | 🟡 Moyen | `docker-compose.prod.yml:16,22` | Mots de passe par défaut `changeme` |
| M-02 | 🟡 Moyen | aucun middleware | Absence d'en-têtes de sécurité HTTP |
| M-03 | 🟡 Moyen | `db/client.ts:5` | DATABASE_URL non validée au démarrage |
| L-01 | 🔵 Faible | `auth.server.ts:12` | trustedOrigins vide si APP_URL absent |
| L-02 | 🔵 Faible | `logger.server.ts:3` | LOG_LEVEL hors du schéma de validation |

---

## Priorité d'action recommandée

1. **Immédiat** : corriger C-01 (path traversal) — risque de lecture de fichiers système
2. **Court terme** : corriger H-01 (deadline micro-pronos) et M-01 (mots de passe prod)
3. **Sprint suivant** : ajouter les en-têtes HTTP (M-02), corriger M-03 et H-02
4. **Backlog** : L-01 et L-02 (cohérence et bonnes pratiques)
