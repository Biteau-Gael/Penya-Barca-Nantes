# Audit de sécurité — Penya Blaugrana Nantes

**Date :** 2026-06-01  
**Branche analysée :** `claude/sharp-fermi-3sktm`  
**Périmètre :** Code applicatif, configuration Docker, gestion des secrets, authentification

---

## Résumé des derniers commits

| Commit | Date | Description |
|--------|------|-------------|
| `003faca` | 2026-04-13 | fix: évaluer les badges immédiatement après chaque action |
| `b1c88f6` | 2026-04-13 | feat: Phase 2 — soirée match live, micro-pronos, badges, séries, saisons |
| `d461ee5` | 2026-04-12 | Merge branch `deploy-synology-nas` |
| `554b873` | 2026-04-12 | docs: guide de déploiement NAS Synology |
| `68e22d2` | 2026-04-13 | feat: menu burger mobile pour la navigation |
| `aed5841` | 2026-04-12 | **security:** supprimer credentials du repo et renforcer `.gitignore` |

---

## Résultats par ordre de criticité

### 🔴 CRITIQUE — Corrigé dans cet audit

#### [C-01] Path Traversal (LFI) — `app/routes/uploads-files.ts`

**Fichier :** `app/routes/uploads-files.ts`  
**Statut :** ✅ Corrigé

**Description :**  
Le handler de fichiers construisait le chemin avec `path.join(process.cwd(), "uploads", params["*"])` sans vérifier que le chemin résultant restait dans le répertoire `uploads/`. Un attaquant authentifié ou non pouvait lire des fichiers arbitraires du serveur via des séquences de type `../../etc/passwd`.

**Exemple d'exploitation :**
```
GET /uploads/../../etc/passwd
```

**Correction appliquée :**
```typescript
const UPLOADS_BASE = path.join(process.cwd(), "uploads");
const filePath = path.resolve(UPLOADS_BASE, params["*"]);

if (!filePath.startsWith(UPLOADS_BASE + path.sep)) {
  return new Response("Not found", { status: 404 });
}
```
`path.resolve` neutralise les `../` et la vérification de préfixe garantit le confinement.

---

### 🟠 HAUTE

#### [H-01] Mots de passe par défaut dans `docker-compose.prod.yml`

**Fichier :** `docker-compose.prod.yml` lignes 22, 32  
**Statut :** ⚠️ À corriger manuellement en production

**Description :**  
Les variables `POSTGRES_PASSWORD` et `REDIS_PASSWORD` utilisent `changeme` comme valeur de repli (`:-changeme`). Si le fichier `.env` est absent ou incomplet lors du déploiement, les services démarrent avec des mots de passe triviaux.

```yaml
POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-changeme}
redis-server --requirepass ${REDIS_PASSWORD:-changeme}
```

**Recommandation :** Supprimer les valeurs de repli pour forcer un échec explicite au démarrage si les variables ne sont pas définies :
```yaml
POSTGRES_PASSWORD=${POSTGRES_PASSWORD:?Variable POSTGRES_PASSWORD manquante}
```

---

#### [H-02] En-têtes de sécurité HTTP absents

**Fichier :** `app/root.tsx`, configuration serveur  
**Statut :** ⚠️ Non implémenté

**Description :**  
Aucun en-tête de sécurité HTTP n'est défini (`Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Options`, `Strict-Transport-Security`, `Referrer-Policy`). L'application est exposée au clickjacking, au sniffing MIME et aux attaques XSS via iframes.

**Recommandation :** Ajouter une fonction `headers` dans `app/root.tsx` (React Router v7) :
```typescript
export function headers() {
  return {
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Content-Security-Policy": "default-src 'self'; ...",
  };
}
```

---

### 🟡 MOYENNE

#### [M-01] Rate limiting contournable par usurpation d'IP

**Fichier :** `app/routes/api.auth.$.ts` lignes 5–11  
**Statut :** ⚠️ Risque selon l'infrastructure

**Description :**  
Le rate limiting lit l'IP depuis `X-Forwarded-For`, dont la première valeur peut être forgée par un attaquant si le reverse proxy ne nettoie pas cet en-tête. Un attaquant peut ainsi contourner les limites de tentatives de connexion.

```typescript
request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
```

**Recommandation :** S'assurer que le reverse proxy (Nginx/Traefik) est configuré pour écraser `X-Forwarded-For` avec la vraie IP du client, et non l'ajouter. Documenter cette exigence dans `DEPLOY.md`.

---

#### [M-02] Absence de rate limiting sur les routes API sensibles

**Fichiers :** `app/routes/api.micro-predictions.ts`, `app/routes/api.sync-matches.ts`  
**Statut :** ⚠️ Non implémenté

**Description :**  
Le rate limiting n'est appliqué que sur les routes d'authentification. Les routes admin (`/api/micro-predictions`, `/api/sync-matches`) ne sont pas limitées, ce qui expose à des attaques en bruteforce de rôle ou à une surcharge de l'API externe Football.

**Recommandation :** Appliquer un rate limiting sur les actions admin et sur l'appel à l'API externe (ex : 1 sync toutes les 5 minutes par IP admin).

---

### 🟢 CONFORME — Bonnes pratiques respectées

| Point | Détail |
|-------|--------|
| ✅ Pas de credentials dans le dépôt | Corrigé dans `aed5841` : `.env` dans `.gitignore`, `.claude/` exclu, placeholders dans `.env.example` |
| ✅ Validation des variables d'environnement | `app/config/env.server.ts` — schéma Zod avec `AUTH_SECRET.min(16)` |
| ✅ Politique de mots de passe stricte | `app/lib/validation/user.ts` — min 8 caractères, majuscule + minuscule + chiffre |
| ✅ Rate limiting sur l'authentification | 10 tentatives/15 min pour le login, 5 tentatives/h pour l'inscription |
| ✅ Validation des entrées admin | Schémas Zod pour la création/modification de matchs (`createMatchSchema`, `updateMatchSchema`) |
| ✅ Contrôle d'accès basé sur les rôles | `requireAuth(request, ["admin"])` systématique sur toutes les routes sensibles |
| ✅ Protection contre la double-réponse | Vérification `existing` avant insertion dans `microPredictionAnswers` |
| ✅ Upload sécurisé | `processAvatar` : type MIME vérifié, taille limitée à 2 Mo, conversion WebP via `sharp` |
| ✅ Consentement GDPR | Champ `gdprConsent: z.literal(true)` obligatoire à l'inscription |
| ✅ Logs structurés sans données sensibles | `pino` logger — pas de mots de passe ou tokens dans les logs |
| ✅ Dockerignore configuré | `.env`, `node_modules`, `uploads/` exclus du contexte de build |
| ✅ Multi-stage Docker build | Image finale allégée sans devDependencies |

---

## Plan d'action recommandé

| Priorité | ID | Action | Effort |
|----------|----|--------|--------|
| 🔴 Immédiat | C-01 | ~~Path traversal uploads-files.ts~~ | ✅ Fait |
| 🟠 Court terme | H-01 | Supprimer les fallbacks `:-changeme` dans docker-compose.prod.yml | 30 min |
| 🟠 Court terme | H-02 | Ajouter les en-têtes de sécurité HTTP dans root.tsx | 1h |
| 🟡 Moyen terme | M-01 | Documenter/configurer le reverse proxy pour X-Forwarded-For | 1h |
| 🟡 Moyen terme | M-02 | Rate limiting sur les routes API admin et sync | 2h |
