# Audit Sécurité — Penya Blaugrana Nantes
**Date :** 13 juin 2026  
**Branche analysée :** `main` (commit HEAD `003faca`)  
**Analyste :** Claude Code (routine automatisée)

---

## Résumé des derniers commits

| Commit | Date | Description |
|--------|------|-------------|
| `003faca` | 13/04/2026 | fix: évaluer les badges immédiatement après chaque action (post, pronostic, commentaire, réaction) |
| `b1c88f6` | 13/04/2026 | feat: Phase 2 — soirée match live, micro-pronos, badges, séries, saisons (Sprint 2–5) |
| `68e22d2` | 13/04/2026 | feat: menu burger mobile pour la navigation |
| `554b873` | 12/04/2026 | Add deployment guide for Synology NAS updates |
| `d461ee5` | 12/04/2026 | Merge branch `claude/deploy-synology-nas-cLkOL` |
| `6aebaf7` | 12/04/2026 | Fix Better Auth trusted origins pour support domaine custom |
| `9823bc5` | 12/04/2026 | Add service migrate dans docker-compose.prod.yml |
| `2bafc6c` | 12/04/2026 | Merge PR #1 — NAS Synology |
| `8d6e5e9` | 12/04/2026 | Add docker-compose.prod.yml + script backup Synology |
| `3d80133` | 12/04/2026 | docs: roadmap Phase 2 documentée |

---

## Résultats de l'audit sécurité

### Points positifs constatés

- Validation des variables d'environnement au démarrage via Zod (`env.server.ts`)
- Rate limiting sur les routes `sign-in` (10 req/15 min) et `sign-up` (5 req/h)
- Utilisation de `requireAuth` sur toutes les routes protégées
- Vérification du rôle admin côté serveur sur les routes `/admin/*`
- Protection anti-auto-modification : un admin ne peut pas modifier son propre rôle
- Validation Zod des formulaires avant insertion en base
- Upload d'avatar : validation du type MIME et de la taille (2 Mo max), conversion WebP via `sharp`
- Sessions via Redis (`secondaryStorage`) — résilience et invalidation possible
- Pas de secrets dans le dépôt (`.env` dans `.gitignore`)
- ORM Drizzle avec requêtes paramétrées — pas de SQL brut avec entrées utilisateur

---

## Vulnérabilités identifiées

---

### CRITIQUE

#### C-01 — Path Traversal dans le serveur de fichiers uploads

**Fichier :** `app/routes/uploads-files.ts` (ligne 5)

```typescript
const filePath = path.join(process.cwd(), "uploads", params["*"]);
```

**Problème :** Le paramètre wildcard `params["*"]` provenant de l'URL est directement passé à `path.join` sans vérifier que le chemin résolu reste à l'intérieur du dossier `uploads/`. Un attaquant peut envoyer une requête du type :

```
GET /uploads/../.env
GET /uploads/../../etc/passwd
```

`path.join` normalise les `../` et peut sortir du répertoire autorisé, permettant la lecture de fichiers arbitraires sur le serveur, y compris le fichier `.env` contenant les credentials de production.

**Impact :** Divulgation de secrets (DATABASE_URL, AUTH_SECRET, API_FOOTBALL_KEY), compromission complète possible.

**Correction :**
```typescript
export async function loader({ params }: { params: { "*": string } }) {
  const UPLOAD_DIR = path.join(process.cwd(), "uploads");
  const filePath = path.join(UPLOAD_DIR, params["*"]);

  // Protection path traversal
  if (!filePath.startsWith(UPLOAD_DIR + path.sep) && filePath !== UPLOAD_DIR) {
    return new Response("Not found", { status: 404 });
  }
  // ... suite inchangée
}
```

---

### HAUTE

#### H-01 — Container Docker exécuté en root

**Fichier :** `Dockerfile` (image finale, ligne 17–21)

```dockerfile
FROM node:20-alpine
# ...
CMD ["npm", "run", "start"]
```

