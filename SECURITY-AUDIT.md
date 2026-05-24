# Rapport d'audit sécurité — Penya Blaugrana Nantes

> Date : 2026-05-24  
> Périmètre : commits récents + analyse statique du code source  
> Branche auditée : `claude/sharp-fermi-aSk5p`

---

## Résumé des derniers commits

| Hash | Type | Description |
|------|------|-------------|
| `003faca` | fix | Badges évalués immédiatement après chaque action utilisateur (feed, match-detail) |
| `b1c88f6` | feat | **Phase 2** — Soirée match live, micro-pronos, badges, séries, saisons (2965 lignes ajoutées) |
| `d461ee5` | merge | Fusion branche deploy-synology-nas |
| `554b873` | docs | Guide de déploiement Synology NAS |
| `4a65a7b` | feat | Menu burger mobile |
| `6aebaf7` | fix | Better Auth — origines de confiance pour domaine personnalisé |
| `9823bc5` | fix | Service `migrate` ajouté à docker-compose.prod.yml |
| `aed5841` | security | **Suppression des credentials du repo + renforcement .gitignore** |

---

## Analyse de sécurité par ordre de criticité

---

### 🔴 CRITIQUE

#### SEC-01 — Path Traversal dans le serveur de fichiers

**Fichier :** `app/routes/uploads-files.ts:5`  
**Commit introduisant le risque :** `ab7fc5d` (MVP Phase 1)

```ts
const filePath = path.join(process.cwd(), "uploads", params["*"]);
const file = await readFile(filePath);
```

Le paramètre wildcard `params["*"]` capture toute séquence de chemin, y compris `../../../etc/passwd`. Bien que `path.join` normalise les segments, il ne bloque pas les remontées de répertoire si la valeur commence par `../`. Un attaquant peut lire n'importe quel fichier accessible par le processus Node.js.

**Correction recommandée :**

```ts
import path from "node:path";

const UPLOAD_DIR = path.join(process.cwd(), "uploads");
const requestedPath = params["*"];

// Résoudre le chemin absolu et vérifier qu'il reste sous UPLOAD_DIR
const filePath = path.resolve(UPLOAD_DIR, requestedPath);
if (!filePath.startsWith(UPLOAD_DIR + path.sep) && filePath !== UPLOAD_DIR) {
  return new Response("Interdit", { status: 403 });
}
```

---

### 🟠 ÉLEVÉ

#### SEC-02 — En-têtes de sécurité HTTP absents

**Fichier :** `app/root.tsx` (aucun en-tête défini), serveur global  
**Impact :** Clickjacking, MIME-sniffing, absence de HSTS, pas de CSP

Aucun des en-têtes de sécurité recommandés n'est positionné :

| En-tête | Risque si absent |
|---------|-----------------|
| `Content-Security-Policy` | XSS, injection de scripts tiers |
| `X-Frame-Options: DENY` | Clickjacking |
| `X-Content-Type-Options: nosniff` | MIME-sniffing (important sur `/uploads/*`) |
| `Strict-Transport-Security` | Downgrade HTTPS → HTTP en production |
| `Referrer-Policy` | Fuite d'URL vers des tiers |

**Correction recommandée :** Ajouter un middleware Express/React Router qui pose ces en-têtes sur toutes les réponses, ou utiliser la bibliothèque `helmet`.

---

#### SEC-03 — Mots de passe Docker par défaut faibles en production

**Fichier :** `docker-compose.prod.yml:19,25`

```yaml
POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-changeme}
redis-server --requirepass ${REDIS_PASSWORD:-changeme}
```

Si le fichier `.env` n'est pas présent ou incomplet en production, les bases de données démarrent avec le mot de passe `changeme`, exposant potentiellement les données si les ports sont accessibles.

**Correction recommandée :** Supprimer les valeurs par défaut (`:-changeme`) pour forcer une erreur explicite si les variables ne sont pas définies, ou utiliser Docker Secrets.

---

#### SEC-04 — Credentials dans l'historique Git

