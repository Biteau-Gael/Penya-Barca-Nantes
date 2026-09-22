# Analyse de Sécurité — Penya Blaugrana Nantes

**Date** : 22 septembre 2026  
**Branche analysée** : `main` (HEAD : `003facad`)  
**Scope** : Revue des 17 derniers commits — conventions de sécurité, gestion des secrets, authentification, autorisation, validation des entrées, infrastructure Docker

---

## 1. Résumé des derniers commits

| # | SHA | Date | Type | Description |
|---|-----|------|------|-------------|
| 17 | `003facad` | 13/04 | fix | Évaluation des badges immédiatement après chaque action |
| 16 | `b1c88f67` | 13/04 | feat | **Phase 2** — Soirée match live, micro-pronos, badges, séries, saisons |
| 15 | `d461ee53` | 12/04 | merge | Merge branch deploy-synology |
| 14 | `554b873a` | 12/04 | docs | Guide de déploiement NAS Synology |
| 13 | `68e22d2b` | 12/04 | feat | Menu burger mobile |
| 12 | `6aebaf76` | 12/04 | fix | Trusted origins Better Auth (support domaine personnalisé) |
| 11 | `4a65a7b2` | 12/04 | merge | Merge PR #2 |
| 10 | `9823bc58` | 12/04 | fix | Service `migrate` dans docker-compose.prod.yml |
| 9  | `2bafc6c8` | 12/04 | merge | Merge PR #1 — Docker prod NAS |
| 8  | `8d6e5e96` | 12/04 | feat | Docker Compose production + backup.sh |
| 7  | `3d801334` | 12/04 | docs | Roadmap Phase 2 — 8 priorités |
| 6  | `6583da33` | 12/04 | docs | README + guide déploiement NAS |
| 5  | `aed5841b` | 12/04 | **security** | **Suppression credentials du repo, renforcement .gitignore** |
| 4  | `ab7fc5d1` | 12/04 | feat | Intégration API Football + stats enrichies + classement Liga |
| 3  | `16c43e66` | 11/04 | feat | **MVP Phase 1** — React Router v7, auth, pronostics, fil, admin, 66 tests |
| 2  | `fec3e63` | 11/04 | feat | Initial commit |
| 1  | `4da20f3` | 11/04 | init | Initial commit create-react-router |

---

## 2. Points positifs — Bonnes pratiques respectées

| # | Fichier | Observation |
|---|---------|-------------|
| ✅ | `.gitignore` | `.env`, `.claude/`, `/uploads/` correctement exclus |
| ✅ | `.env.example` | Placeholders uniquement, aucun credential réel |
| ✅ | `app/config/env.server.ts` | Validation Zod de toutes les variables d'env au démarrage |
| ✅ | `app/lib/server/auth-utils.server.ts` | `requireAuth()` centralisé avec vérification de rôle |
| ✅ | `app/db/` | Drizzle ORM — requêtes paramétrées, pas d'injection SQL possible |
| ✅ | `app/lib/validation/` | Schémas Zod pour posts, commentaires, profil, matchs, pronos |
| ✅ | `app/lib/server/rate-limit.server.ts` | Rate limiting Redis implémenté |
| ✅ | `app/lib/server/upload.ts` | Validation MIME, taille max 2 Mo, resize via `sharp` |
| ✅ | `app/routes/feed.server.ts` | Vérification propriétaire avant suppression (post/commentaire) |
| ✅ | `app/routes/profile.server.ts` | Unicité du pseudo vérifiée côté serveur |
| ✅ | `app/routes/api.micro-predictions.ts` | Vérification `session.user.role === "admin"` avant actions admin |
| ✅ | Tests | 66+ tests unitaires couvrant la validation et les points |

---

## 3. Remarques de sécurité — Par ordre de criticité

---

### 🔴 CRITIQUE

#### C-1 — Mots de passe par défaut "changeme" en production

**Fichier** : `docker-compose.prod.yml`

```yaml
POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-changeme}
redis-server --requirepass ${REDIS_PASSWORD:-changeme}
```

