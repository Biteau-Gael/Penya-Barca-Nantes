# Rapport d'Audit Sécurité — Penya Blaugrana Nantes
**Date :** 16 avril 2026  
**Branche analysée :** `claude/sharp-fermi-HJk9c` (HEAD: `003faca`)  
**Périmètre :** Analyse statique du code source (commits récents + conventions de sécurité)

---

## Résumé des derniers commits

| Hash | Date | Auteur | Description |
|------|------|--------|-------------|
| `003faca` | 2026-04-13 | Claude Opus 4.6 | fix: évaluer les badges immédiatement après chaque action |
| `b1c88f6` | 2026-04-13 | Claude Opus 4.6 | feat: Phase 2 — soirée match live, micro-pronos, badges, séries, saisons |
| `d461ee5` | 2026-04-12 | — | Merge branch `claude/deploy-synology-nas-cLkOL` |
| `554b873` | 2026-04-12 | — | Add deployment guide for Synology NAS updates |
| `68e22d2` | 2026-04-13 | — | feat: menu burger mobile pour la navigation |
| `6aebaf7` | 2026-04-12 | — | Fix Better Auth trusted origins for custom domain support |
| `9823bc5` | 2026-04-12 | — | Add migrate service to docker-compose.prod.yml for database migrations |
| `8d6e5e9` | 2026-04-12 | — | Add production Docker Compose and backup script for Synology NAS deployment |

### Contexte Phase 2 (commit principal `b1c88f6`)
Le commit majeur introduit :
- Page `/soiree/:matchId` avec score live (polling API 60s) et fil d'événements
- Micro-pronostics (création admin, vote joueur, clôture avec points)
- Séries de scores exacts (`currentStreak` / `bestStreak`) avec récompenses
- 10 badges avec évaluation automatique post-action
- Filtrage du classement par saison
- Nouvelles tables DB : `seasons`, `badges`, `user_badges`, `rewards`, `micro_predictions`, `micro_prediction_answers`
- Migration Drizzle : `0007_slimy_maria_hill.sql`

---

## Analyse de Sécurité par Criticité

---

### 🔴 CRITIQUE

#### SEC-01 — Path Traversal sur le service de fichiers uploadés
**Fichier :** `app/routes/uploads-files.ts:5`  
**CWE :** CWE-22 (Improper Limitation of a Pathname to a Restricted Directory)

**Description :**  
Le paramètre wildcard `params["*"]` est passé directement à `path.join` sans validation ni sanitisation. Un attaquant peut fabriquer une URL du type `/uploads/../../etc/passwd` pour lire n'importe quel fichier accessible au processus Node.

```ts
// Code actuel — VULNÉRABLE
const filePath = path.join(process.cwd(), "uploads", params["*"]);
// → /app/uploads/../../etc/passwd  →  /etc/passwd ✓ (traversal réussi)
```

**Impact :** Lecture arbitraire de fichiers serveur (`.env`, secrets, fichiers système).

**Correction recommandée :**
```ts
import path from "node:path";

export async function loader({ params }: { params: { "*": string } }) {
  const UPLOAD_ROOT = path.resolve(process.cwd(), "uploads");
  const filePath = path.resolve(UPLOAD_ROOT, params["*"]);

  // Vérification que le chemin résolu reste dans le répertoire uploads/
  if (!filePath.startsWith(UPLOAD_ROOT + path.sep) && filePath !== UPLOAD_ROOT) {
    return new Response("Forbidden", { status: 403 });
  }
  // … suite inchangée
}
```

---

### 🟠 ÉLEVÉ

#### SEC-02 — Absence de headers HTTP de sécurité
**Fichier :** `app/root.tsx` (aucun header de sécurité défini)  
**CWE :** CWE-16 (Configuration), CWE-693 (Protection Mechanism Failure)

**Description :**  
L'application ne définit aucun header HTTP de sécurité. Sont absents :
- `Content-Security-Policy` (CSP) — risque XSS
- `X-Frame-Options` — risque clickjacking
- `X-Content-Type-Options: nosniff` — risque MIME sniffing
- `Strict-Transport-Security` (HSTS) — risque downgrade HTTP
- `Referrer-Policy` — fuite de données via Referer

**Impact :** Exposition aux attaques XSS, clickjacking et downgrade.

