# Story 2.1 : Consulter et Modifier son Profil

Status: review

## Story

As a membre,
I want consulter et modifier mon profil (pseudo, avatar, informations personnelles),
so that mon identité dans la communauté me représente.

## Acceptance Criteria

1. Un membre connecté voit ses informations actuelles (pseudo, avatar, email, date d'inscription)
2. Il peut modifier son pseudo et son avatar
3. L'upload d'avatar est stocké localement dans le volume Docker `/uploads`
4. Les images sont compressées/optimisées (WebP/AVIF)
5. La validation Zod vérifie les champs (pseudo unique, taille image max)
6. Les modifications sont confirmées avec un message de succès
7. Un membre peut consulter toutes ses données personnelles stockées — NFR9 (RGPD)
8. Un membre peut demander la suppression de son compte
9. Un pseudo déjà pris affiche une erreur explicite

## Tasks / Subtasks

- [x] Task 1 : Page de profil — consultation (AC: #1)
  - [x] 1.1 Créer `app/routes/profile.tsx` avec loader :
    - `requireAuth(request)` pour vérifier l'authentification
    - Charger les infos du user depuis la session Better Auth (pseudo, email, avatarUrl, createdAt, role)
    - Afficher les informations dans un layout Card propre
  - [x] 1.2 Enregistrer la route dans `app/routes.ts` : `route("profil", "routes/profile.tsx")`
  - [x] 1.3 Afficher : pseudo, avatar (ou placeholder), email, date d'inscription formatée en fr-FR
  - [x] 1.4 Design responsive mobile-first, palette blaugrana

- [x] Task 2 : Modification du pseudo (AC: #2, #5, #6, #9)
  - [x] 2.1 Ajouter `updateProfileSchema` dans `app/lib/validation/user.ts` :
    ```typescript
    pseudo: z.string().min(3, "Pseudo : 3 caractères minimum").max(30, "Pseudo : 30 caractères maximum").regex(/^[a-zA-Z0-9_-]+$/, "Pseudo : lettres, chiffres, _ et - uniquement"),
    ```
  - [x] 2.2 Implémenter une action dans `profile.tsx` :
    - Valider le pseudo avec Zod côté serveur
    - Vérifier l'unicité du pseudo via query Drizzle (`SELECT` sur table `user` WHERE pseudo = ...)
    - Mettre à jour le pseudo via Drizzle (`UPDATE user SET pseudo = ... WHERE id = ...`)
    - Si pseudo déjà pris → message d'erreur explicite (AC #9)
    - Si succès → message de confirmation (AC #6)
  - [x] 2.3 Formulaire inline éditable : clic sur "Modifier" → champ input apparaît → "Enregistrer" / "Annuler"
  - [x] 2.4 Logger la modification via Pino : `{ action: "profile-updated", userId, field: "pseudo" }`

- [x] Task 3 : Upload et modification de l'avatar (AC: #2, #3, #4)
  - [x] 3.1 Créer le dossier `uploads/avatars/` (volume Docker)
  - [x] 3.2 Ajouter dans l'action de `profile.tsx` la gestion de l'upload :
    - Accepter les fichiers image (jpeg, png, webp)
    - Taille max : 2 Mo
    - Renommer le fichier : `{userId}.webp`
    - Compresser/convertir en WebP via la librairie `sharp`
    - Stocker dans `uploads/avatars/`
    - Mettre à jour `avatar_url` en base
  - [x] 3.3 Installer `sharp` : `npm i sharp`
  - [x] 3.4 Créer `app/lib/server/upload.server.ts` :
    - Fonction `processAvatar(file: File, userId: string): Promise<string>` → retourne l'URL relative
    - Validation type MIME + taille
    - Compression WebP via sharp
  - [x] 3.5 Servir les fichiers statiques : ajouter une resource route `app/routes/uploads.$.ts` ou configurer via le serveur
  - [x] 3.6 Afficher l'avatar actuel avec fallback (initiales du pseudo ou icône par défaut)

- [x] Task 4 : Section RGPD — données personnelles et suppression (AC: #7, #8)
  - [x] 4.1 Ajouter une section "Mes données personnelles" dans la page profil :
    - Afficher toutes les données stockées : email, pseudo, avatar, date d'inscription, rôle, consentement RGPD
    - Texte explicatif : "Conformément au RGPD, voici l'ensemble de vos données personnelles."
  - [x] 4.2 Bouton "Supprimer mon compte" :
    - Dialogue de confirmation : "Êtes-vous sûr ? Cette action est irréversible."
    - Appeler Better Auth pour supprimer le compte (ou implémenter la suppression via Drizzle)
    - Déconnecter l'utilisateur et rediriger vers la page d'accueil
    - Logger la suppression : `{ action: "account-deleted", userId }`

- [x] Task 5 : Navigation vers le profil (AC: #1)
  - [x] 5.1 Mettre à jour le header : le pseudo cliquable pointe vers `/profil` au lieu de `/espace-membre`
  - [x] 5.2 Mettre à jour la route protégée temporaire `/espace-membre` → rediriger vers `/profil`

- [x] Task 6 : Tests (AC: #1-#9)
  - [x] 6.1 Tests unitaires : `updateProfileSchema` dans `app/lib/validation/user.test.ts`
  - [x] 6.2 Tests unitaires : `processAvatar` (validation type MIME, taille max, format sortie)
  - [x] 6.3 Exécuter `npm run test:run` — TOUS les tests passent à 100%

## Dev Notes

### Learnings Stories précédentes (CRITIQUE)

- **Routes RR7 :** toutes dans `app/routes.ts` via `route()` — CONFIRMÉ
- **Better Auth :** session accessible via `getSession(request)` / `requireAuth(request)` dans `auth-utils.server.ts`
- **Composants shadcn/ui disponibles :** button, card, input, label
- **Schema DB user :** champs pseudo (varchar 30, unique), avatar_url (text), createdAt, role, gdprConsent, welcomeShown
- **Accents français obligatoires** dans tous les textes UI et messages d'erreur
- **Palette blaugrana :** primary (#A50044), secondary (#004D98), accent (#EDBB00)

### Fichiers existants à réutiliser

| Fichier | Usage |
|---------|-------|
| `app/lib/server/auth-utils.server.ts` | `requireAuth`, `getSession` |
| `app/lib/validation/user.ts` | Ajouter `updateProfileSchema` |
| `app/lib/server/logger.server.ts` | Pino logger |
| `app/lib/server/errors.server.ts` | AppError |
| `app/db/client.ts` | Instance Drizzle pour les queries |
| `app/db/schema/users.ts` | Schema table `user` |
| `app/components/layout/header.tsx` | Mettre à jour le lien pseudo |

### Architecture upload avatar

- **Stockage :** volume Docker `/uploads/avatars/` (local, MVP)
- **Format :** WebP (compression via `sharp`)
- **Nom fichier :** `{userId}.webp` (un seul avatar par user, écrasé à chaque modification)
- **Taille max :** 2 Mo avant compression
- **Accès :** route statique ou resource route pour servir les fichiers
- **Fallback :** si pas d'avatar → cercle avec initiales du pseudo ou icône générique

### Convention Drizzle pour les queries directes

```typescript
import { db } from "~/db/client";
import { user } from "~/db/schema";
import { eq } from "drizzle-orm";

// Lecture
const userData = await db.select().from(user).where(eq(user.id, userId));

// Mise à jour
await db.update(user).set({ pseudo: newPseudo }).where(eq(user.id, userId));
```

### Anti-Patterns

- **NE PAS** utiliser Better Auth pour modifier le pseudo — utiliser Drizzle directement
- **NE PAS** stocker les avatars en base64 en base — utiliser le filesystem
- **NE PAS** servir les uploads via un CDN pour le MVP — volume Docker local suffit

### Références

- [Source: _bmad-output/planning-artifacts/epics.md#Story 2.1]
- [Source: _bmad-output/planning-artifacts/architecture.md#Infrastructure & Deployment — uploads volume Docker]
- [Source: _bmad-output/planning-artifacts/prd.md#ADN & Principes de Design]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (1M context)

### Debug Log References

- `sharp` installé pour la compression WebP des avatars.
- Route `/espace-membre` transformée en simple redirect vers `/profil`.
- Tous les textes avec accents français corrects.

### Completion Notes List

- Page `/profil` complète : consultation infos, modification pseudo inline, upload avatar
- Upload avatar via `sharp` : compression WebP 256x256, stockage dans `uploads/avatars/`
- Resource route `/uploads/*` pour servir les fichiers statiques avec cache
- Validation `updateProfileSchema` Zod avec vérification unicité pseudo via Drizzle
- Section RGPD : affichage données personnelles + suppression de compte avec confirmation
- Header mis à jour : pseudo pointe vers `/profil`
- Route `/espace-membre` redirige vers `/profil`
- 45 tests passent à 100% (6 fichiers)

### Change Log

- 2026-04-11 : Implémentation Story 2.1 — profil membre, avatar, RGPD

### File List

- package.json (modifié — ajout sharp)
- app/routes.ts (modifié — ajout routes profil + uploads)
- app/routes/profile.tsx (créé — page profil complète)
- app/routes/uploads.$.ts (créé — resource route fichiers statiques)
- app/routes/protected.tsx (modifié — redirect vers /profil)
- app/lib/validation/user.ts (modifié — ajout updateProfileSchema)
- app/lib/validation/user.test.ts (modifié — ajout 4 tests updateProfile)
- app/lib/server/upload.server.ts (créé — traitement avatar sharp)
- app/lib/server/upload.server.test.ts (créé — 8 tests validation upload)
- app/components/layout/header.tsx (modifié — lien pseudo → /profil)
- uploads/avatars/ (créé — dossier stockage avatars)
