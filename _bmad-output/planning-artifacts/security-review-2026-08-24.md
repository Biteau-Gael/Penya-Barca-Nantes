# Revue sécurité — 24 août 2026

Analyse des deux derniers commits de la branche `main` (`003faca` et `b1c88f6`)
et des conventions de sécurité du dépôt. Aucune revue équivalente n'existait
dans `_bmad-output/` avant celle-ci.

## 1. Résumé des derniers commits

### `003faca` — fix: évaluer les badges immédiatement après chaque action
- Ajout d'appels `evaluateBadges(userId).catch(() => {})` dans
  `app/routes/feed.server.ts` (création de post, réaction, commentaire) et
  `app/routes/match-detail.server.ts` (soumission de pronostic).
- Périmètre : 2 fichiers, +6 lignes.
- Objectif : débloquer les badges *Premier pas*, *Régulier*, *Fidèle*,
  *Auteur*, *Commentateur*, *Réactif* sans attendre le calcul global.

### `b1c88f6` — feat: Phase 2 — soirée match live, micro-pronos, badges, séries, saisons
- 26 fichiers, +2965 / −47 lignes.
- Nouvelles routes : `soiree/:matchId`, `badges`, `api/micro-predictions`.
- Nouveau schéma DB (migration 0007) : `seasons`, `badges`, `user_badges`,
  `rewards`, `micro_predictions`, `micro_prediction_answers`, colonnes
  `user.currentStreak`, `user.bestStreak`, `matches.season`.
- Nouveaux modules serveur : `badges.server.ts`, `seasons.server.ts`,
  `streaks.server.ts`, extensions à `api-football.server.ts` pour événements
  live et scores.
- Fonctionnalités : score live (polling API 60 s), fil du match temps réel,
  micro-pronostics QCM, séries de scores exacts avec paliers 3/5/10, badges
  auto, filtrage classement par saison.

## 2. Conventions de sécurité — état de conformité

| Convention | Statut | Détail |
|---|---|---|
| Authentification obligatoire sur routes protégées | ✅ | Toutes les nouvelles routes (`soiree`, `badges`, `api/micro-predictions`) appellent `requireAuth(request)`. |
| Contrôle du rôle admin | ✅ | Les branches `create`/`close`/`delete` de `api.micro-predictions.ts` vérifient explicitement `session.user.role === "admin"`. `api.sync-matches.ts` passe `["admin"]` à `requireAuth`. |
| Requêtes SQL paramétrées | ✅ | Toutes les requêtes utilisent Drizzle (`eq`, `and`, `sql\`\` ` avec `${...}` en placeholder). Aucun `sql.raw` ni concaténation. |
| Secrets serveur uniquement | ✅ | `API_FOOTBALL_KEY` accédée via `getEnv()` dans `.server.ts` seulement. `.env` et `.claude/` bien listés dans `.gitignore`. |
| Protection XSS | ✅ | Aucun `dangerouslySetInnerHTML` dans le code. Le contenu utilisateur (`{post.content}`, `{micro.question}`, `{micro.answer}`) est rendu via JSX standard. |
| Validation d'entrée typée | ⚠️ Partielle | `feed.ts`, `prediction.ts`, `user.ts` ont des schémas Zod. Les nouvelles entrées `question`/`options`/`answer`/`correctAnswer` de micro-pronostics n'ont **pas** de schéma dédié. |
| Rate limiting | ⚠️ Partielle | Infra Redis présente (`rate-limit.server.ts`) et utilisée sur `api.auth.$.ts`. Non appliquée à `api/micro-predictions`. |
| Journalisation | ✅ | `logger.info`/`logger.error` en place sur toutes les nouvelles actions et fetchs API. |

## 3. Remarques par ordre de criticité

Aucune vulnérabilité **critique** ni **haute** n'a été identifiée.
Les points ci-dessous sont des risques d'intégrité applicative et
d'hygiène, à traiter dans l'ordre.

### 🟠 Moyen 1 — Deadline des micro-pronostics jamais vérifiée

- **Fichier** : `app/routes/api.micro-predictions.ts:89-132`
- **Constat** : la branche `intent === "answer"` valide seulement
  `micro.closedAt`. Aucun contrôle du champ `deadlineSeconds`
  (`createdAt + deadline > now`).
- **Impact** : un joueur peut répondre à un micro-prono après que
  l'information (ex. buteur du prochain but) est publique, puis empocher
  les points quand l'admin clôture. Compromet l'équité du scoring.
- **Aggravant** : le champ est déclaré sur le schéma comme
  `deadline: integer("deadline_seconds")` (`app/db/schema/micro-predictions.ts:21`)
  mais l'insert et le loader utilisent la clé `deadlineSeconds`
  (`api.micro-predictions.ts:39`, `soiree.server.ts:252`). La valeur
  insérée est ignorée par Drizzle (valeur par défaut 120 utilisée) et le
  loader renvoie `undefined` au front. La fenêtre est donc doublement
  inopérante.
