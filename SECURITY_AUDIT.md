# Audit de sécurité — Penya Blaugrana Nantes

**Date :** 2026-09-30  
**Périmètre :** Commits récents (Phase 2 + déploiement NAS)  
**Branche analysée :** `main` (HEAD : `003faca`)

---

## Résumé des derniers commits

| SHA | Auteur | Date | Description |
|-----|--------|------|-------------|
| `003faca` | Biteau Gaël | 2026-04-13 | fix: évaluer les badges immédiatement après chaque action |
| `b1c88f6` | Biteau Gaël | 2026-04-13 | feat: Phase 2 — soirée match live, micro-pronos, badges, séries, saisons |
| `d461ee5` | Claude | 2026-04-12 | Merge branch 'claude/deploy-synology-nas-cLkOL' |
| `554b873` | Claude | 2026-04-12 | Add deployment guide for Synology NAS updates |
| `68e22d2` | Biteau Gaël | 2026-04-13 | feat: menu burger mobile pour la navigation |
| `6aebaf7` | Claude | 2026-04-12 | Fix Better Auth trusted origins for custom domain support |
| `9823bc5` | Claude | 2026-04-12 | Add migrate service to docker-compose.prod.yml |
| `8d6e5e9` | Claude | 2026-04-12 | Add production Docker Compose and backup script for Synology NAS |
| `aed5841` | Biteau Gaël | 2026-04-12 | security: supprimer credentials du repo et renforcer .gitignore |

---

## Résultats de l'audit — par ordre de criticité

---

### 🔴 CRITIQUE — Path Traversal dans le serveur de fichiers

**Fichier :** `app/routes/uploads-files.ts`  
**Statut :** ✅ **CORRIGÉ dans ce commit**

**Problème :**  
Le paramètre wildcard `params["*"]` était utilisé directement avec `path.join` sans validation. Un attaquant authentifié pouvait contourner le répertoire `uploads/` en forgeant une URL du type :

```
GET /uploads/../.env
GET /uploads/../../etc/passwd
```

**Impact :** Lecture de n'importe quel fichier lisible par le processus Node (`.env`, secrets, code source, etc.).

**Correction appliquée :**

```typescript
const uploadRoot = path.join(process.cwd(), "uploads");
const filePath = path.resolve(uploadRoot, params["*"]);

if (!filePath.startsWith(uploadRoot + path.sep) && filePath !== uploadRoot) {
  return new Response("Not found", { status: 404 });
}
```

`path.resolve` normalise les segments `..`, puis la vérification de préfixe garantit que le chemin final reste dans `uploads/`.

---

### 🟠 HAUTE — Mots de passe par défaut dans les fichiers Docker

**Fichiers :** `docker-compose.yml`, `docker-compose.prod.yml`

**Problème :**  
Les deux fichiers utilisent une valeur de repli `changeme` si les variables d'environnement ne sont pas définies :

```yaml
POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-changeme}
```
```yaml
redis-server --requirepass ${REDIS_PASSWORD:-changeme}
```

**Impact :** Si le déploiement est effectué sans fichier `.env` correctement rempli, PostgreSQL et Redis seront accessibles avec le mot de passe trivial `changeme`. Sur un NAS Synology exposé, cela représente un risque d'accès complet à la base de données.

**Recommandation :**  
Remplacer les valeurs de repli par une absence de valeur par défaut pour forcer une erreur explicite au démarrage :

```yaml
POSTGRES_PASSWORD=${POSTGRES_PASSWORD:?Variable POSTGRES_PASSWORD requise}
```

---

### 🟠 HAUTE — Absence de rate-limiting sur les routes métier

**Fichiers :** `app/routes/feed.server.ts`, `app/routes/api.micro-predictions.ts`, `app/routes/match-detail.server.ts`

**Problème :**  
Le rate-limiting n'est appliqué qu'aux routes d'authentification (`/api/auth/sign-in`, `/api/auth/sign-up`). Les routes métier n'ont aucune protection contre les requêtes abusives :

- Création de posts (`intent=create-post`) : aucune limite
- Création de commentaires (`intent=comment`) : aucune limite
- Soumission de pronostics : aucune limite
- Votes micro-pronostics (`intent=answer`) : aucune limite

**Impact :** Un utilisateur malveillant peut inonder le fil d'activité, spammer des pronostics, ou saturer la base de données.

**Recommandation :**  
Appliquer `checkRateLimit` (déjà disponible dans `app/lib/server/rate-limit.server.ts`) sur chaque action utilisateur :