**Correction recommandée :**  
Ajouter un middleware React Router ou configurer le reverse-proxy (nginx) avec ces headers. Exemple dans `app/root.tsx` :

```ts
export function headers() {
  return {
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Strict-Transport-Security": "max-age=63072000; includeSubDomains",
    "Content-Security-Policy":
      "default-src 'self'; img-src 'self' https://images.fotmob.com data:; font-src 'self' https://fonts.gstatic.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  };
}
```

---

#### SEC-03 — Endpoint `/api/health` public sans authentification
**Fichier :** `app/routes/api.health.ts`  
**CWE :** CWE-200 (Exposure of Sensitive Information to an Unauthorized Actor)

**Description :**  
L'endpoint `/api/health` expose l'état des services internes (PostgreSQL, Redis) sans aucune vérification d'identité. Un attaquant peut surveiller les fenêtres de disponibilité, détecter les redémarrages ou cibler les moments de faiblesse de l'infrastructure.

```json
// Réponse visible par n'importe qui :
{
  "status": "ok",
  "services": { "app": "ok", "db": "ok", "redis": "ok" },
  "timestamp": "2026-04-16T10:00:00.000Z"
}
```

**Impact :** Reconnaissance infrastructure facilitée pour un attaquant.

**Correction recommandée :**  
Protéger l'endpoint par un token interne (ex. header `x-health-token`) ou restreindre l'accès au niveau du reverse-proxy (accès uniquement depuis le réseau local / Synology).

---

### 🟡 MOYEN

#### SEC-04 — Mots de passe par défaut en production Docker
**Fichier :** `docker-compose.prod.yml:20,27`  
**CWE :** CWE-521 (Weak Password Requirements), CWE-1188 (Insecure Default Initialization)

**Description :**  
Si les variables d'environnement `POSTGRES_PASSWORD` et `REDIS_PASSWORD` ne sont pas définies dans le `.env` de production, Docker utilise le fallback `changeme` :

```yaml
POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-changeme}  # ligne 20
command: redis-server --requirepass ${REDIS_PASSWORD:-changeme}  # ligne 27
```

**Impact :** Accès direct aux bases de données avec un mot de passe trivial si le `.env` est manquant ou mal configuré.

**Correction recommandée :**  
Supprimer les valeurs par défaut pour forcer une configuration explicite. Si les variables ne sont pas définies, Docker Compose lèvera une erreur plutôt que d'utiliser un mot de passe faible :
```yaml
POSTGRES_PASSWORD=${POSTGRES_PASSWORD:?Variable POSTGRES_PASSWORD manquante}
```

---

#### SEC-05 — Fallback Redis sans authentification
**Fichier :** `app/lib/server/redis.server.ts:3`  
**CWE :** CWE-306 (Missing Authentication for Critical Function)

**Description :**  
Si la variable `REDIS_URL` n'est pas définie, la connexion Redis s'effectue sans mot de passe sur `localhost:6379` :

```ts
export const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379", ...);
```

Les sessions utilisateurs étant stockées dans Redis (via Better Auth), une connexion non sécurisée permet la lecture et la falsification de sessions.

**Impact :** Vol de sessions utilisateurs si Redis est accessible sans mot de passe.

**Correction recommandée :**  
Forcer la présence de `REDIS_URL` via la validation Zod déjà en place dans `env.server.ts` (passer de `.default("redis://localhost:6379")` à `.string()` obligatoire, ou utiliser `getEnv()` dans `redis.server.ts`).

---

#### SEC-06 — Délai de soumission des micro-pronos non appliqué côté serveur
**Fichier :** `app/routes/api.micro-predictions.ts:74-96`  
**CWE :** CWE-602 (Client-Side Enforcement of Server-Side Security)