- **Recommandation** : (1) renommer la propriété du schéma en
  `deadlineSeconds` ou mapper explicitement, (2) ajouter dans la branche
  `answer` un contrôle `Date.now() - micro.createdAt.getTime() > micro.deadlineSeconds * 1000`.

### 🟠 Moyen 2 — Absence de limite de longueur sur les champs texte

- **Fichiers** : `app/routes/api.micro-predictions.ts:20-49`,
  schéma `app/db/schema/micro-predictions.ts` (colonnes `question`,
  `options`, `correct_answer`, `answer` en `text` sans borne).
- **Constat** : `question`, `options`, `correctAnswer` (admin) et `answer`
  (membre) sont acceptés sans limite haute.
- **Impact** : un membre authentifié peut faire enfler la base
  (`text` PostgreSQL = jusqu'à 1 Go par champ). Coût de stockage,
  temps de rendu, timeouts front possibles.
- **Recommandation** : introduire un schéma Zod
  (`lib/validation/micro-prediction.ts`) avec `min(1).max(280)` pour
  `question`/`answer` et `max(500)` pour `options`, appliqué via
  `safeParse` avant tout accès DB.

### 🟡 Bas 1 — Erreurs d'évaluation des badges silencieuses

- **Fichiers** : `app/routes/feed.server.ts:135,156,178`,
  `app/routes/match-detail.server.ts:188`.
- **Constat** : appels `evaluateBadges(...).catch(() => {})`. Aucune
  trace n'est écrite si la promesse échoue (indisponibilité DB,
  ligne verrouillée, etc.).
- **Impact** : aucune atteinte à la sécurité, mais impossible de
  diagnostiquer un badge qui ne se déclenche jamais.
- **Recommandation** : remplacer par
  `evaluateBadges(userId).catch((err) => logger.error({ err, userId }, "badge eval failed"))`.

### 🟡 Bas 2 — Réponse trompeuse en cas d'usurpation d'intent admin

- **Fichier** : `app/routes/api.micro-predictions.ts:17-154`.
- **Constat** : si un utilisateur non-admin envoie `intent="create"`
  (ou `close`/`delete`), la branche est ignorée et la réponse finale
  est `"Action inconnue" (400)` au lieu d'un `403`.
- **Impact** : pas d'élévation de privilège (l'accès reste refusé),
  mais logs peu explicites et fingerprinting facile de l'API.
- **Recommandation** : factoriser l'assertion admin en tête
  (`if (["create","close","delete"].includes(intent) && session.user.role !== "admin") return 403`).

### 🟡 Bas 3 — Auto-post `isAnnouncement: true` avec pseudo utilisateur

- **Fichier** : `app/lib/server/streaks.server.ts:55-72`.
- **Constat** : le message de récompense de série est publié dans le fil
  avec `isAnnouncement: true` et contient `displayName = userInfo?.pseudo`.
- **Impact** : pas de XSS (JSX escape). Mais un pseudo choisi
  spécifiquement (« FC Barcelona » par ex.) peut donner l'illusion d'un
  message officiel à côté des annonces admin.
- **Recommandation** : conserver `isAnnouncement: false` pour les posts
  système générés au nom d'un membre, ou introduire un rôle
  `system` distinct côté auteur du post.

### 🟡 Bas 4 — Absence de rate limit sur `api/micro-predictions`

- **Fichier** : `app/routes/api.micro-predictions.ts`.
- **Constat** : chaque action (`answer`, `create`, `close`, `delete`)
  peut être appelée sans limite par un utilisateur authentifié.
- **Impact** : contexte fermé (site membre), risque faible ; mais un
  compte compromis peut spammer réponses ou (si admin) créer/supprimer
  massivement.
- **Recommandation** : appliquer `checkRateLimit` par
  `session.user.id + intent`, par ex. 20 req/min sur `answer`,
  10 req/min sur les actions admin.

### ℹ️ Info — Bug fonctionnel connexe (non sécurité)

- Mismatch de nommage `deadline` (schéma) / `deadlineSeconds`
  (insert & loader) — voir Moyen 1. À corriger dans le même patch.

## 4. Actions recommandées

1. Corriger le nommage `deadline` ↔ `deadlineSeconds` et ajouter le
   contrôle de fenêtre de réponse (Moyen 1).
2. Introduire un schéma Zod `micro-prediction.ts` et l'appliquer côté
   admin et joueur (Moyen 2).
3. Ajouter la journalisation des erreurs `evaluateBadges` (Bas 1).
4. Renvoyer `403` explicitement pour les intents admin usurpés (Bas 2).
5. Décider de la politique d'auto-post système (Bas 3).
6. Étendre `checkRateLimit` à `api/micro-predictions` (Bas 4).

Aucune action bloquante avant merge n'est requise — les manques ci-dessus
sont à traiter dans un prochain sprint hygiène/QA.
