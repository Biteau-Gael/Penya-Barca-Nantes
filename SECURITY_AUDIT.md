# Rapport d'audit de sécurité — Penya Blaugrana Nantes

> **Date d'analyse :** 01/08/2026  
> **Branche analysée :** `main` (HEAD `003faca`)  
> **Analysé par :** Claude Code (automatique, tâche planifiée)  
> **Statut :** ✅ C-1 corrigé et poussé (`app/routes/uploads-files.ts`)

---

## Résumé des derniers commits

| Hash | Date | Description |
|------|------|-------------|
| `003faca` | 13/04/2026 | fix: évaluer les badges immédiatement après chaque action |
| `b1c88f6` | 13/04/2026 | feat: Phase 2 — soirée match live, micro-pronos, badges, séries, saisons |
| `68e22d2` | 13/04/2026 | feat: menu burger mobile pour la navigation |
| `d461ee5` | 12/04/2026 | Merge branch 'claude/deploy-synology-nas-cLkOL' |
| `554b873` | 12/04/2026 | Add deployment guide for Synology NAS updates |
| `6aebaf7` | 12/04/2026 | Fix Better Auth trusted origins for custom domain support |
| `9823bc5` | 12/04/2026 | Add migrate service to docker-compose.prod.yml for database migrations |
| `8d6e5e9` | 12/04/2026 | Add production Docker Compose and backup script for Synology NAS deployment |

### Périmètre Phase 2 (`b1c88f6`)
La Phase 2 a introduit **3 050 lignes** de code réparties sur 29 fichiers :
- Nouvelle route `/soiree/:matchId` avec score live et événements de match via API Football
- Système de **micro-pronostics** en temps réel (`api.micro-predictions.ts`)
- Moteur de **badges** (10 badges) avec évaluation automatique après chaque action
- Gestion des **séries** (`streaks.server.ts`) et des **saisons** (`seasons.server.ts`)
- Nouvelles tables BDD : `badges`, `user_badges`, `micro_predictions`, `micro_prediction_answers`, `rewards`, `seasons`

**Bilan npm audit :** 35 vulnérabilités (1 critique, 16 élevées, 17 modérées, 1 faible) — principalement `better-auth ≤1.6.2` et `@react-router/* 7.14.0`.

---

## Analyse de sécurité par ordre de criticité

### 🔴 CRITIQUE

#### C-1 — Path Traversal dans la route de serveur de fichiers ✅ CORRIGÉ
**Fichier :** `app/routes/uploads-files.ts`  
**Statut :** Corrigé dans ce commit

```ts
// AVANT (vulnérable)
const filePath = path.join(process.cwd(), "uploads", params["*"]);
// Un attaquant pouvait requêter /uploads/../../../etc/passwd

// APRÈS (corrigé)
const filePath = path.resolve(UPLOADS_BASE, requested);
if (!filePath.startsWith(UPLOADS_BASE + path.sep)) {
  return new Response("Forbidden", { status: 403 });
}
// + validation de l'extension uniquement aux types autorisés
```

**Risque originel :** Un attaquant non authentifié pouvait lire n'importe quel fichier accessible par le processus Node (`.env`, bundle serveur, `/etc/passwd`...) via une requête GET vers `/uploads/../../../etc/passwd`.

---

#### C-2 — `better-auth ^1.6.2` — 12 CVEs dont compromission de compte
**Fichier :** `package.json` (ligne 20)  
**npm audit :** 1 critique, plusieurs élevées

Vulnerabilités pertinentes même sans OAuth/OIDC activé :
- `GHSA-2vg6-77g8-24mp` — Sessions persistantes après suppression d'utilisateur (CWE-613)
- `GHSA-g38m-r43w-p2q7` — Prise de compte via auto-link OAuth email non vérifié (CWE-287)
- `GHSA-wxw3-q3m9-c3jr` — Mismatch `state` OAuth accepté sans PKCE
- `GHSA-86j7-9j95-vpqj` — XSS stocké via `javascript:` dans redirect_uri OIDC

**Correctif :** Mettre à jour dès qu'une version patchée est disponible. En attendant : vérifier qu'aucun plugin OIDC, magic-link ou OAuth n'est activé dans `auth.server.ts`.

