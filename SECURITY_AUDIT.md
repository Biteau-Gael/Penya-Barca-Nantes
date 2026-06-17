# Audit de sécurité — Penya Blaugrana Nantes

**Date :** 17 juin 2026  
**Branche analysée :** `main` (commit `003faca`)  
**Périmètre :** Code applicatif, configuration Docker, gestion des fichiers, authentification

---

## Résumé des derniers commits

| Commit | Description |
|--------|-------------|
| `003faca` | fix: évaluer les badges immédiatement après chaque action (soumission pronostic, post, commentaire, réaction) |
| `b1c88f6` | feat: Phase 2 — soirée match live, micro-pronos, badges, séries, saisons (2 965 lignes ajoutées) |
| `d461ee5` | Merge branch deploy Synology NAS |
| `554b873` | Add deployment guide for Synology NAS updates (DEPLOY.md) |
| `68e22d2` | feat: menu burger mobile pour la navigation |
| `6aebaf7` | Fix Better Auth trusted origins for custom domain support |
| `9823bc5` | Add migrate service to docker-compose.prod.yml |
| `8d6e5e9` | Add production Docker Compose and backup script for Synology NAS |
| `aed5841` | security: supprimer credentials du repo et renforcer .gitignore |
| `ab7fc5d` | feat: intégration API Football + stats enrichies + classement Liga |

---

## Analyse de sécurité — Résultats par ordre de criticité

---

### 🔴 CRITIQUE

#### 1. Path traversal dans le serveur de fichiers statiques

**Fichier :** `app/routes/uploads-files.ts:5`

```typescript
const filePath = path.join(process.cwd(), "uploads", params["*"]);
```

**Risque :** Le paramètre wildcard `params["*"]` est utilisé directement dans `path.join` sans aucune validation ni confinement. `path.join` en Node.js résout les séquences `..` — un attaquant peut donc sortir du répertoire `uploads/` et lire des fichiers arbitraires du serveur.

**Exemple d'exploitation :**
```
GET /uploads/../.env          → lit le fichier .env (clés API, DATABASE_URL, AUTH_SECRET)
GET /uploads/../../etc/passwd → lit des fichiers système
```

**Correctif recommandé :**
```typescript
export async function loader({ params }: { params: { "*": string } }) {
  const requested = params["*"];
  // Rejeter tout chemin contenant des séquences de traversal
  if (!requested || requested.includes("..") || path.isAbsolute(requested)) {
    return new Response("Not found", { status: 404 });
  }
  const UPLOAD_DIR = path.join(process.cwd(), "uploads");
  const filePath = path.join(UPLOAD_DIR, requested);
  // Vérification finale que le chemin résolu est bien sous UPLOAD_DIR
  if (!filePath.startsWith(UPLOAD_DIR + path.sep)) {
    return new Response("Not found", { status: 404 });
  }
  // ... suite du code
}
```

---

#### 2. Contournement du rate limiting par usurpation d'IP

**Fichier :** `app/routes/api.auth.$.ts:5-10`

```typescript
function getClientIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}
```

**Risque :** Le header `X-Forwarded-For` est contrôlé par le client. En envoyant un header arbitraire (`X-Forwarded-For: 1.2.3.4`), n'importe quel attaquant peut contourner le rate limiting sur login/register et effectuer des attaques par force brute sur les comptes.

**Correctif recommandé :** Utiliser l'IP réelle de connexion (socket), ou prendre le **dernier** élément de `X-Forwarded-For` (celui ajouté par le reverse proxy de confiance), pas le premier (contrôlé par le client).

```typescript
function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    // Prendre la dernière adresse (ajoutée par le proxy de confiance)
    const ips = forwarded.split(",").map(ip => ip.trim());
    return ips[ips.length - 1] || "unknown";
  }
  return request.headers.get("x-real-ip") || "unknown";
}
```

---

### 🟠 ÉLEVÉ

#### 3. Absence de security headers HTTP

**Risque :** Aucun header de sécurité n'est configuré au niveau de l'application ou du reverse proxy :
- Pas de `Content-Security-Policy` → risque XSS si du contenu utilisateur est rendu en HTML
- Pas de `X-Frame-Options` ou `frame-ancestors` → risque de clickjacking
- Pas de `X-Content-Type-Options: nosniff` → risque de MIME sniffing
- Pas de `Referrer-Policy`
- Pas de `Permissions-Policy`

**Correctif recommandé :** Ajouter un middleware dans le point d'entrée de l'application (ou via nginx en production) :

```typescript
// app/root.tsx ou middleware React Router
const SECURITY_HEADERS = {
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Content-Security-Policy": "default-src 'self'; img-src 'self' data: https:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'",
};
```

---

#### 4. `trustedOrigins` vide si `APP_URL` non défini

**Fichier :** `app/lib/server/auth.server.ts:12`

```typescript
trustedOrigins: env.APP_URL ? [env.APP_URL] : [],
```

**Risque :** En l'absence de la variable `APP_URL`, le tableau `trustedOrigins` est vide. Selon le comportement de Better Auth avec un tableau vide, cela peut désactiver la protection CSRF sur les endpoints d'authentification, permettant des requêtes cross-origin non autorisées.

**Correctif recommandé :** Forcer `APP_URL` comme variable d'environnement obligatoire dans `env.server.ts` :

```typescript
APP_URL: z.string().url("APP_URL doit être une URL valide"),
```

Et s'assurer que `.env.example` et la documentation de déploiement l'imposent.

