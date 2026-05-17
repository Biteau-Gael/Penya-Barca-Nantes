# Rapport d'audit de sécurité — Penya Blaugrana Nantes

**Date :** 2026-05-17  
**Branche analysée :** `claude/sharp-fermi-FXOxy`  
**Commits analysés :** `003faca` ← `b1c88f6` ← `554b873` ← `68e22d2` (4 derniers commits actifs)

---

## Résumé des derniers commits

| Hash | Date | Description |
|------|------|-------------|
| `003faca` | 2026-04-13 | **fix:** évaluation immédiate des badges après chaque action utilisateur (pronostic, post, commentaire, réaction) |
| `b1c88f6` | 2026-04-13 | **feat:** Phase 2 complète — soirée match live, micro-pronostics, badges (10 de base), séries de scores exacts, gestion des saisons, migration DB 0007 |
| `554b873` | 2026-04-12 | **docs:** guide de déploiement pour mises à jour sur NAS Synology |
| `68e22d2` | 2026-04-13 | **feat:** menu burger mobile pour la navigation responsive |

Le commit `b1c88f6` est le plus substantiel : +2 965 lignes sur 26 fichiers. Il introduit les tables `seasons`, `badges`, `user_badges`, `rewards`, `micro_predictions`, `micro_prediction_answers`, la route `/soiree/:matchId` avec polling live API, et toute la logique de gamification.

---

## Résultats de l'audit de sécurité

### CRITIQUE

---

#### [C-01] Path traversal dans le serveur de fichiers statiques

**Fichier :** `app/routes/uploads-files.ts`, ligne 5  
**Commit d'origine :** antérieur à la branche analysée (feature Upload)

```typescript
const filePath = path.join(process.cwd(), "uploads", params["*"]);
```

`params["*"]` est la valeur brute de l'URL et n'est jamais sanitisée. `path.join` résout les segments `..`, ce qui permet à un attaquant d'accéder à n'importe quel fichier du système de fichiers du conteneur :

```
GET /uploads/../../package.json          → /app/package.json
GET /uploads/../../build/server/index.js → code compilé côté serveur
```

Dans le Dockerfile, `COPY . /app/` copie l'intégralité du dépôt dans l'image. Si un fichier `.env` ou des secrets se trouvent dans l'image, ils seraient lisibles.

**Correction recommandée :**

```typescript
const UPLOADS_ROOT = path.resolve(process.cwd(), "uploads");

export async function loader({ params }: { params: { "*": string } }) {
  const filePath = path.resolve(UPLOADS_ROOT, params["*"]);

  // Rejeter tout chemin qui sort du répertoire uploads
  if (!filePath.startsWith(UPLOADS_ROOT + path.sep)) {
    return new Response("Forbidden", { status: 403 });
  }
  // ... suite inchangée
}
```

---

### ÉLEVÉ

---

#### [H-01] Mots de passe Docker par défaut en production

**Fichier :** `docker-compose.prod.yml`, lignes 22 et 33

```yaml
POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-changeme}
command: redis-server --requirepass ${REDIS_PASSWORD:-changeme}
```

Si les variables d'environnement `POSTGRES_PASSWORD` et `REDIS_PASSWORD` ne sont pas définies dans le fichier `.env` au démarrage, les services se lancent avec le mot de passe `changeme`. Cette valeur est connue et documentée dans le dépôt public.

**Correction recommandée :** Supprimer les valeurs par défaut et forcer la présence des variables :

```yaml
POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?La variable POSTGRES_PASSWORD est requise}
command: redis-server --requirepass ${REDIS_PASSWORD:?La variable REDIS_PASSWORD est requise}
```

---

#### [H-02] Endpoint `/api/health` public exposant l'état des services internes

**Fichier :** `app/routes/api.health.ts`, lignes 11–43

La route de health check est accessible sans authentification et retourne une réponse JSON détaillant l'état de PostgreSQL et Redis :

```json
{ "status": "degraded", "services": { "db": "error", "redis": "ok" } }
```

