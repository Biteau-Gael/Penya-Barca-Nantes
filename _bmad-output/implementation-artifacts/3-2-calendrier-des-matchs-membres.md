# Story 3.2 : Calendrier des Matchs (Membres)

Status: review

## Story

As a membre,
I want consulter le calendrier des prochains matchs du Barça et voir les détails d'un match,
so that je sache quand et où regarder les matchs avec la communauté.

## Acceptance Criteria

1. Un membre connecté voit la liste des prochains matchs triés par date chronologique
2. Chaque match affiche : date, heure, adversaire, compétition, lieu
3. Les matchs passés sont distincts visuellement des matchs à venir
4. La page est responsive mobile-first
5. Un clic sur un match donne accès à la page de détail
6. La page de détail affiche toutes les informations du match
7. La page se charge en moins de 3 secondes sur mobile 4G — NFR1

## Tasks / Subtasks

- [x] Task 1 : Page calendrier membres (AC: #1, #2, #3, #4)
  - [x] 1.1 Créer `app/routes/calendar.server.ts` — loader :
    - `requireAuth(request)` pour vérifier l'authentification
    - Charger tous les matchs triés par date (à venir en premier, puis passés)
  - [x] 1.2 Créer `app/routes/calendar.tsx` — page calendrier :
    - Séparer visuellement : section "À venir" et section "Passés"
    - Chaque match : Card avec adversaire, date/heure formatée fr-FR, compétition, lieu (Domicile/Extérieur)
    - Matchs passés avec opacité réduite et score affiché si disponible
    - Lien vers la page de détail du match
  - [x] 1.3 Enregistrer dans `app/routes.ts` : `route("calendrier", "routes/calendar.tsx")`

- [x] Task 2 : Page de détail d'un match (AC: #5, #6)
  - [x] 2.1 Créer `app/routes/match-detail.server.ts` — loader :
    - `requireAuth(request)` + charger le match par ID
    - 404 si match introuvable
  - [x] 2.2 Créer `app/routes/match-detail.tsx` — page détail :
    - Toutes les infos : adversaire, date/heure, compétition, lieu, score si disponible
    - Placeholder pour le formulaire de pronostic (Epic 4)
    - ErrorBoundary 404
  - [x] 2.3 Enregistrer dans `app/routes.ts` : `route("matchs/:matchId", "routes/match-detail.tsx")`

- [x] Task 3 : Navigation (AC: #1)
  - [x] 3.1 Mettre à jour le header : remplacer le lien "Calendrier" désactivé par un vrai lien vers `/calendrier` pour les non-connectés
  - [x] 3.2 Ajouter "Calendrier" dans la nav des connectés aussi

- [x] Task 4 : Tests (AC: #1-#7)
  - [x] 4.1 Exécuter `npm run test:run` — TOUS les tests passent à 100%

## Dev Notes

### Fichiers existants

- `app/db/schema/matches.ts` — table matches déjà créée (Story 3.1)
- `app/lib/validation/match.ts` — schemas Zod déjà créés
- Header avec liens désactivés à remplacer

### Formatage dates fr-FR

```typescript
new Date(matchDate).toLocaleDateString("fr-FR", {
  weekday: "long", day: "numeric", month: "long", year: "numeric",
  hour: "2-digit", minute: "2-digit",
})
```

### Références

- [Source: _bmad-output/planning-artifacts/epics.md#Story 3.2]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (1M context)

### Debug Log References

- Aucun problème.

### Completion Notes List

- Page `/calendrier` : matchs à venir triés chronologiquement + matchs passés avec opacité réduite
- Page `/matchs/:matchId` : détail match avec score, infos complètes, placeholder pronostic, ErrorBoundary 404
- Header : lien "Calendrier" actif pour connectés et non-connectés
- 53 tests passent à 100%

### Change Log

- 2026-04-11 : Implémentation Story 3.2 — calendrier et détail matchs membres

### File List

- app/routes/calendar.server.ts (créé)
- app/routes/calendar.tsx (créé)
- app/routes/match-detail.server.ts (créé)
- app/routes/match-detail.tsx (créé)
- app/routes.ts (modifié — ajout routes calendrier + matchs/:matchId)
- app/components/layout/header.tsx (modifié — liens Calendrier actifs)
