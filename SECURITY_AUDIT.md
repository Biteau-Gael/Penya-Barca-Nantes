# Audit de sécurité — Penya Blaugrana Nantes

**Date :** 2026-05-21  
**Branche analysée :** `claude/sharp-fermi-xq2Un`  
**Dernier commit analysé :** `003faca` — fix: évaluer les badges immédiatement après chaque action

---

## Résumé des derniers commits

| Commit | Description | Fichiers clés |
|--------|-------------|---------------|
| `003faca` | Correction : évaluation des badges déclenchée immédiatement après chaque action (pronostic, post, commentaire, réaction) | `feed.server.ts`, `match-detail.server.ts` |
| `b1c88f6` | Phase 2 complète — Soirée match live, micro-pronostics, badges (10 de base), séries de scores, saisons | `soiree.tsx/server`, `badges.server.ts`, `micro-predictions`, schéma DB migration 0007 |
| `d461ee5` | Merge de la branche `deploy-synology-nas` | — |
| `554b873` | Guide de déploiement NAS Synology mis à jour | `DEPLOY.md` |
| `68e22d2` | Menu burger mobile pour la navigation | `header.tsx` |

---

## Analyse de sécurité

---

### CRITIQUE

#### 1. Path Traversal — Route de fichiers uploadés

**Fichier :** `app/routes/uploads-files.ts`

```typescript
// Vulnérable : params["*"] n'est pas sanitisé
const filePath = path.join(process.cwd(), "uploads", params["*"]);
```

Un attaquant peut demander `/uploads-files/../../etc/passwd` ou tout autre chemin relatif pour lire des fichiers arbitraires sur le serveur. `path.join` normalise les segments `..` et ne bloque pas la sortie du répertoire `uploads/`.

**Impact :** Lecture de tout fichier accessible par le processus Node.js (code source, `.env`, clés, base de données SQLite si applicable, `/etc/passwd`, etc.).

**Correction recommandée :**

```typescript
export async function loader({ params }: { params: { "*": string } }) {
  const requested = params["*"];
  const uploadsDir = path.resolve(process.cwd(), "uploads");
  const filePath = path.resolve(uploadsDir, requested);

  // Bloquer toute sortie hors du répertoire uploads
  if (!filePath.startsWith(uploadsDir + path.sep)) {
    return new Response("Forbidden", { status: 403 });
  }
  // ... reste du code
}
```

---

#### 2. Mots de passe par défaut en production (Docker Compose)

**Fichier :** `docker-compose.prod.yml`

```yaml
POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-changeme}
REDIS_PASSWORD=${REDIS_PASSWORD:-changeme}
```

Si le fichier `.env` n'est pas renseigné lors du déploiement, PostgreSQL et Redis utilisent le mot de passe `changeme`, exposant toute la base de données.

**Impact :** Accès complet à la base de données et au cache Redis (sessions utilisateurs incluses) depuis tout service ayant accès réseau au conteneur.

**Correction recommandée :** Supprimer les valeurs par défaut pour forcer une erreur explicite si les variables ne sont pas définies :

```yaml
POSTGRES_PASSWORD=${POSTGRES_PASSWORD:?Variable POSTGRES_PASSWORD manquante}
REDIS_PASSWORD=${REDIS_PASSWORD:?Variable REDIS_PASSWORD manquante}
```

---

### ÉLEVÉE

#### 3. Contournement du rate limiting par usurpation d'IP

**Fichier :** `app/routes/api.auth.$.ts`

```typescript
function getClientIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}
```

La clé de rate limiting est basée sur l'IP extraite des en-têtes `x-forwarded-for` ou `x-real-ip`. Un client peut envoyer un en-tête `X-Forwarded-For` arbitraire et ainsi utiliser une fausse IP pour contourner la limitation.

**Impact :** Un attaquant peut effectuer du brute-force sur les mots de passe en changeant l'IP dans les en-têtes à chaque requête, rendant le rate limiting inopérant.

**Correction recommandée :** Utiliser uniquement l'IP extraite par le reverse proxy de confiance (Nginx/Traefik), configuré pour écraser l'en-tête — ou limiter la confiance au dernier IP de la chaîne `x-forwarded-for` plutôt qu'au premier.

---

#### 4. Absence de rate limiting sur les actions du fil d'actualité

**Fichiers :** `app/routes/feed.server.ts`, `app/routes/api.micro-predictions.ts`

Les actions `create-post`, `comment`, `react` et `answer` (micro-pronostics) ne sont soumises à aucune limitation de débit. Un utilisateur authentifié peut spammer le fil ou saturer la base de données.

**Impact :** Spam massif du fil communautaire, dégradation des performances (N requêtes DB), abus potentiel du système de badges (farming de réactions).

**Correction recommandée :** Appliquer `checkRateLimit` sur ces actions, par exemple :

```typescript
// Dans feedAction, intent "create-post"
await checkRateLimit({
  key: `feed-post:${session.user.id}`,
  maxAttempts: 10,
  windowSeconds: 3600,
});
```

---

### MOYENNE

#### 5. Container Docker exécuté en tant que root

**Fichier :** `Dockerfile`

Le Dockerfile ne crée pas d'utilisateur non-privilégié. Le processus Node.js tourne donc en tant que `root` dans le conteneur.

**Impact :** En cas d'exploitation d'une vulnérabilité dans l'application (comme le path traversal ci-dessus), l'attaquant dispose des droits root à l'intérieur du conteneur, facilitant toute élévation de privilèges ou exfiltration.

