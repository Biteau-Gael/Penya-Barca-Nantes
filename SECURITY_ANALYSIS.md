# Analyse de Sécurité — Penya Blaugrana Nantes

**Date :** 2026-09-21  
**Branche analysée :** `main` (commit `003facad`)  
**Analyste :** Revue automatique (Claude Code)

---

## Résumé des derniers commits

| Date | Commit | Description |
|------|--------|-------------|
| 2026-04-13 | `003facad` | fix: évaluation des badges après chaque action utilisateur |
| 2026-04-13 | `b1c88f67` | feat: Phase 2 — soirée match live, micro-pronos, badges, séries, saisons |
| 2026-04-12 | `d461ee53` | Merge branch deploy Synology NAS |
| 2026-04-12 | `554b873a` | Add deployment guide for Synology NAS |
| 2026-04-12 | `68e22d2b` | feat: menu burger mobile |
| 2026-04-12 | `6aebaf76` | Fix Better Auth trusted origins pour le domaine custom |
| 2026-04-12 | `9823bc58` | Add migrate service dans docker-compose.prod.yml |
| 2026-04-12 | `8d6e5e96` | Add production Docker Compose + backup.sh |
| 2026-04-12 | `aed58411` | **security:** suppression des credentials du repo, renforcement .gitignore |
| 2026-04-12 | `ab7fc5d1` | feat: intégration API Football + stats enrichies + classement Liga |
| 2026-04-11 | `16c43e66` | feat: MVP Phase 1 — Epics 1 à 6 complets |

La Phase 2 représente le gros de l'ajout récent (micro-pronostics, badges, séries, saisons, page soirée live). Le commit sécurité `aed58411` a corrigé une exposition de credentials dans le repo.

---

## Conventions de sécurité respectées ✅

- `.env` exclu du git via `.gitignore` ✓
- `.claude/` exclu du git ✓
- `docker-compose.yml` et `docker-compose.dev.yml` utilisent `env_file` (plus de credentials en dur) ✓
- `.env.example` avec des placeholders uniquement ✓
- `requireAuth()` systématiquement appelé sur toutes les routes protégées ✓
- Vérification du rôle admin avant chaque opération sensible ✓
- ORM Drizzle paramétré → protection contre l'injection SQL ✓
- Validation des entrées utilisateur avec Zod ✓
- Upload d'avatar avec contrôle de type MIME et redimensionnement via `sharp` ✓
- `AUTH_SECRET` forcé à 16 caractères minimum (validation Zod) ✓
- Better Auth pour la gestion des sessions (bibliothèque robuste) ✓
- Rate limiting implémenté dans `rate-limit.server.ts` ✓

---

## Remarques de sécurité par ordre de criticité

---

### 🔴 CRITIQUE

#### 1. Path Traversal — `app/routes/uploads-files.ts`

**Fichier :** `app/routes/uploads-files.ts`  
**Ligne :** 5

```ts
const filePath = path.join(process.cwd(), "uploads", params["*"]);
```

Le paramètre `params["*"]` est utilisé directement pour construire le chemin de fichier sans vérification que le chemin résultant reste dans le répertoire `uploads/`. `path.join` ne bloque pas les séquences `../`, ce qui permet à un attaquant de lire des fichiers arbitraires sur le serveur (ex : `/uploads/../../etc/passwd` → `/etc/passwd`).

**Correction recommandée :**

```ts
const UPLOADS_BASE = path.join(process.cwd(), "uploads");
const filePath = path.join(UPLOADS_BASE, params["*"]);

// Vérifier que le chemin reste dans uploads/
if (!filePath.startsWith(UPLOADS_BASE + path.sep)) {
  return new Response("Not found", { status: 404 });
}
```

---

#### 2. Mots de passe par défaut en production — `docker-compose.prod.yml`

**Fichier :** `docker-compose.prod.yml`  
**Lignes :** 21, 29

```yaml
POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-changeme}
command: redis-server --requirepass ${REDIS_PASSWORD:-changeme}
```

Si le fichier `.env` de production est absent ou incomplet, les mots de passe par défaut `changeme` sont utilisés. Cela expose la base de données et Redis à un accès non autorisé trivial.

**Correction recommandée :** Supprimer les fallbacks `:-changeme` et laisser Docker échouer au démarrage si la variable n'est pas définie, plutôt que démarrer avec un mot de passe faible.

```yaml
POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?POSTGRES_PASSWORD doit être défini}
```

---

### 🟠 ÉLEVÉ

#### 3. Absence de headers de sécurité HTTP

**Impact :** XSS, clickjacking, sniffing de type MIME  

Aucun middleware ne définit les headers de sécurité standards :
- `Content-Security-Policy`
- `X-Frame-Options: DENY`
- `X-Content-Type-Options: nosniff`
- `Strict-Transport-Security`
- `Referrer-Policy`

**Correction recommandée :** Ajouter un middleware dans `entry.server.tsx` ou configurer le reverse proxy Synology pour injecter ces headers.

---

#### 4. Mot de passe Redis exposé dans les logs système — `docker-compose.prod.yml`

**Fichier :** `docker-compose.prod.yml`  
**Ligne :** 30

```yaml
test: ["CMD", "redis-cli", "-a", "${REDIS_PASSWORD:-changeme}", "ping"]
```

