# Audit de Sécurité — Penya Blaugrana Nantes

**Date :** 25 juin 2026
**Branche analysée :** `claude/sharp-fermi-vroeaj`
**Scope :** Analyse statique complète du code source

---

## Résumé des derniers commits

| Hash | Date | Auteur | Description |
|------|------|--------|-------------|
| `003faca` | 13 avr. 2026 | Biteau Gaël | fix: évaluer les badges immédiatement après chaque action |
| `b1c88f6` | 13 avr. 2026 | Biteau Gaël | feat: Phase 2 — soirée match live, micro-pronos, badges, séries, saisons |
| `d461ee5` | 12 avr. 2026 | Claude | Merge branch 'claude/deploy-synology-nas-cLkOL' |
| `554b873` | 12 avr. 2026 | Claude | Add deployment guide for Synology NAS updates |
| `68e22d2` | 13 avr. 2026 | Biteau Gaël | feat: menu burger mobile pour la navigation |
| `4a65a7b` | 13 avr. 2026 | Biteau Gaël | Merge PR #2 — déploiement Synology NAS |
| `6aebaf7` | 12 avr. 2026 | Claude | Fix Better Auth trusted origins pour domaine personnalisé |
| `9823bc5` | 12 avr. 2026 | Claude | Add migrate service au docker-compose.prod.yml |
| `2bafc6c` | 12 avr. 2026 | Biteau Gaël | Merge PR #1 — déploiement Synology NAS |
| `8d6e5e9` | 12 avr. 2026 | Claude | Add production Docker Compose + backup script NAS Synology |

**Évolution principale :** La Phase 2 (commit `b1c88f6`) a introduit ~2 965 lignes de code ajoutant les fonctionnalités de soirée match live, micro-pronos, badges, séries et saisons. Le hotfix `003faca` corrige l'évaluation des badges après chaque action utilisateur.

---

## Résultats de l'audit de sécurité

### CRITIQUE

#### [C1] Path Traversal dans le serveur de fichiers statiques
**Fichier :** `app/routes/uploads-files.ts:5`

```ts
const filePath = path.join(process.cwd(), "uploads", params["*"]);
```

**Problème :** Le paramètre de route `params["*"]` est utilisé directement dans `path.join` sans validation ni sanitization. Un attaquant peut envoyer une requête `GET /uploads/../.env` ou `GET /uploads/../../etc/passwd` pour accéder à des fichiers sensibles en dehors du répertoire `uploads/`.

**Correction recommandée :**

```ts
const UPLOADS_DIR = path.resolve(process.cwd(), "uploads");
const filePath = path.resolve(UPLOADS_DIR, params["*"]);

if (!filePath.startsWith(UPLOADS_DIR + path.sep)) {
  return new Response("Not found", { status: 404 });
}
```