**Risque** : Si les variables d'environnement `POSTGRES_PASSWORD` et `REDIS_PASSWORD` ne sont pas définies dans le `.env` de production, les services démarrent avec le mot de passe `changeme` — lisible dans le fichier. Une base PostgreSQL ou un Redis accessible sur le réseau local du NAS Synology serait compromis immédiatement.

**Correction recommandée** : Supprimer les valeurs par défaut (`:-changeme`) et faire échouer le démarrage si les variables sont absentes. Alternativement, ajouter un check dans le script de déploiement.

```yaml
POSTGRES_PASSWORD=${POSTGRES_PASSWORD:?Variable POSTGRES_PASSWORD requise}
```

---

### 🟠 ÉLEVÉ

#### E-1 — `trustedOrigins` vide si `APP_URL` non définie

**Fichier** : `app/lib/server/auth.server.ts` (ligne 12)

```ts
trustedOrigins: env.APP_URL ? [env.APP_URL] : [],
```

**Risque** : Avec un tableau vide, le comportement par défaut de Better Auth est d'autoriser l'origine de la requête elle-même (localhost en dev). En production sans `APP_URL`, cela peut autoriser des requêtes depuis n'importe quelle origine — selon la version de Better Auth utilisée, cela peut neutraliser la protection CSRF.

**Correction recommandée** : Rendre `APP_URL` obligatoire en production (dans `env.server.ts` : `APP_URL: z.string().url()` sans `.optional()` si `NODE_ENV === 'production'`).

---

#### E-2 — Endpoint `/api/health` public exposant l'état de l'infrastructure

**Fichier** : `app/routes/api.health.ts`

```ts
export async function loader() {
  // Aucune authentification — accessible sans session
  return Response.json({ status, services: { db: "ok"|"error", redis: "ok"|"error" } });
}
```

**Risque** : Un attaquant peut sonder en permanence l'état des services (DB, Redis) sans s'authentifier. Cette information aide à planifier des attaques ciblées lors de fenêtres de dégradation.

**Correction recommandée** : Protéger l'endpoint par un token secret dans le header ou le limiter aux IPs internes via le reverse proxy Synology. Ou retourner uniquement `{ status: "ok" | "degraded" }` sans le détail des services.

---

#### E-3 — Validation insuffisante dans les micro-pronostics (création admin)

**Fichier** : `app/routes/api.micro-predictions.ts` (action `create`)

```ts
const question = formData.get("question") as string;
const type = formData.get("type") as string;
const pointsValue = parseInt(formData.get("pointsValue") as string) || 1;
const deadlineSeconds = parseInt(formData.get("deadlineSeconds") as string) || 120;
// Aucun schéma Zod — pas de contrainte de longueur, de plage, de type énuméré
```

**Risque** : Une `question` sans limite de longueur peut saturer la colonne en base. Un `type` non contrôlé peut casser la logique métier. Un `pointsValue` négatif ou excessif peut corrompre le classement.

**Correction recommandée** : Ajouter un schéma Zod pour cette action :

```ts
const createMicroSchema = z.object({
  matchId: z.string().min(1),
  question: z.string().min(3).max(200),
  type: z.enum(["qcm", "score", "boolean"]),
  pointsValue: z.number().int().min(1).max(10),
  deadlineSeconds: z.number().int().min(30).max(600),
});
```

---

### 🟡 MODÉRÉ

#### M-1 — Rate limiting absent sur les actions du fil communautaire

**Fichier** : `app/routes/feed.server.ts`

La fonction `checkRateLimit` est implémentée dans `rate-limit.server.ts` mais n'est pas appelée dans `feedAction()` pour les actions `create-post`, `comment`, `react`.

**Risque** : Un utilisateur authentifié peut publier des centaines de posts ou commentaires en boucle (flood/spam).

**Correction recommandée** : Ajouter dans `feedAction()` :

```ts
await checkRateLimit({ key: `feed:${session.user.id}`, maxAttempts: 10, windowSeconds: 60 });
```

---

#### M-2 — Cast `(session.user as any).role` répété dans plusieurs fichiers

**Fichiers** : `feed.server.ts`, `root.tsx`, et d'autres

