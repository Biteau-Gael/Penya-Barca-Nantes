# Story 3.1 : Administration des Matchs (CRUD)

Status: review

## Story

As a admin,
I want créer, modifier et supprimer des matchs dans le calendrier,
so that les membres puissent toujours voir les prochains matchs du Barça à jour.

## Acceptance Criteria

1. Un admin connecté peut créer un match (date, heure, adversaire, compétition, lieu domicile/extérieur)
2. La validation Zod vérifie tous les champs obligatoires
3. Le match est enregistré dans la table `matches` en base
4. Un message de succès confirme la création
5. Un admin peut modifier un match existant
6. Un admin peut supprimer un match (confirmation demandée avant suppression)
7. Un utilisateur avec le rôle "membre" se voit refuser l'accès (403) — NFR8

## Tasks / Subtasks

- [x] Task 1 : Schema DB matches (AC: #3)
  - [x] 1.1 Créer `app/db/schema/matches.ts` :
    ```typescript
    matches: pgTable("matches", {
      id: text("id").primaryKey(), // uuid généré
      opponent: varchar("opponent", { length: 100 }).notNull(),
      competition: varchar("competition", { length: 100 }).notNull(),
      matchDate: timestamp("match_date").notNull(),
      venue: varchar("venue", { length: 20 }).notNull(), // "home" | "away"
      homeScore: integer("home_score"),
      awayScore: integer("away_score"),
      predictionDeadline: timestamp("prediction_deadline"),
      pointsScheme: varchar("points_scheme", { length: 20 }).default("standard"),
      createdAt: timestamp("created_at").defaultNow().notNull(),
      updatedAt: timestamp("updated_at").defaultNow().notNull(),
    })
    ```
  - [x] 1.2 Exporter depuis `app/db/schema/index.ts`
  - [x] 1.3 Générer et appliquer la migration Drizzle

- [x] Task 2 : Schema validation Zod (AC: #2)
  - [x] 2.1 Créer `app/lib/validation/match.ts` avec `createMatchSchema` :
    - opponent : string, 1-100 caractères
    - competition : string (Liga, Champions League, Copa del Rey, Supercoupe, Amical)
    - matchDate : string ISO transformé en Date, doit être dans le futur
    - venue : enum "home" | "away"
  - [x] 2.2 Créer `updateMatchSchema` (mêmes champs, tous optionnels sauf id)
  - [x] 2.3 Tests unitaires pour les schemas

- [x] Task 3 : Page admin liste des matchs (AC: #5, #6, #7)
  - [x] 3.1 Créer `app/routes/admin.matches.server.ts` :
    - Loader : `requireAuth(request, ["admin"])` + charger tous les matchs triés par date
    - Action : gérer create / update / delete selon l'intent
  - [x] 3.2 Créer `app/routes/admin.matches.tsx` :
    - Liste des matchs avec adversaire, date, compétition, lieu
    - Boutons "Modifier" et "Supprimer" par match
    - Formulaire de création en haut de page
    - Dialogue de confirmation pour la suppression
  - [x] 3.3 Enregistrer la route dans `app/routes.ts` : `route("admin/matchs", "routes/admin.matches.tsx")`
  - [x] 3.4 Protection rôle admin : si membre → redirect ou 403

- [x] Task 4 : Formulaire de création/modification (AC: #1, #2, #4, #5)
  - [x] 4.1 Formulaire avec les champs : adversaire, compétition (select), date/heure (datetime-local), lieu (radio home/away)
  - [x] 4.2 Validation Zod côté serveur
  - [x] 4.3 Message de succès/erreur après soumission
  - [x] 4.4 Mode édition : pré-remplir le formulaire avec les données existantes

- [x] Task 5 : Navigation admin (AC: #7)
  - [x] 5.1 Ajouter un lien "Admin" dans le header pour les utilisateurs avec rôle admin
  - [x] 5.2 Le lien pointe vers `/admin/matchs`

- [x] Task 6 : Tests (AC: #1-#7)
  - [x] 6.1 Tests unitaires : `createMatchSchema` et `updateMatchSchema`
  - [x] 6.2 Exécuter `npm run test:run` — TOUS les tests passent à 100%

## Dev Notes

### Learnings critiques

- **Fichiers `.server.ts` séparés** pour la logique Drizzle/auth dans les routes
- **Noms de fichiers routes** : pas de `$` — noms lisibles
- **Import relatif dans root.tsx** : utiliser `./` au lieu de `~/` pour les composants importés dans root.tsx
- **Accents français** obligatoires dans tous les textes
- **`requireAuth(request, ["admin"])`** : déjà implémenté dans `auth-utils.server.ts`, vérifie le rôle

### Schema DB — Conventions

- Table : `matches` (snake_case pluriel)
- Colonnes : `match_date`, `home_score`, `away_score`, `prediction_deadline`, `points_scheme`
- ID : text UUID généré côté app (comme Better Auth)

### Compétitions prédéfinies

```typescript
const COMPETITIONS = ["Liga", "Champions League", "Copa del Rey", "Supercoupe", "Amical"] as const;
```

### Fichiers à modifier pour la migration

Le `drizzle-kit generate` est interactif — si ça bloque, ajouter la table manuellement et régénérer.

### Références

- [Source: _bmad-output/planning-artifacts/epics.md#Story 3.1]
- [Source: _bmad-output/planning-artifacts/architecture.md#Data Architecture — matches table]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (1M context)

### Debug Log References

- `createId()` ajouté dans utils.ts avec `crypto.randomUUID()` (compatible client+serveur).

### Completion Notes List

- Table `matches` créée (11 colonnes : opponent, competition, matchDate, venue, scores, deadline, etc.)
- Migration Drizzle générée et appliquée
- Validation Zod : createMatchSchema + updateMatchSchema avec 8 tests
- Page admin `/admin/matchs` : CRUD complet (création, édition inline, suppression avec confirmation)
- Protection rôle admin via `requireAuth(request, ["admin"])`
- Lien "Admin" dans le header visible uniquement pour les admins
- Root loader enrichi avec le rôle utilisateur
- 53 tests passent à 100%

### Change Log

- 2026-04-11 : Implémentation Story 3.1 — CRUD matchs admin

### File List

- app/db/schema/matches.ts (créé)
- app/db/schema/index.ts (modifié — export matches)
- app/db/migrations/0001_odd_random.sql (créé)
- app/lib/utils.ts (modifié — ajout createId)
- app/lib/validation/match.ts (créé)
- app/lib/validation/match.test.ts (créé — 8 tests)
- app/routes/admin.matches.server.ts (créé — loader + action)
- app/routes/admin.matches.tsx (créé — page CRUD)
- app/routes.ts (modifié — ajout route admin/matchs)
- app/root.tsx (modifié — ajout role au loader)
- app/components/layout/header.tsx (modifié — lien Admin conditionnel)