**Problème :** Aucune directive `USER` dans l'image finale. L'application tourne avec l'utilisateur `root` dans le container. En cas d'exploitation d'une vulnérabilité applicative (RCE, SSRF), l'attaquant obtient directement les privilèges root dans le container.

**Correction :** Ajouter avant `CMD` :
```dockerfile
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser
CMD ["npm", "run", "start"]
```

---

#### H-02 — Mots de passe par défaut en production (`changeme`)

**Fichier :** `docker-compose.prod.yml` (lignes 22, 32)

```yaml
POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-changeme}
redis-server --requirepass ${REDIS_PASSWORD:-changeme}
```

**Problème :** Si le fichier `.env` n'est pas correctement configuré en production, PostgreSQL et Redis démarreront avec le mot de passe `changeme`. Ce mécanisme de fallback est dangereux en production.

**Correction :** Supprimer les valeurs par défaut pour forcer une erreur explicite au démarrage si le secret n'est pas fourni :
```yaml
POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?POSTGRES_PASSWORD must be set}
redis-server --requirepass ${REDIS_PASSWORD:?REDIS_PASSWORD must be set}
```

---

#### H-03 — Endpoint `/api/health` non authentifié expose l'infrastructure

**Fichier :** `app/routes/api.health.ts`

**Problème :** Le health check est public (aucun `requireAuth`). La réponse révèle le statut de PostgreSQL, Redis et un timestamp — informations utiles pour un attaquant lors d'une reconnaissance. En mode dégradé, la réponse indique précisément quel service est en panne.

**Impact :** Faible individuellement, mais dans le cadre d'une attaque plus large, cela permet de cartographier l'infrastructure.

**Correction (option 1):** Restreindre l'accès à des IPs internes (proxy/Nginx).  
**Correction (option 2):** Ajouter une clé d'authentification dans le header :
```typescript
const healthToken = request.headers.get("x-health-token");
if (healthToken !== process.env.HEALTH_TOKEN) {
  return new Response("Unauthorized", { status: 401 });
}
```

---

#### H-04 — Absence totale de headers de sécurité HTTP

**Fichiers :** `vite.config.ts`, `react-router.config.ts`, aucun middleware HTTP

**Problème :** Aucun header de sécurité n'est configuré :
- Pas de `Content-Security-Policy` (risque XSS)
- Pas de `X-Frame-Options` ou `frame-ancestors` (risque clickjacking)
- Pas de `X-Content-Type-Options: nosniff`
- Pas de `Strict-Transport-Security` (HSTS)
- Pas de `Referrer-Policy`

**Correction :** Ajouter un middleware dans `entry.server.tsx` ou configurer Nginx/proxy :
```typescript
// Dans le loader racine ou entry.server.tsx
headers.set("X-Frame-Options", "DENY");
headers.set("X-Content-Type-Options", "nosniff");
headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
headers.set("Content-Security-Policy", "default-src 'self'; ...");
```

---

### MOYENNE

#### M-01 — Spoofing possible de l'IP pour contourner le rate limiting

**Fichier :** `app/routes/api.auth.$.ts` (ligne 6–10)

```typescript
request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
request.headers.get("x-real-ip") || "unknown"
```

**Problème :** Si l'application n'est pas derrière un proxy de confiance, un attaquant peut envoyer un faux header `X-Forwarded-For` pour contourner le rate limiting et effectuer des attaques par force brute.

**Correction :** S'assurer que le reverse proxy (Nginx) est configuré pour écraser ces headers avec la vraie IP cliente avant de les transmettre, et ne jamais faire confiance à des headers injectés par le client.

---

#### M-02 — `(session.user as any).role` — contournement du typage TypeScript

**Fichier :** `app/routes/feed.server.ts` (lignes 99, 124, 184, 200)

```typescript
isAdmin: (session.user as any).role === "admin",
if (isAnnouncement && (session.user as any).role !== "admin") {
```

**Problème :** Le cast `as any` contourne la vérification de types TypeScript. Le type `Session` de Better Auth n'inclut pas `role` dans ses types de base. Fonctionnellement correct aujourd'hui, mais fragilise la maintenance et peut masquer une régression si la structure du user change.

