# Audit Sécurité & Résumé des Commits — Penya Barca Nantes

> **Date :** 15 juin 2026  
> **Branche analysée :** `main` (commits jusqu'à `003faca`)  
> **Périmètre :** Revue des 8 derniers commits + audit sécurité de l'ensemble de la codebase

---

## 1. Résumé des derniers commits

### `003faca` — fix: évaluer les badges immédiatement après chaque action *(13 avr. 2026)*
Correction du déclenchement des badges : `evaluateBadges()` est maintenant appelé côté serveur dès la soumission d'un pronostic (`match-detail.server.ts`), la publication d'un post, d'un commentaire ou d'une réaction (`feed.server.ts`). Avant ce fix, les badges "Premier pas", "Auteur", "Commentateur" et "Réactif" n'étaient pas évalués immédiatement après chaque action.

### `b1c88f6` — feat: Phase 2 — soirée match live, micro-pronos, badges, séries, saisons *(13 avr. 2026)*
Sprint majeur (2 965 lignes ajoutées, 26 fichiers) couvrant :
- **Page /soiree/:matchId** : score en direct via polling API toutes les 60 s, fil d'événements en temps réel (buts, cartons, remplacements), indicateur "En direct" animé, pronos communauté révélés au coup d'envoi.
- **Micro-pronostics** : création/clôture/suppression admin, vote joueur, attribution automatique des points, points séparés affichés sur le profil.
- **Séries** : `currentStreak` / `bestStreak` sur les utilisateurs, récompenses aux paliers 3/5/10 avec post auto dans le fil.
- **Badges** : 10 badges de base, évaluation automatique, page /badges avec grille visuelle, affichage sur le profil.
- **Saisons** : table `seasons`, champ `season` sur les matchs, classement filtrable par saison avec sélecteur, support archives.
- **Schéma DB** : migration 0007 (tables `seasons`, `badges`, `user_badges`, `rewards`, `micro_predictions`, `micro_prediction_answers`).

### `d461ee5` — Merge branch 'claude/deploy-synology-nas-cLkOL' *(12 avr. 2026)*
Fusion de la branche de déploiement NAS Synology.

### `554b873` — Add deployment guide for Synology NAS updates *(12 avr. 2026)*
Ajout du guide de mise à jour du déploiement sur NAS Synology dans la documentation.

### `68e22d2` — feat: menu burger mobile pour la navigation *(13 avr. 2026)*
Refonte du composant `header.tsx` (+121 lignes) : menu hamburger responsive pour mobile, animation d'ouverture/fermeture, overlay de fond, fermeture automatique au clic extérieur.

### `aed5841` — security: supprimer credentials du repo et renforcer .gitignore *(12 avr. 2026)*
Commit de nettoyage sécurité : suppression de `.claude/settings.local.json` du tracking Git, ajout de `.claude/` dans `.gitignore`, remplacement des credentials en dur par des placeholders dans `.env.example`, `docker-compose.yml` et `docker-compose.dev.yml` passent en mode `env_file`.

### `6583da3` — docs: README complet avec guide de déploiement NAS Synology *(12 avr. 2026)*
Rédaction du README complet avec guide de déploiement, architecture, et variables d'environnement.

### `ab7fc5d` — feat: intégration API Football + stats enrichies + classement Liga *(avant le 12 avr.)*
Intégration de l'API RapidAPI (Free API Live Football Data), synchronisation des matchs, enrichissement des stats et affichage du classement Liga.

---

## 2. Audit de sécurité

> Les findings sont classés par criticité décroissante. Chaque entrée indique le fichier, la ligne, la sévérité, la description du risque et la correction recommandée.

---

### 🔴 CRITIQUE

#### SEC-01 — Path Traversal sur le serveur de fichiers statiques
**Fichier :** `app/routes/uploads-files.ts:5`  
**Sévérité :** CRITIQUE

```ts
const filePath = path.join(process.cwd(), "uploads", params["*"]);
```

`path.join` normalise les segments `..` : une requête vers `/uploads/../../etc/passwd` produit le chemin `/etc/passwd` sur le serveur. Tout fichier accessible par le processus Node.js peut être lu par un utilisateur non authentifié (aucun contrôle d'authentification sur ce loader).

**Correction :**
```ts
const UPLOAD_DIR = path.resolve(process.cwd(), "uploads");
const filePath = path.resolve(UPLOAD_DIR, params["*"]);

if (!filePath.startsWith(UPLOAD_DIR + path.sep)) {
  return new Response("Forbidden", { status: 403 });
}
```
Ajouter également `requireAuth` si les uploads ne sont pas publics.

---

### 🟠 ÉLEVÉ

#### SEC-02 — Validation du type MIME basée sur le client (MIME spoofing)
**Fichier :** `app/lib/server/upload.ts:13`  
**Sévérité :** ÉLEVÉ

```ts
if (!ALLOWED_TYPES.includes(file.type)) { ... }
```

`file.type` est fourni par le navigateur (header `Content-Type`) et peut être falsifié. Un attaquant peut envoyer un fichier malveillant (exécutable, fichier SVG avec script, etc.) en déclarant `image/jpeg`. La vérification par magic bytes (en-têtes binaires du fichier) est absente.

**Correction :** Utiliser la librairie `file-type` pour lire les premiers octets et valider le type réel :
```ts
import { fileTypeFromBuffer } from "file-type";
const type = await fileTypeFromBuffer(buffer);
if (!type || !["image/jpeg", "image/png", "image/webp"].includes(type.mime)) {
  throw new Error("Format non supporté.");
}
```
Note : Sharp re-encode déjà en WebP, ce qui limite l'impact, mais la validation doit rester robuste.

#### SEC-03 — Aucun rate limiting sur les actions sensibles du profil
**Fichier :** `app/routes/profile.server.ts`  
**Sévérité :** ÉLEVÉ

Les actions `update-avatar`, `update-pseudo` et `delete-account` ne font appel à aucun mécanisme de rate limiting, alors que `api.auth.$.ts` en applique un sur le login/register. Un attaquant authentifié peut :
- Spammer l'upload d'avatars (charge disque/mémoire).
- Énumérer les pseudos disponibles sans limite.
- Déclencher des suppressions de compte en masse si une faille d'élévation de privilège existe.

**Correction :** Appliquer `checkRateLimit` avec des fenêtres adaptées :
```ts
await checkRateLimit({ key: `avatar:${session.user.id}`, maxAttempts: 5, windowSeconds: 3600 });
await checkRateLimit({ key: `pseudo:${session.user.id}`, maxAttempts: 10, windowSeconds: 3600 });
await checkRateLimit({ key: `delete:${session.user.id}`, maxAttempts: 3, windowSeconds: 3600 });
```

#### SEC-04 — `APP_URL` optionnel affaiblit les protections CSRF de BetterAuth
**Fichier :** `app/config/env.server.ts:15` + `app/lib/server/auth.server.ts:12`  
**Sévérité :** ÉLEVÉ

```ts
APP_URL: z.string().optional(),
// ...
trustedOrigins: env.APP_URL ? [env.APP_URL] : [],
```

Quand `APP_URL` n'est pas défini, `trustedOrigins` est vide `[]`. Le comportement de BetterAuth avec un tableau vide n'est pas documenté de façon définitive : cela peut signifier "aucun domaine autorisé" (bloquant toutes les requêtes cross-origin) ou laisser BetterAuth en mode permissif selon la version. En production sans `APP_URL`, le risque de CSRF augmente.

**Correction :** Rendre `APP_URL` obligatoire en production :
```ts
APP_URL: z.string().url().min(1, "APP_URL est requis"),
```
Et documenter cette variable dans `.env.example` comme requise.

#### SEC-05 — Endpoint `/api/health` non authentifié expose l'état de l'infrastructure
**Fichier :** `app/routes/api.health.ts`  
**Sévérité :** ÉLEVÉ (faible en isolation, élevé combiné à d'autres infos)

Le loader retourne sans authentification les statuts de PostgreSQL et Redis (ok/error), l'horodatage du check, et un code HTTP 503 quand les services sont dégradés. Ces informations facilitent la reconnaissance pour un attaquant qui cherche une fenêtre d'attaque pendant une indisponibilité.

**Correction :** Restreindre à une IP de confiance (monitoring interne) ou ajouter un token d'accès via header :
```ts
const token = request.headers.get("x-health-token");
if (token !== env.HEALTH_TOKEN) return new Response("Unauthorized", { status: 401 });
```

#### SEC-06-bis — Exposition des erreurs internes dans `api.sync-matches.ts`
**Fichier :** `app/routes/api.sync-matches.ts:21`  
**Sévérité :** ÉLEVÉ

```ts
const message = error instanceof Error ? error.message : "Erreur inconnue";
return Response.json({ error: message }, { status: 500 });
```

Les erreurs remontées par l'API Football (clé invalide, quota dépassé, etc.) sont transmises directement au client admin, révélant potentiellement des URLs internes, des codes d'erreur tiers ou des informations sur l'infrastructure.

**Correction :** Logger l'erreur complète et retourner un message générique :
```ts
logger.error({ error }, "Erreur sync API-Football");
return Response.json({ error: "Synchronisation échouée. Consultez les logs." }, { status: 500 });
```

---

### 🟡 MOYEN

#### SEC-06 — Champ `role` potentiellement injectable à l'inscription
**Fichier :** `app/lib/server/auth.server.ts:25-28`  
**Sévérité :** MOYEN

```ts
role: {
  type: "string",
  defaultValue: "member",
},
```

Dans BetterAuth, les `additionalFields` sans `input: false` peuvent être passés dans le payload de `signUp`. Si un utilisateur envoie `{ role: "admin" }` lors de l'inscription, cela pourrait être accepté selon la version de BetterAuth.

**Correction :** Forcer `input: false` pour le champ `role` :
```ts
role: {
  type: "string",
  defaultValue: "member",
  input: false,
},
```
Vérifier également que la table `user` a une contrainte CHECK sur les valeurs de rôle autorisées.

#### SEC-07 — Validation insuffisante des champs de micro-pronostics
**Fichier :** `app/routes/api.micro-predictions.ts:21-24, 92`  
**Sévérité :** MOYEN

Plusieurs champs ne sont pas correctement validés :
- `type` (ligne 21) : aucune vérification contre `["qcm", "libre"]` — une valeur arbitraire est stockée en base.
- `answer` (ligne 92) : aucune limite de longueur — peut insérer des chaînes de plusieurs Mo en base.
- `pointsValue` (ligne 23) : `parseInt()` sans borne max — un admin peut créer un pronostic à 999 999 points.
- `deadlineSeconds` (ligne 24) : idem, pas de borne.

**Correction :** Utiliser un schéma Zod pour valider l'ensemble des inputs admin et joueur :
```ts
const createMicroSchema = z.object({
  matchId: z.string().min(1),
  question: z.string().min(1).max(300),
  type: z.enum(["qcm", "libre"]),
  options: z.string().optional(),
  pointsValue: z.coerce.number().int().min(1).max(100),
  deadlineSeconds: z.coerce.number().int().min(30).max(3600),
});

const answerSchema = z.object({
  microId: z.string().min(1),
  answer: z.string().min(1).max(200),
});
```

#### SEC-08 — Absence de headers de sécurité HTTP
**Fichier :** `react-router.config.ts` / middleware global (non trouvé)  
**Sévérité :** MOYEN

Aucun header de sécurité HTTP n'est visible dans la codebase :
- `Content-Security-Policy` (protection XSS)
- `X-Frame-Options` (protection clickjacking)
- `X-Content-Type-Options: nosniff` (protection MIME sniffing)
- `Referrer-Policy`
- `Permissions-Policy`

**Correction :** Ajouter un middleware Express/React Router qui injecte ces headers sur toutes les réponses. Exemple minimal :
```ts
// app/middleware/security-headers.ts
export function securityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("Content-Security-Policy", "default-src 'self'; img-src 'self' data: blob:; ...");
  return new Response(response.body, { status: response.status, headers });
}
```

#### SEC-09 — Les messages d'erreur Sharp peuvent exposer des chemins internes
**Fichier :** `app/routes/profile.server.ts:146`  
**Sévérité :** MOYEN

```ts
const message = err instanceof Error ? err.message : "Erreur lors de l'upload.";
return { error: message };
```

Les exceptions levées par Sharp (ex : `Error: Input file /uploads/avatars/xyz.webp contains unsupported image format`) exposent des chemins de fichiers systèmes côté client.

**Correction :** Logger l'erreur complète mais retourner un message générique :
```ts
logger.error({ err, userId: session.user.id }, "Erreur upload avatar");
return { error: "Erreur lors de l'upload. Vérifiez le format et la taille du fichier." };
```

---

### 🔵 FAIBLE

#### SEC-10 — IP rate limiting contournable via `X-Forwarded-For` forgé
**Fichier :** `app/routes/api.auth.$.ts:6-10`  
**Sévérité :** FAIBLE

```ts
request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
```

Si le reverse proxy (Nginx/Traefik) n'écrase pas systématiquement le header `X-Forwarded-For`, un attaquant peut le forger pour contourner le rate limiting par IP.

**Correction :** Configurer le reverse proxy pour écraser ce header avec l'IP réelle du client et ne pas faire confiance aux valeurs existantes.

#### SEC-11 — `.gitignore` incomplet pour les fichiers `.env.*`
**Fichier :** `.gitignore:1`  
**Sévérité :** FAIBLE

Seul `.env` est ignoré. Les variantes `.env.local`, `.env.production`, `.env.staging`, `.env.*.local` ne sont pas couvertes.

**Correction :**
```
.env
.env.*
!.env.example
```

#### SEC-11-bis — `JSON.parse` sans gestion d'erreur sur des données DB
**Fichier :** `app/routes/match-detail.server.ts:83`, `app/routes/soiree.server.ts:250`  
**Sévérité :** MOYEN

```ts
// match-detail.server.ts:83
matchDetails = JSON.parse(match.matchDetails) as MatchDetails;

// soiree.server.ts:250
options: m.options ? JSON.parse(m.options) as string[] : [],
```

Ces colonnes sont stockées via `JSON.stringify` par notre propre code, mais en cas de corruption de la base de données (migration partielle, bug futur), un JSON malformé provoquerait un crash non géré de la page.

**Correction :** Wrapper dans un try-catch :
```ts
try {
  matchDetails = JSON.parse(match.matchDetails) as MatchDetails;
} catch {
  logger.error({ matchId: match.id }, "matchDetails JSON invalide en base");
  matchDetails = null;
}
```

#### SEC-12 — Aucun rate limiting sur les actions du fil (feed) et micro-pronos joueur
**Fichier :** `app/routes/feed.server.ts`, `app/routes/api.micro-predictions.ts:90`  
**Sévérité :** FAIBLE

Les actions de post, commentaire, réaction et réponse aux micro-pronos ne sont pas limitées en fréquence. Un membre authentifié peut spammer le fil ou soumettre de multiples tentatives par script.

**Correction :** Appliquer `checkRateLimit` par userId avec des fenêtres courtes (ex : 5 posts par minute).

---

## 3. Points positifs identifiés

| Domaine | Observation |
|---|---|
| Authentification | BetterAuth correctement configuré avec sessions Redis |
| Validation d'entrée | Schémas Zod appliqués sur register, login, pseudo, événements, feed |
| Contrôle d'accès | `requireAuth` + vérification de rôle cohérente sur toutes les routes admin |
| Autorisation IDOR | Vérification `authorId === session.user.id` avant suppression de posts/commentaires |
| Upload avatar | Limite 2 Mo, allowlist des types, re-encodage WebP via Sharp (défense en profondeur partielle) |
| Logging | Pino configuré avec niveaux et contexte structuré, sans exposition d'informations sensibles |
| Gestion secrets | Credentials retirés du repo (commit `aed5841`), `.env` gitignored |
| Rate limiting auth | Login : 10 tentatives / 15 min par IP, Register : 5 / 1h |
| Gestion d'erreurs | `AppError` centralisé avec codes et statuts HTTP appropriés |
| XSS | Aucun usage de `dangerouslySetInnerHTML` dans toute la codebase |

---

## 4. Plan d'action recommandé

| Priorité | ID | Action | Effort estimé |
|---|---|---|---|
| 🔴 Immédiat | SEC-01 | Corriger la traversée de chemin dans `uploads-files.ts` | 30 min |
| 🟠 Semaine 1 | SEC-06 | Ajouter `input: false` sur le champ `role` dans BetterAuth | 15 min |
| 🟠 Semaine 1 | SEC-04 | Rendre `APP_URL` obligatoire dans `env.server.ts` | 15 min |
| 🟠 Semaine 1 | SEC-02 | Ajouter validation magic bytes pour les uploads | 1h |
| 🟠 Semaine 1 | SEC-03 | Ajouter rate limiting sur les actions profil | 30 min |
| 🟡 Semaine 2 | SEC-07 | Schéma Zod complet pour les micro-pronostics | 1h |
| 🟡 Semaine 2 | SEC-08 | Mettre en place les headers de sécurité HTTP | 2h |
| 🟡 Semaine 2 | SEC-09 | Masquer les messages d'erreur internes | 30 min |
| 🟡 Semaine 2 | SEC-05 | Protéger l'endpoint `/api/health` | 30 min |
| 🔵 Semaine 3 | SEC-10 | Vérifier la conf Nginx/Traefik pour X-Forwarded-For | 1h |
| 🔵 Semaine 3 | SEC-11 | Étendre le `.gitignore` aux variantes `.env.*` | 5 min |
| 🔵 Semaine 3 | SEC-12 | Rate limiting sur le fil et les micro-pronos | 1h |
| 🟡 Semaine 2 | SEC-11-bis | try-catch sur JSON.parse dans match-detail et soiree | 30 min |
| 🟠 Semaine 1 | SEC-06-bis | Masquer les erreurs internes de sync-matches | 15 min |

---

*Document généré automatiquement le 15 juin 2026 — audit statique de la codebase, aucune exploitation active réalisée.*
