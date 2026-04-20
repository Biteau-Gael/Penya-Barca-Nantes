# Revue de Sécurité — Penya Barca Nantes
**Date** : 20 avril 2026  
**Branche analysée** : `main` (commits jusqu'à `003faca`)  
**Stack** : React Router 7 · Better Auth · Drizzle ORM · PostgreSQL · Redis · Docker

---

## Résumé des derniers commits

| Commit | Message | Périmètre |
|--------|---------|-----------|
| `003faca` | fix: évaluer les badges immédiatement après chaque action | `feed.server.ts`, `match-detail.server.ts` — déclenchement badges sur post, commentaire, réaction |
| `b1c88f6` | feat: Phase 2 — soirée match live, micro-pronos, badges, séries, saisons | 29 fichiers — page soirée live, micro-pronostics admin/joueur, 10 badges, séries, saisons |
| `d461ee5` | Merge: deploy-synology-nas | Fusion guide déploiement NAS |
| `554b873` | Add deployment guide for Synology NAS updates | `DEPLOY.md` |
| `68e22d2` | feat: menu burger mobile pour la navigation | `header.tsx` |

---

## Résumé exécutif

**Bilan** : 12 points identifiés — 2 critiques, 3 hauts, 5 moyens, 2 faibles.  
Le code respecte les bonnes pratiques fondamentales (ORM paramétré, Zod, Better Auth, rate limiting sur l'auth). Les vulnérabilités identifiées sont principalement liées aux fonctionnalités récentes de la Phase 2 et à deux oublis sur la gestion des fichiers uploadés et l'endpoint de santé.

---

## Vulnérabilités par ordre de criticité

### 🔴 CRITIQUE

---

#### C1 — Path Traversal sur le serveur de fichiers uploadés
**Fichier** : `app/routes/uploads-files.ts:5`  
**Commit d'introduction** : `ab7fc5d` (Phase 1 MVP)

```typescript
// VULNÉRABLE — params["*"] non validé
const filePath = path.join(process.cwd(), "uploads", params["*"]);
const file = await readFile(filePath);
```

**Problème** : Le paramètre `params["*"]` (ex: `avatars/xxx.webp`) est utilisé directement dans `path.join()` sans validation. Un attaquant peut envoyer `../../../etc/passwd` ou `../../.env` pour lire des fichiers arbitraires du serveur.

**Impact** : Lecture du fichier `.env` (clé API Football, `AUTH_SECRET`, `DATABASE_URL`), fichiers système, compromission complète de l'application.

**Correction** :
```typescript
import path from "node:path";
import { readFile } from "node:fs/promises";

const SAFE_PATH_RE = /^[a-zA-Z0-9_/-]+\.(webp|jpg|jpeg|png)$/;
const UPLOADS_DIR = path.resolve(process.cwd(), "uploads");

export async function loader({ params }: { params: { "*": string } }) {
  const raw = params["*"];
  if (!SAFE_PATH_RE.test(raw)) {
    return new Response("Not found", { status: 404 });
  }
  const filePath = path.resolve(UPLOADS_DIR, raw);
  // Garantit que le chemin résolu reste sous UPLOADS_DIR
  if (!filePath.startsWith(UPLOADS_DIR + path.sep)) {
    return new Response("Not found", { status: 404 });
  }
  // ... reste du code
}
```

---

#### C2 — Endpoint `/api/health` public exposant l'état des services internes
**Fichier** : `app/routes/api.health.ts:11`

```typescript
export async function loader() { // Aucune authentification
  // Révèle : db ok/error, redis ok/error
}
```

**Problème** : Accessible sans authentification. Révèle l'état des services internes (PostgreSQL, Redis), ce qui facilite la reconnaissance pour des attaques ciblées.

**Impact** : Reconnaissance d'infrastructure, aide pour planifier une attaque lors d'une dégradation de service.

**Correction** : Restreindre aux admins ou limiter à un réseau interne (Docker internal network). Alternative légère : supprimer le détail des services dans la réponse publique, ne retourner que `{ status: "ok" | "degraded" }`.

```typescript
// Option A : restriction admin
import { requireAuth } from "~/lib/server/auth-utils.server";
export async function loader({ request }: { request: Request }) {
  await requireAuth(request, ["admin"]);
  // ...
}

// Option B : réponse réduite sans auth
return Response.json({ status: allHealthy ? "ok" : "degraded" });
```

---

### 🟠 HAUTE

---

#### H1 — IP Spoofing contournant le rate limiting
**Fichier** : `app/routes/api.auth.$.ts:5-10`

```typescript
function getClientIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}
```

**Problème** : Sans validation que la requête vient d'un proxy de confiance, n'importe quel client peut forger l'en-tête `X-Forwarded-For` pour contourner le rate limiting (brute force de mots de passe illimité).

**Impact** : Contournement du rate limiting sur login/inscription. Brute force possible si `AUTH_SECRET` ou comptes connus.

**Correction** : Configurer Docker/Nginx pour n'ajouter `X-Forwarded-For` que depuis le reverse proxy, ou valider que l'IP de connexion directe correspond au proxy de confiance. En production Synology, la valeur du proxy NAS doit être la seule source de confiance.

---

#### H2 — `trustedOrigins` vide si `APP_URL` non configurée
**Fichier** : `app/lib/server/auth.server.ts:12`

```typescript
trustedOrigins: env.APP_URL ? [env.APP_URL] : [],
```

**Problème** : Si `APP_URL` n'est pas définie dans `.env`, Better Auth reçoit un tableau `trustedOrigins` vide. Selon la version de Better Auth, cela peut soit désactiver la vérification CSRF, soit bloquer toutes les requêtes cross-origin.

**Impact** : Protection CSRF absente ou comportement indéfini en production sans `APP_URL`.

**Correction** : Rendre `APP_URL` obligatoire en production, ou définir un fallback sûr.

```typescript
// Dans env.server.ts
APP_URL: z.string().url().optional(), // ou obligatoire en prod

// Dans auth.server.ts
trustedOrigins: env.APP_URL
  ? [env.APP_URL]
  : env.NODE_ENV === "production"
    ? [] // bloque tout en prod sans config
    : ["http://localhost:3000"],
```

---

#### H3 — Validation manquante sur les champs admin des micro-pronostics
**Fichier** : `app/routes/api.micro-predictions.ts:19-24`

```typescript
const question = formData.get("question") as string;   // Pas de validation Zod
const type = (formData.get("type") as string) || "qcm";
const optionsRaw = formData.get("options") as string;
const pointsValue = parseInt(formData.get("pointsValue") as string) || 1;
const deadlineSeconds = parseInt(formData.get("deadlineSeconds") as string) || 120;
```

**Problème** : Les champs `question`, `type`, `options`, `pointsValue` et `deadlineSeconds` ne sont pas validés avec Zod. `type` peut prendre n'importe quelle valeur. `question` peut être vide ou extrêmement longue.

**Impact** : Stockage de données mal formées, potentiel XSS si `question` ou `options` contient du HTML/JS affiché sans échappement.

**Correction** :
```typescript
const microPredictionSchema = z.object({
  matchId: z.string().min(1),
  question: z.string().min(5).max(500),
  type: z.enum(["qcm", "open"]),
  options: z.string().max(1000).optional(),
  pointsValue: z.coerce.number().int().min(1).max(10),
  deadlineSeconds: z.coerce.number().int().min(30).max(600),
});
```

---

### 🟡 MOYENNE

---

#### M1 — Type casting `(session.user as any).role` non typé
**Fichier** : `app/routes/feed.server.ts:99,124,184,200`

```typescript
isAdmin: (session.user as any).role === "admin",
if (isAnnouncement && (session.user as any).role !== "admin") {
```

**Problème** : Utilisation de `as any` pour accéder au rôle. Si la structure de session évolue, ces vérifications peuvent silencieusement échouer sans erreur TypeScript.

**Impact** : Contournement silencieux des vérifications de rôle lors de refactors futurs.

**Correction** : Importer le type `Session` de Better Auth et utiliser le typage fort, ou centraliser la vérification de rôle dans `auth-utils.server.ts`.

```typescript
// Dans auth-utils.server.ts
export function isAdmin(session: Session): boolean {
  return session.user.role === "admin";
}
```

---

#### M2 — Suppression de compte sans confirmation supplémentaire
**Fichier** : `app/routes/profile.server.ts:127-131`

```typescript
if (intent === "delete-account") {
  await db.delete(user).where(eq(user.id, session.user.id));
  return { success: true, message: "Compte supprimé.", deleted: true };
}
```

**Problème** : La suppression de compte s'effectue sur simple soumission de formulaire sans confirmation par email, mot de passe ni token CSRF dédié.

**Impact** : Action irréversible (données supprimées), risque d'exécution accidentelle ou via CSRF si la protection CSRF de Better Auth n'est pas active.

**Correction** : Ajouter une confirmation par saisie du mot de passe ou envoi d'un token par email avec TTL de 1 heure avant suppression effective.

---

#### M3 — Un admin peut retirer les droits d'un autre admin
**Fichier** : `app/routes/admin.members.server.ts:55-62`

```typescript
// Protection actuelle : uniquement self-protection
if (intent === "change-role" && memberId === session.user.id) {
  return { error: "Vous ne pouvez pas modifier votre propre rôle." };
}
// Mais aucun blocage pour modifier un AUTRE admin
await db.update(user).set({ role: newRole }).where(eq(user.id, memberId));
```

**Problème** : Un admin peut retirer les droits d'un autre admin, entraînant une perte de contrôle en cas de compromission d'un compte admin.

**Impact** : Escalade de privilèges, lock-out de l'administration.

**Correction** :
```typescript
// Vérifier le rôle actuel avant modification
const [target] = await db.select({ role: user.role }).from(user).where(eq(user.id, memberId));
if (target?.role === "admin") {
  return { error: "Impossible de modifier le rôle d'un autre administrateur." };
}
```

---

#### M4 — Rôle utilisateur exposé publiquement via les profils membres
**Fichier** : `app/routes/member-profile.server.ts:21-27`

```typescript
const [member] = await db.select({
  id: user.id,
  name: user.name,
  pseudo: user.pseudo,
  avatarUrl: user.avatarUrl,
  role: user.role,   // Exposé publiquement
  createdAt: user.createdAt,
}).from(user).where(eq(user.id, params.memberId));
```

**Problème** : Le rôle (`admin`, `partner`, `member`) est visible par tout utilisateur connecté sur le profil de n'importe quel membre.

**Impact** : Énumération des comptes admin, cible pour phishing ou attaques sociales.

**Correction** : Ne pas retourner `role` dans les profils publics, ou le masquer si le visiteur n'est pas admin.

---

#### M5 — Accès direct `process.env` sans validation dans des fichiers serveur
**Fichiers** : `app/lib/server/redis.server.ts:3`, `app/db/client.ts:6`, `app/lib/server/logger.server.ts:4`

```typescript
// redis.server.ts
export const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379", {});

// db/client.ts
connectionString: process.env.DATABASE_URL,
```

**Problème** : Ces fichiers accèdent directement à `process.env` contournant la validation Zod de `env.server.ts`. En cas d'erreur de configuration, le fallback `redis://localhost:6379` (sans auth) peut être utilisé silencieusement en production.

**Correction** : Utiliser `getEnv()` partout et supprimer les fallbacks non sécurisés.

```typescript
// redis.server.ts
import { getEnv } from "~/config/env.server";
export const redis = new Redis(getEnv().REDIS_URL);
```

---

### 🔵 FAIBLE

---

#### F1 — Absence de Content Security Policy (CSP)
**Périmètre** : Toute l'application

Aucun en-tête `Content-Security-Policy` n'est configuré. En cas de XSS, l'attaquant peut exécuter du code arbitraire sans restriction.

**Correction** : Ajouter des headers de sécurité via un middleware React Router ou la configuration Nginx :
```
Content-Security-Policy: default-src 'self'; img-src 'self' data:; script-src 'self'
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
```

---

#### F2 — `pointsScheme` non validé contre une liste de valeurs autorisées
**Fichier** : `app/routes/admin.matches.server.ts:59`

```typescript
const pointsScheme = (formData.get("pointsScheme") as string) || "standard";
// Valeur stockée sans validation
```

**Problème** : N'importe quelle chaîne peut être stockée comme `pointsScheme`, même si seuls `standard` et potentiellement d'autres valeurs connues sont utilisés.

**Correction** :
```typescript
const VALID_SCHEMES = ["standard", "double"] as const;
const pointsScheme = VALID_SCHEMES.includes(formData.get("pointsScheme") as typeof VALID_SCHEMES[number])
  ? formData.get("pointsScheme") as string
  : "standard";
```

---

## Points positifs

| ✅ Bonne pratique | Localisation |
|---|---|
| ORM Drizzle avec requêtes paramétrées — **aucune SQL injection possible** | Tous les fichiers `*.server.ts` |
| Validation Zod sur les inputs critiques (pseudo, email, scores, contenus) | `app/lib/validation/` |
| Rate limiting Redis sur login/inscription | `app/routes/api.auth.$.ts` |
| Better Auth pour la gestion des sessions (tokens, cookies HTTPOnly) | `app/lib/server/auth.server.ts` |
| Validation de format des fichiers uploadés (MIME type + taille 2 Mo) | `app/lib/server/upload.ts` |
| Vérification admin systématique sur les routes sensibles | `requireAuth(request, ["admin"])` |
| Suppression des credentials du repo (commit `aed5841`) | `.gitignore` renforcé |
| Redimensionnement et conversion WebP via Sharp (isolation des contenus) | `app/lib/server/upload.ts` |
| Pas de hardcoding de secrets dans le code | Tout le projet |

---

## Plan d'action recommandé

### Immédiat (avant prochaine mise en production)
- [ ] **C1** — Corriger le Path Traversal dans `uploads-files.ts`
- [ ] **C2** — Restreindre `/api/health` (auth admin ou réponse réduite)
- [ ] **H3** — Ajouter validation Zod sur les micro-pronostics admin

### Court terme (1-2 semaines)
- [ ] **H1** — Sécuriser la détection IP dans le rate limiter
- [ ] **H2** — Rendre `APP_URL` obligatoire en production
- [ ] **M1** — Remplacer les `as any` par un typage fort des rôles
- [ ] **M5** — Uniformiser l'accès aux variables d'env via `getEnv()`

### Moyen terme (1 mois)
- [ ] **M2** — Confirmation par mot de passe avant suppression de compte
- [ ] **M3** — Protéger la modification du rôle admin
- [ ] **M4** — Masquer le rôle dans les profils publics
- [ ] **F1** — Ajouter les headers de sécurité (CSP, X-Frame-Options)
- [ ] **F2** — Valider `pointsScheme` contre une liste de valeurs autorisées