**Description :**  
Le champ `deadlineSeconds` est stocké mais uniquement utilisé côté client pour l'affichage d'un compte à rebours. Côté serveur, seul `closedAt` (clôture manuelle par l'admin) est vérifié. Un joueur peut contourner le compte à rebours et soumettre une réponse après la deadline si l'admin n'a pas encore clôturé manuellement le micro-prono.

```ts
// Seule vérification présente — insuffisante
if (!micro || micro.closedAt) {
  return Response.json({ error: "Micro-pronostic fermé" }, { status: 400 });
}
// deadlineSeconds est ignoré ici
```

**Impact :** Manipulation du jeu — les joueurs peuvent répondre après avoir vu le résultat.

**Correction recommandée :**
```ts
const deadlineAt = new Date(micro.createdAt.getTime() + micro.deadlineSeconds * 1000);
if (!micro || micro.closedAt || new Date() > deadlineAt) {
  return Response.json({ error: "Micro-pronostic fermé" }, { status: 400 });
}
```

---

### 🔵 FAIBLE

#### SEC-07 — Stack trace exposée dans l'ErrorBoundary
**Fichier :** `app/root.tsx:74-79`  
**CWE :** CWE-209 (Generation of Error Message Containing Sensitive Information)

**Description :**  
La stack trace d'erreur est affichée dans le HTML uniquement si `import.meta.env.DEV` est vrai. Le comportement est correct si `NODE_ENV=production` est bien défini lors du build. Risque résiduel si un build de développement est accidentellement déployé en production.

**Correction recommandée :**  
Aucune action immédiate requise — s'assurer que le pipeline CI/CD définit `NODE_ENV=production` pour les builds de production. Documenter cette exigence dans `DEPLOY.md`.

---

#### SEC-08 — Validation MIME des avatars basée sur `file.type`
**Fichier :** `app/lib/server/upload.ts:12-14`  
**CWE :** CWE-434 (Unrestricted Upload of File with Dangerous Type)

**Description :**  
La propriété `file.type` est fournie par le client et peut être falsifiée (ex. envoyer un fichier `.php` avec `Content-Type: image/jpeg`). Cependant, la bibliothèque `sharp` valide le contenu réel de l'image et refusera tout fichier non-image, ce qui atténue significativement le risque.

**Impact :** Risque très faible grâce à la validation `sharp`.

**Correction recommandée :**  
Considérer l'ajout d'une validation par magic bytes (ex. via `file-type`) pour une défense en profondeur, si la surface d'attaque évolue.

---

## Bilan des Bonnes Pratiques Respectées

| Domaine | Statut | Détail |
|---------|--------|--------|
| Authentification | ✅ | `requireAuth` appliqué sur toutes les routes protégées |
| Autorisation | ✅ | Rôles (`admin`, `member`, `partner`) vérifiés côté serveur |
| Validation des entrées | ✅ | Zod sur toutes les données utilisateur |
| Rate Limiting | ✅ | `checkRateLimit` via Redis disponible |
| Injection SQL | ✅ | Drizzle ORM avec requêtes préparées |
| Secrets en dépôt | ✅ | `.env` dans `.gitignore`, secrets supprimés (commit `aed5841`) |
| Logging structuré | ✅ | Pino avec niveaux, sans données sensibles |
| Gestion d'erreurs | ✅ | `AppError` typé, messages génériques en production |
| GDPR | ✅ | Consentement explicite à l'inscription |
| Upload avatar | ✅ | Recodage webp via `sharp`, taille et type limités |
| Variables d'env | ✅ | Validation Zod au démarrage dans `env.server.ts` |
| Protection anti-self-admin | ✅ | Un admin ne peut pas modifier/supprimer son propre compte |

---

## Tableau Récapitulatif des Risques

| ID | Criticité | Titre | Fichier | Effort de correction |
|----|-----------|-------|---------|---------------------|
| SEC-01 | 🔴 CRITIQUE | Path Traversal uploads | `uploads-files.ts:5` | Faible (5 min) |
| SEC-02 | 🟠 ÉLEVÉ | Absence headers HTTP | `root.tsx` | Faible (15 min) |
| SEC-03 | 🟠 ÉLEVÉ | Health endpoint public | `api.health.ts` | Faible (10 min) |
| SEC-04 | 🟡 MOYEN | Mots de passe Docker par défaut | `docker-compose.prod.yml` | Faible (5 min) |
| SEC-05 | 🟡 MOYEN | Redis fallback sans auth | `redis.server.ts:3` | Faible (5 min) |
| SEC-06 | 🟡 MOYEN | Deadline micro-pronos non vérifiée | `api.micro-predictions.ts:74` | Faible (10 min) |
| SEC-07 | 🔵 FAIBLE | Stack trace en ErrorBoundary | `root.tsx:74` | Info (doc) |
| SEC-08 | 🔵 FAIBLE | MIME validation `file.type` | `upload.ts:12` | Optionnel |

---

*Rapport généré le 16 avril 2026 — Branche `claude/sharp-fermi-HJk9c`*
