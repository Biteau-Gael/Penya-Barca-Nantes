# Audit de sécurité — Penya Blaugrana Nantes

**Date :** 06 juin 2026  
**Périmètre :** Commits `4da20f3` → `003faca` (intégralité du projet)  
**Branche analysée :** `claude/sharp-fermi-q1BcI`

---

## Résumé des derniers commits

| Hash | Message | Impact sécurité |
|------|---------|----------------|
| `003faca` | fix: évaluer les badges immédiatement après chaque action | Faible |
| `b1c88f6` | feat: Phase 2 — soirée match live, micro-pronos, badges, séries, saisons | Moyen (nouvelles routes API) |
| `d461ee5` | Merge branch deploy-synology-nas | Faible |
| `554b873` | Add deployment guide for Synology NAS | Faible |
| `68e22d2` | feat: menu burger mobile pour la navigation | Aucun |
| `6aebaf7` | Fix Better Auth trusted origins for custom domain support | Positif |
| `9823bc5` | Add migrate service to docker-compose.prod.yml | Faible |
| `8d6e5e9` | Add production Docker Compose and backup script for Synology NAS | Moyen (config prod) |
| `aed5841` | security: supprimer credentials du repo et renforcer .gitignore | Positif |
| `ab7fc5d` | feat: intégration API Football + stats enrichies + classement Liga | Faible |

---

## Analyse de sécurité par ordre de criticité

---

### CRITIQUE

#### SEC-01 — Path Traversal dans le service de fichiers statiques
**Fichier :** `app/routes/uploads-files.ts:5`  
**Gravité :** Critique  
**OWASP :** A01 Broken Access Control / Path Traversal

**Description :**  
Le paramètre wildcard `params["*"]` est concaténé avec `path.join` sans vérification que le chemin résolu reste dans le répertoire `uploads/`.

```ts
// Vulnérable — un attaquant peut requêter /uploads/../../../etc/passwd
const filePath = path.join(process.cwd(), "uploads", params["*"]);
```

`path.join` résout les segments `..` : un paramètre comme `../../../etc/passwd` produit un chemin hors du répertoire `uploads`.

**Correction recommandée :**
```ts
const UPLOAD_BASE = path.join(process.cwd(), "uploads");
const filePath = path.join(UPLOAD_BASE, params["*"]);

// Vérifier que le chemin résolu est bien dans uploads/
if (!filePath.startsWith(UPLOAD_BASE + path.sep)) {
  return new Response("Forbidden", { status: 403 });
}
```

---

### HAUTE

#### SEC-02 — Race condition dans le rate limiter Redis
**Fichier :** `app/lib/server/rate-limit.server.ts:15-18`  
**Gravité :** Haute  
**OWASP :** A04 Insecure Design

**Description :**  
Les opérations `INCR` et `EXPIRE` sont deux commandes Redis distinctes et non atomiques. Si le processus crashe entre les deux, la clé ne reçoit jamais de TTL et bloque définitivement l'utilisateur. Lors de pics de charge, deux requêtes simultanées peuvent toutes deux obtenir `current === 1` et chacune poser une TTL en double.

```ts
const current = await redis.incr(redisKey);   // commande 1
if (current === 1) {
  await redis.expire(redisKey, windowSeconds); // commande 2 — non atomique
}
```

**Correction recommandée :**  
Utiliser une pipeline Redis ou la commande `SET ... EX ... NX` avec un script Lua :

```ts
const pipeline = redis.pipeline();
pipeline.incr(redisKey);
pipeline.expire(redisKey, windowSeconds);
const [incrResult] = await pipeline.exec();
const current = (incrResult as [Error | null, number])[1];
```

---

#### SEC-03 — Endpoint `/api/health` public — divulgation d'informations
**Fichier :** `app/routes/api.health.ts`  
**Gravité :** Haute  
**OWASP :** A05 Security Misconfiguration

**Description :**  
Le healthcheck est accessible sans authentification et révèle l'état de l'infrastructure (PostgreSQL, Redis, timestamp). Ces informations facilitent la reconnaissance pour un attaquant.

