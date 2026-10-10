# Rapport d'Audit de Sécurité — Penya Blaugrana Nantes

**Date :** 10 octobre 2026  
**Branche analysée :** `claude/sharp-fermi-g1o5vm` (HEAD: `003faca`)  
**Périmètre :** Analyse statique du code source + configuration Docker/Nginx

---

## Résumé des derniers commits analysés

| Commit | Date | Description |
|--------|------|-------------|
| `003faca` | 2026-04-13 | fix: évaluer les badges immédiatement après chaque action |
| `b1c88f6` | 2026-04-13 | feat: Phase 2 — soirée match live, micro-pronos, badges, séries, saisons |
| `68e22d2` | 2026-04-13 | feat: menu burger mobile pour la navigation |
| `6aebaf7` | 2026-04-12 | Fix Better Auth trusted origins pour support domaine custom |
| `9823bc5` | 2026-04-12 | Add migrate service dans docker-compose.prod.yml |
| `8d6e5e9` | 2026-04-12 | Add production Docker Compose et backup script NAS Synology |
| `554b873` | 2026-04-12 | Add deployment guide for Synology NAS updates |
| `aed5841` | antérieur | security: supprimer credentials du repo et renforcer .gitignore |

---

## Résultats de l'audit de sécurité

### ✅ Points positifs

- **Aucune credential hardcodée** dans le code source
- **Routes admin protégées** : tous les fichiers `admin.*.server.ts` appellent `requireAuth(request, ["admin"])` dans les loaders et actions
- **Pas d'injection SQL** : toutes les requêtes utilisent Drizzle ORM avec requêtes paramétrées ; les rares usages de `sql\`\`` n'interpolent pas d'input utilisateur
- **.gitignore correct** : fichiers `.env`, `node_modules`, `uploads/` et `.claude/` exclus
- **Validation Zod** utilisée sur les variables d'environnement (sauf cas noté ci-dessous)

---

## Vulnérabilités par ordre de criticité

---

### 🔴 CRITIQUE — Corrigé dans ce rapport

#### 1. Path Traversal — lecture arbitraire de fichiers serveur
- **Fichier :** `app/routes/uploads-files.ts` ligne 5 (avant correction)
- **Description :** `path.join(process.cwd(), "uploads", params["*"])` ne bloque pas les séquences `../`. Un attaquant pouvait requêter `/uploads/../../.env` pour lire des secrets.
- **Impact :** Lecture de fichiers arbitraires sur le serveur sans authentification, y compris `.env`, code source, migrations DB.
- **Correction appliquée :** Validation que le chemin résolu reste dans `uploads/` via `path.resolve()` + comparaison de préfixe.
- **Statut :** ✅ **Corrigé** (commit présent dans ce rapport)

---

### 🟠 ÉLEVÉ

#### 2. Mots de passe par défaut `changeme` en production
- **Fichier :** `docker-compose.prod.yml` lignes 22 et 33
- **Code :** `${POSTGRES_PASSWORD:-changeme}` et `${REDIS_PASSWORD:-changeme}`
- **Impact :** Si le fichier `.env` est absent ou mal configuré au déploiement, PostgreSQL et Redis sont accessibles avec un mot de passe trivial.
- **Recommandation :** Remplacer les fallbacks par une erreur explicite. Utiliser une valeur aléatoire forte ou faire échouer le démarrage si la variable est absente.
  ```yaml
  # Option : supprimer le fallback pour forcer la configuration
  POSTGRES_PASSWORD=${POSTGRES_PASSWORD:?POSTGRES_PASSWORD must be set}
  ```
- **Statut :** ⚠️ À corriger en priorité avant déploiement

---

### 🟡 MOYEN