Ces informations aident un attaquant à identifier les composants vulnérables (base de données injoignable = fenêtre d'attaque, Redis seul actif, etc.).

**Correction recommandée :** Restreindre l'accès par un token secret (header `Authorization: Bearer <HEALTH_TOKEN>`) ou limiter l'endpoint au réseau interne Docker uniquement (pas d'exposition sur le port public).

---

#### [H-03] `trustedOrigins` vide si `APP_URL` est absent

**Fichier :** `app/lib/server/auth.server.ts`, ligne 12

```typescript
trustedOrigins: env.APP_URL ? [env.APP_URL] : [],
```

`APP_URL` est optionnel dans le schéma Zod (`z.string().optional()`). Si cette variable n'est pas définie en production, `trustedOrigins` est un tableau vide. Selon le comportement de Better Auth avec une liste vide, cela peut soit bloquer toutes les origines (rupture de service), soit les accepter toutes (CSRF ouvert).

**Correction recommandée :** Rendre `APP_URL` obligatoire en production, ou définir une valeur par défaut explicite :

```typescript
// env.server.ts
APP_URL: z.string().url().default("http://localhost:3000"),
```

---

#### [H-04] IP client récupérée depuis `X-Forwarded-For` sans validation

**Fichier :** `app/routes/api.auth.$.ts`, lignes 6–11

```typescript
request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || ...
```

L'en-tête `X-Forwarded-For` peut être falsifié par un client si le reverse proxy ne le réécrit pas. Un attaquant peut contourner le rate limiting login/register en changeant cet en-tête à chaque requête.

**Correction recommandée :** S'assurer que le reverse proxy (nginx/Traefik) réécrit systématiquement cet en-tête, ou utiliser `X-Real-IP` fourni exclusivement par le proxy. Documenter l'exigence dans `DEPLOY.md`.

---

### MOYEN

---

#### [M-01] Absence totale de headers de sécurité HTTP

**Fichier :** aucun — non implémenté

L'application ne définit aucun header de sécurité HTTP :

- `Content-Security-Policy` (XSS)
- `X-Frame-Options` (clickjacking)
- `X-Content-Type-Options: nosniff`
- `Strict-Transport-Security` (HSTS)
- `Referrer-Policy`

**Correction recommandée :** Ajouter un middleware dans `app/root.tsx` ou via la configuration du loader racine :

```typescript
// app/root.tsx — dans le loader
export function headers() {
  return {
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Content-Security-Policy": "default-src 'self'; img-src 'self' data:;",
  };
}
```

---

#### [M-02] Dockerfile — conteneur s'exécutant en tant que `root`

**Fichier :** `Dockerfile`, image finale (ligne 17)

L'image finale n'inclut pas d'instruction `USER`. Le processus Node.js tourne donc en tant que `root` dans le conteneur, augmentant la surface d'attaque en cas de fuite de conteneur.

**Correction recommandée :**

```dockerfile
FROM node:20-alpine
# ... COPY et installation ...
USER node
CMD ["npm", "run", "start"]
```

---

#### [M-03] `deadlineSeconds` des micro-pronos non appliqué côté serveur

**Fichier :** `app/routes/api.micro-predictions.ts`, lignes 99–106

La vérification de validité d'un micro-pronostic ne teste que `micro.closedAt` (clôture manuelle par l'admin) mais pas l'expiration automatique basée sur `deadlineSeconds` + `createdAt`. Un joueur peut voter après le délai configuré si l'admin n'a pas clôturé manuellement.

**Correction recommandée :**

```typescript
const deadline = new Date(micro.createdAt.getTime() + micro.deadlineSeconds * 1000);
if (micro.closedAt || new Date() > deadline) {
  return Response.json({ error: "Micro-pronostic fermé" }, { status: 400 });
}
```

---

#### [M-04] Validation du type MIME basée sur `file.type` (contrôlé par le client)

**Fichier :** `app/lib/server/upload.ts`, ligne 13

```typescript
if (!ALLOWED_TYPES.includes(file.type)) {
  throw new Error("Format non supporté.");
}
```

`file.type` provient du navigateur et peut être falsifié (ex: envoyer un fichier SVG avec `Content-Type: image/jpeg`). Le risque est **atténué** par le traitement via `sharp` qui échouera si le buffer n'est pas une image valide, mais un SVG bien formé pourrait potentiellement passer.

**Correction recommandée :** Utiliser `file-type` ou vérifier la signature magique des bytes après lecture du buffer, avant le traitement `sharp`.

---

### FAIBLE

---

#### [F-01] `.gitignore` incomplet — variantes `.env` non couvertes

**Fichier :** `.gitignore`, ligne 2

Seul `.env` est ignoré. Les variantes suivantes ne sont pas couvertes et pourraient être accidentellement committées :

- `.env.local`
- `.env.production`
- `.env.*.local`
- `.env.development`

**Correction recommandée :**

```gitignore
.env
.env.*
!.env.example
```

---

#### [F-02] Erreurs de `evaluateBadges` silencieusement ignorées

**Fichiers :** `app/routes/feed.server.ts` (lignes 136, 157, 178) et `app/routes/match-detail.server.ts`

```typescript
evaluateBadges(session.user.id).catch(() => {});
```

Les erreurs sont avalées sans log. Si la fonction échoue (ex: problème DB transitoire), l'utilisateur ne reçoit jamais son badge et aucune alerte n'est émise.

**Correction recommandée :**

```typescript
evaluateBadges(session.user.id).catch((err) => {
  logger.error({ err, userId: session.user.id }, "Échec évaluation badges");
});
```

---

#### [F-03] Message d'erreur potentiellement verbeux dans `api.sync-matches.ts`

**Fichier :** `app/routes/api.sync-matches.ts`, ligne 22

```typescript
const message = error instanceof Error ? error.message : "Erreur inconnue";
return Response.json({ error: message }, { status: 500 });
```

Le message d'erreur brut de l'exception est renvoyé au client. Des messages comme `"connect ECONNREFUSED 127.0.0.1:5432"` ou des URLs d'API tiers peuvent fuiter des informations sur l'infrastructure.

**Correction recommandée :** Logger l'erreur complète côté serveur et retourner un message générique au client.

---

#### [F-04] Image Docker sans `.env` dans `.dockerignore` — copie implicite possible

**Fichier :** `.dockerignore`

Le fichier `.dockerignore` exclut correctement `node_modules` et `build`, mais n'exclut pas `.env`, `.env.*` ou `backup.sh`. Si un fichier `.env` existe localement lors du `docker build`, il sera copié dans l'image et potentiellement extractible.

**Correction recommandée :**

```dockerignore
.env
.env.*
*.sh
.git
```

---

## Tableau récapitulatif

| ID | Criticité | Fichier(s) | Description |
|----|-----------|-----------|-------------|
| C-01 | **CRITIQUE** | `uploads-files.ts:5` | Path traversal — accès arbitraire aux fichiers du conteneur |
| H-01 | **ÉLEVÉ** | `docker-compose.prod.yml:22,33` | Mots de passe Docker avec fallback `changeme` |
| H-02 | **ÉLEVÉ** | `api.health.ts:11` | Endpoint health check public exposant l'état des services |
| H-03 | **ÉLEVÉ** | `auth.server.ts:12` | `trustedOrigins` vide si `APP_URL` non défini |
| H-04 | **ÉLEVÉ** | `api.auth.$.ts:7` | Header `X-Forwarded-For` falsifiable pour contourner le rate limiting |
| M-01 | **MOYEN** | (global) | Absence de headers de sécurité HTTP (CSP, HSTS, X-Frame-Options) |
| M-02 | **MOYEN** | `Dockerfile:17` | Conteneur Docker s'exécutant en tant que `root` |
| M-03 | **MOYEN** | `api.micro-predictions.ts:99` | Deadline micro-pronos non vérifiée côté serveur |
| M-04 | **MOYEN** | `upload.ts:13` | Validation MIME basée sur `file.type` client (atténuée par `sharp`) |
| F-01 | **FAIBLE** | `.gitignore:2` | Variantes `.env.*` non ignorées |
| F-02 | **FAIBLE** | `feed.server.ts:136` | Erreurs `evaluateBadges` silencieuses (pas de log) |
| F-03 | **FAIBLE** | `api.sync-matches.ts:22` | Messages d'erreur bruts exposés au client admin |
| F-04 | **FAIBLE** | `.dockerignore` | `.env` et scripts `.sh` non exclus du build Docker |

---

## Points positifs identifiés

- **ORM paramétré (Drizzle)** — aucune injection SQL possible, toutes les requêtes utilisent l'ORM.
- **Rate limiting sur login/register** — implémenté via Redis (`api.auth.$.ts`), fonctionnel.
- **Vérification de rôle cohérente** — `requireAuth(request, ["admin"])` est appliqué sur toutes les routes admin.
- **Secrets gérés par variables d'environnement** — aucun secret hardcodé trouvé dans le code source.
- **Stack trace non exposée en production** — `ErrorBoundary` conditionne l'affichage à `import.meta.env.DEV`.
- **Upload sécurisé** — taille limitée à 2 Mo, reconversion systématique en WebP 256×256 via `sharp`, nom de fichier basé sur `userId` (pas d'input utilisateur).
- **Protection auto-suppression admin** — un admin ne peut pas modifier/supprimer son propre compte.
- **Validation Zod** sur toutes les entrées formulaire (matches, profil, feed, auth).

---

*Document généré automatiquement lors de l'audit du 2026-05-17.*
