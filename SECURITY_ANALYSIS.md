# Analyse de Sécurité — Penya Blaugrana Nantes

**Date d'analyse :** 19 juin 2026  
**Branche :** `main`  
**Dernier commit :** `003faca` — 13 avril 2026

---

## 1. Résumé des derniers commits

| Hash | Date | Type | Description |
|------|------|------|-------------|
| `003faca` | 13 avr. 2026 02:54 | `fix` | Évaluation des badges immédiatement après chaque action (pronostic, post, commentaire, réaction) |
| `b1c88f6` | 13 avr. 2026 02:33 | `feat` | **Phase 2** — soirée match live, micro-pronos, badges, séries, saisons (2 965 lignes ajoutées) |
| `d461ee5` | 12 avr. 2026 23:54 | `merge` | Fusion de la branche `claude/deploy-synology-nas-cLkOL` |
| `554b873` | 12 avr. 2026 23:49 | `docs` | Guide de déploiement des mises à jour sur NAS Synology |
| `68e22d2` | 13 avr. 2026 01:30 | `feat` | Menu burger mobile pour la navigation |
| `6aebaf7` | — | `fix` | Correction des trusted origins Better Auth pour le domaine personnalisé |
| `9823bc5` | — | `fix` | Ajout du service `migrate` dans `docker-compose.prod.yml` |
| `8d6e5e9` | — | `feat` | Docker Compose production + script de sauvegarde pour NAS Synology |
| `3d80133` | — | `docs` | Roadmap Phase 2 — 8 priorités documentées |
| `aed5841` | — | `security` | Suppression des credentials du dépôt + renforcement `.gitignore` |

### Points notables de la Phase 2 (commit `b1c88f6`)

- Nouvelles tables DB : `seasons`, `badges`, `user_badges`, `rewards`, `micro_predictions`, `micro_prediction_answers`
- Page soirée match live avec polling API toutes les 60 s
- 10 badges automatiques évalués après chaque action
- Micro-pronostics avec vote joueur et calcul de points
- Séries de scores exacts (paliers 3/5/10) avec récompenses automatiques
- Classement filtré par saison

---

## 2. Analyse de sécurité par ordre de criticité

### CRITIQUE

---

#### SEC-01 — Mots de passe par défaut faibles en production

**Fichier :** `docker-compose.prod.yml` — lignes 22, 32, 34  
**Impact :** Compromission totale de la base de données et de Redis en production

```yaml
POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-changeme}   # ← défaut "changeme"
redis-server --requirepass ${REDIS_PASSWORD:-changeme}  # ← défaut "changeme"
```

En l'absence de variable d'environnement, les services démarrent avec le mot de passe `changeme`. Un attaquant ayant accès réseau au NAS peut accéder directement à la base de données.

**Correction recommandée :**

```yaml
# Supprimer les valeurs par défaut — le démarrage doit échouer si non défini
POSTGRES_PASSWORD=${POSTGRES_PASSWORD:?POSTGRES_PASSWORD must be set}
redis-server --requirepass ${REDIS_PASSWORD:?REDIS_PASSWORD must be set}
```

---

#### SEC-02 — Absence de HTTPS / TLS en production

**Fichier :** `docker/nginx/nginx.conf`  
**Impact :** Données utilisateurs (sessions, mots de passe, tokens) transmises en clair

La configuration Nginx n'écoute que sur le port 80 (HTTP). Aucun certificat TLS n'est configuré, aucune redirection HTTP → HTTPS.

**Correction recommandée :** Configurer Let's Encrypt (Certbot) ou un reverse proxy SSL (ex. Traefik) devant Nginx. Ajouter la redirection HTTP → HTTPS et l'en-tête HSTS.

---

#### SEC-03 — En-têtes de sécurité HTTP absents

**Fichier :** `docker/nginx/nginx.conf`  
**Impact :** Vulnérabilités XSS, clickjacking, MIME sniffing activement exploitables

Aucun des en-têtes de sécurité standards n'est présent :