**Risque :** Exposition du fichier `.env` (clés API, secret d'authentification, URL de base de données), accès à des fichiers système.

---

### HAUTE

#### [H1] Mots de passe par défaut faibles dans Docker Compose
**Fichiers :** `docker-compose.yml:21`, `docker-compose.prod.yml:18`

```yaml
POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-changeme}
redis-server --requirepass ${REDIS_PASSWORD:-changeme}
```

**Problème :** Si les variables d'environnement `POSTGRES_PASSWORD` et `REDIS_PASSWORD` ne sont pas définies dans le fichier `.env`, les services démarrent avec le mot de passe `changeme`. Un déploiement oublié sans `.env` ou avec un `.env` incomplet exposera les services avec des credentials triviaux.

**Correction recommandée :** Supprimer les valeurs par défaut et faire échouer explicitement le démarrage si les variables sont absentes :

```yaml
POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?Variable POSTGRES_PASSWORD requise}
```

#### [H2] Absence d'en-têtes de sécurité HTTP dans Nginx
**Fichier :** `docker/nginx/nginx.conf`

**Problème :** La configuration Nginx ne définit aucun en-tête de sécurité. Les navigateurs sont exposés à plusieurs classes d'attaques :
- Pas de `Content-Security-Policy` → risque XSS
- Pas de `X-Frame-Options` → risque de clickjacking
- Pas de `X-Content-Type-Options` → risque de MIME sniffing
- Pas de `Strict-Transport-Security` → downgrade HTTP possible
- Pas de `Referrer-Policy`

**Correction recommandée :** Ajouter dans le bloc `server` :

```nginx
add_header X-Frame-Options "SAMEORIGIN" always;
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains" always;
add_header Content-Security-Policy "default-src 'self'; img-src 'self' https://images.fotmob.com data:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline';" always;
```

#### [H3] Absence de rate limiting sur l'inscription
**Fichier :** `app/routes/register.tsx` / `app/lib/server/auth.server.ts`

**Problème :** L'endpoint d'inscription (`/api/auth/sign-up/email`) n'est soumis à aucun rate limiting côté serveur applicatif. Un attaquant peut créer massivement des comptes (account flooding), épuiser les ressources Redis/Postgres, ou préparer des attaques spam.

**Correction recommandée :** Ajouter un rate limiting sur l'IP source avant d'appeler Better Auth, ou configurer le rate limiting natif de Better Auth via son option `rateLimit`.

---

### MOYENNE

#### [M1] Race condition dans le rate limiter Redis
**Fichier :** `app/lib/server/rate-limit.server.ts:16-19`

```ts
const current = await redis.incr(redisKey);
if (current === 1) {
  await redis.expire(redisKey, windowSeconds);
}
```

**Problème :** Les deux commandes `INCR` et `EXPIRE` sont exécutées en deux appels Redis séparés. Si le processus s'interrompt entre les deux (crash, OOM, redémarrage), la clé reste en mémoire Redis indéfiniment, bloquant l'utilisateur légitime de façon permanente.

**Correction recommandée :** Utiliser la commande atomique `SET NX EX` ou un script Lua, ou plus simplement :

```ts
const current = await redis.incr(redisKey);
await redis.expire(redisKey, windowSeconds); // expire à chaque incr
```

Ou en une seule commande avec pipeline Redis.

#### [M2] `correctAnswer` exposé dans le loader soirée
**Fichier :** `app/routes/soiree.server.ts:253`

```ts
correctAnswer: m.correctAnswer,
```

**Problème :** Le champ `correctAnswer` est renvoyé pour tous les micro-pronostics dans la réponse du loader, y compris ceux non encore clôturés. Bien que la logique normale ne définisse `correctAnswer` qu'à la clôture, un bug ou une manipulation admin accidentelle pourrait exposer la réponse correcte à tous les utilisateurs authentifiés avant fermeture officielle.

**Correction recommandée :** N'exposer `correctAnswer` que si `closedAt` est non-null :

```ts
correctAnswer: m.closedAt ? m.correctAnswer : null,
```

#### [M3] Cache `immutable` sur les avatars — invalidation impossible
**Fichier :** `app/routes/uploads-files.ts:21`

```ts
"Cache-Control": "public, max-age=31536000, immutable",
```

**Problème :** Le nom du fichier avatar est `{userId}.webp`. Après une mise à jour d'avatar, les navigateurs servent l'ancienne version depuis leur cache pendant jusqu'à 1 an, car `immutable` indique que l'URL ne changera jamais. L'utilisateur voit son ancien avatar partout même après modification.

**Correction recommandée :** Utiliser une durée courte ou un cache-busting (hash du fichier ou timestamp dans l'URL), ou retirer `immutable` :

```ts
"Cache-Control": "public, max-age=3600",
```

---

### BASSE

#### [B1] Validation du type MIME basée sur `file.type` (contrôlé côté client)
**Fichier :** `app/lib/server/upload.ts:13`

```ts
if (!ALLOWED_TYPES.includes(file.type)) { ... }
```

**Problème :** `file.type` provient du header HTTP envoyé par le client et peut être falsifié. Un attaquant peut envoyer un fichier malveillant avec `Content-Type: image/jpeg`. **Mitigation partielle :** la conversion systématique par Sharp valide implicitement le contenu binaire et rejette les fichiers non-image. Le risque résiduel est faible mais présent.

**Correction recommandée :** Valider le contenu réel du fichier avec `file-type` (magic bytes) en plus de `file.type`.

#### [B2] Absence de HTTPS forcé en production
**Fichier :** `docker/nginx/nginx.conf`

**Problème :** Nginx n'écoute que sur le port 80 (HTTP). Sur le NAS Synology, le HTTPS est probablement géré par un reverse proxy externe (DSM), mais si le conteneur est exposé directement, les sessions et cookies transitent en clair.

**Recommandation :** Vérifier que la terminaison TLS est bien assurée par la couche supérieure du NAS. Si Nginx expose directement, configurer TLS ou forcer la redirection 301 HTTP → HTTPS.

---

## Points de conformité sécurité — Bilan positif

| Pratique | Statut |
|----------|--------|
| Variables d'environnement validées au démarrage (Zod) | ✅ |
| `AUTH_SECRET` validé minimum 16 caractères | ✅ |
| Fichier `.env` exclu du dépôt Git (`.gitignore`) | ✅ |
| Aucune credential hardcodée dans le code source | ✅ |
| ORM Drizzle — protection native injection SQL | ✅ |
| `requireAuth` systématiquement appliqué sur les routes protégées | ✅ |
| Vérification du rôle admin côté serveur (session, non user-input) | ✅ |
| Rate limiting Redis sur les actions sensibles | ✅ (partiel) |
| Traitement des avatars via Sharp (resize + re-encodage webp) | ✅ |
| Validation Zod des formulaires côté serveur | ✅ |
| Logging structuré sans données sensibles (pas de passwords, tokens) | ✅ |
| Sessions stockées côté serveur (Redis via Better Auth) | ✅ |
| `.env.example` fourni avec des placeholders explicites | ✅ |

---

## Récapitulatif par criticité

| ID | Criticité | Fichier | Résumé |
|----|-----------|---------|--------|
| C1 | **CRITIQUE** | `uploads-files.ts:5` | Path traversal — accès arbitraire au système de fichiers |
| H1 | **HAUTE** | `docker-compose*.yml` | Mots de passe par défaut `changeme` sur Postgres et Redis |
| H2 | **HAUTE** | `nginx.conf` | Absence totale d'en-têtes de sécurité HTTP |
| H3 | **HAUTE** | `register.tsx` / `auth.server.ts` | Pas de rate limiting sur l'inscription |
| M1 | **MOYENNE** | `rate-limit.server.ts:16` | Race condition INCR + EXPIRE non atomique |
| M2 | **MOYENNE** | `soiree.server.ts:253` | `correctAnswer` exposé avant clôture officielle |
| M3 | **MOYENNE** | `uploads-files.ts:21` | Cache `immutable` bloque l'invalidation des avatars |
| B1 | **BASSE** | `upload.ts:13` | MIME type validé côté client uniquement |
| B2 | **BASSE** | `nginx.conf` | Absence de HTTPS / redirection forcée en production |

---

*Document généré lors de l'analyse automatique du 25 juin 2026. Mettre à jour après chaque sprint.*