**Correction recommandée :** Ajouter un utilisateur dédié dans le Dockerfile :

```dockerfile
FROM node:20-alpine
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
# ... COPY, WORKDIR ...
USER appuser
CMD ["npm", "run", "start"]
```

---

#### 6. En-têtes de sécurité HTTP absents

Aucun en-tête de sécurité HTTP standard n'est configuré dans l'application ou dans la configuration Docker.

**En-têtes manquants :**
- `Content-Security-Policy` — prévient les attaques XSS
- `X-Frame-Options: DENY` — prévient le clickjacking
- `X-Content-Type-Options: nosniff` — prévient le MIME sniffing
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Strict-Transport-Security` (HSTS) — force HTTPS

**Correction recommandée :** Ajouter un middleware dans `root.tsx` ou configurer Nginx/Traefik en reverse proxy avec ces en-têtes.

---

#### 7. `APP_URL` optionnel — `trustedOrigins` potentiellement vide

**Fichier :** `app/lib/server/auth.server.ts`

```typescript
trustedOrigins: env.APP_URL ? [env.APP_URL] : [],
```

Si `APP_URL` n'est pas défini en production, la liste des origines de confiance est vide. Selon le comportement de Better Auth avec une liste vide, cela peut soit tout autoriser, soit tout bloquer selon la version.

**Correction recommandée :** Rendre `APP_URL` obligatoire dans le schéma de validation `env.server.ts` pour la production, ou ajouter une valeur par défaut sûre.

---

#### 8. Accès au rôle via `as any` — contournement du typage

**Fichiers :** `app/routes/feed.server.ts`

```typescript
const isAdmin = (session.user as any).role === "admin";
```

L'utilisation de `as any` contourne les vérifications TypeScript. Si le champ `role` est renommé ou son type modifié, le contrôle d'autorisation peut silencieusement échouer sans erreur de compilation.

**Correction recommandée :** Typer correctement la session avec le type étendu Better Auth, ou utiliser la fonction `requireAuth` avec le paramètre `allowedRoles` déjà disponible dans `auth-utils.server.ts`.

---

### FAIBLE

#### 9. `LOG_LEVEL` configurable — risque en mode `debug`

**Fichier :** `app/config/env.server.ts`

Le niveau de log est configurable via variable d'environnement et accepte `debug`. En mode debug, des données sensibles (corps de requêtes, tokens, paramètres SQL) peuvent être écrites dans les logs.

**Recommandation :** S'assurer que `LOG_LEVEL=debug` n'est jamais activé en production. Documenter cette contrainte dans `.env.example`.

---

#### 10. Condition `exact_scores` du badge "Voyant" — logique imprécise

**Fichier :** `app/lib/server/badges.server.ts`

```typescript
exactScores: sql<number>`count(case when ${matchPredictions.points} >= 3 then 1 end)::int`,
```

Le badge "Voyant" (premier score exact) est attribué si `points >= 3`. Or, dans le système de points standard, 3 points correspondent bien au score exact. Cependant, si le schéma de points change (`pointsScheme`), cette condition peut attribuer le badge de manière incorrecte.

**Recommandation :** Ajouter un champ `isExactScore: boolean` sur `matchPredictions` mis à jour lors du calcul des points, pour découpler la logique badge du barème.

---

## Récapitulatif par criticité

| # | Criticité | Titre | Fichier |
|---|-----------|-------|---------|
| 1 | CRITIQUE | Path Traversal lecture de fichiers arbitraires | `uploads-files.ts` |
| 2 | CRITIQUE | Mots de passe par défaut "changeme" en production | `docker-compose.prod.yml` |
| 3 | ÉLEVÉE | Contournement du rate limiting par usurpation IP | `api.auth.$.ts` |
| 4 | ÉLEVÉE | Absence de rate limiting sur les actions du fil | `feed.server.ts`, `api.micro-predictions.ts` |
| 5 | MOYENNE | Container Docker tourne en root | `Dockerfile` |
| 6 | MOYENNE | En-têtes de sécurité HTTP absents | Configuration globale |
| 7 | MOYENNE | `APP_URL` optionnel → `trustedOrigins` potentiellement vide | `auth.server.ts` |
| 8 | MOYENNE | Accès au rôle via `as any` | `feed.server.ts` |
| 9 | FAIBLE | `LOG_LEVEL=debug` possible en production | `env.server.ts` |
| 10 | FAIBLE | Condition badge "Voyant" couplée au barème de points | `badges.server.ts` |

---

## Points positifs constatés

- **Validation des entrées** : schémas Zod systématiques sur tous les formulaires (`prediction.ts`, `user.ts`, `feed.ts`, `match.ts`).
- **Authentification** : Better Auth avec session Redis, `requireAuth` utilisé cohéremment sur les routes protégées.
- **Rate limiting sur l'authentification** : login (10 tentatives/15 min) et inscription (5/heure) protégés.
- **Upload d'avatars sécurisé** : vérification du type MIME, limite de taille 2 Mo, conversion forcée en WebP via Sharp (pas de stockage de fichiers arbitraires).
- **Contrôle d'autorisation admin** : vérification du rôle `admin` présente sur toutes les actions d'administration.
- **Pas de credentials dans le repo** : commit `aed5841` a nettoyé les secrets, `.gitignore` correctement configuré.
- **Gestion des erreurs** : `AppError` centralisé, pas d'exposition de stack traces aux clients.
- **Drizzle ORM** : requêtes paramétrées nativement, pas de risque d'injection SQL par construction.
