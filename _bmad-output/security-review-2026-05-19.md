# Revue de sécurité — Penya Barca Nantes
**Date :** 19 mai 2026  
**Branche analysée :** `main` (dernier commit : `003faca`)  
**Périmètre :** Analyse statique du code source, configuration Docker, scripts de déploiement

---

## Résumé des derniers commits

| Commit | Date | Auteur | Description |
|--------|------|--------|-------------|
| `003faca` | 13 avr. 2026 | Biteau Gaël | fix: évaluer les badges immédiatement après chaque action |
| `b1c88f6` | 13 avr. 2026 | Biteau Gaël | feat: Phase 2 — soirée match live, micro-pronos, badges, séries, saisons |
| `d461ee5` | 12 avr. 2026 | Claude | Merge branch `claude/deploy-synology-nas-cLkOL` |
| `554b873` | 12 avr. 2026 | Claude | Add deployment guide for Synology NAS updates |
| `68e22d2` | 13 avr. 2026 | Biteau Gaël | feat: menu burger mobile pour la navigation |
| `6aebaf7` | 12 avr. 2026 | Claude | Fix Better Auth trusted origins for custom domain support |
| `9823bc5` | 12 avr. 2026 | Claude | Add migrate service to docker-compose.prod.yml for database migrations |
| `8d6e5e9` | 12 avr. 2026 | Claude | Add production Docker Compose and backup script for Synology NAS deployment |

---

## Analyse de sécurité par ordre de criticité

---

### 🔴 CRITIQUE

#### C-1 — Path traversal dans le serveur de fichiers uploadés
**Fichier :** `app/routes/uploads-files.ts` — ligne 5  
**Type :** Directory Traversal (CWE-22)

```typescript
// Code actuel — VULNÉRABLE
const filePath = path.join(process.cwd(), "uploads", params["*"]);
```

`path.join` normalise le chemin mais **ne bloque pas la traversée de répertoire**. Un attaquant peut appeler `/uploads/../../.env` ou `/uploads/../../package.json` pour lire des fichiers sensibles hors du dossier `uploads/`.

**Preuve de concept :**
```
GET /uploads/../../.env
→ path.join('/app', 'uploads', '../../.env') = '/app/.env'  ✓ lu sans restriction
```

**Correction recommandée :**
```typescript
const uploadsDir = path.resolve(process.cwd(), "uploads");
const filePath = path.resolve(uploadsDir, params["*"]);

if (!filePath.startsWith(uploadsDir + path.sep)) {
  return new Response("Not found", { status: 404 });
}
```

---

### 🟠 ÉLEVÉ

#### H-1 — Credentials par défaut en production (Docker Compose)
**Fichier :** `docker-compose.prod.yml` — lignes 19, 25  
**Type :** Weak Credentials (CWE-521)

```yaml
POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-changeme}
redis-server --requirepass ${REDIS_PASSWORD:-changeme}
```

Si les variables d'environnement `POSTGRES_PASSWORD` et `REDIS_PASSWORD` ne sont pas définies dans `.env`, les mots de passe `changeme` sont utilisés en production. Un accès réseau au conteneur permet alors une connexion immédiate.

**Correction recommandée :** Supprimer les valeurs par défaut pour forcer une configuration explicite :
```yaml
POSTGRES_PASSWORD=${POSTGRES_PASSWORD:?POSTGRES_PASSWORD must be set}
```

---

#### H-2 — Dockerfile sans utilisateur non-root
**Fichier :** `Dockerfile` — image finale (ligne 17+)  
**Type :** Privilege Escalation Risk (CWE-250)

Le conteneur d'application final s'exécute en tant que `root`. En cas de RCE (exécution de code à distance), l'attaquant obtient les droits root dans le conteneur, facilitant l'évasion vers l'hôte.

**Correction recommandée :**
```dockerfile
FROM node:20-alpine
# ...
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser
CMD ["npm", "run", "start"]
```

---

### 🟡 MOYEN

#### M-1 — Endpoint de healthcheck public exposant l'infrastructure
**Fichier :** `app/routes/api.health.ts`  
**Type :** Information Disclosure (CWE-200)

L'endpoint `/api/health` est accessible sans authentification et révèle :
- La technologie de base de données (PostgreSQL)
- La technologie de cache (Redis)
- L'état opérationnel de chaque service (up/down)

Ces informations facilitent la reconnaissance lors d'une attaque ciblée.

**Correction recommandée :** Restreindre l'endpoint à des IPs internes, ou à une clé secrète partagée avec l'orchestrateur (ex. en-tête `X-Health-Key`).

---

#### M-2 — Fuite de messages d'erreur internes
**Fichier :** `app/routes/api.sync-matches.ts` — ligne 21  
**Type :** Information Disclosure (CWE-209)

```typescript
const message = error instanceof Error ? error.message : "Erreur inconnue";
return Response.json({ error: message }, { status: 500 });
```

