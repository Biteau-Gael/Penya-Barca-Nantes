# Analyse de sécurité — Penya Barca Nantes

**Date :** 31 mai 2026  
**Branches analysées :** `main` / `claude/sharp-fermi-jMqDX`  
**Commits couverts :** `fec3e63` → `003faca` (historique complet)

---

## Résumé des derniers commits

| Hash | Message | Impact sécurité |
|------|---------|-----------------|
| `003faca` | fix: évaluer les badges immédiatement après chaque action | Neutre |
| `b1c88f6` | feat: Phase 2 — soirée match live, micro-pronos, badges, séries, saisons | Nouvelles surfaces d'attaque (voir SEC-01, SEC-05) |
| `d461ee5` | Merge branch deploy-synology-nas | Neutre |
| `554b873` | Add deployment guide for Synology NAS updates | Neutre |
| `68e22d2` | feat: menu burger mobile pour la navigation | Neutre |
| `9823bc5` / `aed5841` | Fix Better Auth trusted origins + security: supprimer credentials du repo | Correctifs sécurité positifs |

---

## Vulnérabilités par ordre de criticité

---

### 🔴 CRITIQUE — SEC-01 : Path Traversal sur le serveur de fichiers

**Fichier :** `app/routes/uploads-files.ts:5`

```ts
const filePath = path.join(process.cwd(), "uploads", params["*"]);
```

**Preuve :**
```
path.join('/app', 'uploads', '../.env')     → /app/.env
path.join('/app', 'uploads', '../../etc/passwd') → /etc/passwd
```

Un utilisateur non authentifié peut lire **n'importe quel fichier** accessible par le processus Node.js en envoyant une requête du type :
```
GET /uploads/../.env
GET /uploads/../../etc/passwd
```

Le paramètre wildcard `*` de React Router n'est pas normalisé avant d'être passé à `path.join`.

**Correction :**
```ts
import path from "node:path";

export async function loader({ params }: { params: { "*": string } }) {
  const UPLOAD_ROOT = path.join(process.cwd(), "uploads");
  const requested = path.resolve(UPLOAD_ROOT, params["*"]);

  // Garantit que le chemin résolu est bien dans uploads/
  if (!requested.startsWith(UPLOAD_ROOT + path.sep)) {
    return new Response("Forbidden", { status: 403 });
  }
  // ... suite inchangée
}
```

---

### 🔴 CRITIQUE — SEC-02 : trustedOrigins vide en l'absence de APP_URL

**Fichier :** `app/lib/server/auth.server.ts:12`

```ts
trustedOrigins: env.APP_URL ? [env.APP_URL] : [],
```

Lorsque `APP_URL` n'est pas défini (cas fréquent en développement et si la variable est omise en production), le tableau est vide. Le comportement de Better Auth avec `trustedOrigins: []` ouvre la voie à des attaques CSRF cross-origin car la librairie peut alors accepter toutes les origines.

**Correction :** définir `APP_URL` comme variable requise dans le schéma Zod (`env.server.ts`) et fournir un fallback explicite :
```ts
APP_URL: z.string().url().default("http://localhost:3000"),
```

---

### 🟠 ÉLEVÉ — SEC-03 : IP spoofable dans le rate-limiter

**Fichier :** `app/routes/api.auth.$.ts:7-10`

```ts
request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
request.headers.get("x-real-ip") ||
"unknown"
```

Sans vérification que la requête provient d'un reverse-proxy de confiance, un attaquant peut envoyer un header `X-Forwarded-For: 1.2.3.4` falsifié et contourner le rate-limiter de connexion (10 tentatives / 15 min par IP).

**Correction :** lire l'IP uniquement si la requête provient d'une IP interne connue (réseau Docker `172.x.x.x`), ou utiliser `request.headers.get("x-real-ip")` en exclusivité si le reverse-proxy est Nginx (et configurer `real_ip_header` côté Nginx).

---

### 🟠 ÉLEVÉ — SEC-04 : Absence d'en-têtes de sécurité HTTP

**Fichier :** `app/root.tsx` + aucun middleware HTTP

Aucun des en-têtes de sécurité standard n'est positionné :

| En-tête | Risque |
|---------|--------|
| `Content-Security-Policy` | XSS via injection de scripts tiers |
| `X-Frame-Options` | Clickjacking |
| `X-Content-Type-Options` | MIME sniffing |
| `Strict-Transport-Security` | Downgrade HTTPS→HTTP |
| `Referrer-Policy` | Fuite d'URL dans les logs tiers |

**Correction :** ajouter un handler global dans `app/root.tsx` (React Router v7 `headers` export) ou via un middleware Express/Hono wrapping l'app :
```ts
export const headers = () => ({
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains",
});
```

---

### 🟠 ÉLEVÉ — SEC-05 : Absence de rate-limiting sur les API actions authentifiées

**Fichiers :** `app/routes/api.micro-predictions.ts`, `app/routes/feed.server.ts`, `app/routes/api.welcome-dismiss.ts`

Le rate-limiter Redis est appliqué uniquement sur `/api/auth/*` (connexion / inscription). Les endpoints d'action post-login (réponses aux micro-pronos, publications, réactions) ne sont pas limités, autorisant du spam ou de l'abus en masse par un compte compromis.