```typescript
await checkRateLimit({
  key: `post:${session.user.id}`,
  maxAttempts: 10,
  windowSeconds: 60,
});
```

---

### 🟡 MOYENNE — Réponse correcte exposée aux joueurs avant clôture

**Fichier :** `app/routes/soiree.server.ts` (ligne 257)

**Problème :**  
Le loader de la page soirée retourne `correctAnswer` pour tous les micro-pronostics, y compris ceux non encore clôturés :

```typescript
correctAnswer: m.correctAnswer,  // exposé même si closedAt === null
```

**Impact :** Si un admin pré-remplit la réponse correcte avant de clôturer le micro-pronostic, un joueur inspectant les données réseau (`Network > Fetch/XHR`) peut voir la réponse attendue et tricher.

**Recommandation :**  
N'inclure `correctAnswer` que si le micro-pronostic est clôturé :

```typescript
correctAnswer: m.closedAt ? m.correctAnswer : null,
```

---

### 🟡 MOYENNE — Contournement du typage TypeScript pour les contrôles de rôle

**Fichier :** `app/routes/feed.server.ts` (lignes 99, 124, 184, 200)

**Problème :**  
Le champ `role` de l'utilisateur est accédé via un cast `as any` :

```typescript
const isAdmin = (session.user as any).role === "admin";
```

**Impact :** Ce n'est pas directement exploitable (la valeur vient de la base de données via Better Auth), mais ce pattern contourne la vérification de type et peut masquer des régressions si le schéma des champs additionnels de Better Auth change. La fonction `requireAuth` dans `auth-utils.server.ts` gère correctement les rôles — les vérifications locales devraient s'appuyer sur le même mécanisme ou typer correctement `session.user`.

**Recommandation :**  
Créer un type utilitaire ou utiliser la fonction centralisée `requireAuth` avec le rôle approprié.

---

### 🟢 FAIBLE — Mot de passe Redis visible dans la commande healthcheck

**Fichier :** `docker-compose.prod.yml`

**Problème :**  
```yaml
test: ["CMD", "redis-cli", "-a", "${REDIS_PASSWORD:-changeme}", "ping"]
```

Le mot de passe Redis apparaît en clair dans les arguments de la commande, visible dans `docker inspect`, les logs de démarrage, et les outils de supervision.

**Recommandation :**  
Utiliser une commande qui évite d'exposer le mot de passe dans les arguments de processus :

```yaml
test: ["CMD-SHELL", "redis-cli -a \"$$REDIS_PASSWORD\" ping || exit 1"]
```

---

## Bonnes pratiques confirmées

Les éléments suivants ont été vérifiés et sont conformes :

- ✅ **`.env` hors du dépôt** — `.gitignore` inclut `.env` ; commit `aed5841` a supprimé les credentials précédemment exposés
- ✅ **Validation des entrées utilisateur** — Zod utilisé systématiquement (`createPostSchema`, `createCommentSchema`, validations prediction/match/user)
- ✅ **Authentification centralisée** — `requireAuth` utilisé sur toutes les routes protégées
- ✅ **Contrôle des rôles admin** — Routes admin protégées par `requireAuth(request, ["admin"])`
- ✅ **Upload d'avatars sécurisé** — Validation du type MIME, limite de taille 2 Mo, retraitement via `sharp` (élimine les métadonnées et les payloads cachés dans les images)
- ✅ **Requêtes paramétrées** — Drizzle ORM utilisé partout (pas de concaténation de SQL brut)
- ✅ **Gestion de session via Redis** — Sessions stockées côté serveur, non dans des cookies signés uniquement
- ✅ **Rate-limiting sur l'authentification** — 10 tentatives/15 min pour la connexion, 5 tentatives/h pour l'inscription
- ✅ **Variables d'environnement validées au démarrage** — Zod sur `process.env` dans `env.server.ts`
- ✅ `APP_URL` utilisé comme `trustedOrigins` dans Better Auth (protection CSRF)

---

## Actions prioritaires

| Priorité | Action | Fichier |
|----------|--------|---------|
| 1 — ✅ Fait | Corriger path traversal | `uploads-files.ts` |
| 2 | Ajouter rate-limit sur les actions feed/pronos | `feed.server.ts`, `api.micro-predictions.ts` |
| 3 | Masquer `correctAnswer` tant que non clôturé | `soiree.server.ts` |
| 4 | Supprimer les mots de passe par défaut Docker | `docker-compose.yml`, `docker-compose.prod.yml` |
| 5 | Corriger healthcheck Redis | `docker-compose.prod.yml` |