| En-tête manquant | Risque |
|---|---|
| `Content-Security-Policy` | XSS, injection de contenu tiers |
| `X-Frame-Options: DENY` | Clickjacking |
| `X-Content-Type-Options: nosniff` | MIME confusion |
| `Strict-Transport-Security` | Downgrade HTTP |
| `Referrer-Policy` | Fuite d'URL sensibles |
| `Permissions-Policy` | Accès caméra/micro non restreint |

**Correction recommandée :** Ajouter dans `nginx.conf` :

```nginx
add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self';" always;
add_header X-Frame-Options "DENY" always;
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;
```

---

### ÉLEVÉ

---

#### SEC-04 — Absence de rate limiting sur les endpoints API

**Fichiers concernés :**
- `app/routes/api.micro-predictions.ts` (soumission de réponses)
- `app/routes/feed.server.ts` (création de posts, commentaires, réactions)
- `app/routes/match-detail.server.ts` (soumission de pronostics)

**Impact :** Abus des fonctionnalités, spam, manipulation du classement, épuisement des ressources

Seul l'endpoint d'authentification (`api.auth.$.ts`) applique un rate limiting via Redis. Tous les autres endpoints acceptent des requêtes sans limite.

**Correction recommandée :** Appliquer `applyRateLimit()` (déjà disponible dans `app/lib/server/rate-limit.server.ts`) sur les actions de mutation :

```typescript
// Exemple dans feed.server.ts action()
const rateLimitResponse = await applyRateLimit(request, { max: 20, window: 60 });
if (rateLimitResponse) return rateLimitResponse;
```

---

#### SEC-05 — Conteneur Docker s'exécutant en tant que root

**Fichier :** `Dockerfile`  
**Impact :** Escalade de privilèges en cas de faille dans l'application

Aucune directive `USER` dans le Dockerfile. Le processus Node.js tourne en root dans le conteneur, ce qui amplifie l'impact de toute vulnérabilité d'exécution de code.

**Correction recommandée :** Ajouter dans le stage final du Dockerfile :

```dockerfile
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nodeuser
USER nodeuser
```

---

### MOYEN

---

#### SEC-06 — Accès direct à `process.env` hors validation centralisée

**Fichiers concernés :**
- `app/lib/server/logger.server.ts` — `process.env.LOG_LEVEL`, `process.env.NODE_ENV`
- `app/lib/server/redis.server.ts` — `process.env.REDIS_URL || "redis://localhost:6379"`
- `app/db/client.ts` — `process.env.DATABASE_URL`

**Impact :** Variables manquantes silencieuses, fallback non sécurisé (`redis://localhost:6379` en production sans variable), incohérence avec la validation Zod de `env.server.ts`

**Correction recommandée :** Importer les variables depuis le module centralisé `~/config/env.server` au lieu d'accéder directement à `process.env`.

---

#### SEC-07 — Rate limiting contournable via X-Forwarded-For

**Fichier :** `app/lib/server/rate-limit.server.ts`  
**Impact :** Contournement du rate limiting sur l'authentification par manipulation de l'en-tête IP

Le rate limiting est basé sur l'IP extraite de `x-forwarded-for`. Un attaquant peut falsifier cet en-tête si le proxy n'est pas correctement configuré pour ignorer les valeurs injectées par le client.

**Correction recommandée :** S'assurer que Nginx passe uniquement `X-Real-IP` ou configurer la limite sur `x-real-ip` en priorité. Valider que Nginx est le seul proxy en position de confiance.

---

#### SEC-08 — `JSON.parse()` sans validation de structure

**Fichiers concernés :**
- `app/lib/server/badges.server.ts` ligne ~172 — `JSON.parse(badge.condition)`
- `app/routes/match-detail.server.ts` ligne ~83 — `JSON.parse(match.matchDetails)`
- `app/routes/soiree.server.ts` ligne ~250 — `JSON.parse(m.options)`

**Impact :** Erreurs d'exécution silencieuses, potentiel comportement inattendu si données DB corrompues

Bien que ces données proviennent de la base de données et non d'utilisateurs, l'absence de validation de la structure parsée peut provoquer des crashes ou des comportements inattendus.

**Correction recommandée :** Utiliser Zod pour valider la structure après parsing :

