# Rapport d'analyse de sécurité — Penya Barca Nantes

**Date :** 2026-05-09  
**Branche analysée :** `claude/sharp-fermi-cYmMk`  
**Dernier commit analysé :** `003faca`

---

## 1. Résumé des derniers commits

### `003faca` — fix: évaluer les badges immédiatement après chaque action *(13 avr. 2026)*
**Fichiers modifiés :** `app/routes/feed.server.ts`, `app/routes/match-detail.server.ts`  
Correction d'un bug où les badges n'étaient évalués qu'en différé. Désormais `evaluateBadges()` est appelé immédiatement après chaque action déclenchante : soumission de pronostic, publication de post, commentaire, réaction.

### `b1c88f6` — feat: Phase 2 — soirée match live, micro-pronos, badges, séries, saisons *(13 avr. 2026)*
**Fichiers modifiés :** 26 fichiers, +2 965 lignes  
Livraison majeure en 3 sprints :

- **Sprint 2 – Soirée match** : page `/soiree/:matchId` avec score live (polling API toutes les 60 s), fil d'événements (buts, cartons, remplacements), pronos communauté révélés au coup d'envoi, indicateur « En direct ».
- **Sprint 3 – Micro-pronostics & séries** : création/clôture/suppression de micro-pronos par l'admin, vote joueur, attribution automatique des points, séries de scores exacts avec récompenses aux paliers 3/5/10 (post auto).
- **Sprint 5 – Badges & saisons** : 10 badges avec évaluation automatique, page `/badges`, affichage sur le profil, table `seasons`, champ `season` sur les matchs, classement filtré par saison.

### `d461ee5` — Merge branch 'claude/deploy-synology-nas-cLkOL' *(12 avr. 2026)*
Ajout du fichier `DEPLOY.md` : guide de déploiement pour Synology NAS.

---

## 2. Analyse de sécurité — remarques par ordre de criticité

---

### 🔴 CRITIQUE

#### SEC-01 — Path traversal dans le service de fichiers statiques
**Fichier :** `app/routes/uploads-files.ts:5`

```typescript
const filePath = path.join(process.cwd(), "uploads", params["*"]);
```

`params["*"]` est entièrement contrôlé par l'utilisateur. `path.join` normalise les séquences `..` **après** concaténation, ce qui permet de remonter l'arborescence. Un attaquant peut requêter `/uploads/../.env` ou `/uploads/../../etc/passwd` pour lire des fichiers sensibles en dehors du répertoire `uploads/`.

**Correction recommandée :**
```typescript
const uploadsDir = path.join(process.cwd(), "uploads");
const filePath   = path.resolve(uploadsDir, params["*"]);

// Rejeter tout chemin qui sort du répertoire uploads
if (!filePath.startsWith(uploadsDir + path.sep)) {
  return new Response("Forbidden", { status: 403 });
}
```

---

### 🟠 HAUTE

#### SEC-02 — Absence de rate limiting sur les endpoints utilisateurs sensibles
**Fichiers :** `app/routes/api.micro-predictions.ts`, `app/routes/feed.server.ts`, `app/routes/profile.server.ts`

Le rate limiting n'est implémenté que sur la connexion et l'inscription (`api.auth.$.ts`). Aucun throttle n'est appliqué sur :
- la soumission de micro-pronostics (`answer`)
- la publication de posts, commentaires, réactions
- l'upload d'avatar (opération coûteuse via `sharp`)

Un utilisateur authentifié peut flooder ces endpoints sans limitation.

**Correction recommandée :** appliquer `checkRateLimit` sur chaque action sensible, par exemple :
```typescript
await checkRateLimit({ key: `micro-answer:${session.user.id}`, maxAttempts: 30, windowSeconds: 60 });
```

---

#### SEC-03 — Vérification du type MIME basée sur l'en-tête client (non fiable)
**Fichier :** `app/lib/server/upload.ts:13`

```typescript
if (!ALLOWED_TYPES.includes(file.type)) { ... }
```

`file.type` est fourni par le client (navigateur ou requête HTTP) et peut être falsifié. Un fichier malveillant (script, SVG avec JS, polyglot) peut être uploadé en déclarant `image/jpeg`. La conversion via `sharp` atténue le risque pour les vrais images mais ne protège pas contre des formats semi-valides exploitables (e.g. SVG, fichiers polyglots).

**Correction recommandée :** vérifier les magic bytes du fichier (via `file-type` ou `magic-bytes.js`) avant de passer à `sharp` :
```typescript
import { fileTypeFromBuffer } from "file-type";
const detected = await fileTypeFromBuffer(buffer);
if (!detected || !["image/jpeg", "image/png", "image/webp"].includes(detected.mime)) {
  throw new Error("Format de fichier non valide.");
}
```

---

### 🟡 MOYENNE

#### SEC-04 — Spoofing d'adresse IP pour contourner le rate limiting
**Fichier :** `app/routes/api.auth.$.ts:6-10`