Le mot de passe Redis est passé en argument CLI dans le healthcheck, ce qui le rend visible via `docker inspect` et dans la liste des processus (`ps aux`).

**Correction recommandée :** Utiliser la variable d'environnement `REDISCLI_AUTH` :

```yaml
test: ["CMD-SHELL", "REDISCLI_AUTH=$$REDIS_PASSWORD redis-cli ping"]
```

---

#### 5. Rate limiting non confirmé sur les endpoints d'authentification

**Fichier :** `app/lib/server/rate-limit.server.ts`

La fonction `checkRateLimit` est définie mais son application aux routes `/api/auth/sign-in` et `/api/auth/sign-up` n'est pas visible dans le code analysé. Sans rate limiting sur ces endpoints, une attaque par force brute des mots de passe est possible.

**Action :** Vérifier si Better Auth active son propre rate limiting en production, ou appliquer `checkRateLimit` manuellement sur les actions d'authentification.

---

### 🟡 MOYEN

#### 6. `trustedOrigins` vide si `APP_URL` non défini — `app/lib/server/auth.server.ts`

**Fichier :** `app/lib/server/auth.server.ts`  
**Ligne :** 11

```ts
trustedOrigins: env.APP_URL ? [env.APP_URL] : [],
```

En l'absence de `APP_URL` (développement, CI), la liste des origines de confiance est vide. Le comportement de Better Auth avec une liste vide mérite d'être documenté et testé : est-ce que toutes les origines sont acceptées ou refusées ?

**Recommandation :** Documenter ce comportement et en développement, ajouter explicitement `http://localhost:3000`.

---

#### 7. Typage contourné pour les vérifications de rôle — plusieurs fichiers

**Fichiers :** `app/routes/feed.server.ts`, `app/routes/soiree.server.ts`, etc.

```ts
const isAdmin = (session.user as any).role === "admin";
```

L'utilisation répétée de `as any` contourne le système de types TypeScript pour les vérifications de rôle. Une erreur de logique dans la structure de `session.user` ne serait pas détectée à la compilation.

**Recommandation :** Utiliser le type `Session` exporté depuis `auth.server.ts` avec les champs supplémentaires correctement typés.

---

#### 8. Validation MIME basée uniquement sur le Content-Type client — `app/lib/server/upload.ts`

**Fichier :** `app/lib/server/upload.ts`  
**Ligne :** 14

```ts
if (!ALLOWED_TYPES.includes(file.type)) {
```

Le champ `file.type` est fourni par le client et peut être falsifié. Un attaquant pourrait envoyer un fichier malveillant avec `Content-Type: image/jpeg`. La bibliothèque `sharp` protège partiellement (elle échoue sur les fichiers non-images), mais une vérification de la signature binaire (magic bytes) serait plus robuste.

**Note positive :** La transformation via `sharp` constitue une protection de fait contra la plupart des attaques.

---

### 🟢 FAIBLE / Bonne pratique

#### 9. Réseau Docker non explicitement isolé — `docker-compose.prod.yml`

PostgreSQL et Redis n'ont pas de réseau Docker interne nommé explicitement défini. Docker crée implicitement un réseau isolé, mais une définition explicite améliore la lisibilité et la sécurité.

```yaml
networks:
  internal:
    internal: true
```

---

#### 10. Suppression de compte sans révocation de session — `app/routes/profile.server.ts`

**Fichier :** `app/routes/profile.server.ts`  
**Ligne :** 70

```ts
if (intent === "delete-account") {
  await db.delete(user).where(eq(user.id, session.user.id));
```

Lors de la suppression de compte, les sessions actives dans Redis ne sont pas révoquées. Un token de session existant pourrait potentiellement rester valide jusqu'à son expiration naturelle.

**Recommandation :** Appeler `auth.api.revokeAllSessions()` ou équivalent Better Auth avant de supprimer l'utilisateur.

---

## Tableau de synthèse

| # | Criticité | Fichier | Description | Statut |
|---|-----------|---------|-------------|--------|
| 1 | 🔴 Critique | `uploads-files.ts` | Path traversal sur les fichiers statiques | À corriger |
| 2 | 🔴 Critique | `docker-compose.prod.yml` | Mots de passe par défaut `changeme` | À corriger |
| 3 | 🟠 Élevé | App entière | Absence de headers de sécurité HTTP | À corriger |
| 4 | 🟠 Élevé | `docker-compose.prod.yml` | Mot de passe Redis dans la commande healthcheck | À corriger |
| 5 | 🟠 Élevé | Auth routes | Rate limiting non confirmé sur sign-in/sign-up | À vérifier |
| 6 | 🟡 Moyen | `auth.server.ts` | `trustedOrigins` vide sans `APP_URL` | À documenter |
| 7 | 🟡 Moyen | Plusieurs routes | `as any` pour les vérifications de rôle | Amélioration |
| 8 | 🟡 Moyen | `upload.ts` | MIME basé sur Content-Type client uniquement | Amélioration |
| 9 | 🟢 Faible | `docker-compose.prod.yml` | Réseau Docker non isolé explicitement | Bonne pratique |
| 10 | 🟢 Faible | `profile.server.ts` | Sessions non révoquées à la suppression de compte | Amélioration |

---

*Document généré automatiquement lors de la revue sécurité planifiée du 2026-09-21.*