**Correction :** Étendre le type de session ou utiliser l'assertion correcte via le type augmenté :
```typescript
// Dans auth-utils.server.ts — le type Role est déjà défini
const isAdmin = (session.user.role as Role) === "admin";
```

---

#### M-03 — `.gitignore` incomplet — variantes de `.env` non couvertes

**Fichier :** `.gitignore` (ligne 2)

```
.env
```

**Problème :** Seul `.env` est ignoré. Les fichiers `.env.local`, `.env.production`, `.env.development.local`, `.env.production.local` ne sont pas couverts.

**Correction :**
```gitignore
.env
.env.*
.env.*.local
```

---

#### M-04 — Absence de rate limiting sur les actions utilisateur (feed, pronostics)

**Fichiers :** `feed.server.ts`, `match-detail.server.ts`, `api.micro-predictions.ts`

**Problème :** Les actions d'écriture (posts, commentaires, réactions, pronostics) n'ont aucune limite de fréquence. Un utilisateur authentifié peut spammer le feed ou soumettre des milliers de pronostics automatisés.

**Correction :** Appliquer `checkRateLimit` (déjà disponible dans `rate-limit.server.ts`) sur les actions write, par exemple 20 posts/heure, 50 réactions/heure.

---

#### M-05 — `.dockerignore` incomplet — fichiers sensibles potentiellement copiés dans l'image

**Fichier :** `.dockerignore`

```
.react-router
build
node_modules
README.md
```

**Problème :** Le fichier `.env` n'est pas exclu du contexte de build Docker. Si un `.env` de production se trouve dans le répertoire lors du `docker build`, il sera copié dans l'image (instruction `COPY . /app` dans le Dockerfile).

**Correction :**
```dockerignore
.env
.env.*
*.env
.git
```

---

#### M-06 — Validation insuffisante des options de micro-pronostics

**Fichier :** `app/routes/api.micro-predictions.ts` (lignes 22, 30)

```typescript
const optionsRaw = formData.get("options") as string;
const options = optionsRaw ? JSON.stringify(optionsRaw.split(",").map((o) => o.trim())) : null;
```

**Problème :** Aucune limite sur le nombre d'options (possibilité de créer des milliers d'entrées), ni sur leur taille individuelle. Peut entraîner un stockage excessif ou un rendu côté client difficile.

**Correction :**
```typescript
const optionsSchema = z.array(z.string().max(100)).min(2).max(10);
const options = optionsSchema.parse(optionsRaw.split(",").map(o => o.trim()));
```

---

### HAUTE — Dépendances npm vulnérables

#### D-01 — RCE via turbo-stream dans `react-router` (version actuelle : 7.14.0)

**CVE :** `GHSA-49rj-9fvp-4h2h`  
**Plage vulnérable :** `7.0.0 – 7.14.2`

**Problème :** Le module turbo-stream embarqué dans react-router permet l'invocation de constructeurs arbitraires lors de la désérialisation via le type `TYPE_ERROR`. Exploitable à distance sans authentification (RCE non authentifié).

**Correction :** Mettre à jour react-router à la version `7.14.3` ou supérieure.

---

#### D-02 — Bypass OAuth dans `better-auth` (version actuelle : ^1.6.2)

- **`GHSA-wxw3-q3m9-c3jr`** : Le callback OAuth accepte un `state` non correspondant quand le stockage en cookie est utilisé sans PKCE → vol de session possible.
- **`GHSA-cq3f-vc6p-68fh`** : L'autorisation de device flow accepte n'importe quelle session authentifiée tant que le `user_code` est en attente → prise de contrôle de compte.

**Correction :** Vérifier et appliquer le dernier patch de better-auth dès qu'il est disponible.

---

#### D-03 — Vulnérabilités dans Vite (version actuelle : ^8.0.3)

**Plage vulnérable :** `4.2.0-beta.0 – 8.0.3`

