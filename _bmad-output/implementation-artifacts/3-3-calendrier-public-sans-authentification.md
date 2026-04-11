# Story 3.3 : Calendrier Public (Sans Authentification)

Status: review

## Story

As a visiteur (non connecté),
I want consulter le calendrier des prochains matchs sans avoir de compte,
so that je puisse voir l'activité de la communauté et être tenté de la rejoindre.

## Acceptance Criteria

1. Un visiteur non connecté voit la liste des prochains matchs (même format que pour les membres)
2. La page est rendue côté serveur (SSR) pour le SEO
3. Un CTA invite à s'inscrire pour participer aux pronostics
4. La page est accessible depuis la navigation de la page d'accueil
5. Un clic sur un match montre les informations de base
6. Les pronostics des membres ne sont pas visibles (réservé aux connectés)

## Tasks / Subtasks

- [x] Task 1 : Adapter le calendrier pour les visiteurs (AC: #1-#6)
  - [x] 1.1 Modifier `calendar.server.ts` : retirer le `requireAuth`, le calendrier est public
  - [x] 1.2 Modifier `match-detail.server.ts` : retirer le `requireAuth` pour la consultation de base
  - [x] 1.3 Dans `match-detail.tsx` : si non connecté, afficher le CTA "Inscris-toi pour pronostiquer !" au lieu du placeholder prono
  - [x] 1.4 Ajouter les meta SEO dans `calendar.tsx`
- [x] Task 2 : Tests
  - [x] 2.1 Exécuter `npm run test:run` — TOUS les tests passent à 100%

## Dev Notes

- Le calendrier et le détail match deviennent publics — plus besoin de `requireAuth`
- Le root loader gère déjà le cas `user: null` pour le header
- Les pronostics (Epic 4) vérifieront l'auth indépendamment

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (1M context)

### Completion Notes List

- Calendrier et détail match rendus publics (suppression requireAuth)
- Meta SEO ajoutées sur la page calendrier
- Détail match : CTA "S'inscrire pour pronostiquer" si non connecté
- 53 tests passent à 100%

### File List

- app/routes/calendar.server.ts (modifié — suppression requireAuth)
- app/routes/calendar.tsx (modifié — ajout meta SEO)
- app/routes/match-detail.server.ts (modifié — suppression requireAuth)
- app/routes/match-detail.tsx (modifié — CTA inscription si non connecté)