```typescript
request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
request.headers.get("x-real-ip") || "unknown"
```

Ces en-têtes sont injectables par l'utilisateur lorsque l'application n'est pas derrière un reverse proxy de confiance. Un attaquant peut envoyer `X-Forwarded-For: 1.2.3.4` à chaque requête pour toujours paraître comme une nouvelle IP et contourner le rate limiting de connexion.

**Correction recommandée :** ne lire ces en-têtes que si l'IP du reverse proxy est une IP de confiance (à configurer explicitement) ; sinon utiliser la connexion TCP directe ou un identifiant de session comme clé de rate limit.

---

#### SEC-05 — Validation insuffisante des entrées dans les micro-pronostics
**Fichier :** `app/routes/api.micro-predictions.ts:19-30, 92`

Aucune validation de longueur ni de format sur :
- `question` : peut être arbitrairement longue
- `answer` : idem, insérée telle quelle en base
- `type` : accepte toute chaîne (pas de whitelist vérifiée avant insertion)
- `pointsValue` : peut être négatif ou excessivement grand

**Correction recommandée :** utiliser un schéma Zod similaire aux autres routes :
```typescript
const createMicroSchema = z.object({
  matchId:         z.string().min(1).max(50),
  question:        z.string().min(1).max(200),
  type:            z.enum(["qcm", "open"]),
  options:         z.string().max(500).optional(),
  pointsValue:     z.number().int().min(1).max(10),
  deadlineSeconds: z.number().int().min(30).max(600),
});
```

---

#### SEC-06 — Endpoint de santé public exposant l'état de l'infrastructure
**Fichier :** `app/routes/api.health.ts`

Le endpoint `/api/health` est accessible sans authentification et révèle l'état opérationnel de la base de données et de Redis (`ok` / `error`). Cette information peut aider un attaquant à cibler ses attaques pendant une fenêtre de dégradation.

**Correction recommandée :** protéger l'endpoint par un token secret ou le restreindre aux IP internes. Option minimale : renvoyer un simple `200 OK` sans détail de service vers les clients non autorisés.

---

#### SEC-07 — Fuite de message d'erreur interne vers le client
**Fichier :** `app/routes/api.sync-matches.ts:21`

```typescript
const message = error instanceof Error ? error.message : "Erreur inconnue";
return Response.json({ error: message }, { status: 500 });
```

Le message d'exception brut (potentiellement issu de l'API tierce, de la DB, ou du réseau) est retourné directement au client admin. Il peut contenir des informations sensibles (clé API, URL interne, stack trace partielle).

**Correction recommandée :** logger le message complet côté serveur et renvoyer un message générique au client :
```typescript
logger.error({ error }, "Erreur sync API-Football");
return Response.json({ error: "La synchronisation a échoué. Consultez les logs." }, { status: 500 });
```

---

### 🔵 FAIBLE

#### SEC-08 — `trustedOrigins` vide quand `APP_URL` n'est pas défini
**Fichier :** `app/lib/server/auth.server.ts:12`

```typescript
trustedOrigins: env.APP_URL ? [env.APP_URL] : [],
```

En l'absence de `APP_URL`, le tableau est vide. Selon la configuration interne de `better-auth`, cela peut soit tout accepter, soit tout rejeter. Le comportement est implicite et non documenté.

**Correction recommandée :** rendre `APP_URL` obligatoire dans le schéma Zod de l'env ou définir une valeur par défaut explicite ; documenter le comportement attendu.

---

#### SEC-09 — Cast `(session.user as any).role` contournant la sûreté de type
**Fichier :** `app/routes/feed.server.ts:99, 124, 184`

```typescript
isAdmin: (session.user as any).role === "admin"
```

Ce cast désactive la vérification de type TypeScript sur un champ de sécurité critique. Si le type de `session.user` est un jour revu, la vérification pourrait silencieusement retourner `false` au lieu de lever une erreur de compilation.

**Correction recommandée :** étendre le type `Session` de better-auth avec le champ `role` ou utiliser le helper `requireAuth` qui retourne déjà un type typé.

---

#### SEC-10 — Suppression de compte sans re-vérification d'identité
**Fichier :** `app/routes/profile.server.ts:127-129`

```typescript
if (intent === "delete-account") {
  await db.delete(user).where(eq(user.id, session.user.id));
```

L'action `delete-account` ne demande pas de confirmation par mot de passe. Une session volée (XSS, session fixation) ou un clic involontaire suffit à supprimer définitivement le compte.

**Correction recommandée :** exiger la saisie du mot de passe courant, le vérifier via `auth.api.verifyPassword` avant de procéder à la suppression.

---

#### SEC-11 — Absence totale d'en-têtes de sécurité HTTP
**Fichiers :** `vite.config.ts`, `react-router.config.ts`

Aucun en-tête de sécurité HTTP n'est configuré au niveau applicatif :
- `Content-Security-Policy` (protection XSS)
- `X-Frame-Options: DENY` (protection clickjacking)
- `X-Content-Type-Options: nosniff` (protection MIME sniffing)
- `Strict-Transport-Security` (forçage HTTPS)
- `Referrer-Policy`