```json
{
  "status": "degraded",
  "services": { "db": "error", "redis": "ok" },
  "timestamp": "2026-06-06T12:34:56.000Z"
}
```

**Correction recommandée :**  
Restreindre l'accès à un secret de monitoring ou retourner uniquement le statut HTTP (200/503) sans corps JSON détaillé en production :

```ts
if (env.NODE_ENV === "production") {
  return new Response(null, { status: allHealthy ? 200 : 503 });
}
```

---

#### SEC-04 — Absence de rate limiting sur `/api/micro-predictions`
**Fichier :** `app/routes/api.micro-predictions.ts`  
**Gravité :** Haute  
**OWASP :** A04 Insecure Design

**Description :**  
La route de soumission de réponses aux micro-pronostics (`intent === "answer"`) ne dispose d'aucun rate limiting. Un utilisateur authentifié peut scripter des requêtes en masse. Bien que la logique de déduplication existe (vérification `existing`), l'absence de limite expose Redis et PostgreSQL à des requêtes inutilement répétées.

**Correction recommandée :**
```ts
await checkRateLimit({
  key: `micro-answer:${session.user.id}`,
  maxAttempts: 20,
  windowSeconds: 60,
});
```

---

### MOYENNE

#### SEC-05 — Contournement du typage TypeScript pour les vérifications de rôle
**Fichier :** `app/routes/feed.server.ts:99, 124, 184, 200`  
**Gravité :** Moyenne  
**OWASP :** A01 Broken Access Control

**Description :**  
Le rôle de l'utilisateur est accédé via `(session.user as any).role` à quatre reprises pour des vérifications d'autorisation critiques. Ce contournement du typage TypeScript supprime les garanties de compilation. Si la structure de `session.user` change, ces vérifications échouent silencieusement sans erreur.

```ts
// Anti-pattern — perte des garanties TypeScript
if (isAnnouncement && (session.user as any).role !== "admin") { ... }
const isAdmin = (session.user as any).role === "admin";
```

**Correction recommandée :**  
Utiliser `requireAuth` avec le paramètre `allowedRoles` qui est déjà typé correctement, ou passer par la fonction `getSession` avec un type guard :

```ts
const session = await requireAuth(request, ["admin"]);
// session.user.role est maintenant typé
```

---

#### SEC-06 — Mots de passe de fallback en production Docker
**Fichier :** `docker-compose.prod.yml:17, 23`  
**Gravité :** Moyenne  
**OWASP :** A07 Identification and Authentication Failures

**Description :**  
Les valeurs de fallback `changeme` sont dangereux si le fichier `.env` est absent ou mal configuré en production.

```yaml
POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-changeme}
redis-server --requirepass ${REDIS_PASSWORD:-changeme}
```

**Correction recommandée :**  
Supprimer le fallback pour forcer l'échec explicite plutôt qu'un déploiement avec des credentials triviaux :

```yaml
POSTGRES_PASSWORD=${POSTGRES_PASSWORD:?Variable POSTGRES_PASSWORD requise}
```

---

#### SEC-07 — Validation manquante du champ `type` et longueur de `answer` dans micro-predictions
**Fichier :** `app/routes/api.micro-predictions.ts:22-23, 80`  
**Gravité :** Moyenne  
**OWASP :** A03 Injection

**Description :**  
Le champ `type` du micro-pronostic (ex: `"qcm"`) est pris du formulaire sans validation d'enum côté serveur. Le champ `answer` n'a pas de validation de longueur maximale avant insertion en base de données.

```ts
// type non validé contre un enum
const type = (formData.get("type") as string) || "qcm";

// answer sans limite de longueur
const answer = formData.get("answer") as string;
```

**Correction recommandée :**
```ts
const VALID_TYPES = ["qcm", "open"] as const;
if (!VALID_TYPES.includes(type as typeof VALID_TYPES[number])) {
  return Response.json({ error: "Type invalide" }, { status: 400 });
}
// Pour answer :
if (!answer || answer.length > 200) {
  return Response.json({ error: "Réponse invalide" }, { status: 400 });
}
```

---

