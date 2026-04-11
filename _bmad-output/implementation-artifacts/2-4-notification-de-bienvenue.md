# Story 2.4 : Notification de Bienvenue

Status: review

## Story

As a nouveau membre,
I want recevoir une notification de bienvenue chaleureuse lors de ma première connexion,
so that je me sente accueilli dans la communauté dès le premier instant.

## Acceptance Criteria

1. Un nouveau membre qui vient de créer son compte voit une notification de bienvenue lors de sa première connexion
2. Le ton est celui de la Penya : "Bienvenue dans la famille culer !" (pas institutionnel)
3. La notification suggère les premières actions (explorer le fil, soumettre un prono, consulter le calendrier)
4. La notification ne s'affiche qu'une seule fois (flag `welcomeShown` en base)
5. Un membre qui s'est déjà connecté auparavant ne voit pas la notification

## Tasks / Subtasks

- [x] Task 1 : Détection et affichage de la notification (AC: #1, #4, #5)
  - [x] 1.1 Dans le loader de `root.tsx` : ajouter `welcomeShown` au retour user (lire depuis la DB)
  - [x] 1.2 Créer `app/components/shared/welcome-notification.tsx` :
    - Banner ou modal de bienvenue, visible uniquement si `welcomeShown === false`
    - Bouton "C'est parti !" pour fermer
    - À la fermeture, appeler une action pour marquer `welcomeShown = true` en base

- [x] Task 2 : Contenu de la notification (AC: #2, #3)
  - [x] 2.1 Titre : "Bienvenue dans la famille culer ! 🎉"
  - [x] 2.2 Texte chaleureux et suggestions d'actions :
    - "Consulte le calendrier des matchs" (lien désactivé pour l'instant)
    - "Découvre les autres membres" (lien vers /membres)
    - "Personnalise ton profil" (lien vers /profil)
  - [x] 2.3 Design Card blaugrana, ton chaleureux

- [x] Task 3 : Action serveur pour marquer la notification comme vue (AC: #4)
  - [x] 3.1 Créer une resource route `app/routes/api.welcome-dismiss.ts` :
    - Action POST : mettre à jour `welcomeShown = true` via Drizzle
    - Nécessite authentification
  - [x] 3.2 Enregistrer la route dans `app/routes.ts`
  - [x] 3.3 Le composant appelle cette route via `useFetcher()` à la fermeture

- [x] Task 4 : Tests (AC: #1-#5)
  - [x] 4.1 Exécuter `npm run test:run` — TOUS les tests passent à 100%

## Dev Notes

### Fichiers à modifier/créer

| Fichier | Action |
|---------|--------|
| `app/root.tsx` | Ajouter `welcomeShown` au loader |
| `app/components/shared/welcome-notification.tsx` | CRÉER — composant notification |
| `app/routes/api.welcome-dismiss.ts` | CRÉER — resource route pour marquer vu |
| `app/routes.ts` | Ajouter route api/welcome-dismiss |

### Champ DB existant

Le champ `welcome_shown` (boolean, default false) existe déjà dans la table `user` (créé Story 1.2). Pas de migration nécessaire.

### Pattern useFetcher

```typescript
const fetcher = useFetcher();
fetcher.submit(null, { method: "POST", action: "/api/welcome-dismiss" });
```

### Logique serveur dans resource routes

Les resource routes (`.ts` sans composant) n'ont pas le problème d'import serveur/client. Pas besoin de fichier `.server.ts` séparé.

### Références

- [Source: _bmad-output/planning-artifacts/epics.md#Story 2.4]
- [Source: _bmad-output/planning-artifacts/prd.md#ADN & Principes de Design — ton chaleureux]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (1M context)

### Debug Log References

- Resource route `.ts` (sans composant) n'a pas le problème d'import serveur/client — pas besoin de `.server.ts` séparé.

### Completion Notes List

- Composant WelcomeNotification : banner avec titre, suggestions d'actions, bouton "C'est parti !"
- Affiché dans root.tsx uniquement si user connecté ET welcomeShown === false
- Resource route `/api/welcome-dismiss` : marque welcomeShown = true via Drizzle
- Fermeture via useFetcher() — disparaît instantanément côté client + persist en base
- Root loader enrichi avec welcomeShown depuis la DB
- 45 tests passent à 100%

### Change Log

- 2026-04-11 : Implémentation Story 2.4 — notification de bienvenue

### File List

- app/root.tsx (modifié — ajout welcomeShown au loader + WelcomeNotification)
- app/components/shared/welcome-notification.tsx (créé)
- app/routes/api.welcome-dismiss.ts (créé — resource route)
- app/routes.ts (modifié — ajout route api/welcome-dismiss)
