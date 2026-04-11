# Story 4.1 : Configuration Admin des Pronostics

Status: in-progress

## Story

As a admin,
I want configurer les paramètres de pronostic pour chaque match (deadline, barème de points),
so that les pronostics soient cadrés avant l'ouverture aux membres.

## Acceptance Criteria

1. Un admin peut définir la deadline de soumission (date/heure) pour chaque match
2. Un admin peut choisir le barème de points (score exact, bon résultat, bon écart)
3. La validation Zod vérifie la cohérence (deadline avant le coup d'envoi)
4. Les paramètres sont sauvegardés en base sur la table `matches`
5. Un match sans configuration de pronostic ne montre pas le formulaire de pronostic

## Tasks / Subtasks

- [ ] Task 1 : Ajouter la config pronostic dans la page admin matchs (AC: #1-#4)
  - [ ] 1.1 Modifier le formulaire dans `admin.matches.tsx` : ajouter champs deadline (datetime-local) et barème (select)
  - [ ] 1.2 Modifier l'action dans `admin.matches.server.ts` : sauvegarder predictionDeadline et pointsScheme
  - [ ] 1.3 Validation : deadline doit être avant la date du match
- [ ] Task 2 : Tests
  - [ ] 2.1 Exécuter `npm run test:run` — TOUS les tests passent à 100%

## Dev Notes

- Les colonnes `prediction_deadline` et `points_scheme` existent déjà dans la table `matches` (Story 3.1)
- Barèmes : "standard" (défaut), "strict", "souple"
- Le formulaire de pronostic (Story 4.2) vérifiera si predictionDeadline est défini

## Dev Agent Record

### Agent Model Used
### Debug Log References
### Completion Notes List
### File List