Les messages d'exception bruts (stack traces, noms de tables, URLs internes, clés API) peuvent être renvoyés au client en cas d'erreur.

**Correction recommandée :**
```typescript
logger.error({ error }, "Erreur sync API-Football");
return Response.json({ error: "Une erreur interne est survenue." }, { status: 500 });
```

---

#### M-3 — Rate limiting contournable par falsification de l'IP (IP Spoofing)
**Fichier :** `app/routes/api.auth.$.ts` — lignes 6–12  
**Type :** Improper Input Validation (CWE-20)

```typescript
request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
request.headers.get("x-real-ip") ||
"unknown"
```

L'en-tête `X-Forwarded-For` peut être forgé par n'importe quel client. Si l'application n'est pas derrière un reverse proxy de confiance qui réécrit cet en-tête, un attaquant peut contourner le rate limiting en changeant artificiellement son IP perçue.

**Correction recommandée :** Utiliser le module `request-ip` configuré avec la liste des proxies de confiance, ou configurer NGINX/Caddy en amont pour forcer la valeur de `X-Forwarded-For`.

---

#### M-4 — Accès direct à `process.env` sans validation au démarrage
**Fichiers :** `app/db/client.ts` — ligne 6, `app/lib/server/redis.server.ts` — ligne 3  
**Type :** Improper Configuration (CWE-16)

```typescript
// db/client.ts
connectionString: process.env.DATABASE_URL,  // undefined si non défini

// redis.server.ts
new Redis(process.env.REDIS_URL || "redis://localhost:6379")  // fallback silencieux en prod
```

Ces modules n'utilisent pas `getEnv()` défini dans `app/config/env.server.ts`, contournant la validation Zod. Si `DATABASE_URL` est absent, la connexion DB échoue à la première requête sans message d'erreur clair. Le fallback Redis pointe vers `localhost:6379` sans authentification, ce qui pourrait connecter silencieusement à un Redis non sécurisé en production.

**Correction recommandée :**
```typescript
// db/client.ts
import { getEnv } from "~/config/env.server";
const pool = new pg.Pool({ connectionString: getEnv().DATABASE_URL });

// redis.server.ts
import { getEnv } from "~/config/env.server";
export const redis = new Redis(getEnv().REDIS_URL, { ... });
```

---

### 🟢 FAIBLE

#### L-1 — `trustedOrigins` vide si APP_URL non configuré (protection CSRF)
**Fichier :** `app/lib/server/auth.server.ts` — ligne 12  
**Type :** Cross-Site Request Forgery (CWE-352)

```typescript
trustedOrigins: env.APP_URL ? [env.APP_URL] : [],
```

`APP_URL` est optionnel dans le schéma de validation. Si non défini, `trustedOrigins` est vide, ce qui peut désactiver partiellement la protection CSRF de Better Auth selon les versions.

**Correction recommandée :** Rendre `APP_URL` obligatoire dans `env.server.ts` :
```typescript
APP_URL: z.string().url("APP_URL doit être une URL valide"),
```

---

#### L-2 — En-têtes de sécurité HTTP absents
**Impact :** Ensemble de l'application  
**Type :** Missing Security Headers (CWE-16)

Aucun en-tête de sécurité HTTP n'est configuré dans l'application ou détectable dans la configuration du reverse proxy :

| En-tête manquant | Risque |
|-----------------|--------|
| `Content-Security-Policy` | XSS, injection de ressources |
| `Strict-Transport-Security` | Downgrade HTTPS→HTTP |
| `X-Frame-Options` | Clickjacking |
| `X-Content-Type-Options` | MIME sniffing |
| `Referrer-Policy` | Fuite d'URL dans les logs externes |

**Correction recommandée :** Configurer ces en-têtes dans NGINX/Caddy (reverse proxy) ou via un middleware React Router.

---

#### L-3 — Script de backup sans vérification d'intégrité
**Fichier :** `backup.sh`  
**Type :** Data Integrity (CWE-345)

```bash
docker compose ... exec -T postgres pg_dump -U penya penya_barca_nantes \
  > "$BACKUP_DIR/penya_$DATE.sql"
```

- Aucune vérification du code de retour de `pg_dump` (fichier vide/corrompu sauvegardé silencieusement)
- Aucun checksum pour valider l'intégrité des sauvegardes
- La suppression des anciens backups pourrait se déclencher même si le nouveau backup a échoué

**Correction recommandée :**
```bash
set -euo pipefail
docker compose ... exec -T postgres pg_dump -U penya penya_barca_nantes \
  > "$BACKUP_DIR/penya_$DATE.sql" \
  && echo "Backup OK : $DATE" \
  || { rm -f "$BACKUP_DIR/penya_$DATE.sql"; echo "ERREUR backup"; exit 1; }
# Rotation seulement si backup réussi
ls -t "$BACKUP_DIR"/*.sql | tail -n +31 | xargs rm -f 2>/dev/null || true
```

---

### ℹ️ INFORMATIF