---

### 🟠 ÉLEVÉ

#### H-1 — Aucun en-tête de sécurité HTTP
**Fichiers :** `app/root.tsx`, `docker/nginx/nginx.conf`

L'application n'envoie aucun des en-têtes suivants : `Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Options`, `Strict-Transport-Security`, `Referrer-Policy`.

**Correctif :** Ajouter un export `headers` dans `root.tsx` ou un `entry.server.tsx` :
```ts
export const headers = () => ({
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Content-Security-Policy": "default-src 'self'; img-src 'self' data:; ...",
});
```

#### H-2 — Container Docker exécuté en tant que root
**Fichier :** `Dockerfile` (toutes les étapes)

Aucune instruction `USER` dans le Dockerfile. En cas d'exploitation, l'attaquant dispose des droits root dans le conteneur.

**Correctif :**
```dockerfile
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser
```

#### H-3 — `.env` absent du `.dockerignore`
**Fichier :** `.dockerignore`

Le `COPY . /app` des étapes `development-dependencies-env` et `build-env` peut embarquer un fichier `.env` dans les couches intermédiaires de l'image Docker (récupérables avec `docker history`).

**Correctif :** Ajouter à `.dockerignore` :
```
.env
.env.*
!.env.example
```

#### H-4 — Spoofing IP via `X-Forwarded-For` pour contourner le rate limiting
**Fichier :** `app/routes/api.auth.$.ts` (lignes 7–9)

La config nginx utilise `$proxy_add_x_forwarded_for` qui *ajoute* à la valeur client sans l'écraser. Un attaquant peut forger `X-Forwarded-For: 1.2.3.4` et bypasser indéfiniment le rate limiting de login.

**Correctif dans nginx :**
```nginx
proxy_set_header X-Forwarded-For $remote_addr;  # écrase, ne pas append
```
Ou dans l'app, lire le **dernier** IP de la liste (celui ajouté par le proxy) :
```ts
const xff = request.headers.get("x-forwarded-for");
const ip = xff ? xff.split(",").pop()?.trim() : "unknown";
```

#### H-5 — Fuite d'informations internes dans `api/sync-matches`
**Fichier :** `app/routes/api.sync-matches.ts` (lignes 21–22)

```ts
const message = error instanceof Error ? error.message : "Erreur inconnue";
return Response.json({ error: message }, { status: 500 });
```

Des messages d'erreur peuvent contenir des noms d'hôtes internes, des connexions BDD, des clés API dans les URLs.

**Correctif :** Logger l'erreur côté serveur, renvoyer un message générique au client.

#### H-6 — Rate limiting absent sur les routes de mutation de contenu
**Fichiers :** `app/routes/api.micro-predictions.ts`, `app/routes/feed.server.ts`

Le rate limiting est uniquement appliqué aux routes d'authentification. Les endpoints de création de posts, commentaires, réactions, micro-pronostics n'ont aucune limite de débit.

**Correctif :** Ajouter `checkRateLimit` avec `userId` comme clé sur toutes les actions de mutation.

#### H-7 — `@react-router/* 7.14.0` — Vulnérabilités élevées
**Fichier :** `package.json`

`npm audit` signale des advisories élevées sur `@react-router/node`, `@react-router/serve`, `@react-router/dev` ≤7.14.1. Un fix est disponible en `7.18.2`.

**Correctif :**
```bash
npm update react-router @react-router/node @react-router/serve @react-router/dev
```

---

### 🟡 MOYEN

#### M-1 — `trustedOrigins` vide si `APP_URL` n'est pas définie
**Fichier :** `app/lib/server/auth.server.ts` (ligne 12)

`APP_URL` est optionnel dans le schéma Zod et absent de `.env.example`. En production sans cette variable, `trustedOrigins: []` — comportement non déterministe de Better Auth.

**Correctif :** Rendre `APP_URL` obligatoire ou fournir un fallback explicite.

#### M-2 — Pas de vérification d'email à l'inscription
**Fichier :** `app/lib/server/auth.server.ts`

`emailVerification` n'est pas activé. Un utilisateur peut s'inscrire avec n'importe quelle adresse email et accéder immédiatement à l'application.