#### 3. Contournement du rate-limiting via `X-Forwarded-For` falsifié
- **Fichier :** `app/routes/api.auth.$.ts` lignes 7–8
- **Description :** L'IP client est lue depuis `X-Forwarded-For` (premier élément), header forgeable par n'importe quel client. La config Nginx utilise `$proxy_add_x_forwarded_for` qui ajoute sans remplacer le header existant.
- **Impact :** Un attaquant peut changer son IP apparente à chaque requête pour contourner la limite de 10 tentatives de login / 15 min.
- **Recommandation :** Dans Nginx, utiliser `proxy_set_header X-Real-IP $remote_addr;` et côté applicatif lire `X-Real-IP` en priorité, ou configurer `proxy_set_header X-Forwarded-For $remote_addr;` (remplace au lieu d'ajouter).

#### 4. Absence de headers de sécurité HTTP dans Nginx
- **Fichier :** `docker/nginx/nginx.conf`
- **Description :** Aucun header de sécurité configuré. Pas de TLS.
- **Impact :** Exposition aux attaques XSS, clickjacking, sniffing de contenu, absence de HTTPS.
- **Recommandation :** Ajouter dans le bloc `server` Nginx :
  ```nginx
  add_header X-Content-Type-Options nosniff;
  add_header X-Frame-Options DENY;
  add_header Referrer-Policy strict-origin-when-cross-origin;
  add_header Content-Security-Policy "default-src 'self'; ...";
  # + configurer TLS (Let's Encrypt ou certificat Synology)
  ```

#### 5. `trustedOrigins` vide si `APP_URL` non défini
- **Fichier :** `app/lib/server/auth.server.ts` ligne 12
- **Code :** `trustedOrigins: env.APP_URL ? [env.APP_URL] : []`
- **Description :** `APP_URL` est optionnel dans le schéma Zod. Sans valeur, le tableau est vide, comportement de Better Auth incertain (peut être permissif ou bloquant).
- **Recommandation :** Rendre `APP_URL` obligatoire dans le schéma de validation, ou définir une valeur par défaut sûre pour le développement local uniquement.

---

### 🔵 FAIBLE

#### 6. Endpoint de health non authentifié — fuite d'informations infrastructure
- **Fichier :** `app/routes/api.health.ts` ligne 11
- **Description :** `/api/health` est public et retourne le statut DB et Redis.
- **Impact :** Aide à la reconnaissance (l'attaquant sait quand l'infrastructure est dégradée).
- **Recommandation :** Restreindre à un IP range interne, ou ajouter un token de monitoring.

#### 7. Absence de validation de longueur sur le champ `answer` des micro-pronos
- **Fichier :** `app/routes/api.micro-predictions.ts` lignes 92–93
- **Description :** Le champ `answer` est stocké sans limite de taille.
- **Impact :** Utilisateur authentifié pouvant soumettre des chaînes arbitrairement longues.
- **Recommandation :** Ajouter `.max(500)` (ou valeur appropriée) dans la validation Zod.

#### 8. Vérification d'email non appliquée sur les routes protégées
- **Fichier :** `app/lib/server/auth-utils.server.ts`
- **Description :** `requireAuth()` ne vérifie pas `session.user.emailVerified`. Un utilisateur avec email non vérifié accède à toutes les routes authentifiées.
- **Impact :** Faible si la vérification email n'est pas intentionnellement requise ; à revoir selon les exigences métier.

#### 9. `DATABASE_URL` lue sans validation Zod
- **Fichier :** `app/db/client.ts` ligne 6
- **Code :** `connectionString: process.env.DATABASE_URL`
- **Description :** Contourne le système de validation `getEnv()` utilisé partout ailleurs.
- **Impact :** Erreur de connexion tardive au lieu d'une erreur de validation au démarrage.
- **Recommandation :** Utiliser `getEnv().DATABASE_URL` (après avoir ajouté la variable dans le schéma Zod).

---

## Tableau de synthèse

| # | Criticité | Fichier | Problème | Statut |
|---|-----------|---------|----------|--------|
| 1 | 🔴 Critique | `app/routes/uploads-files.ts:5` | Path traversal — lecture de fichiers arbitraires | ✅ Corrigé |
| 2 | 🟠 Élevé | `docker-compose.prod.yml:22,33` | Mots de passe par défaut `changeme` | ⚠️ À corriger |
| 3 | 🟡 Moyen | `app/routes/api.auth.$.ts:7-8` | Rate-limiting contournable via `X-Forwarded-For` | ⚠️ À corriger |
| 4 | 🟡 Moyen | `docker/nginx/nginx.conf` | Absence de headers de sécurité / pas de HTTPS | ⚠️ À corriger |
| 5 | 🟡 Moyen | `app/lib/server/auth.server.ts:12` | `trustedOrigins` vide si `APP_URL` absent | ⚠️ À corriger |
| 6 | 🔵 Faible | `app/routes/api.health.ts:11` | Health endpoint public — fuite d'état infra | ℹ️ Recommandé |
| 7 | 🔵 Faible | `app/routes/api.micro-predictions.ts:92-93` | Pas de validation de longueur sur `answer` | ℹ️ Recommandé |
| 8 | 🔵 Faible | `app/lib/server/auth-utils.server.ts` | Email non vérifié ignoré | ℹ️ À évaluer |
| 9 | 🔵 Faible | `app/db/client.ts:6` | `DATABASE_URL` sans validation Zod | ℹ️ Recommandé |

---

## Actions prioritaires recommandées

1. **Immédiat (fait)** : correctif path traversal appliqué dans `uploads-files.ts`
2. **Avant prochain déploiement** : changer les fallbacks `changeme` dans `docker-compose.prod.yml`
3. **Court terme** : ajouter les headers de sécurité Nginx + configurer TLS
4. **Court terme** : corriger la gestion de `X-Forwarded-For` dans Nginx et l'API auth
5. **Moyen terme** : validation longueur `answer`, `APP_URL` obligatoire, `DATABASE_URL` via Zod

---

*Rapport généré automatiquement — Audit du 2026-10-10*