#### I-1 — Utilisation de `as any` pour les vérifications de rôle
**Fichier :** `app/routes/feed.server.ts` — lignes 99, 124, 184, 200  
**Type :** Type Safety (CWE-704)

```typescript
(session.user as any).role === "admin"
```

Le cast `as any` contourne la vérification de type TypeScript. Si la structure de `session.user` évolue, ces vérifications pourraient silencieusement devenir incorrectes. La logique de sécurité repose sur la valeur de `role` sans garantie de type.

**Correction recommandée :** Typer correctement `session.user` en étendant le type de Better Auth ou en utilisant la fonction `requireAuth` avec `allowedRoles` déjà disponible dans `auth-utils.server.ts`.

---

#### I-2 — Rate limiting absent sur les routes sensibles autres que l'auth
**Impact :** Soumission de pronostics, upload d'avatar, commentaires  
**Type :** Insufficient Rate Limiting

Seuls les endpoints `/sign-in` et `/sign-up` sont protégés par rate limiting. Les routes suivantes n'en ont pas :
- `POST /feed` (création de posts/commentaires → spam)
- `POST /match/:id` (soumission de pronostics répétée)
- `POST /profile` (upload d'avatar → consommation disque)

---

#### I-3 — Parsing JSON sans try/catch ni validation de schéma
**Fichiers :** `app/lib/server/badges.server.ts`, `app/routes/match-detail.server.ts:83`, `app/routes/soiree.server.ts:250`  
**Type :** Improper Error Handling (CWE-755)

```typescript
// badges.server.ts
const condition = JSON.parse(badge.condition) as { type: string; threshold: number };

// soiree.server.ts
options: m.options ? JSON.parse(m.options) as string[] : []
```

Si des données corrompues sont insérées en base (bug ou accès direct), `JSON.parse` lève une exception non interceptée qui fait planter la route. Le cast `as Type` ne valide pas la structure réelle.

**Correction recommandée :** Entourer les `JSON.parse` d'un `try/catch` et valider avec Zod si les données sont critiques.

---

## Tableau récapitulatif

| ID | Criticité | Fichier | Description | Effort de correction |
|----|-----------|---------|-------------|----------------------|
| C-1 | 🔴 Critique | `uploads-files.ts:5` | Path traversal — lecture de fichiers arbitraires | **✅ CORRIGÉ** |
| H-1 | 🟠 Élevé | `docker-compose.prod.yml:19,25` | Credentials par défaut "changeme" | Faible |
| H-2 | 🟠 Élevé | `Dockerfile` | Conteneur s'exécute en root | Faible |
| M-1 | 🟡 Moyen | `api.health.ts` | Healthcheck public expose l'infrastructure | Faible |
| M-2 | 🟡 Moyen | `api.sync-matches.ts:21` | Fuite de messages d'erreur internes | Faible |
| M-3 | 🟡 Moyen | `api.auth.$.ts:6` | IP spoofing contourne le rate limiting | Moyen |
| M-4 | 🟡 Moyen | `db/client.ts`, `redis.server.ts` | Bypass du validateur d'environnement | Faible |
| L-1 | 🟢 Faible | `auth.server.ts:12` | trustedOrigins vide — CSRF partiel | Faible |
| L-2 | 🟢 Faible | (global) | En-têtes HTTP de sécurité absents | Moyen |
| L-3 | 🟢 Faible | `backup.sh` | Backup sans contrôle d'intégrité | Faible |
| I-1 | ℹ️ Info | `feed.server.ts` | Casts `as any` sur les rôles | Faible |
| I-2 | ℹ️ Info | Multiples routes | Rate limiting incomplet | Moyen |
| I-3 | ℹ️ Info | `badges.server.ts`, `soiree.server.ts` | JSON.parse sans try/catch ni validation | Faible |

---

## Points positifs constatés

- **Validation des entrées** : Utilisation systématique de Zod pour valider les formulaires (inscriptions, profil, posts, commentaires, matchs)
- **ORM paramétré** : Toutes les requêtes DB passent par Drizzle ORM — pas de SQL brut injectable détecté
- **Auth centralisée** : `requireAuth()` est correctement appelé sur toutes les routes protégées, y compris les routes admin
- **Vérification de propriété** : Avant suppression d'un post/commentaire, vérification que l'utilisateur est l'auteur ou admin
- **Upload sécurisé** : Vérification du type MIME, limitation de taille (2 Mo), conversion WebP via sharp
- **Rate limiting sur l'auth** : Protection contre le brute-force sur login (10 tentatives/15 min) et register (5 tentatives/heure)
- **Variables d'environnement** : `getEnv()` avec schema Zod garantit la validité des configs au démarrage
- **Mots de passe** : Validation stricte (8 car., majuscule, minuscule, chiffre) via Zod
- **Logging** : Pino utilisé systématiquement, aucun `console.log` de données sensibles détecté
- **Pas de credentials committés** : `.gitignore` correct, commit `aed5841` a nettoyé les credentials