**Correctif :** Activer la vérification email dans Better Auth et bloquer l'accès tant que `emailVerified !== true`.

#### M-3 — `pointsScheme` non validé
**Fichier :** `app/routes/admin.matches.server.ts` (lignes 59, 95)

Le champ `pointsScheme` est accepté sans validation contre les valeurs autorisées (`"standard"`, `"strict"`, `"souple"`).

**Correctif :** `z.enum(["standard", "strict", "souple"])`.

#### M-4 — Champs `type`, `question`, `answer` sans limites dans les micro-pronostics
**Fichier :** `app/routes/api.micro-predictions.ts`

Aucune validation Zod sur les champs de création et de réponse aux micro-pronostics : pas de longueur max, pas d'enum pour `type`.

**Correctif :**
```ts
const createMicroSchema = z.object({
  question: z.string().min(1).max(500),
  type: z.enum(["qcm", "score", "player"]),
  pointsValue: z.coerce.number().int().min(1).max(100),
  deadlineSeconds: z.coerce.number().int().min(10).max(3600),
});
const answerSchema = z.object({
  answer: z.string().min(1).max(200),
});
```

#### M-5 — `highlightUrl` externe rendu directement en `<a href>`
**Fichier :** `app/routes/match-detail.tsx` (ligne ~314)

L'URL de highlight provient d'une API tierce non contrôlée et est rendue directement en lien. Une URL `javascript:` ou de phishing serait cliquable.

**Correctif :** Valider côté serveur avant stockage :
```ts
const isValidHttpUrl = (url: string) => /^https?:\/\//.test(url);
highlightUrl = isValidHttpUrl(raw) ? raw : null;
```

#### M-6 — `seasonParam` non validé contre une liste autorisée
**Fichier :** `app/routes/rankings.server.ts` (lignes 21–26)

Le paramètre de query string `saison` est utilisé directement en DB sans vérification qu'il correspond à une saison existante (SQL injection évitée par Drizzle, mais risque de fuite de données cross-saison).

**Correctif :**
```ts
const validLabels = allSeasons.map(s => s.label);
const seasonLabel = seasonParam && validLabels.includes(seasonParam)
  ? seasonParam : activeSeason.label;
```

#### M-7 — Redis bypass la validation `getEnv()`
**Fichier :** `app/lib/server/redis.server.ts`

La connexion Redis lit `process.env.REDIS_URL` directement sans passer par Zod, avec fallback silencieux vers `redis://localhost:6379`.

**Correctif :** Utiliser `getEnv().REDIS_URL`.

#### M-8 — Mots de passe Docker par défaut `changeme`
**Fichier :** `docker-compose.prod.yml` (lignes 22, 32–34)

```yaml
POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-changeme}
redis-server --requirepass ${REDIS_PASSWORD:-changeme}
```

Si `.env` n'est pas configuré, PostgreSQL et Redis démarrent avec des credentials triviaux.

**Correctif :** Supprimer les valeurs de fallback pour forcer l'erreur au démarrage.

#### M-9 — `members-list` sans pagination
**Fichier :** `app/routes/members-list.server.ts`

La liste des membres récupère tous les utilisateurs sans `LIMIT`. Peut devenir un vecteur de DoS indirect à mesure que la communauté grandit.

**Correctif :** Ajouter `.limit(100)` minimum.

---

### 🔵 FAIBLE

#### L-1 — `as any` sur le rôle dans `feed.server.ts`
**Fichier :** `app/routes/feed.server.ts` (lignes 99, 124, 184, 200)

`(session.user as any).role` désactive le typage TypeScript. Typer correctement le champ via l'extension du type Better Auth.

#### L-2 — Nginx sans HTTPS / TLS
**Fichier :** `docker/nginx/nginx.conf`

Nginx écoute uniquement sur le port 80. Si le NAS Synology ne termine pas TLS en amont, les cookies de session transitent en clair.

**Correctif :** Documenter explicitement que TLS est géré en amont par Synology DSM, ou configurer le certificat dans nginx.

#### L-3 — Pas de `HEALTHCHECK` dans le Dockerfile
**Fichier :** `Dockerfile`