---

### 🟡 MOYEN

#### 5. Absence de rate limiting sur les actions utilisateur

**Risque :** Seuls les endpoints `/api/auth/sign-in` et `/api/auth/sign-up` sont protégés par du rate limiting. Les actions suivantes ne le sont pas :
- Publication de posts (`feed` → intent `create-post`)
- Ajout de commentaires (`feed` → intent `comment`)
- Réactions (`feed` → intent `react`)
- Réponses aux micro-pronostics (`api.micro-predictions` → intent `answer`)

Un utilisateur peut donc spammer ces actions indéfiniment.

**Correctif recommandé :** Appliquer `checkRateLimit` par userId sur ces actions sensibles :

```typescript
// Exemple dans feedAction
await checkRateLimit({ key: `post:${session.user.id}`, maxAttempts: 10, windowSeconds: 60 });
```

---

#### 6. Vérification du type MIME basée sur le client

**Fichier :** `app/lib/server/upload.ts:12`

```typescript
if (!ALLOWED_TYPES.includes(file.type)) {
  throw new Error("Format non supporté. Utilisez JPEG, PNG ou WebP.");
}
```

**Risque :** `file.type` provient du navigateur (header `Content-Type` de la requête multipart), et peut être manipulé par un client malveillant qui envoie un fichier exécutable avec le type `image/jpeg`.

**Atténuation partielle :** La bibliothèque `sharp` valide le contenu réel de l'image lors du traitement — si le fichier n'est pas une image valide, Sharp lèvera une exception. Le risque est donc limité, mais il serait plus robuste de vérifier la signature "magic bytes" du fichier en complément.

---

#### 7. Absence de limite de taille sur les requêtes action

**Risque :** Les routes `feed` et `match-detail` n'imposent pas de limite explicite sur la taille du corps de la requête (`request.formData()`). Un attaquant peut envoyer des requêtes très volumineuses pour consommer de la mémoire serveur.

**Correctif recommandé :** Configurer une limite de taille au niveau de React Router ou du reverse proxy nginx :

```nginx
client_max_body_size 5M;
```

---

### 🟢 FAIBLE

#### 8. Utilisation de `sql` template brut pour le nom de table `"user"`

**Fichier :** `app/lib/server/badges.server.ts:91`

```typescript
const [userRow] = await db.select({ bestStreak: sql<number>`coalesce(best_streak, 0)::int` })
  .from(sql`"user"`)
  .where(sql`id = ${userId}`);
```

**Risque :** L'usage de `sql` raw pour le nom de table et la clause `where` est un pattern potentiellement risqué. Ici `userId` est issu de la session (donc de confiance), et le nom de table est une chaîne littérale — le risque réel est faible. Mais ce pattern, s'il est reproduit avec des entrées non contrôlées, pourrait mener à une injection SQL.

**Correctif recommandé :** Utiliser l'alias Drizzle pour la table `user` importée depuis le schema, comme partout ailleurs dans le code :

```typescript
const [userRow] = await db.select({ bestStreak: sql<number>`coalesce(${user.bestStreak}, 0)::int` })
  .from(user)
  .where(eq(user.id, userId));
```

---

#### 9. Logs structurés incluant des données potentiellement sensibles

**Fichiers :** Plusieurs routes (`feed.server.ts`, `admin.members.server.ts`, etc.)

```typescript
logger.info({ action: "role-changed", memberId, newRole, by: session.user.id }, "Rôle modifié");
```

**Risque faible :** Les logs incluent des IDs utilisateur et des actions. En environnement de production, s'assurer que les logs ne contiennent jamais d'emails, mots de passe ou tokens. La configuration actuelle est correcte mais mérite surveillance.

---

## Résumé des points positifs

| Aspect | Statut |
|--------|--------|
| Authentification via Better Auth (bibliothèque éprouvée) | ✅ |
| Sessions stockées en Redis | ✅ |
| ORM Drizzle (pas de requêtes SQL brutes dans l'essentiel du code) | ✅ |
| Validation Zod sur tous les formulaires (client + serveur) | ✅ |
| Rate limiting sur login/register | ✅ |
| Vérification des rôles sur toutes les routes admin | ✅ |
| Protection auto-modification de rôle admin | ✅ |
| Secrets exclus du dépôt Git (.gitignore) | ✅ |
| Traitement d'image via Sharp (reencoding, resize) | ✅ |
| Mot de passe fort imposé à l'inscription | ✅ |
| Vérification ownership avant suppression post/commentaire | ✅ |
| Logs structurés avec pino | ✅ |

---

## Tableau de bord des actions prioritaires

| Priorité | Fichier | Action |
|----------|---------|--------|
| 🔴 IMMÉDIAT | `app/routes/uploads-files.ts` | Ajouter validation et confinement du chemin |
| 🔴 IMMÉDIAT | `app/routes/api.auth.$.ts` | Corriger extraction IP (last trusted proxy) |
| 🟠 COURT TERME | Configuration nginx/app | Ajouter security headers HTTP |
| 🟠 COURT TERME | `app/lib/server/auth.server.ts` | Forcer `APP_URL` obligatoire |
| 🟡 MOYEN TERME | `app/routes/feed.server.ts` | Rate limiting sur posts/commentaires |
| 🟡 MOYEN TERME | `app/routes/api.micro-predictions.ts` | Rate limiting sur réponses |
| 🟢 LONG TERME | `app/lib/server/badges.server.ts` | Remplacer `sql` raw par requête Drizzle typée |
