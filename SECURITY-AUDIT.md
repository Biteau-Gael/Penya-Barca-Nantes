# Rapport d'audit de sécurité — Penya Blaugrana Nantes

**Date :** 27 septembre 2026  
**Périmètre :** Analyse des derniers commits (Phase 2 — branches `main` jusqu'à `003faca`)  
**Statut :** Vulnérabilité critique corrigée, recommandations en cours

---

## Résumé des derniers commits

| Commit | Date | Description |
|--------|------|-------------|
| `003faca` | 13 avril 2026 | fix: évaluation immédiate des badges après chaque action |
| `b1c88f6` | 13 avril 2026 | feat: Phase 2 — soirée match live, micro-pronos, badges, séries, saisons |
| `d461ee5` | 12 avril 2026 | Merge branch deploy-synology-nas |
| `554b873` | 12 avril 2026 | Ajout guide déploiement NAS Synology |
| `68e22d2` | 12 avril 2026 | feat: menu burger mobile |
| `6aebaf7` | 12 avril 2026 | Fix Better Auth trusted origins pour domaine custom |
| `9823bc5` | 12 avril 2026 | Ajout service migrate dans docker-compose.prod.yml |
| `aed5841` | 12 avril 2026 | security: suppression credentials du repo et renforcement .gitignore |

---

## Analyse de sécurité par ordre de criticité

---

### 🔴 CRITIQUE — Traversée de chemin (Path Traversal) corrigée

**Fichier :** `app/routes/uploads-files.ts`  
**Statut :** ✅ **CORRIGÉ** dans ce commit

**Description :**  
La route servant les fichiers uploadés construisait le chemin avec `path.join` sans vérifier que le chemin résolu restait dans le dossier `uploads/`. Un attaquant pouvait requêter `/uploads/../../../etc/passwd` pour lire n'importe quel fichier du système.

**Avant :**
```typescript
const filePath = path.join(process.cwd(), "uploads", params["*"]);
// params["*"] = "../../etc/passwd" → lecture de /etc/passwd
```

**Après :**
```typescript
const UPLOADS_DIR = path.resolve(process.cwd(), "uploads");
const filePath = path.resolve(UPLOADS_DIR, params["*"]);
if (!filePath.startsWith(UPLOADS_DIR + path.sep)) {
  return new Response("Not found", { status: 404 });
}
```

---

### 🟠 HAUTE — Credentials présents dans l'historique git

**Fichier :** Historique git (commit `aed5841` et antérieurs)  
**Statut :** ⚠️ **À TRAITER** — rotation des secrets requise

**Description :**  
Le commit `aed5841` a supprimé des credentials en clair du repo (clé `.claude/settings.local.json`, mots de passe dans les fichiers docker-compose). Ces valeurs restent accessibles dans l'historique git pour quiconque clone le dépôt.

**Recommandations :**
1. Considérer les secrets exposés comme compromis — les **rotation immédiate** :
   - `AUTH_SECRET` (Better Auth)
   - `API_FOOTBALL_KEY` (RapidAPI)
   - Mot de passe PostgreSQL de production
   - Mot de passe Redis de production
2. Optionnel : réécrire l'historique git avec `git filter-repo` si le dépôt est privé et que l'équipe est informée

---

### 🟠 HAUTE — Mots de passe par défaut dans Docker Compose

**Fichier :** `docker-compose.prod.yml`  
**Statut :** ⚠️ **À TRAITER**

**Description :**  
Les services PostgreSQL et Redis ont un fallback `changeme` si les variables d'environnement ne sont pas définies.

```yaml
POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-changeme}
redis-server --requirepass ${REDIS_PASSWORD:-changeme}
```

**Risque :** Si déployé sans fichier `.env` complet, les bases de données sont accessibles avec le mot de passe `changeme`.

**Recommandation :** Supprimer le fallback `-changeme` et laisser le déploiement échouer explicitement si les variables ne sont pas définies. Ajouter une vérification de démarrage.

---

### 🟡 MOYENNE — Rate limiting limité aux routes d'authentification

**Fichier :** `app/routes/api.auth.$.ts`, `app/lib/server/rate-limit.server.ts`  
**Statut :** ⚠️ **À SURVEILLER**

**Description :**  
Le rate limiting n'est appliqué qu'aux routes de connexion et d'inscription (10 tentatives / 15 min pour login, 5 / heure pour register). Les autres endpoints d'action ne sont pas protégés :

- `api.micro-predictions.ts` — soumission illimitée de réponses
- `feed.server.ts` — création illimitée de posts et commentaires
- `profile.server.ts` — upload d'avatars illimité

**Recommandation :** Étendre le rate limiting aux actions sensibles (ex : 20 posts / heure par utilisateur, 50 commentaires / heure).

---

### 🟡 MOYENNE — Absence de protection CSRF explicite

**Statut :** ⚠️ **À VÉRIFIER**

**Description :**  
Aucune protection CSRF explicite n'est implémentée dans l'application. Better Auth gère les sessions via cookies, ce qui expose théoriquement les mutations POST aux attaques CSRF depuis d'autres origines.

**Note :** Better Auth inclut des mécanismes de protection (SameSite cookies, vérification d'origine). Vérifier que la configuration dans `auth.server.ts` active bien ces protections et que `trustedOrigins` est correctement restreint.

---

### 🟢 BASSE — Validation du type MIME côté client uniquement (upload)

**Fichier :** `app/lib/server/upload.ts`  
**Statut :** ✅ Partiellement mitigé

**Description :**  
La validation du type de fichier repose sur `file.type` qui peut être falsifié côté client. Cependant, `sharp` échouera sur des fichiers non-image, ce qui limite l'impact réel. La conversion systématique en WebP élimine les vecteurs d'attaque de type SVG/HTML.

**Recommandation :** Ajouter une vérification du magic number (premiers octets du fichier) en complément de `file.type`.

---

### 🟢 BASSE — IP Spoofing sur le rate limiting

**Fichier :** `app/routes/api.auth.$.ts`  
**Statut :** ℹ️ Acceptable selon l'infrastructure

**Description :**  
La fonction `getClientIp` lit le header `x-forwarded-for` sans validation stricte. Un attaquant peut forger ce header pour contourner le rate limiting par IP.

```typescript
request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
```

**Recommandation :** Si l'application est derrière un reverse proxy de confiance (Nginx/Traefik sur le NAS Synology), configurer le proxy pour écraser ce header avec la vraie IP. Si l'IP du proxy est connue, valider que la requête provient bien de lui.

---

## Points positifs relevés

- ✅ Authentification systématique via `requireAuth` sur toutes les routes protégées
- ✅ Contrôle des rôles admin vérifié côté serveur (`session.user.role === "admin"`)
- ✅ Requêtes SQL via Drizzle ORM avec requêtes paramétrées (pas d'injection SQL)
- ✅ Variables d'environnement gérées via `getEnv()` — pas de `process.env` direct
- ✅ Clé API Football uniquement utilisée côté serveur (jamais exposée au client)
- ✅ Avatars converties en WebP via Sharp — neutralise les payloads malveillants dans les images
- ✅ `.gitignore` inclut `.env`, `node_modules`, `.claude/`
- ✅ Logs structurés avec niveaux (pino/logger) — traçabilité des actions

---

## Actions prioritaires

| Priorité | Action | Effort |
|----------|--------|--------|
| 🔴 Immédiat | ~~Corriger path traversal `uploads-files.ts`~~ | ✅ Fait |
| 🟠 Urgent | Rotation de tous les secrets exposés dans l'historique git | 30 min |
| 🟠 Urgent | Supprimer les mots de passe par défaut Docker (`changeme`) | 15 min |
| 🟡 Court terme | Étendre le rate limiting aux actions POST | 2h |
| 🟡 Court terme | Vérifier la config CSRF de Better Auth | 1h |
| 🟢 Long terme | Validation magic number pour les uploads | 1h |
