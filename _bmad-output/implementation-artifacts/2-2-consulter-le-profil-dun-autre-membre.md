# Story 2.2 : Consulter le Profil d'un Autre Membre

Status: review

## Story

As a membre,
I want consulter le profil d'un autre membre,
so that je puisse le connaître et me sentir connecté à la communauté.

## Acceptance Criteria

1. Un membre connecté peut accéder au profil d'un autre membre
2. Il voit le pseudo, l'avatar, la date d'inscription et les stats publiques du membre
3. Les informations privées (email) ne sont pas visibles
4. La page est responsive mobile-first
5. Un profil inexistant affiche une page d'erreur 404 conviviale

## Tasks / Subtasks

- [x] Task 1 : Route et loader pour le profil membre (AC: #1, #2, #3, #5)
  - [x] 1.1 Créer `app/routes/member-profile.server.ts` avec le loader :
    - `requireAuth(request)` pour vérifier l'authentification
    - Charger le membre via Drizzle : `db.select().from(user).where(eq(user.id, memberId))`
    - Retourner uniquement les données publiques : pseudo, avatarUrl, createdAt, role
    - NE PAS retourner : email, gdprConsent, welcomeShown
    - Si membre introuvable → throw Response 404
  - [x] 1.2 Créer `app/routes/member-profile.tsx` — composant UI :
    - Importer le loader depuis `member-profile.server.ts`
    - Afficher le profil public dans un layout Card
    - Avatar avec fallback (initiale du pseudo)
    - Date d'inscription formatée en fr-FR
    - Section "Statistiques" avec état vide : "Aucun pronostic pour le moment" (les données viendront avec l'Epic 4)
  - [x] 1.3 Enregistrer la route dans `app/routes.ts` : `route("membres/:memberId", "routes/member-profile.tsx")`

- [x] Task 2 : Page 404 conviviale (AC: #5)
  - [x] 2.1 Ajouter un `ErrorBoundary` dans `member-profile.tsx` :
    - Si erreur 404 → afficher un message convivial : "Ce membre n'existe pas ou a été supprimé."
    - Bouton "Retour à l'accueil"
    - Design blaugrana cohérent

- [x] Task 3 : Responsive et accessibilité (AC: #4)
  - [x] 3.1 Layout mobile-first avec max-w-md centré
  - [x] 3.2 Texte alternatif sur l'avatar
  - [x] 3.3 Navigation clavier fonctionnelle

- [x] Task 4 : Tests (AC: #1-#5)
  - [x] 4.1 Exécuter `npm run test:run` — TOUS les tests passent à 100%

## Dev Notes

### Learnings Stories précédentes (CRITIQUE)

- **Routes RR7 :** toutes dans `app/routes.ts` via `route()` — CONFIRMÉ
- **Fichiers `.server.ts` séparés :** la logique serveur (Drizzle, auth) doit être dans un fichier `.server.ts` séparé pour éviter l'erreur de module côté client (appris Story 2.1)
- **Nommage fichiers routes :** pas de `$` dans les noms de fichiers quand on utilise le routing explicite (appris Story 2.1). Utiliser des noms lisibles (`member-profile.tsx`, pas `members.$memberId.tsx`)
- **Accents français obligatoires** dans tous les textes UI
- **Paramètres de route :** `route("membres/:memberId", ...)` → le param est accessible via `params.memberId`

### Fichiers existants à réutiliser

| Fichier | Usage |
|---------|-------|
| `app/lib/server/auth-utils.server.ts` | `requireAuth` |
| `app/db/client.ts` | Instance Drizzle |
| `app/db/schema/users.ts` | Schema table `user` |
| `app/components/ui/*` | Card, Button |

### Données publiques vs privées

| Champ | Public | Privé |
|-------|--------|-------|
| pseudo | ✅ | |
| avatarUrl | ✅ | |
| createdAt | ✅ | |
| role | ✅ | |
| email | | ✅ |
| gdprConsent | | ✅ |
| welcomeShown | | ✅ |

### Anti-Patterns

- **NE PAS** exposer l'email d'un autre membre
- **NE PAS** retourner les champs RGPD dans la réponse publique

### Références

- [Source: _bmad-output/planning-artifacts/epics.md#Story 2.2]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (1M context)

### Debug Log References

- Logique serveur séparée dans `member-profile.server.ts` (pattern confirmé Story 2.1).

### Completion Notes List

- Page `/membres/:memberId` : profil public (pseudo, avatar, rôle, date d'inscription)
- Données privées (email, RGPD) exclues de la réponse
- Section statistiques avec état vide (en attente de l'Epic 4)
- ErrorBoundary 404 convivial avec bouton retour accueil
- 45 tests passent à 100%

### Change Log

- 2026-04-11 : Implémentation Story 2.2 — profil public d'un membre

### File List

- app/routes.ts (modifié — ajout route membres/:memberId)
- app/routes/member-profile.tsx (créé — page profil public)
- app/routes/member-profile.server.ts (créé — loader serveur)
