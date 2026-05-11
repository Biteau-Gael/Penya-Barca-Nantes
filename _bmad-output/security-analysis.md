# Analyse de sécurité — Penya Blaugrana Nantes

**Date :** 11 mai 2026  
**Branche :** `claude/sharp-fermi-yTJ2D`  
**Dernier commit analysé :** `003faca` — *fix: évaluer les badges immédiatement après chaque action*

---

## Résumé des derniers commits

### `003faca` — fix: évaluer les badges immédiatement après chaque action *(13 avr. 2026)*
Correctif ciblé : `evaluateBadges()` est désormais appelé dès la soumission d'un pronostic (`match-detail.server.ts`), la publication d'un post ou d'un commentaire et l'ajout d'une réaction (`feed.server.ts`). L'appel est non bloquant (`.catch(() => {})`).

### `b1c88f6` — feat: Phase 2 — soirée match live, micro-pronos, badges, séries, saisons *(13 avr. 2026)*
Fonctionnalités massives (+2 965 lignes) :
- **Soirée match** : route `/soiree/:matchId`, score live (polling API 60 s), fil d'événements en temps réel, pronos communauté révélés au coup d'envoi.
- **Micro-pronostics** : création/clôture/suppression admin, vote joueur, attribution automatique de points.
- **Badges** : 10 badges, évaluation automatique, page `/badges`, affichage profil.
- **Séries (streaks)** : `currentStreak` / `bestStreak` sur l'utilisateur, récompenses palier 3/5/10.
- **Saisons** : table `seasons`, filtre classement, sélecteur archives.
- **Schéma DB** : migration 0007, 6 nouvelles tables / colonnes.

### Commits précédents notables
| Hash | Résumé |
|------|--------|
| `68e22d2` | Menu burger mobile navigation |
| `554b873` | Guide de déploiement mises à jour NAS |
| `6aebaf7` | Fix trusted origins Better Auth (domaine custom) |
| `aed5841` | **security:** suppression credentials du repo, renforcement `.gitignore` |
| `ab7fc5d` | Intégration API Football + stats + classement Liga |

---

## Analyse de sécurité par ordre de criticité

---

### 🔴 CRITIQUE

#### C-01 — Path traversal sur le serveur de fichiers statiques
**Fichier :** `app/routes/uploads-files.ts`  
**Ligne :** 7

```ts
const filePath = path.join(process.cwd(), "uploads", params["*"]);
```

`path.join` résout les composants `..`, ce qui permet à un attaquant d'échapper au répertoire `uploads/` et de lire n'importe quel fichier accessible au processus Node (ex. `.env`, clés privées, code source).

**Exemple d'exploitation :**
```
GET /uploads-files/../../.env
GET /uploads-files/../../app/config/env.server.ts
```

**Correction :**
```ts
const UPLOADS_DIR = path.resolve(process.cwd(), "uploads");
const filePath = path.resolve(UPLOADS_DIR, params["*"]);

if (!filePath.startsWith(UPLOADS_DIR + path.sep)) {
  return new Response("Not found", { status: 404 });
}
```

---

### 🟠 ÉLEVÉ

#### H-01 — Suppression de compte sans invalidation des sessions Redis
**Fichier :** `app/routes/profile.server.ts`, intent `delete-account`  
**Ligne :** ~115

Quand un utilisateur supprime son compte, seule la ligne en base de données est supprimée. Les tokens de session stockés dans Redis restent valides jusqu'à expiration naturelle. Un token volé avant la suppression reste donc exploitable.

**Correction :** Appeler `auth.api.signOut()` ou supprimer explicitement toutes les clés Redis de l'utilisateur avant de le supprimer de la DB.

---

#### H-02 — Absence de validation de longueur sur le champ `answer` des micro-pronostics
**Fichier :** `app/routes/api.micro-predictions.ts`, intent `answer`  
**Ligne :** ~81

Le champ `answer` est inséré en DB sans aucune validation de longueur ni de contenu. Un utilisateur peut soumettre des réponses arbitrairement longues (attaque de type DB bombing / surcharge).

**Correction :** Ajouter une validation Zod :
```ts
const answerSchema = z.string().min(1).max(200);
const parsed = answerSchema.safeParse(answer);
if (!parsed.success) return Response.json({ error: "Réponse invalide" }, { status: 400 });
```

---

#### H-03 — Absence de rate limiting sur l'API micro-pronostics
**Fichier :** `app/routes/api.micro-predictions.ts`

Aucun rate limiting n'est appliqué sur les actions `answer`, `create`, `close` ou `delete`. Le module `checkRateLimit` existe mais n'est pas utilisé ici. Cela permet des attaques par spam ou bruteforce d'IDs.

