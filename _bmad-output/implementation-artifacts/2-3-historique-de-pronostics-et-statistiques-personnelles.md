# Story 2.3 : Historique de Pronostics et Statistiques Personnelles

Status: review

## Story

As a membre,
I want consulter mon historique de pronostics et mes statistiques personnelles,
so that je puisse suivre ma progression et me comparer aux autres.

## Acceptance Criteria

1. Un membre connecté voit son nombre total de pronostics soumis
2. Il voit son taux de réussite et ses points cumulés
3. Il voit son historique de pronostics par match (score prédit vs score réel, points gagnés)
4. Les statistiques sont calculées à partir des données existantes (tables predictions/matches)
5. Si aucun pronostic n'a encore été soumis, un état vide encourageant est affiché

**Note :** Cette story crée l'affichage des stats. Les données de pronostics seront alimentées par l'Epic 4. En attendant, l'état vide est géré gracieusement.

## Tasks / Subtasks

- [x] Task 1 : Ajouter une section statistiques dans la page profil (AC: #1, #2, #3, #5)
  - [x] 1.1 Ajouter dans le loader de `profile.server.ts` :
    - Compter le nombre de pronostics soumis (query sur future table `match_predictions` — retourner 0 si la table n'existe pas encore)
    - Calculer le taux de réussite et les points cumulés (retourner 0/0% par défaut)
  - [x] 1.2 Ajouter une Card "Mes statistiques" dans `profile.tsx` :
    - 3 indicateurs : Pronostics soumis, Points cumulés, Taux de réussite
    - Design en grille avec les chiffres mis en avant (text-2xl font-bold)
  - [x] 1.3 Ajouter une Card "Historique des pronostics" dans `profile.tsx` :
    - Liste vide pour l'instant avec état vide encourageant
    - Message : "Tes pronostics apparaîtront ici dès le premier match !"
    - Préparer la structure de la liste (sera alimentée par l'Epic 4)

- [x] Task 2 : État vide encourageant (AC: #5)
  - [x] 2.1 Quand stats = 0 : afficher les indicateurs à 0 avec un style non-alarmant
  - [x] 2.2 Message d'encouragement avec le ton Penya : chaleureux, pas institutionnel
  - [x] 2.3 CTA discret : "Le calendrier des matchs arrive bientôt !"

- [x] Task 3 : Stats sur le profil public d'un autre membre (AC: #1, #2, #5)
  - [x] 3.1 Mettre à jour `member-profile.server.ts` : retourner les mêmes stats (0 par défaut)
  - [x] 3.2 Mettre à jour `member-profile.tsx` : remplacer le message statique par la même grille de stats

- [x] Task 4 : Tests (AC: #1-#5)
  - [x] 4.1 Exécuter `npm run test:run` — TOUS les tests passent à 100%

## Dev Notes

### Note importante

Les tables `matches` et `match_predictions` n'existent pas encore (Epic 4). Cette story crée **uniquement l'affichage** avec des valeurs à 0 et un état vide. Les données réelles seront injectées quand l'Epic 4 sera implémenté.

### Fichiers à modifier

| Fichier | Action |
|---------|--------|
| `app/routes/profile.server.ts` | Ajouter stats (0 par défaut) au return du loader |
| `app/routes/profile.tsx` | Ajouter Cards stats + historique |
| `app/routes/member-profile.server.ts` | Ajouter stats (0 par défaut) au return |
| `app/routes/member-profile.tsx` | Remplacer section stats statique par grille |

### Ton des messages (PRD)

- "Tes pronostics apparaîtront ici dès le premier match !"
- "Le calendrier des matchs arrive bientôt !"
- Pas de "Vous n'avez aucune donnée" — toujours positif et tourné vers l'avenir

### Références

- [Source: _bmad-output/planning-artifacts/epics.md#Story 2.3]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (1M context)

### Debug Log References

- Aucune table pronostics n'existe encore — stats à 0 par défaut, état vide encourageant.

### Completion Notes List

- Section "Mes statistiques" ajoutée au profil : 3 indicateurs (pronostics, points, réussite) en grille
- Section "Historique des pronostics" avec état vide et message chaleureux
- Profil public mis à jour avec la même grille de stats
- Loaders enrichis avec objet `stats` (0 par défaut, sera alimenté par Epic 4)
- 45 tests passent à 100%

### Change Log

- 2026-04-11 : Implémentation Story 2.3 — stats et historique pronostics (état vide)

### File List

- app/routes/profile.server.ts (modifié — ajout stats au loader)
- app/routes/profile.tsx (modifié — ajout Cards stats + historique)
- app/routes/member-profile.server.ts (modifié — ajout stats au loader)
- app/routes/member-profile.tsx (modifié — grille stats remplace message statique)