**Commit :** `aed5841` (qui les a supprimés, mais l'historique les conserve)

Les valeurs suivantes ont été committées puis retirées :
- `DATABASE_URL` avec mot de passe : `penya_secret`
- `AUTH_SECRET` : `change-me-in-production-min-16-chars`
- Fichier `.claude/settings.local.json` avec potentiellement d'autres données

Si le dépôt est ou a été public, ces valeurs sont à considérer comme compromises.

**Correction recommandée :** Effectuer une rotation des secrets si ceux-ci correspondent à des valeurs de production réelles. Pour nettoyer l'historique Git, utiliser `git filter-repo` (hors périmètre de cet audit).

---

### 🟡 MOYEN

#### SEC-05 — Absence de rate limiting sur les actions métier

**Fichiers :** `app/routes/feed.server.ts`, `app/routes/api.micro-predictions.ts`, `app/routes/profile.server.ts`  
**Rate limiting existant :** uniquement sur `/api/auth/sign-in` et `/api/auth/sign-up` (`app/routes/api.auth.$.ts`)

Les actions suivantes n'ont aucune limitation de fréquence :
- Création de posts et commentaires (spam possible)
- Soumission de réactions (flood possible)
- Vote sur micro-pronostics (tentatives multiples)
- Upload d'avatar (abus de stockage)

**Correction recommandée :** Appliquer `checkRateLimit` (déjà disponible dans `app/lib/server/rate-limit.server.ts`) sur ces routes, par exemple 20 posts/heure par utilisateur.

---

#### SEC-06 — Container Docker exécuté en root

**Fichier :** `Dockerfile`  
**Ligne :** aucune directive `USER` dans l'image finale

```dockerfile
FROM node:20-alpine
# ...aucun USER défini → exécution en root
CMD ["npm", "run", "start"]
```

Si une vulnérabilité permet l'exécution de code arbitraire, l'attaquant obtient les droits root dans le container.

**Correction recommandée :**

```dockerfile
FROM node:20-alpine
# ... COPY, etc.
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser
CMD ["npm", "run", "start"]
```

---

#### SEC-07 — SQL brut dans `badges.server.ts`

**Fichier :** `app/lib/server/badges.server.ts:141-142`

```ts
.from(sql`"user"`)
.where(sql`id = ${userId}`)
```

La variable `userId` est correctement paramétrée par le tag template Drizzle (pas d'injection SQL directe), mais ce pattern contourne l'ORM et pourrait devenir risqué si copié sans précaution. De plus, cela indique que la table `user` n'est pas correctement référencée via le schéma Drizzle.

**Correction recommandée :** Utiliser la référence Drizzle standard `user` (déjà importée dans d'autres fichiers) plutôt que le fragment SQL brut.

---

### 🔵 FAIBLE

#### SEC-08 — `APP_URL` optionnelle → `trustedOrigins` vide

**Fichier :** `app/lib/server/auth.server.ts:12`

```ts
trustedOrigins: env.APP_URL ? [env.APP_URL] : [],
```

Si `APP_URL` n'est pas défini, la liste des origines de confiance est vide. Le comportement dépend de Better Auth : si par défaut toutes les origines sont acceptées, cela désactive la protection CSRF.

**Correction recommandée :** Documenter explicitement que `APP_URL` est obligatoire en production, et ajouter une validation dans `env.server.ts` qui rend cette variable requise pour `NODE_ENV=production`.

---

#### SEC-09 — Cast `as any` pour le rôle utilisateur

**Fichiers :** `app/routes/feed.server.ts`, `app/routes/soiree.server.ts`

```ts
isAdmin: (session.user as any).role === "admin"
```

Le cast `as any` contourne la vérification de type TypeScript. Si le champ `role` change de nom ou de type, la vérification silencieuse échouera sans erreur de compilation.

**Correction recommandée :** Étendre le type `Session` de Better Auth avec les champs additionnels, ou utiliser `requireAuth(request, ["admin"])` qui est déjà disponible et correctement typé.

---

#### SEC-10 — En-tête `X-Content-Type-Options` absent sur les uploads

**Fichier :** `app/routes/uploads-files.ts:19-24`

Les fichiers servis depuis `/uploads/*` n'ont pas l'en-tête `X-Content-Type-Options: nosniff`. Si un fichier malveillant était uploadé avec une mauvaise extension, certains navigateurs pourraient l'interpréter comme du HTML/JS.

**Note :** Le risque est limité grâce au retraitement systématique des avatars via `sharp` (conversion en WebP), mais l'en-tête reste recommandé.

---

## Récapitulatif

| ID | Criticité | Statut | Fichier principal |
|----|-----------|--------|-------------------|
| SEC-01 | 🔴 Critique | À corriger | `uploads-files.ts` |
| SEC-02 | 🟠 Élevé | À corriger | `root.tsx` / serveur global |
| SEC-03 | 🟠 Élevé | À corriger | `docker-compose.prod.yml` |
| SEC-04 | 🟠 Élevé | Rotation à envisager | Historique Git |
| SEC-05 | 🟡 Moyen | À corriger | `feed.server.ts`, etc. |
| SEC-06 | 🟡 Moyen | À corriger | `Dockerfile` |
| SEC-07 | 🟡 Moyen | À améliorer | `badges.server.ts` |
| SEC-08 | 🔵 Faible | À documenter | `auth.server.ts` |
| SEC-09 | 🔵 Faible | À améliorer | `feed.server.ts` |
| SEC-10 | 🔵 Faible | À améliorer | `uploads-files.ts` |

## Points positifs relevés

- Validation des variables d'environnement via Zod (`env.server.ts`) — toute variable manquante plante au démarrage.
- Rate limiting Redis sur login/register avec fenêtre glissante.
- Validation des inputs utilisateur avec Zod sur les routes critiques (prédictions, posts, commentaires).
- Authentification centralisée via `requireAuth` et `getSession`.
- Upload d'avatars : validation de type MIME, limite de taille (2 Mo), reconversion systématique en WebP via `sharp`.
- Vérification de propriété avant suppression de posts/commentaires.
- Protection admin : un admin ne peut pas modifier son propre rôle.
- Credentials retirés du dépôt (commit `aed5841`).
- `.gitignore` correctement configuré (`.env`, `.claude/`, uploads).
