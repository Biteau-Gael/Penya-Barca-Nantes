# Analyse Sécurité — Penya Blaugrana Nantes

> Généré automatiquement le 2026-10-09 | Basé sur l'état de la branche `main`

---

## Résumé des derniers commits

| Hash | Message | Auteur | Date |
|------|---------|--------|------|
| `003faca` | fix: évaluer les badges immédiatement après chaque action | Biteau Gaël | 13 avr. 2026 |
| `b1c88f6` | feat: Phase 2 — soirée match live, micro-pronos, badges, séries, saisons | Biteau Gaël | 13 avr. 2026 |
| `d461ee5` | Merge branch 'claude/deploy-synology-nas-cLkOL' | — | — |
| `554b873` | Add deployment guide for Synology NAS updates | — | — |
| `68e22d2` | feat: menu burger mobile pour la navigation | — | — |
| `6aebaf7` | Fix Better Auth trusted origins for custom domain support | — | — |
| `9823bc5` | Add migrate service to docker-compose.prod.yml | — | — |

### Détails Phase 2 (`b1c88f6`)
- **Soirée match live** : route `/soiree/:matchId` avec polling score API (60s), fil en temps réel, indicateur "En direct"
- **Micro-pronostics** : création/vote/clôture admin, points auto, suppression admin
- **Badges** : 10 badges de base, évaluation automatique, page `/badges`, affichage profil
- **Séries** : `currentStreak` / `bestStreak`, récompenses à 3/5/10 scores exacts
- **Saisons** : table `seasons`, classement filtrable, archives

---

## Analyse de Sécurité

### CRITIQUE

#### 1. Mots de passe Docker en production avec valeur par défaut faible
**Fichier** : `docker-compose.prod.yml`

```yaml
POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-changeme}
redis-server --requirepass ${REDIS_PASSWORD:-changeme}
```

Si les variables `POSTGRES_PASSWORD` et `REDIS_PASSWORD` ne sont pas définies dans le `.env` de production, Docker utilisera `changeme` comme mot de passe pour PostgreSQL et Redis. C'est une faille critique en production.

**Recommandation** : Supprimer les valeurs par défaut pour forcer la configuration explicite, ou ajouter une validation au démarrage.

```yaml
# Remplacer par (sans valeur par défaut) :
POSTGRES_PASSWORD=${POSTGRES_PASSWORD:?Erreur: POSTGRES_PASSWORD non défini}
```

---

### HAUTE

#### 2. Absence de protection CSRF
**Scope** : Toutes les routes avec actions (feed, profil, pronos, événements)

Aucun token CSRF n'est généré ou vérifié dans les formulaires. React Router se basant sur des `action()` server-side, il est possible pour un site tiers de soumettre des requêtes POST en se faisant passer pour l'utilisateur authentifié via ses cookies.

**Recommandation** : Implémenter des tokens CSRF via `better-auth` (qui le supporte nativement) ou une librairie dédiée, en particulier sur les actions sensibles (profil, publication, pronos).

#### 3. Endpoint `/api/health` exposé sans authentification
**Fichier** : `app/routes/api.health.ts`

L'endpoint renvoie le statut de PostgreSQL et Redis (ok/error) sans aucune authentification. Cela expose de l'information sur l'infrastructure interne.

**Recommandation** : Restreindre l'accès à ce endpoint (IP whitelist, token Bearer, ou accès réseau interne uniquement via reverse proxy).

#### 4. Dockerfile exécute en tant que root
**Fichier** : `Dockerfile`

Le conteneur final ne définit pas d'utilisateur non-root. En cas de compromission de l'application, l'attaquant dispose des droits root dans le conteneur.

**Recommandation** : Ajouter avant `CMD` :
```dockerfile
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser
```
Et vérifier que le répertoire `/app` est accessible à cet utilisateur.

---

### MOYENNE

#### 5. Rate limiting limité aux endpoints d'authentification
**Fichier** : `app/routes/api.auth.$.ts`

Le rate limiting est correctement implémenté pour login (10 req/15min) et inscription (5 req/h), mais **n'est pas appliqué** aux endpoints suivants qui consomment des ressources ou peuvent être abusés :
- `POST /api/micro-predictions` (vote en boucle)
- `POST` sur le feed (spam de posts/commentaires)
- `POST /api/sync-matches` (appel API externe coûteux, protégé admin)

**Recommandation** : Appliquer `checkRateLimit` sur les actions de publication et de vote avec des fenêtres adaptées.