**Correction :** ajouter `checkRateLimit` sur les actions sensibles, ex :
```ts
await checkRateLimit({ key: `post:${session.user.id}`, maxAttempts: 20, windowSeconds: 60 });
```

---

### 🟡 MOYEN — SEC-06 : Validation manquante sur le champ `answer` des micro-pronos

**Fichier :** `app/routes/api.micro-predictions.ts:90-95`

```ts
const answer = formData.get("answer") as string;
if (!microId || !answer) { ... }
```

Le champ `answer` est inséré en base de données sans contrainte de longueur ni de format. Un utilisateur peut envoyer une réponse de plusieurs mégaoctets.

**Correction :**
```ts
if (!answer || answer.length > 200) {
  return Response.json({ error: "Réponse invalide" }, { status: 400 });
}
```

---

### 🟡 MOYEN — SEC-07 : client.ts ne passe pas par la validation d'environnement

**Fichier :** `app/db/client.ts:4`

```ts
connectionString: process.env.DATABASE_URL,
```

`db/client.ts` accède directement à `process.env` sans passer par `getEnv()`. Si `DATABASE_URL` est absent, la connexion échouera silencieusement au runtime plutôt qu'au démarrage avec un message explicite.

Même observation pour `app/lib/server/redis.server.ts:3` (`REDIS_URL` avec fallback non validé).

**Correction :** utiliser `getEnv().DATABASE_URL` et `getEnv().REDIS_URL` pour bénéficier de la validation Zod au boot.

---

### 🟡 MOYEN — SEC-08 : Cache immutable sur les avatars (invalidation impossible)

**Fichier :** `app/routes/uploads-files.ts:16-19`

```ts
"Cache-Control": "public, max-age=31536000, immutable",
```

Les avatars sont servis avec un cache d'un an marqué `immutable`. Comme le nom de fichier est `{userId}.webp` (fixe), changer d'avatar n'invalide pas le cache navigateur/CDN : l'ancienne image reste affichée jusqu'à expiration.

**Correction :** utiliser un paramètre de version dans l'URL (`/uploads/avatars/user123.webp?v=<timestamp>`) ou un nom de fichier avec hash.

---

### 🟢 FAIBLE — SEC-09 : Mots de passe Docker par défaut en production

**Fichier :** `docker-compose.prod.yml:22,29`

```yaml
POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-changeme}
redis-server --requirepass ${REDIS_PASSWORD:-changeme}
```

Si les variables `POSTGRES_PASSWORD` et `REDIS_PASSWORD` ne sont pas définies dans le `.env` de production, les services démarrent avec le mot de passe `changeme`.

**Correction :** retirer le fallback `:-changeme` pour forcer l'échec au démarrage en l'absence de configuration explicite.

---

### 🟢 FAIBLE — SEC-10 : Conteneur Docker tournant en root

**Fichier :** `Dockerfile:16` (stage final)

Aucune instruction `USER` n'est présente dans l'image finale. L'application Node.js s'exécute en tant que `root` dans le conteneur, ce qui amplifie l'impact d'une éventuelle compromission.

**Correction :**
```dockerfile
RUN addgroup -S app && adduser -S app -G app
USER app
CMD ["npm", "run", "start"]
```

---

## Bilan

| Criticité | Nombre | Statuts |
|-----------|--------|---------|
| 🔴 Critique | 2 | SEC-01 (Path Traversal), SEC-02 (CSRF / trusted origins) |
| 🟠 Élevé | 3 | SEC-03 (IP spoofing), SEC-04 (Headers HTTP), SEC-05 (Rate-limit API) |
| 🟡 Moyen | 3 | SEC-06 (Validation answer), SEC-07 (Env validation), SEC-08 (Cache avatar) |
| 🟢 Faible | 2 | SEC-09 (Docker passwords), SEC-10 (Root Docker) |

### Points positifs constatés

- ✅ Variables d'environnement validées par Zod au démarrage (`env.server.ts`)
- ✅ ORM Drizzle avec requêtes paramétrées (protection SQL injection)
- ✅ Rate-limiting Redis sur les endpoints d'authentification
- ✅ Contrôle des rôles (`requireAuth` + vérification `role === "admin"`)
- ✅ Credentials supprimés du dépôt (commit `aed5841`)
- ✅ Upload d'avatars : validation du type MIME et taille max 2 Mo
- ✅ Protection auto-suppression / auto-modification de rôle admin
- ✅ Utilisation de Better Auth (librairie maintenue, CSRF géré par défaut si bien configurée)

### Actions prioritaires recommandées

1. **[Immédiat]** Corriger SEC-01 (path traversal) — exploitable sans authentification
2. **[Immédiat]** Définir `APP_URL` comme variable requise (SEC-02)
3. **[Court terme]** Ajouter les en-têtes HTTP de sécurité (SEC-04)
4. **[Court terme]** Étendre le rate-limiting aux actions authentifiées (SEC-05)
5. **[Moyen terme]** Corriger SEC-03, SEC-06, SEC-07, SEC-08
6. **[Avant mise en prod]** Retirer les mots de passe Docker par défaut (SEC-09) et passer en utilisateur non-root (SEC-10)
