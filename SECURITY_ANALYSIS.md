# Analyse de Sécurité — Penya Blaugrana Nantes

**Date :** 12 septembre 2026  
**Analysé par :** Claude Code (automatisé)  
**Branche :** `claude/sharp-fermi-yex5ml`  
**Commits couverts :** `fec3e63` → `003faca` (15 commits)

---

## Résumé des Derniers Commits

| SHA | Date | Auteur | Description |
|-----|------|--------|-------------|
| `003faca` | 2026-04-13 | Biteau Gaël | fix: évaluer les badges immédiatement après chaque action |
| `b1c88f6` | 2026-04-13 | Biteau Gaël | feat: Phase 2 — soirée match live, micro-pronos, badges, séries, saisons |
| `d461ee5` | 2026-04-12 | Claude | Merge branch deploy-synology-nas |
| `554b873` | 2026-04-12 | Claude | Add deployment guide for Synology NAS updates |
| `68e22d2` | 2026-04-13 | Biteau Gaël | feat: menu burger mobile pour la navigation |
| `4a65a7b` | 2026-04-13 | Biteau Gaël | Merge pull request #2 (deploy-synology-nas) |
| `6aebaf7` | 2026-04-12 | Claude | Fix Better Auth trusted origins pour domaine custom |
| `9823bc5` | 2026-04-12 | Claude | Add migrate service to docker-compose.prod.yml |
| `2bafc6c` | 2026-04-12 | Biteau Gaël | Merge pull request #1 (deploy-synology-nas) |
| `8d6e5e9` | 2026-04-12 | Claude | Add Docker Compose prod + backup script Synology NAS |
| `3d80133` | 2026-04-12 | Biteau Gaël | docs: roadmap Phase 2 |
| `aed5841` | 2026-04-12 | Biteau Gaël | **security: supprimer credentials du repo et renforcer .gitignore** |
| `6583da3` | 2026-04-12 | Biteau Gaël | docs: README complet avec guide déploiement NAS |
| `ab7fc5d` | 2026-04-12 | Biteau Gaël | feat: intégration API Football + stats enrichies + classement Liga |
| `16c43e6` | 2026-04-11 | Biteau Gaël | feat: MVP Phase 1 — Penya Blaugrana Nantes |

---

## Analyse de Sécurité par Ordre de Criticité

---

### 🔴 CRITIQUE — Path Traversal dans le serveur de fichiers statiques

**Fichier :** `app/routes/uploads-files.ts`  
**Statut :** ✅ **Corrigé dans ce commit**

**Description :**  
Le paramètre wildcard `params["*"]` de la route `/uploads/*` était directement injecté dans `path.join()` sans validation. Un attaquant pouvait accéder à n'importe quel fichier du serveur en forgeant une URL du type :

```
GET /uploads/../../etc/passwd
GET /uploads/../../app/config/env.server.ts
```

**Fichiers sensibles accessibles :** clés d'API, secrets d'auth, configuration de base de données, code source complet.

**Correction appliquée :**
```typescript
const uploadsDir = path.resolve(process.cwd(), "uploads");
const requestedPath = path.resolve(uploadsDir, params["*"]);
if (!requestedPath.startsWith(uploadsDir + path.sep) && requestedPath !== uploadsDir) {
  return new Response("Not found", { status: 404 });
}
```
`path.resolve()` normalise les séquences `../` avant la comparaison de préfixe.

---

### 🔴 HAUTE — Credentials de développement dans l'historique Git

**Fichier :** `.claude/settings.local.json` (supprimé dans `aed5841` mais persistant en historique)  
**Statut :** ⚠️ **À traiter manuellement**

**Description :**  
Le commit `aed5841` a correctement supprimé le fichier du tracking Git, mais les credentials restent accessibles via `git show aed5841^:.claude/settings.local.json`. On y trouve notamment :

- `DATABASE_URL=postgresql://penya:penya_secret@localhost:5432/...`
- `AUTH_SECRET=dev-secret-change-me-min-16`

Ces valeurs semblent être des credentials de développement local. **Si elles sont utilisées ou similaires à des credentials de production, elles doivent être immédiatement invalidées.**

**Actions recommandées :**
1. Confirmer que ces credentials ne sont utilisés qu'en local.
2. Si le dépôt est public ou a été partagé : faire une rotation des secrets via `git filter-branch` ou `git-filter-repo` pour réécrire l'historique.
3. S'assurer que les credentials de production sont différents et stockés uniquement dans des variables d'environnement sécurisées.

---

### 🔴 HAUTE — Validation MIME basée sur la valeur client (File Upload)

**Fichier :** `app/lib/server/upload.ts:13`  
**Statut :** ⚠️ **Non corrigé**

**Description :**  
La validation du type de fichier utilise `file.type`, qui est la valeur déclarée par le client dans le header `Content-Type`. Un attaquant peut envoyer un fichier `.php` ou `.js` malveillant avec `Content-Type: image/png` et contourner la validation.

```typescript
// PROBLÈME : file.type est contrôlé par le client
if (!ALLOWED_TYPES.includes(file.type)) {
  throw new Error("Format non supporté...");
}
```

**Recommandation :** Valider les magic bytes (signatures de fichiers) avec une bibliothèque comme `file-type` :
```typescript
import { fileTypeFromBuffer } from "file-type";
const detected = await fileTypeFromBuffer(buffer);
if (!detected || !['image/jpeg', 'image/png', 'image/webp'].includes(detected.mime)) {
  throw new Error("Format non supporté.");
}
```