#### 6. Usage de `sql` brut sur la table `user`
**Fichier** : `app/lib/server/badges.server.ts:141-142`

```typescript
.from(sql`"user"`)
.where(sql`id = ${userId}`)
```

Le paramètre `userId` est bien passé en interpolation Drizzle (protection injection SQL active), mais l'usage de la table `"user"` en SQL brut contourne le typage de l'ORM. Si la structure de la table évolue, ce code ne sera pas détecté par le compilateur TypeScript.

**Recommandation** : Utiliser l'import du schéma Drizzle :
```typescript
import { user } from "~/db/schema";
// ...
.from(user)
.where(eq(user.id, userId))
```

#### 7. Absence d'en-têtes de sécurité HTTP
**Scope** : Application globale

Aucun en-tête de sécurité HTTP n'est visible (CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy).

**Recommandation** : Configurer ces en-têtes dans le reverse proxy Nginx/Traefik du NAS Synology, ou dans `entry.server.tsx` de React Router :
```
Content-Security-Policy: default-src 'self'; ...
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
```

---

### FAIBLE

#### 8. Upload d'avatar : validation du type MIME côté client uniquement
**Fichier** : `app/lib/server/upload.ts`

La validation du type de fichier repose sur `file.type` qui provient du client et peut être manipulé. Le retraitement via `sharp` mitigue partiellement le risque (les images invalides échoueront), mais une validation du contenu binaire (magic bytes) serait plus robuste.

**Recommandation** : Utiliser une librairie comme `file-type` pour valider les magic bytes du buffer avant traitement.

#### 9. `.gitignore` exclut tous les fichiers `.png`
**Fichier** : `.gitignore`

```
*.png
```

Cette règle exclut globalement tous les PNG du dépôt, y compris d'éventuels assets légitimes dans `public/`. À surveiller selon l'évolution du projet.

#### 10. Feed chargé sans pagination (limite à 50)
**Fichier** : `app/routes/feed.server.ts`

Le feed charge les 50 derniers posts avec N+1 requêtes pour chaque post (réactions + commentaires). À mesure que la communauté grandit, cela peut devenir un vecteur de lenteur/déni de service applicatif.

**Recommandation** : Implémenter une pagination par curseur et optimiser avec des jointures ou agrégations côté SQL.

---

## Points Positifs

| Domaine | Implémentation |
|---------|---------------|
| Authentification | `requireAuth()` systématique sur toutes les routes protégées |
| Contrôle d'accès | RBAC clair : `admin` / `member` / `partner` vérifié côté serveur |
| Variables d'env | Validation Zod au démarrage (`env.server.ts`) — secrets obligatoires |
| Pas de secrets dans le code | Aucun credential hardcodé détecté |
| Validation des entrées | Zod sur les schémas métier (feed, match, prediction, user) |
| Rate limiting auth | login (10/15min) et inscription (5/h) protégés |
| Upload fichier | Validation type + taille + retraitement via `sharp` |
| Logging structuré | Pino configuré, pas de `console.log` dans le code serveur |
| Mots de passe en prod | Injectés via `.env` (non commités) |
| Origines de confiance auth | `trustedOrigins` configuré depuis `APP_URL` |

---

## Récapitulatif par criticité

| # | Criticité | Titre | Fichier |
|---|-----------|-------|---------|
| 1 | 🔴 CRITIQUE | Mots de passe Docker avec fallback `changeme` | `docker-compose.prod.yml` |
| 2 | 🟠 HAUTE | Absence de protection CSRF | Global |
| 3 | 🟠 HAUTE | Endpoint `/api/health` public | `api.health.ts` |
| 4 | 🟠 HAUTE | Conteneur Docker exécuté en root | `Dockerfile` |
| 5 | 🟡 MOYENNE | Rate limiting incomplet | `api.micro-predictions.ts`, `feed.server.ts` |
| 6 | 🟡 MOYENNE | SQL brut sur table `user` | `badges.server.ts` |
| 7 | 🟡 MOYENNE | Absence d'en-têtes de sécurité HTTP | Global |
| 8 | 🟢 FAIBLE | Validation MIME upload côté client | `upload.ts` |
| 9 | 🟢 FAIBLE | `.gitignore` exclut tous les PNG | `.gitignore` |
| 10 | 🟢 FAIBLE | Feed sans pagination (N+1) | `feed.server.ts` |