Plusieurs CVEs affectant le serveur de développement Vite (lecture de fichiers arbitraires, requêtes cross-origin non autorisées). Impact en production limité, mais critique si le port Vite est exposé.

**Correction :** Mettre à jour Vite à `8.0.4+` dès disponibilité.

---

#### D-04 — Autres dépendances HIGH (résumé)

| Package | CVE | Impact |
|---------|-----|--------|
| `fast-uri` ≤ 3.1.1 | `GHSA-q3j6-qgpj-74h6` | Path traversal via segments percent-encodés |
| `lodash` ≤ 4.17.23 | `GHSA-r5fr-rjxr-66jc` | Code injection via `_.template` |
| `esbuild` ≤ 0.28.0 | `GHSA-67mh-4wv8-2f99` | Dev server lisible depuis n'importe quel site |
| `kysely` 0.26–0.28.16 | `GHSA-pv5w-4p9q-p3v2` | JSON-path traversal injection |

**Commande :** `npm audit` retourne **30 vulnérabilités** (14 modérées, 16 hautes).

---

### FAIBLE

#### F-01 — Cache avatar immuable sur un nom de fichier fixe

**Fichier :** `app/lib/server/upload.ts` (ligne 28) + `app/routes/uploads-files.ts` (ligne 18)

```typescript
const filename = `${userId}.webp`;  // nom fixe par userId
Cache-Control: public, max-age=31536000, immutable
```

**Problème :** Quand un utilisateur change d'avatar, le nouveau fichier écrase l'ancien avec le même nom. Mais les clients (navigateurs, CDN) ont mis en cache l'ancienne image pour 1 an avec `immutable`. Le nouvel avatar ne s'affichera pas avant expiration du cache.

**Correction :** Inclure un hash ou timestamp dans le nom du fichier, ou utiliser un cache-busting dans l'URL.

---

#### F-02 — `backup.sh` sans vérification d'erreur

**Fichier :** `backup.sh`

**Problème :** Si `pg_dump` échoue (base indisponible, permissions), le script continue et crée un fichier vide. La rotation (`tail -n +31`) peut supprimer d'anciens backups valides en ne gardant que des fichiers vides récents.

**Correction :**
```bash
docker compose ... pg_dump ... > "$BACKUP_DIR/penya_$DATE.sql" || { echo "ERREUR: backup échoué"; rm -f "$BACKUP_DIR/penya_$DATE.sql"; exit 1; }
```

---

#### F-03 — `postId` non validé avant réaction (pas de vérification d'existence)

**Fichier :** `app/routes/feed.server.ts` (intent `react`, ligne 141–161)

**Problème :** Lors d'une réaction, le `postId` n'est pas vérifié comme existant avant l'insertion. Si l'ORM ne lève pas de contrainte FK, on pourrait insérer une réaction orpheline.

**Note :** Drizzle avec PostgreSQL applique les contraintes FK en base, donc l'impact réel est faible, mais une vérification explicite améliore la lisibilité des erreurs.

---

## Synthèse

| Criticité | Nb | Sujets |
|-----------|-----|--------|
| CRITIQUE | 1 | Path traversal fichiers uploads |
| HAUTE | 8 | Root Docker, mots de passe défaut, health public, headers sécurité, RCE react-router, OAuth bypass better-auth, Vite vulnérable, lodash/fast-uri/kysely |
| MOYENNE | 6 | IP spoofing rate limit, typage role, .gitignore, rate limit actions, .dockerignore, options micro-pronos |
| FAIBLE | 3 | Cache avatar, backup.sh, postId validation |

**Actions prioritaires :**
1. **C-01** — Corriger `uploads-files.ts` (path traversal sans authentification)
2. **D-01** — Mettre à jour `react-router` ≥ 7.14.3 (RCE non authentifié)
3. **D-02** — Patcher `better-auth` (bypass OAuth / prise de contrôle de compte)

```bash
npm audit  # 30 vulnérabilités actuellement (16 HIGH)
npm update react-router @react-router/node @react-router/express
```

---

*Document généré automatiquement par audit de sécurité — branche `main`, commit `003faca`*
