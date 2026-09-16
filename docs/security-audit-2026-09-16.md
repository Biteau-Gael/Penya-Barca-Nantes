# Audit de sécurité — Penya Blaugrana Nantes
**Date :** 16 septembre 2026  
**Branche analysée :** `main` (dernier commit : `003faca`)  
**Scope :** Revue statique du code + analyse des derniers commits  

---

## Résumé des derniers commits

| Commit | Message | Impact sécurité |
|--------|---------|-----------------|
| `003faca` | fix: évaluer les badges immédiatement après chaque action | Aucun |
| `b1c88f6` | feat: Phase 2 — soirée match live, micro-pronos, badges, séries, saisons | Nouvelles surfaces d'attaque (voir ci-dessous) |
| `d461ee5` | Merge: deploy-synology-nas | Aucun |
| `554b873` | Add deployment guide for Synology NAS updates | Documentation uniquement |
| `68e22d2` | feat: menu burger mobile | Aucun |
| `6aebaf7` | Fix Better Auth trusted origins | Correctif partiel CSRF |
| `9823bc5` | Add migrate service docker-compose.prod | Configuration infra |
| `8d6e5e9` | Add production Docker Compose and backup script | Secrets en valeur par défaut (voir ci-dessous) |
| `aed5841` | **security: supprimer credentials du repo** | Correctif critique appliqué |
| `ab7fc5d` | feat: intégration API Football + stats enrichies | Clé API exposée en variable d'env ✓ |
| `16c43e6` | feat: MVP Phase 1 | Fondation de l'application |

---

## Résultats de l'audit par ordre de criticité

---

### 🔴 CRITIQUE — Path Traversal sur le service de fichiers

**Fichier :** `app/routes/uploads-files.ts`  
**Ligne :** 5

**Code vulnérable :**
```ts
const filePath = path.join(process.cwd(), "uploads", params["*"]);
```

**Problème :** Le paramètre `params["*"]` (ex. : `../../etc/passwd`) est directement concaténé au chemin sans vérification que le chemin résultant reste dans le répertoire `uploads/`. `path.join` résout les séquences `..` mais n'empêche pas la sortie du répertoire cible.

**Vérification :**
```js
path.join('/app/uploads', '../../../etc/passwd') // → /etc/passwd
// résultat: hors du répertoire uploads !
```

**Impact :** Lecture de fichiers arbitraires sur le serveur (fichiers de configuration, `.env`, clés privées, etc.).

**Correctif recommandé :**
```ts
export async function loader({ params }: { params: { "*": string } }) {
  const uploadsDir = path.resolve(process.cwd(), "uploads");
  const filePath = path.resolve(uploadsDir, params["*"]);

  // Vérification que le chemin reste dans uploads/
  if (!filePath.startsWith(uploadsDir + path.sep)) {
    return new Response("Forbidden", { status: 403 });
  }
  // ...suite du handler
}
```

---

### 🔴 CRITIQUE — Mots de passe par défaut en production Docker

**Fichier :** `docker-compose.prod.yml`  
**Lignes :** 19, 27

**Code vulnérable :**
```yaml
POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-changeme}
redis-server --requirepass ${REDIS_PASSWORD:-changeme}
```

**Problème :** Si les variables `POSTGRES_PASSWORD` et `REDIS_PASSWORD` ne sont pas définies dans le fichier `.env` de production, Docker utilisera le mot de passe `changeme` pour PostgreSQL et Redis. Une erreur de déploiement peut exposer les bases de données avec un mot de passe trivial.

**Impact :** Compromission complète de la base de données et du cache de sessions Redis.

**Correctif recommandé :** Retirer les valeurs par défaut pour forcer une erreur explicite si les variables ne sont pas définies :
```yaml
POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?POSTGRES_PASSWORD doit être défini}
```
Et documenter cette exigence dans la checklist de déploiement.

---

### 🟠 ÉLEVÉ — Endpoint health sans authentification (information disclosure)

**Fichier :** `app/routes/api.health.ts`

**Problème :** L'endpoint `/api/health` est accessible sans authentification et expose l'état des services internes (PostgreSQL, Redis) ainsi que des timestamps. Ces informations sont précieuses pour un attaquant qui souhaite cartographier l'infrastructure.

**Réponse exposée :**
```json
{
  "status": "ok",
  "services": { "app": "ok", "db": "ok", "redis": "ok" },
  "timestamp": "2026-09-16T..."
}
```

**Correctif recommandé :** Restreindre cet endpoint à des requêtes internes (par IP source) ou protéger par un token secret, ou ne retourner qu'un statut HTTP sans détail de service.

---

### 🟠 ÉLEVÉ — Absence de headers de sécurité HTTP

**Fichier :** Aucun fichier de configuration de headers détecté

**Problème :** L'application ne définit aucun en-tête de sécurité HTTP standard. Les headers manquants :

| Header | Risque sans lui |
|--------|----------------|
| `Content-Security-Policy` | XSS si une injection HTML était introduite |
| `X-Frame-Options` | Clickjacking |
| `X-Content-Type-Options` | MIME sniffing |
| `Strict-Transport-Security` | Downgrade HTTPS → HTTP |
| `Referrer-Policy` | Fuite d'URL dans les logs tiers |

**Correctif recommandé :** Ajouter un middleware dans `entry.server.tsx` ou configurer le reverse proxy Synology pour injecter ces headers :
```
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Strict-Transport-Security: max-age=31536000; includeSubDomains
```

---

### 🟠 ÉLEVÉ — Rate limiting absent sur les endpoints métier

**Fichiers :** `app/routes/feed.server.ts`, `app/routes/api.micro-predictions.ts`, `app/routes/profile.server.ts`

