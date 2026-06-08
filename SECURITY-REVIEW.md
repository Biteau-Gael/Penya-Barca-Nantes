# Analyse de Sécurité — Penya Barca Nantes

> **Date** : 2026-06-08  
> **Branche analysée** : `main` (commit `003faca`)  
> **Scope** : Application React Router + Node.js, PostgreSQL, Redis, Docker  

---

## Résumé des derniers commits

| Hash | Message | Impact sécurité |
|------|---------|----------------|
| `003faca` | fix: évaluer les badges immédiatement après chaque action | Aucun |
| `b1c88f6` | feat: Phase 2 — soirée match live, micro-pronos, badges, séries, saisons | Nouveaux endpoints à auditer |
| `d461ee5` | Merge branch deploy-synology-nas | Aucun |
| `554b873` | Add deployment guide for Synology NAS updates | Aucun |
| `68e22d2` | feat: menu burger mobile pour la navigation | Aucun |
| `6aebaf7` | Fix Better Auth trusted origins for custom domain support | Positif (restriction des origines) |
| `9823bc5` | Add migrate service to docker-compose.prod.yml | Aucun |
| `8d6e5e9` | Add production Docker Compose and backup script for Synology NAS | Voir §Docker |
| `aed5841` | **security: supprimer credentials du repo et renforcer .gitignore** | Positif (remédiation critique) |
| `ab7fc5d` | feat: intégration API Football + stats enrichies + classement Liga | Clé API tier exposée |
| `16c43e6` | feat: MVP Phase 1 — Penya Blaugrana Nantes | Base du projet |

---

## Résultats par ordre de criticité

---

### 🔴 CRITIQUE — Path Traversal sur le serveur de fichiers statiques

**Fichier** : `app/routes/uploads-files.ts:5`

```ts
const filePath = path.join(process.cwd(), "uploads", params["*"]);
```

Le paramètre wildcard `params["*"]` est passé directement à `path.join` **sans aucune sanitisation**. Une requête vers `/uploads/../.env` ou `/uploads/../../etc/passwd` permet de lire des fichiers arbitraires sur le serveur.

**Remédiation** :

```ts
import path from "node:path";

const UPLOAD_ROOT = path.resolve(process.cwd(), "uploads");

export async function loader({ params }: { params: { "*": string } }) {
  const requested = path.resolve(UPLOAD_ROOT, params["*"]);
  // Bloquer toute sortie du dossier autorisé
  if (!requested.startsWith(UPLOAD_ROOT + path.sep)) {
    return new Response("Forbidden", { status: 403 });
  }
  // ... suite inchangée
}
```

---

### 🟠 ÉLEVÉ — Absence totale de Security Headers HTTP

**Fichier** : aucun middleware n'ajoute de headers de sécurité dans `app/root.tsx` ni ailleurs.

Les headers suivants sont absents :
- `Content-Security-Policy` (XSS)
- `X-Frame-Options` (clickjacking)
- `X-Content-Type-Options` (MIME sniffing)
- `Strict-Transport-Security` (downgrade HTTPS)
- `Referrer-Policy`