```typescript
const conditionSchema = z.object({ type: z.string(), value: z.number() });
const condition = conditionSchema.parse(JSON.parse(badge.condition));
```

---

#### SEC-09 — Redis sans authentification en développement

**Fichier :** `docker-compose.yml` (développement)  
**Impact :** Accès libre aux sessions et au cache si le port Redis est exposé

En développement, Redis n'a pas de mot de passe. Les sessions utilisateur sont stockées dans Redis via Better Auth. Si le port 6379 est accessible sur le réseau local du NAS, les sessions sont exposées.

**Correction recommandée :** Configurer un mot de passe même en développement, ou s'assurer que le port Redis n'est pas exposé à l'extérieur du réseau Docker (`127.0.0.1:6379:6379` au lieu de `6379:6379`).

---

#### SEC-10 — Port PostgreSQL exposé à l'hôte en production

**Fichier :** `docker-compose.prod.yml`  
**Impact :** Base de données accessible directement depuis le réseau si le firewall NAS n'est pas configuré

**Correction recommandée :** Supprimer le mapping de port PostgreSQL en production (les services internes communiquent via le réseau Docker) :

```yaml
# Supprimer cette ligne en prod :
# ports:
#   - "5432:5432"
```

---

### FAIBLE

---

#### SEC-11 — Absence de validation sur `api.welcome-dismiss.ts`

**Fichier :** `app/routes/api.welcome-dismiss.ts`  
**Impact :** Requête fonctionnelle même si l'utilisateur n'existe pas en DB

L'endpoint met à jour le flag `welcomeDismissed` sans vérifier que l'utilisateur existe réellement avant l'opération. Risque mineur car l'endpoint est protégé par authentification.

---

#### SEC-12 — Absence d'API versioning

**Impact :** Pas de stratégie de dépréciation des endpoints API existants

Les endpoints `/api/*` n'ont pas de versioning (`/api/v1/`). En cas de modification breaking, tous les clients (y compris l'app mobile si ajoutée) seront affectés immédiatement.

---

## 3. Points positifs confirmés

| Domaine | État |
|---------|------|
| Requêtes SQL via Drizzle ORM (pas d'injection SQL) | ✅ |
| Validation Zod sur tous les inputs utilisateur | ✅ |
| Mots de passe hashés par Better Auth | ✅ |
| Sessions stockées dans Redis avec TTL | ✅ |
| RBAC (member / admin / partner) bien implémenté | ✅ |
| Upload d'images re-encodé via Sharp (WebP 256×256) | ✅ |
| Type MIME et taille de fichier validés côté serveur | ✅ |
| Aucun `dangerouslySetInnerHTML` dans les composants | ✅ |
| Variables d'environnement validées via Zod au démarrage | ✅ |
| Aucun secret trouvé dans l'historique git | ✅ |
| `.gitignore` couvre `.env`, `uploads/`, `.DS_Store` | ✅ |
| Messages d'erreur génériques renvoyés au client | ✅ |
| Rate limiting sur l'authentification (login/register) | ✅ |
| Build Docker multi-stage avec image Alpine | ✅ |
| Healthchecks Docker configurés | ✅ |

---

## 4. Plan d'action recommandé

### Immédiat (avant mise en production)

1. **SEC-01** — Supprimer les valeurs par défaut `changeme` dans `docker-compose.prod.yml`
2. **SEC-02** — Configurer HTTPS/TLS (Let's Encrypt ou Traefik)
3. **SEC-03** — Ajouter les en-têtes de sécurité HTTP dans Nginx

### Court terme (sprint suivant)

4. **SEC-04** — Ajouter le rate limiting sur les endpoints de mutation
5. **SEC-05** — Ajouter la directive `USER` dans le Dockerfile
6. **SEC-06** — Centraliser tous les accès `process.env` via `env.server.ts`

### Moyen terme

7. **SEC-07** — Durcir la configuration du rate limiting (confiance IP)
8. **SEC-08** — Valider les structures JSON parsées via Zod
9. **SEC-09** — Sécuriser Redis en développement
10. **SEC-10** — Retirer l'exposition du port PostgreSQL en production

---

*Document généré automatiquement — analyse statique du code source et de la configuration de déploiement.*
