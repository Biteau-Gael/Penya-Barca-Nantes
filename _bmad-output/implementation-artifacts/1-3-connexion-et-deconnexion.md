# Story 1.3 : Connexion et Deconnexion

Status: review

## Story

As a membre,
I want me connecter et me deconnecter de mon compte,
so that j'accede a mon espace de maniere securisee.

## Acceptance Criteria

1. Un membre avec un compte existant peut se connecter avec email et mot de passe corrects
2. Apres connexion reussie, le membre est redirige vers la page d'accueil authentifiee
3. Une session est creee dans Redis avec expiration apres inactivite — NFR7
4. La separation des roles est active (membre, admin, partenaire) — NFR8
5. Un membre connecte peut se deconnecter via un bouton
6. A la deconnexion, la session Redis est invalidee
7. Apres deconnexion, le membre est redirige vers la page d'accueil publique
8. Un message d'erreur generique est affiche pour des identifiants incorrects ("Email ou mot de passe incorrect")
9. Le rate limiting protege contre le brute force sur la connexion
10. Une session expiree redirige vers la page de connexion

## Tasks / Subtasks

- [x] Task 1 : Schema de validation Zod pour la connexion (AC: #1, #8)
  - [x] 1.1 Ajouter `loginSchema` dans `app/lib/validation/user.ts` :
    ```typescript
    email: z.string().email("Email invalide"),
    password: z.string().min(1, "Mot de passe requis"),
    ```
  - [x] 1.2 Tests unitaires pour `loginSchema` (cas valides + invalides)

- [x] Task 2 : Page de connexion UI (AC: #1, #8, #10)
  - [x] 2.1 Creer `app/routes/login.tsx` avec le formulaire :
    - Champs : email, mot de passe
    - Composants shadcn/ui (Input, Button, Card, Label)
    - Labels et placeholders en francais
    - `aria-describedby` pour les messages d'erreur
    - Navigation clavier fonctionnelle
  - [x] 2.2 Enregistrer la route dans `app/routes.ts` : `route("connexion", "routes/login.tsx")`
  - [x] 2.3 Validation cote client avec affichage des erreurs sous chaque champ
  - [x] 2.4 Message d'erreur generique : "Email ou mot de passe incorrect" (AC #8)
  - [x] 2.5 Design responsive mobile-first avec palette blaugrana
  - [x] 2.6 Lien vers la page d'inscription ("Pas encore membre ? S'inscrire")
  - [x] 2.7 Appeler `signIn.email()` de Better Auth client pour l'authentification
  - [x] 2.8 Redirection vers `/` apres connexion reussie (AC #2)

- [x] Task 3 : Rate limiting connexion (AC: #9)
  - [x] 3.1 Integrer `checkRateLimit` (deja cree Story 1.2) sur la route de connexion
  - [x] 3.2 Config : max 10 tentatives par IP par 15 minutes
  - [x] 3.3 Afficher le message rate limit dans le formulaire

- [x] Task 4 : Navigation authentifiee et deconnexion (AC: #5, #6, #7)
  - [x] 4.1 Creer `app/components/layout/header.tsx` :
    - Logo/nom Penya Barca Nantes
    - Navigation conditionnelle : si connecte → liens app + bouton deconnexion, si non connecte → liens inscription/connexion
    - Responsive mobile (menu burger ou nav simplifiee)
  - [x] 4.2 Ajouter le header dans `app/root.tsx` (layout global)
  - [x] 4.3 Implementer la deconnexion via `signOut()` de Better Auth client
  - [x] 4.4 Apres deconnexion, redirection vers `/` (AC #7)
  - [x] 4.5 Le loader de `root.tsx` charge la session via `getSession(request)` et la passe au header

- [x] Task 5 : Protection des routes authentifiees (AC: #4, #10)
  - [x] 5.1 Creer un loader de test dans une route protegee temporaire `app/routes/protected.tsx` :
    - Utiliser `requireAuth(request)` depuis `auth-utils.server.ts`
    - Si non authentifie → redirect vers `/connexion`
    - Si authentifie → afficher un message de bienvenue avec le pseudo
  - [x] 5.2 Enregistrer la route dans `app/routes.ts` : `route("espace-membre", "routes/protected.tsx")`
  - [x] 5.3 Verifier que la session expire correctement (NFR7)

- [x] Task 6 : Tests (AC: #1-#10)
  - [x] 6.1 Tests unitaires : `loginSchema` dans `app/lib/validation/user.test.ts` (ajout)
  - [x] 6.2 Executer `npm run test:run` — TOUS les tests passent a 100%

## Dev Notes

### Learnings Story 1.2 (CRITIQUE)

- **Better Auth deja installe (1.6.2)** et configure dans `app/lib/server/auth.server.ts`
- **Client auth deja exporte** depuis `app/lib/auth.client.ts` : `signIn`, `signOut`, `useSession`
- **Route catch-all `api/auth/*`** deja en place dans `app/routes/api.auth.$.ts`
- **Rate limiting** deja implemente dans `app/lib/server/rate-limit.server.ts` — le reutiliser
- **`requireAuth` et `getSession`** deja implementes dans `app/lib/server/auth-utils.server.ts`
- **Schema DB** : tables user, session, account, verification deja creees
- **Routes RR7 :** toutes les routes dans `app/routes.ts` via `route()` (pas de file-based auto)
- **Composants shadcn/ui deja installes :** button, card, input, label

### Fichiers existants a reutiliser (NE PAS recreer)

| Fichier | Contenu | Usage dans cette story |
|---------|---------|----------------------|
| `app/lib/server/auth.server.ts` | Config Better Auth | Deja fait |
| `app/lib/auth.client.ts` | `signIn`, `signOut`, `useSession` | Utiliser dans login.tsx et header |
| `app/lib/server/auth-utils.server.ts` | `getSession`, `requireAuth` | Loader root.tsx et routes protegees |
| `app/lib/server/rate-limit.server.ts` | `checkRateLimit` | Rate limit sur connexion |
| `app/lib/server/logger.server.ts` | Pino logger | Logger les connexions |
| `app/lib/server/errors.server.ts` | AppError | Erreurs typees |
| `app/lib/utils.ts` | `cn()` | Classes conditionnelles |

### Architecture

- **Connexion :** `signIn.email()` client → Better Auth handler → session creee en DB + cache Redis
- **Deconnexion :** `signOut()` client → Better Auth handler → session invalidee
- **Session check :** loader root.tsx → `getSession(request)` → passe au header
- **Routes protegees :** loader → `requireAuth(request)` → redirect si non auth
- **Rate limiting :** cote client la route `api/auth/*` est geree par Better Auth, mais on peut ajouter un middleware custom si necessaire

### Naming Conventions

| Contexte | Convention | Exemples |
|----------|-----------|----------|
| Fichiers routes | flat-file | `login.tsx`, `protected.tsx` |
| Composants layout | kebab-case | `header.tsx` |
| URL routes | francais kebab | `/connexion`, `/espace-membre` |

### Anti-Patterns

- **NE PAS** reveler si l'email existe lors d'un echec de connexion
- **NE PAS** stocker le mot de passe en clair ni le logger
- **NE PAS** creer un nouveau systeme de session — utiliser Better Auth
- **NE PAS** dupliquer la logique de rate limiting — reutiliser `checkRateLimit`

### References

- [Source: _bmad-output/planning-artifacts/architecture.md#Authentication & Security]
- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.3]
- [Source: _bmad-output/implementation-artifacts/1-2-inscription-dun-nouveau-membre.md#Completion Notes]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (1M context)

### Debug Log References

- Warning `asChild` prop de shadcn/ui Button — cosmetic, pas d'impact fonctionnel.
- Route protegee `/espace-membre` redirige correctement vers `/connexion` quand non authentifie.

### Completion Notes List

- Page connexion `/connexion` — formulaire responsive mobile-first, messages en francais, WCAG AA
- loginSchema Zod ajoute dans validation/user.ts
- Rate limiting integre sur le catch-all auth (10 tentatives/15 min login, 5/1h register)
- Header global avec nav conditionnelle (connecte/non connecte) + bouton deconnexion
- Loader root.tsx charge la session et la passe au header
- Route protegee `/espace-membre` avec requireAuth + redirect
- `html lang="fr"` corrige dans root.tsx
- 33 tests passent a 100% (5 fichiers)

### Change Log

- 2026-04-11 : Implementation Story 1.3 — connexion, deconnexion, header, route protegee

### File List

- app/routes.ts (modifie — ajout routes connexion + espace-membre)
- app/routes/login.tsx (cree — page connexion)
- app/routes/protected.tsx (cree — route protegee test)
- app/routes/api.auth.$.ts (modifie — rate limiting integre)
- app/root.tsx (modifie — loader session + header + lang fr)
- app/components/layout/header.tsx (cree — header global)
- app/lib/validation/user.ts (modifie — ajout loginSchema)
- app/lib/validation/user.test.ts (modifie — ajout 4 tests loginSchema)