Note : `sharp` traite malgré tout l'image, ce qui réduit partiellement le risque, mais ne protège pas contre tous les vecteurs.

---

### 🟠 MOYENNE — Mots de passe Docker par défaut faibles

**Fichiers :** `docker-compose.yml:22`, `docker-compose.prod.yml:22`  
**Statut :** ⚠️ **Non corrigé**

**Description :**  
Les deux fichiers Docker Compose définissent des mots de passe de fallback `changeme` pour PostgreSQL et Redis :

```yaml
POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-changeme}
command: redis-server --requirepass ${REDIS_PASSWORD:-changeme}
```

Si un déploiement se fait sans fichier `.env` correctement configuré, les bases de données sont accessibles avec un mot de passe trivial.

**Recommandation :** Supprimer les valeurs par défaut pour forcer une configuration explicite, ou utiliser des secrets Docker :
```yaml
POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?POSTGRES_PASSWORD must be set}
```

---

### 🟠 MOYENNE — Redis sans authentification (docker-compose.yml de base)

**Fichier :** `docker-compose.yml`  
**Statut :** ⚠️ **Non corrigé**

**Description :**  
Le `docker-compose.yml` de base expose Redis sans mot de passe (port `6379` sur `0.0.0.0`), contrairement à `docker-compose.prod.yml` qui utilise `requirepass`. Les sessions Better Auth sont stockées dans Redis : une instance Redis non protégée permet l'accès ou la manipulation de toutes les sessions.

**Recommandation :** Ajouter `requirepass` également dans `docker-compose.yml`, ou exposer Redis uniquement sur le réseau Docker interne (supprimer la section `ports`).

---

### 🟠 MOYENNE — Rate limiting non appliqué sur les routes d'authentification

**Fichier :** `app/routes/api.auth.$.ts` + `app/lib/server/rate-limit.server.ts`  
**Statut :** ⚠️ **À vérifier**

**Description :**  
Un utilitaire `checkRateLimit()` existe mais aucune preuve de son application sur les routes `/api/auth/*` (login, register) n'est visible. Sans rate limiting sur l'authentification, des attaques par force brute sur les mots de passe sont possibles.

**Recommandation :** Appliquer `checkRateLimit` sur les routes de connexion, idéalement par IP :
```typescript
await checkRateLimit({ key: `login:${ip}`, maxAttempts: 10, windowSeconds: 300 });
```

---

### 🟡 FAIBLE — Cohérence de la vérification de rôle admin

**Fichier :** `app/routes/api.micro-predictions.ts:18`  
**Statut :** ℹ️ **Observation**

**Description :**  
Les opérations admin dans ce fichier utilisent une vérification de rôle inline (`session.user.role === "admin"`) plutôt que `requireAuth(request, ["admin"])`. Bien que fonctionnellement équivalent dans le contexte actuel, cette inconsistance peut mener à des oublis lors de refactorisations futures.

```typescript
// Pattern actuel (ok mais inconsistant)
const session = await requireAuth(request); // vérifie authentification seulement
if (intent === "create" && session.user.role === "admin") { ... }

// Pattern préférable
await requireAuth(request, ["admin"]);
```

---

### 🟡 FAIBLE — .gitignore incomplet pour les fichiers d'environnement

**Fichier :** `.gitignore`  
**Statut :** ℹ️ **Observation**

**Description :**  
Le `.gitignore` protège `.env` mais pas d'autres variantes communes :

```
# Actuellement ignoré
.env

# Manquants
.env.local
.env.production
.env.production.local
.env.development.local
.env.test.local
```

---

### 🟢 POINTS POSITIFS

- ✅ Validation des variables d'environnement au démarrage via Zod (`env.server.ts`) — empêche un démarrage silencieux avec une config incomplète.
- ✅ Utilisation de l'ORM Drizzle avec des requêtes paramétrées — pas d'injection SQL possible.
- ✅ `AUTH_SECRET` requiert minimum 16 caractères (validé par Zod).
- ✅ Contrôle des accès admin centralisé via `requireAuth(request, ["admin"])` dans la majorité des routes.
- ✅ Upload d'avatar : type limité, taille limitée à 2 Mo, retraitement via `sharp` (redimensionnement + conversion WebP).
- ✅ Credentials supprimés du tracking dans `aed5841` et `.gitignore` renforcé.
- ✅ `trustedOrigins` Better Auth configuré via `APP_URL` (évite les attaques CSRF cross-origin).
- ✅ Logger structuré (`pino`) sans exposition d'informations sensibles dans les réponses HTTP.

---

## Actions Prioritaires

| Priorité | Action | Effort |
|----------|--------|--------|
| P0 | ~~Corriger path traversal `uploads-files.ts`~~ | ✅ Fait |
| P1 | Vérifier que credentials historique Git sont bien dev-only ; rotation si doute | 30 min |
| P2 | Valider magic bytes dans `upload.ts` (ajouter `file-type`) | 2h |
| P3 | Remplacer fallback `changeme` par obligation de config dans Docker Compose | 30 min |
| P4 | Appliquer rate limiting sur `/api/auth/*` | 1h |
| P5 | Compléter `.gitignore` pour toutes les variantes `.env.*` | 5 min |