**Remédiation** — Ajouter un middleware dans `entry.server.ts` (ou via React Router's `headers` export) :

```ts
// app/entry.server.ts — dans handleRequest
const responseHeaders = new Headers(responseHeadersInit);
responseHeaders.set("X-Content-Type-Options", "nosniff");
responseHeaders.set("X-Frame-Options", "DENY");
responseHeaders.set("Referrer-Policy", "strict-origin-when-cross-origin");
responseHeaders.set(
  "Content-Security-Policy",
  "default-src 'self'; img-src 'self' https://images.fotmob.com data:; script-src 'self'; style-src 'self' 'unsafe-inline';"
);
if (process.env.NODE_ENV === "production") {
  responseHeaders.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
}
```

---

### 🟠 ÉLEVÉ — IP source spoofable dans le rate limiting

**Fichier** : `app/routes/api.auth.$.ts:6-10`

```ts
function getClientIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}
```

Si le reverse proxy Synology ne **force pas** l'écriture du header `X-Forwarded-For`, un attaquant peut le falsifier en envoyant une valeur arbitraire, contournant ainsi le rate limiting par IP. Avec `"unknown"` comme fallback unique, toutes les requêtes sans IP partagent le même compteur.

**Remédiation** : Documenter et s'assurer que le reverse proxy Synology est configuré pour écraser (et non ajouter) le header `X-Forwarded-For`. Alternative : ajouter `TRUSTED_PROXY_IPS` dans l'env et ne lire `x-forwarded-for` que si la connexion provient d'un proxy de confiance.

---

### 🟡 MOYEN — Validation MIME incomplète pour les uploads d'avatars

**Fichier** : `app/lib/server/upload.ts:13`

```ts
if (!ALLOWED_TYPES.includes(file.type)) {
  throw new Error("Format non supporté. Utilisez JPEG, PNG ou WebP.");
}
```

`file.type` est la valeur `Content-Type` **déclarée par le client** — elle peut être falsifiée. Un fichier malveillant (ex. SVG avec `<script>`, WebShell PHP renommé) peut contourner cette vérification.

**Remédiation** : Vérifier les magic bytes du fichier via `sharp` (qui lève une erreur si le format est invalide) en plaçant l'appel `sharp(buffer).metadata()` avant tout traitement. Le traitement via `sharp().webp()` atténue déjà le risque pour les exécutables, mais pas pour les SVG ou les ZIP polyglots.

```ts
// Vérifier le format réel avant toute autre opération
try {
  const metadata = await sharp(buffer).metadata();
  if (!["jpeg", "png", "webp"].includes(metadata.format ?? "")) {
    throw new Error("Format de fichier non reconnu.");
  }
} catch {
  throw new Error("Format non supporté. Utilisez JPEG, PNG ou WebP.");
}
```

---

### 🟡 MOYEN — Mots de passe Docker avec fallback `changeme`

**Fichier** : `docker-compose.prod.yml:22,32`

```yaml
POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-changeme}
command: redis-server --requirepass ${REDIS_PASSWORD:-changeme}
```

Si le fichier `.env` est absent ou incomplet en production, les services démarrent avec le mot de passe `changeme`, potentiellement exposé si les ports sont accessibles depuis le réseau local Synology.

**Remédiation** : Supprimer les valeurs par défaut pour forcer l'échec explicite :

```yaml
POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?POSTGRES_PASSWORD doit être défini}
command: redis-server --requirepass ${REDIS_PASSWORD:?REDIS_PASSWORD doit être défini}
```

---

### 🟡 MOYEN — Cast `as any` sur la vérification de rôle

**Fichiers** : `app/routes/feed.server.ts:99,124` et `app/lib/server/auth-utils.server.ts:19`

```ts
const isAdmin = (session.user as any).role === "admin";
// et
if (allowedRoles && !allowedRoles.includes(session.user.role as Role)) {
```

Le cast `as any` contourne le système de types et masque toute évolution du schéma. Le champ `role` est défini comme `additionalFields` dans Better Auth mais n'est pas typé explicitement dans `Session`. Si le champ venait à changer de nom, la vérification échouerait silencieusement (retournant toujours `false`).

**Remédiation** : Étendre le type `Session` pour inclure les champs additionnels :

```ts
// app/lib/server/auth.server.ts — après l'export
export type AppUser = typeof auth.$Infer.Session.user & {
  role: "member" | "admin" | "partner";
  pseudo?: string;
  avatarUrl?: string;
};
```

---

### 🟡 MOYEN — Rate limiting par IP uniquement (login)

**Fichier** : `app/routes/api.auth.$.ts:20`

```ts
const key = isSignIn ? `login:${ip}` : `register:${ip}`;
const maxAttempts = isSignIn ? 10 : 5;
```

Le rate limiting est par IP mais pas par identifiant (email). Un attaquant avec un réseau distribué (botnets, proxys) peut tenter de nombreux mots de passe sur un compte cible sans déclencher la limite.

**Remédiation** : Ajouter un second compteur par email :

```ts
const emailKey = `login-email:${body.email}`;
await checkRateLimit({ key: emailKey, maxAttempts: 20, windowSeconds: 3600 });
```

---

### 🔵 FAIBLE — Validation manquante sur le champ `answer` des micro-pronos

**Fichier** : `app/routes/api.micro-predictions.ts:92-93`

```ts
const answer = formData.get("answer") as string;
if (!microId || !answer) { ... }
```

Le champ `answer` n'est soumis à aucune limite de taille avant insertion en base de données. Une valeur arbitrairement longue peut provoquer une erreur PostgreSQL ou un comportement inattendu.

**Remédiation** : Ajouter une validation Zod :

```ts
import { z } from "zod";
const answerSchema = z.string().min(1).max(200);
const parsed = answerSchema.safeParse(answer);
if (!parsed.success) return Response.json({ error: "Réponse invalide" }, { status: 400 });
```

---

### 🔴 CRITIQUE — Conteneur Docker exécuté en tant que root

**Fichier** : `Dockerfile:17-22`

```dockerfile
FROM node:20-alpine
...
CMD ["npm", "run", "start"]
```

L'image finale s'exécute sans instruction `USER`, donc en tant que **root** dans le conteneur. En cas d'exploitation d'une vulnérabilité applicative (RCE), l'attaquant dispose de tous les privilèges dans le conteneur.

**Remédiation** :

```dockerfile
FROM node:20-alpine
COPY ./package.json package-lock.json /app/
COPY --from=production-dependencies-env /app/node_modules /app/node_modules
COPY --from=build-env /app/build /app/build
WORKDIR /app
# Réduire les privilèges
RUN addgroup -S penya && adduser -S penya -G penya && chown -R penya:penya /app
USER penya
CMD ["npm", "run", "start"]
```

---

### 🟠 ÉLEVÉ — CSRF possible si APP_URL non définie

**Fichier** : `app/lib/server/auth.server.ts:12`

```ts
trustedOrigins: env.APP_URL ? [env.APP_URL] : [],
```

Si `APP_URL` n'est pas définie en production, `trustedOrigins` est un tableau vide. Le comportement de Better Auth avec une liste vide doit être vérifié : s'il accepte toutes les origines par défaut, cela ouvre la porte à des attaques CSRF cross-domain.

De plus, `APP_URL` est définie comme `z.string().optional()` sans validation de format URL.

**Remédiation** :

```ts
// app/config/env.server.ts
APP_URL: z.string().url("APP_URL doit être une URL valide").optional(),

// app/lib/server/auth.server.ts
trustedOrigins: env.APP_URL
  ? [env.APP_URL]
  : env.NODE_ENV === "development"
    ? ["http://localhost:3000"]
    : (() => { throw new Error("APP_URL requis en production"); })(),
```

---

### 🟠 ÉLEVÉ — JSON.parse sans try-catch (crash serveur possible)

Trois emplacements lisent du JSON depuis la base de données sans gestion d'erreur :

| Fichier | Ligne | Valeur parsée |
|---------|-------|---------------|
| `app/lib/server/badges.server.ts` | ~172 | `badge.condition` |
| `app/routes/soiree.server.ts` | ~250 | `m.options` (micro-pronos) |
| `app/routes/match-detail.server.ts` | ~83 | `match.matchDetails` |

Si une valeur en base est corrompue ou malformée, le serveur crashe avec une exception non capturée, rendant la page inaccessible.

**Remédiation** : Wrapper chaque appel avec try-catch ou un helper :

```ts
function safeJsonParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try { return JSON.parse(raw) as T; }
  catch { return fallback; }
}

// Usage :
const condition = safeJsonParse(badge.condition, { type: "", threshold: 0 });
```

---

### 🟠 ÉLEVÉ — `parseInt` retournant `NaN` dans les micro-pronos

**Fichier** : `app/routes/api.micro-predictions.ts:23-24`

```ts
const pointsValue = parseInt(formData.get("pointsValue") as string) || 1;
const deadlineSeconds = parseInt(formData.get("deadlineSeconds") as string) || 120;
```

`parseInt("abc")` retourne `NaN`, et `NaN || 1` retourne bien `1` — **mais** `parseInt("")` retourne aussi `NaN` donc le fallback fonctionne. Cependant, des valeurs comme `-999` ou `999999` passent sans validation, permettant des délais négatifs ou des points arbitraires.

**Remédiation** :

```ts
const pointsValueRaw = parseInt(formData.get("pointsValue") as string);
const pointsValue = Number.isFinite(pointsValueRaw) && pointsValueRaw > 0 ? pointsValueRaw : 1;

const deadlineSecondsRaw = parseInt(formData.get("deadlineSeconds") as string);
const deadlineSeconds = Number.isFinite(deadlineSecondsRaw) && deadlineSecondsRaw > 0 ? deadlineSecondsRaw : 120;
```

---

### 🔵 FAIBLE — Image Docker non épinglée (supply chain)

**Fichier** : `Dockerfile:1,6,11,17`

```dockerfile
FROM node:20-alpine
```

L'image `node:20-alpine` sans digest SHA256 peut être remplacée si le registre est compromis ou si une mise à jour introduit une régression.

**Remédiation** : Épingler avec le digest (à vérifier et mettre à jour régulièrement) :

```dockerfile
FROM node:20-alpine@sha256:<digest>
```

---

### 🔵 FAIBLE — Email utilisateur exposé dans l'API admin

**Fichier** : `app/routes/admin.members.server.ts:20`

```ts
email: user.email,
```

Les emails sont retournés dans la réponse JSON du loader admin. Bien que la route soit protégée par `requireAuth(request, ["admin"])`, toute faille future sur le contrôle d'accès exposerait les emails de tous les membres.

**Recommandation** : S'assurer que l'interface admin n'affiche les emails que si fonctionnellement nécessaire. Envisager un masquage côté client (`g.b***@example.com`) pour les vues de liste.

---

## Points positifs constatés

| Domaine | Observation |
|---------|-------------|
| Injections SQL | Drizzle ORM utilisé exclusivement — aucune requête SQL brute |
| Validation entrées | Schémas Zod sur tous les formulaires principaux (`feed`, `user`, `prediction`) |
| Authentification | `requireAuth()` centralisé appelé systématiquement dans tous les loaders/actions protégés |
| Contrôle d'accès | Vérification de rôle (`admin`) systématique sur les routes `/admin/*` et `api.sync-matches` |
| Rate limiting | Limite sur login (10/15min) et inscription (5/h) par IP via Redis |
| Secrets | `.env` dans `.gitignore`, aucun secret dans le code source (commit `aed5841`) |
| Sessions | Stockage sécurisé via Redis avec TTL (Better Auth) |
| Mots de passe | Politique forte exigée à l'inscription (8 car, maj+min+chiffre) |
| Protection admin | Un admin ne peut pas modifier/supprimer son propre compte (protection anti-lockout) |
| Logs | Pino avec niveau configurable, aucune donnée sensible loggée |
| Uploads | Retraitement via `sharp` en WebP 256×256 (neutralise la plupart des exploits d'images) |

---

## Plan de remédiation recommandé

| Priorité | Criticité | Action | Effort estimé |
|----------|-----------|--------|---------------|
| 1 | 🔴 CRITIQUE | Corriger le path traversal dans `uploads-files.ts` | ~30 min |
| 2 | 🔴 CRITIQUE | Ajouter `USER node` dans le Dockerfile final | ~15 min |
| 3 | 🟠 ÉLEVÉ | Ajouter les security headers HTTP (CSP, X-Frame-Options, HSTS…) | ~1h |
| 4 | 🟠 ÉLEVÉ | Sécuriser `trustedOrigins` si `APP_URL` non défini + valider format URL | ~30 min |
| 5 | 🟠 ÉLEVÉ | Wrapper les `JSON.parse` avec try-catch (3 emplacements) | ~30 min |
| 6 | 🟠 ÉLEVÉ | Vérifier la config du reverse proxy Synology pour `X-Forwarded-For` | ~30 min |
| 7 | 🟡 MOYEN | Remplacer les fallbacks `changeme` dans `docker-compose.prod.yml` | ~15 min |
| 8 | 🟡 MOYEN | Valider les plages des `parseInt` dans les micro-pronos | ~20 min |
| 9 | 🟡 MOYEN | Valider les magic bytes des uploads avec `sharp.metadata()` | ~30 min |
| 10 | 🟡 MOYEN | Typer explicitement le champ `role` dans `Session` | ~1h |
| 11 | 🔵 FAIBLE | Ajouter validation taille sur `answer` micro-pronos | ~15 min |
| 12 | 🔵 FAIBLE | Épingler l'image Docker avec un SHA256 | ~15 min |