**Correction :** Ajouter pour l'action `answer` :
```ts
await checkRateLimit({
  key: `micro-answer:${session.user.id}`,
  maxAttempts: 20,
  windowSeconds: 60,
});
```

---

#### H-04 — `trustedOrigins` vide si `APP_URL` non défini en production
**Fichier :** `app/lib/server/auth.server.ts`  
**Ligne :** 14

```ts
trustedOrigins: env.APP_URL ? [env.APP_URL] : [],
```

Si `APP_URL` n'est pas configuré (omission dans le `.env` de production), Better Auth accepte toutes les origines par défaut ou aucune selon sa configuration interne. Ce comportement implicite peut ouvrir des failles CSRF ou bloquer le login en production sans message d'erreur clair.

**Correction :** Rendre `APP_URL` obligatoire en production dans `env.server.ts` :
```ts
APP_URL: z.string().url().optional().refine(
  (val) => process.env.NODE_ENV !== "production" || !!val,
  { message: "APP_URL est requis en production" }
),
```

---

### 🟡 MOYEN

#### M-01 — Race condition dans le rate limiter Redis
**Fichier :** `app/lib/server/rate-limit.server.ts`  
**Lignes :** 18–22

```ts
const current = await redis.incr(redisKey);
if (current === 1) {
  await redis.expire(redisKey, windowSeconds);
}
```

Les commandes `INCR` et `EXPIRE` ne sont pas atomiques. En cas de crash ou de coupure entre les deux, la clé n'expire jamais, bloquant définitivement un utilisateur. En haute concurrence, le TTL peut ne pas être positionné.

**Correction :** Utiliser un pipeline atomique Redis :
```ts
const pipeline = redis.multi();
pipeline.incr(redisKey);
pipeline.expire(redisKey, windowSeconds, "NX"); // NX = ne set que si absent
const [current] = await pipeline.exec() as [number, ...unknown[]];
```

---

#### M-02 — `JSON.parse(badge.condition)` sans gestion d'erreur
**Fichier :** `app/lib/server/badges.server.ts`  
**Ligne :** ~136

```ts
const condition = JSON.parse(badge.condition) as { type: string; threshold: number };
```

Si la colonne `condition` contient un JSON malformé (corruption DB, bug de migration), l'appel lèvera une exception non catchée, faisant échouer silencieusement toute évaluation de badge pour l'utilisateur concerné.

**Correction :** Entourer d'un try/catch ou utiliser une validation Zod sur le résultat parsé.

---

#### M-03 — `pointsScheme` non validé côté serveur
**Fichier :** `app/routes/admin.matches.server.ts`  
**Lignes :** ~64 et ~97

```ts
const pointsScheme = (formData.get("pointsScheme") as string) || "standard";
```

La valeur est insérée directement en DB sans vérification qu'elle fait partie des schémas autorisés. Cela peut introduire des valeurs inconnues traitées par `calculatePoints` en tant que cas `default`, silencieusement.

**Correction :**
```ts
const VALID_SCHEMES = ["standard", "bonus"] as const;
const pointsScheme = VALID_SCHEMES.includes(formData.get("pointsScheme") as any)
  ? formData.get("pointsScheme") as string
  : "standard";
```

---

#### M-04 — `deadlineSeconds` non protégé contre NaN dans les micro-pronostics
**Fichier :** `app/routes/api.micro-predictions.ts`  
**Ligne :** ~27

```ts
const deadlineSeconds = parseInt(formData.get("deadlineSeconds") as string) || 120;
```

`parseInt("abc")` retourne `NaN`. `NaN || 120` retourne correctement `120` dans ce cas, mais `parseInt("0")` retourne `0`, et `0 || 120` retourne `120` — rendant impossible de poser une deadline de 0 seconde. Ce n'est pas un risque sécurité grave mais un comportement inattendu.

**Correction :** `const deadlineSeconds = Math.max(0, parseInt(...) || 120);`

---

#### M-05 — Logs d'authentification insuffisants (tentatives échouées non loguées)
**Fichier :** `app/lib/server/auth.server.ts`  
**Ligne :** 60

```ts
logger: { disabled: false, level: "error" },
```

Seules les erreurs de Better Auth sont loguées. Les tentatives de connexion échouées (mauvais mot de passe, compte inexistant) ne produisent aucun log applicatif. Cela rend indétectables les attaques par bruteforce qui ne déclenchent pas d'erreur interne.

**Correction :** Passer au niveau `"warn"` pour capturer les échecs d'authentification.

---