```ts
const isAdmin = (session.user as any).role === "admin";
```

**Risque** : Contournement du système de types TypeScript. Si le champ `role` change de nom ou de structure, le compilateur ne signalera pas l'erreur. Peut masquer une régression silencieuse sur les vérifications de rôle.

**Correction recommandée** : Étendre le type `Session` de Better Auth pour inclure `role`, ou créer un helper `isAdmin(session)` typé utilisant le type `Role` déjà défini dans `auth-utils.server.ts`.

---

#### M-3 — Suppression de compte sans re-confirmation d'identité

**Fichier** : `app/routes/profile.server.ts` (action `delete-account`)

```ts
if (intent === "delete-account") {
  await db.delete(user).where(eq(user.id, session.user.id));
  return { success: true, deleted: true };
}
```

**Risque** : Une session volée (CSRF ou XSS) permet de supprimer le compte sans connaître le mot de passe de l'utilisateur.

**Correction recommandée** : Exiger le mot de passe actuel lors de la suppression de compte (appel `auth.api.signIn` pour vérification, ou ajout d'un champ de confirmation).

---

#### M-4 — Absence de headers HTTP de sécurité

**Fichier** : `app/root.tsx` (aucun header de sécurité défini)

Les headers suivants sont absents :
- `Content-Security-Policy` (CSP) — protection XSS
- `X-Frame-Options: DENY` — protection clickjacking
- `X-Content-Type-Options: nosniff`
- `Strict-Transport-Security` (HSTS)
- `Referrer-Policy`

**Correction recommandée** : Ajouter ces headers dans le reverse proxy Synology (ou dans un middleware React Router si applicable). Au minimum, configurer CSP et X-Frame-Options.

---

### 🟢 FAIBLE / INFORMATIONNEL

#### F-1 — Pagination fixe à 50 sur le fil communautaire

**Fichier** : `app/routes/feed.server.ts` (ligne `limit(50)`)

Pas de pagination côté client ni de curseur. À mesure que le fil grandit, ce `LIMIT 50` deviendra insuffisant et ne permettra pas de voir les anciens posts.

---

#### F-2 — Email utilisateur inclus dans les données loader du profil

**Fichier** : `app/routes/profile.server.ts` (retourne `email: userData.email`)

L'email est transmis au client dans le loader. Si le composant `profile.tsx` l'expose dans le DOM (attribut `data-*`, formulaire caché), il pourrait être lu par un script tiers.

**Recommandation** : Vérifier que l'email n'est affiché que dans un contexte authentifié maîtrisé, et l'exclure du loader si non nécessaire côté client.

---

## 4. Tableau récapitulatif

| # | Sévérité | Fichier principal | Description courte | Action requise |
|---|----------|-------------------|-------------------|----------------|
| C-1 | 🔴 Critique | `docker-compose.prod.yml` | Password par défaut "changeme" en prod | Immédiate |
| E-1 | 🟠 Élevé | `auth.server.ts` | `trustedOrigins` vide si `APP_URL` absente | Avant prochain déploiement |
| E-2 | 🟠 Élevé | `api.health.ts` | Health endpoint public exposant l'infra | Avant prochain déploiement |
| E-3 | 🟠 Élevé | `api.micro-predictions.ts` | Pas de validation Zod sur la création admin | Court terme |
| M-1 | 🟡 Modéré | `feed.server.ts` | Rate limiting absent sur le fil | Court terme |
| M-2 | 🟡 Modéré | Multiples | `as any` sur `session.user.role` | Moyen terme |
| M-3 | 🟡 Modéré | `profile.server.ts` | Suppression compte sans re-auth | Moyen terme |
| M-4 | 🟡 Modéré | `root.tsx` / reverse proxy | Absence de headers HTTP de sécurité | Moyen terme |
| F-1 | 🟢 Faible | `feed.server.ts` | Pagination fixe à 50 posts | Backlog |
| F-2 | 🟢 Faible | `profile.server.ts` | Email dans le loader client | Backlog |

---

*Rapport généré automatiquement le 2026-09-22 par analyse statique du dépôt GitHub.*