#### SEC-08 — Parsing `any` des réponses API externe dans `soiree.server.ts`
**Fichier :** `app/routes/soiree.server.ts:93`  
**Gravité :** Moyenne  
**OWASP :** A08 Software and Data Integrity Failures

**Description :**  
Les données de l'API externe (RapidAPI) sont parsées avec le type `any` sans validation de schéma. Si l'API retourne des données malformées ou change de structure, les données transitent vers la base ou l'interface sans contrôle.

```ts
return res.value.json().then((data: any) => {
```

**Correction recommandée :**  
Définir une interface TypeScript stricte pour la réponse et valider les champs critiques avant utilisation, comme c'est déjà fait dans `api-football.server.ts` avec les interfaces `ApiMatch`, `ApiLineupResponse`, etc.

---

### FAIBLE

#### SEC-09 — Absence d'en-têtes de sécurité HTTP
**Fichier :** Configuration globale (aucun fichier dédié)  
**Gravité :** Faible  
**OWASP :** A05 Security Misconfiguration

**Description :**  
Aucun en-tête de sécurité HTTP n'est configuré : pas de `Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`. Ces en-têtes réduisent la surface d'attaque XSS et clickjacking.

**Correction recommandée :**  
Ajouter dans `app/root.tsx` via le `loader` ou dans la configuration Vite/React Router un middleware qui pose ces en-têtes :

```ts
// app/root.tsx — dans le loader
headers: {
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
}
```

---

#### SEC-10 — Conteneur Docker s'exécutant en tant que root
**Fichier :** `Dockerfile`  
**Gravité :** Faible  
**OWASP :** A05 Security Misconfiguration

**Description :**  
Le Dockerfile ne définit pas d'utilisateur non-root pour le stage final. Le processus Node.js s'exécute en tant que `root` dans le conteneur, amplifiant l'impact d'une compromission potentielle.

**Correction recommandée :**
```dockerfile
FROM node:20-alpine
# ... (copies et install)
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser
CMD ["npm", "run", "start"]
```

---

## Points positifs identifiés

- **Drizzle ORM** utilisé systématiquement : pas de requêtes SQL brutes, injection SQL impossible.
- **Better Auth** avec `trustedOrigins` configuré : protection CSRF native.
- **Validation Zod** sur les variables d'environnement (`env.server.ts`) : pas de démarrage silencieux avec des configs incomplètes.
- **Validation côté serveur** avec Zod sur les formulaires critiques (création de match, profil, pronostics).
- **Rate limiting** en place sur l'authentification (`api.auth.$.ts`).
- **Contrôle de rôle** systématique sur toutes les routes admin (`requireAuth(request, ["admin"])`).
- **Logs structurés** (pino) sur toutes les actions sensibles avec contexte utilisateur.
- **Traitement d'image** via sharp avec redimensionnement et conversion WebP avant stockage.
- **`.gitignore` renforcé** (commit `aed5841`) — `.env` et uploads exclus du repo.
- **Secrets via variables d'environnement** uniquement, aucun secret hardcodé trouvé dans le code.

---

## Tableau récapitulatif

| ID | Titre | Criticité | Fichier |
|----|-------|-----------|---------|
| SEC-01 | Path Traversal uploads | **CRITIQUE** | `uploads-files.ts:5` |
| SEC-02 | Race condition rate limiter | **HAUTE** | `rate-limit.server.ts:15` |
| SEC-03 | Health endpoint public | **HAUTE** | `api.health.ts` |
| SEC-04 | Pas de rate limit micro-predictions | **HAUTE** | `api.micro-predictions.ts` |
| SEC-05 | `as any` pour vérification de rôle | **MOYENNE** | `feed.server.ts:99,124,184,200` |
| SEC-06 | Mots de passe fallback Docker | **MOYENNE** | `docker-compose.prod.yml:17,23` |
| SEC-07 | Validation `type`/`answer` absente | **MOYENNE** | `api.micro-predictions.ts:22,80` |
| SEC-08 | Parsing `any` API externe | **MOYENNE** | `soiree.server.ts:93` |
| SEC-09 | Pas d'en-têtes sécurité HTTP | **FAIBLE** | Config globale |
| SEC-10 | Docker run as root | **FAIBLE** | `Dockerfile` |