**Correction recommandée :** ajouter un middleware React Router qui injecte ces en-têtes sur chaque réponse, ou configurer le reverse proxy (nginx/Synology) pour les envoyer.

---

#### SEC-12 — Requête SQL contournant le schéma ORM dans badges.server.ts
**Fichier :** `app/lib/server/badges.server.ts:140-142`

```typescript
const [userRow] = await db.select({ bestStreak: sql<number>`coalesce(best_streak, 0)::int` })
  .from(sql`"user"`)
  .where(sql`id = ${userId}`);
```

L'utilisation de `sql\`"user"\`` contourne le schéma Drizzle et accède directement à la table par nom brut. Bien que `userId` soit paramétré (pas d'injection SQL), ce pattern est fragile : une migration qui renomme la table ou le champ ne provoquera pas d'erreur de compilation. De plus, il s'écarte du pattern établi dans le reste du code.

**Correction recommandée :**
```typescript
const [userRow] = await db
  .select({ bestStreak: user.bestStreak })
  .from(user)
  .where(eq(user.id, userId));
```

---

#### SEC-13 — Politique de mot de passe insuffisante
**Fichier :** `app/lib/validation/user.ts:16-19`

```typescript
.min(8, "Mot de passe : 8 caractères minimum")
.regex(/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, ...)
```

Les critères actuels (8 caractères, 1 majuscule, 1 minuscule, 1 chiffre) acceptent des mots de passe très faibles comme `Password1` ou `Abc12345`. Aucune protection contre les mots de passe communs ou les séquences simples.

**Correction recommandée :** augmenter le minimum à 12 caractères et exiger au moins un caractère spécial ; documenter la recommandation d'un gestionnaire de mots de passe dans l'interface.

---

## 3. Tableau récapitulatif

| ID | Sévérité | Fichier | Description |
|----|----------|---------|-------------|
| SEC-01 | 🔴 CRITIQUE | `uploads-files.ts:5` | Path traversal — lecture de fichiers arbitraires |
| SEC-02 | 🟠 HAUTE | `api.micro-predictions.ts`, `feed.server.ts`, `profile.server.ts` | Absence de rate limiting sur les endpoints utilisateurs |
| SEC-03 | 🟠 HAUTE | `upload.ts:13` | Validation MIME basée sur l'en-tête client (falsifiable) |
| SEC-04 | 🟡 MOYENNE | `api.auth.$.ts:6` | IP spoofing contournant le rate limiting |
| SEC-05 | 🟡 MOYENNE | `api.micro-predictions.ts:19-92` | Absence de validation de longueur/type sur les entrées |
| SEC-06 | 🟡 MOYENNE | `api.health.ts` | Endpoint de santé public exposant l'infrastructure |
| SEC-07 | 🟡 MOYENNE | `api.sync-matches.ts:21` | Fuite de messages d'erreur internes |
| SEC-11 | 🟡 MOYENNE | `vite.config.ts`, `react-router.config.ts` | Absence d'en-têtes de sécurité HTTP (CSP, HSTS, X-Frame…) |
| SEC-12 | 🟡 MOYENNE | `badges.server.ts:140` | Requête SQL hors schéma ORM (fragile, contourne la sécurité de type) |
| SEC-13 | 🟡 MOYENNE | `validation/user.ts:16` | Politique de mot de passe insuffisante |
| SEC-08 | 🔵 FAIBLE | `auth.server.ts:12` | `trustedOrigins` vide si `APP_URL` absent |
| SEC-09 | 🔵 FAIBLE | `feed.server.ts:99` | Cast `as any` sur un champ de sécurité (`role`) |
| SEC-10 | 🔵 FAIBLE | `profile.server.ts:127` | Suppression de compte sans re-vérification du mot de passe |

---

## 4. Points positifs constatés

- **Variables d'environnement** : validation Zod stricte via `env.server.ts` avec `AUTH_SECRET` minimum 16 caractères.
- **Contrôle d'accès admin** : `requireAuth(request, ["admin"])` systématiquement appliqué sur toutes les routes admin.
- **Protection auto-modification** : un admin ne peut pas modifier son propre rôle ni supprimer son compte via l'interface d'administration.
- **ORM paramétré** : utilisation de Drizzle ORM sans requêtes SQL brutes — pas de risque d'injection SQL.
- **Traitement des avatars** : `processAvatar` limite correctement la taille (2 Mo) et redimensionne via `sharp` (256×256) avec nom de fichier basé sur l'ID utilisateur (pas d'entrée arbitraire).
- **Rate limiting connexion** : implémenté et opérationnel via Redis avec fenêtre glissante.
- **Sessions Redis** : stockage sécurisé des sessions côté serveur via `better-auth` + Redis.
- **Credentials hors dépôt** : `.gitignore` exclut correctement `.env` et le répertoire `uploads/`.