**Problème :** Le rate limiting Redis est correctement implémenté sur les routes d'authentification (`api.auth.$.ts`), mais les endpoints métier n'ont aucune limitation :
- Soumission de posts (`feed`)
- Soumission de commentaires
- Réponses aux micro-pronostics
- Upload d'avatar

**Impact :** Spam dans le fil communautaire, épuisement de ressources (N+1 DB queries sur feed), abus du système de points.

**Correctif recommandé :** Appliquer `checkRateLimit` (déjà disponible dans `app/lib/server/rate-limit.server.ts`) sur les actions critiques. Exemple :
```ts
await checkRateLimit({ key: `post:${session.user.id}`, maxAttempts: 10, windowSeconds: 60 });
```

---

### 🟡 MOYEN — Rate limiting contournable via spoofing d'IP

**Fichier :** `app/routes/api.auth.$.ts`  
**Lignes :** 8-13

**Problème :**
```ts
function getClientIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}
```
L'en-tête `X-Forwarded-For` peut être forgé par le client si le reverse proxy ne le réécrit pas. Un attaquant peut contourner le rate limiting en envoyant `X-Forwarded-For: 1.2.3.4` différent à chaque requête.

**Correctif recommandé :** S'assurer que le reverse proxy Synology (ou Nginx) réécrit/supprime cet en-tête avant de le transmettre à l'application, ou utiliser uniquement l'IP de la connexion TCP (non disponible directement en React Router SSR — à gérer au niveau proxy).

---

### 🟡 MOYEN — trustedOrigins vide si APP_URL non défini

**Fichier :** `app/lib/server/auth.server.ts`  
**Ligne :** 12

**Code :**
```ts
trustedOrigins: env.APP_URL ? [env.APP_URL] : [],
```

**Problème :** Si `APP_URL` n'est pas défini en production, `trustedOrigins` sera un tableau vide `[]`. Le comportement de Better Auth avec un tableau vide n'est pas documenté explicitement — selon la version, il peut autoriser toutes les origines (fail-open) ou bloquer toutes (fail-closed). Dans les deux cas, le comportement attendu n'est pas garanti.

**Correctif recommandé :** Rendre `APP_URL` obligatoire dans `env.server.ts` :
```ts
APP_URL: z.string().url(),
```
Et documenter cette exigence dans `.env.example` et la checklist de déploiement.

---

### 🟢 BAS — Informations de débogage potentielles dans les erreurs API

**Fichiers :** `app/routes/api.sync-matches.ts`, `app/routes/api.micro-predictions.ts`

**Code :**
```ts
const message = error instanceof Error ? error.message : "Erreur inconnue";
return Response.json({ error: message }, { status: 500 });
```

**Problème :** Les messages d'erreur natifs (ex. : stack traces de base, messages de connexion DB) peuvent être exposés aux clients en cas d'erreur serveur. En production, les erreurs internes ne devraient pas détailler leur cause à l'utilisateur final.

**Correctif recommandé :** Filtrer les messages d'erreur en production :
```ts
const message = process.env.NODE_ENV === "production"
  ? "Une erreur est survenue"
  : (error instanceof Error ? error.message : "Erreur inconnue");
```

---

### 🟢 BAS — Délai de deadline micro-pronos non limité

**Fichier :** `app/routes/api.micro-predictions.ts`  
**Ligne :** 39

**Code :**
```ts
const deadlineSeconds = parseInt(formData.get("deadlineSeconds") as string) || 120;
```

**Problème :** La valeur `deadlineSeconds` n'a pas de borne maximale. Un admin pourrait créer un micro-pronostic avec un délai de plusieurs années.

**Impact :** Faible (seul un admin peut créer des micro-pronos), mais une validation explicite renforce la robustesse.

**Correctif recommandé :** Ajouter une validation :
```ts
const deadlineSeconds = Math.min(Math.max(parseInt(...) || 120, 30), 600);
```

---

## Points positifs constatés

- ✅ **Credentials supprimés du repo** (`aed5841`) — action corrective menée rapidement
- ✅ **Rate limiting implémenté** sur sign-in (10 tentatives/15 min) et sign-up (5/heure) via Redis
- ✅ **Validation Zod** sur les inputs utilisateur (posts, commentaires, variables d'environnement)
- ✅ **ORM Drizzle** utilisé avec requêtes paramétrées → pas d'injection SQL directe
- ✅ **Contrôle de rôle** systématique sur les routes admin (`requireAuth(request, ["admin"])`)
- ✅ **Protection auto-modification de rôle** admin (`memberId === session.user.id` → rejeté)
- ✅ **Upload d'avatar sécurisé** : type MIME validé, taille limitée à 2 Mo, nom de fichier basé sur userId (non-guessable par tiers), conversion Sharp vers WebP
- ✅ **Pas de `dangerouslySetInnerHTML`** dans les composants React → pas de XSS côté rendu
- ✅ **Clé API Football** en variable d'environnement, non committée
- ✅ **Sessions stockées dans Redis** (expiration gérée côté Better Auth)

---

## Plan d'action recommandé

| Priorité | Action | Effort |
|----------|--------|--------|
| 🔴 1 | Corriger path traversal dans `uploads-files.ts` | 15 min |
| 🔴 2 | Retirer les mots de passe par défaut Docker (`changeme`) | 10 min |
| 🟠 3 | Ajouter security headers (via middleware ou proxy) | 1h |
| 🟠 4 | Protéger ou restreindre `/api/health` | 30 min |
| 🟠 5 | Rate limiting sur les endpoints métier (feed, micro-pronos) | 2h |
| 🟡 6 | Rendre `APP_URL` obligatoire en production | 15 min |
| 🟡 7 | Documenter la configuration du proxy pour X-Forwarded-For | 30 min |
| 🟢 8 | Filtrer les messages d'erreur en production | 30 min |