L'image de production n'a pas d'instruction `HEALTHCHECK`. Docker ne peut pas détecter un processus Node bloqué.

**Correctif :**
```dockerfile
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/health || exit 1
```

#### L-4 — Sauvegardes non chiffrées
**Fichier :** `backup.sh`

Les dumps SQL sont stockés non chiffrés dans `/volume1/docker/backups/`. Ils contiennent les hash de mots de passe et toutes les données utilisateurs.

**Correctif :** Chiffrer avec GPG, restreindre les permissions du répertoire (`chmod 700`).

---

## Points positifs constatés

| Domaine | État |
|---------|------|
| Variables d'environnement validées avec Zod | ✅ |
| Schémas Zod sur formulaires (user, match, feed, prediction) | ✅ |
| Authentification requise sur toutes les routes protégées | ✅ |
| Rôle `admin` vérifié sur toutes les actions admin | ✅ |
| Rate limiting sur les routes d'auth (login/register) | ✅ |
| Credentials exclus du repo (commit `aed5841`) | ✅ |
| ORM Drizzle — protection SQL injection | ✅ |
| Logs structurés Pino sans fuite de secrets | ✅ |
| Retraitement avatars via Sharp (mitigation upload malveillant) | ✅ |
| Anti-doublon sur les réponses aux micro-pronostics | ✅ |
| Path traversal uploads corrigé (ce commit) | ✅ |

---

## Synthèse des actions — par priorité

| Priorité | ID | Action | Effort | Statut |
|----------|----|--------|--------|--------|
| 🔴 CRITIQUE | C-1 | Path traversal `uploads-files.ts` | Faible | **CORRIGÉ** |
| 🔴 CRITIQUE | C-2 | Mettre à jour `better-auth` vers version patchée | Moyen | À faire |
| 🟠 ÉLEVÉ | H-1 | En-têtes HTTP sécurité (CSP, HSTS, X-Frame…) | Moyen | À faire |
| 🟠 ÉLEVÉ | H-2 | Utilisateur non-root dans le Dockerfile | Faible | À faire |
| 🟠 ÉLEVÉ | H-3 | Exclure `.env` du `.dockerignore` | Faible | À faire |
| 🟠 ÉLEVÉ | H-4 | Corriger `X-Forwarded-For` dans nginx | Faible | À faire |
| 🟠 ÉLEVÉ | H-5 | Erreurs internes génériques dans `sync-matches` | Faible | À faire |
| 🟠 ÉLEVÉ | H-6 | Rate limiting sur routes de mutation | Moyen | À faire |
| 🟠 ÉLEVÉ | H-7 | Mettre à jour `@react-router/*` vers `7.18.2` | Faible | À faire |
| 🟡 MOYEN | M-1 | `APP_URL` obligatoire ou documenté | Faible | À faire |
| 🟡 MOYEN | M-2 | Activer vérification email à l'inscription | Moyen | À faire |
| 🟡 MOYEN | M-3 | Valider `pointsScheme` (enum Zod) | Faible | À faire |
| 🟡 MOYEN | M-4 | Validation Zod sur micro-pronostics | Faible | À faire |
| 🟡 MOYEN | M-5 | Valider `highlightUrl` avant stockage | Faible | À faire |
| 🟡 MOYEN | M-6 | Valider `seasonParam` contre liste autorisée | Faible | À faire |
| 🟡 MOYEN | M-7 | Redis passer par `getEnv()` | Faible | À faire |
| 🟡 MOYEN | M-8 | Supprimer defaults `changeme` Docker | Faible | À faire |
| 🟡 MOYEN | M-9 | Pagination sur `members-list` | Faible | À faire |
| 🔵 FAIBLE | L-1 | Typer `session.user.role` sans `as any` | Faible | À faire |
| 🔵 FAIBLE | L-2 | Documenter/configurer TLS Nginx | Faible | À faire |
| 🔵 FAIBLE | L-3 | `HEALTHCHECK` dans Dockerfile | Faible | À faire |
| 🔵 FAIBLE | L-4 | Chiffrer les sauvegardes BDD | Moyen | À faire |