#### M-06 — `(session.user as any).role` — typage contourné
**Fichiers :** `app/routes/feed.server.ts` (lignes ~18, ~90), et potentiellement d'autres  

Le rôle est accédé via un cast `as any`, signe que le type `Session` de Better Auth ne l'expose pas nativement. Ce contournement désactive les vérifications TypeScript sur ce champ critique.

**Correction :** Étendre le type Session avec un module de déclaration :
```ts
declare module "better-auth" {
  interface User {
    role: "member" | "admin" | "partner";
  }
}
```

---

### 🔵 FAIBLE

#### L-01 — `highlightUrl` externe non validée avant exposition
**Fichier :** `app/lib/server/api-football.server.ts`  
**Ligne :** ~305

L'URL de highlight est retournée telle quelle depuis l'API externe et exposée au frontend. Si l'API renvoie une URL malveillante (`javascript:`, `data:` URI), elle pourrait être utilisée dans un attribut `href` ou `src`.

**Recommandation :** Valider que l'URL commence par `https://` avant de la retourner.

---

#### L-02 — Absence de Content Security Policy (CSP)
Aucun header CSP n'est configuré dans le projet. En cas de XSS (même mineur), l'absence de CSP permet l'exécution de scripts arbitraires et l'exfiltration de données.

**Recommandation :** Ajouter un middleware CSP dans `entry.server.tsx` ou au niveau du reverse proxy (Nginx).

---

#### L-03 — Cache-Control `immutable` sur les avatars sans versioning d'URL
**Fichier :** `app/routes/uploads-files.ts`  
**Ligne :** 22

```ts
"Cache-Control": "public, max-age=31536000, immutable",
```

Les avatars sont identifiés par `{userId}.webp`. Si un utilisateur change d'avatar, l'ancien est mis en cache côté navigateur pendant 1 an (`immutable`). Les autres membres verront l'ancien avatar indéfiniment.

**Correction :** Ajouter un paramètre de cache-busting (timestamp) à l'URL lors de la mise à jour de l'avatar.

---

## Tableau récapitulatif

| ID | Criticité | Fichier principal | Impact |
|----|-----------|-------------------|--------|
| C-01 | 🔴 CRITIQUE | `uploads-files.ts` | Lecture de fichiers arbitraires sur le serveur |
| H-01 | 🟠 ÉLEVÉ | `profile.server.ts` | Session persistante après suppression de compte |
| H-02 | 🟠 ÉLEVÉ | `api.micro-predictions.ts` | Injection de données volumineuses en DB |
| H-03 | 🟠 ÉLEVÉ | `api.micro-predictions.ts` | Spam / déni de service applicatif |
| H-04 | 🟠 ÉLEVÉ | `auth.server.ts` | CSRF potentiel ou blocage silencieux en production |
| M-01 | 🟡 MOYEN | `rate-limit.server.ts` | Blocage permanent d'utilisateurs légitimes |
| M-02 | 🟡 MOYEN | `badges.server.ts` | Crash silencieux évaluation badges |
| M-03 | 🟡 MOYEN | `admin.matches.server.ts` | Valeurs non contrôlées en DB |
| M-04 | 🟡 MOYEN | `api.micro-predictions.ts` | Comportement inattendu deadline 0 |
| M-05 | 🟡 MOYEN | `auth.server.ts` | Bruteforce non détectable |
| M-06 | 🟡 MOYEN | `feed.server.ts` (et autres) | Contournement typage rôle admin |
| L-01 | 🔵 FAIBLE | `api-football.server.ts` | URL externe non validée |
| L-02 | 🔵 FAIBLE | Global | Absence de protection XSS CSP |
| L-03 | 🔵 FAIBLE | `uploads-files.ts` | Avatars en cache après mise à jour |

---

## Points positifs constatés

- `.env` absent du dépôt (`.gitignore` correct, commit `aed5841` a nettoyé les credentials).
- Validation Zod systématique sur les entrées utilisateur (pronostics, posts, commentaires, inscriptions, pseudo).
- `requireAuth` et `requireAuth(request, ["admin"])` appliqués sur toutes les routes protégées.
- Rate limiting Redis implémenté et utilisé sur les routes sensibles (login, inscription).
- Upload d'avatar sécurisé : vérification MIME, taille max 2 Mo, conversion forcée en WebP via `sharp`.
- Drizzle ORM utilisé avec des paramètres liés — pas de concaténation SQL brute (sauf `sql` template tag correctement utilisé).
- Gestion structurée des erreurs via `AppError`.
- Journalisation structurée (pino) avec contexte utilisateur/action sur les opérations sensibles.
