# Story 1.2 : Inscription d'un Nouveau Membre

Status: review

## Story

As a visiteur,
I want creer un compte avec mon email et un mot de passe,
so that je puisse rejoindre la communaute Penya Barca Nantes.

## Acceptance Criteria

1. Le formulaire d'inscription contient : email, pseudo, mot de passe, confirmation mot de passe
2. Un compte membre est cree avec le role "membre" par defaut
3. Le mot de passe est hashe et sale (jamais stocke en clair) — NFR6
4. Le consentement RGPD est recueilli explicitement avant la creation — NFR9
5. La validation Zod verifie les champs (email valide, mot de passe fort, pseudo unique)
6. Les erreurs de validation sont affichees clairement en francais
7. Le membre est automatiquement connecte apres inscription
8. La page est accessible WCAG 2.1 AA (contrastes, clavier, ARIA) — NFR14-17
9. Si un email deja utilise, un message d'erreur explicite est affiche sans reveler si l'email existe (securite)

## Tasks / Subtasks

- [x] Task 1 : Installation et configuration Better Auth (AC: #2, #3)
  - [x] 1.1 Installer Better Auth : `npm i better-auth`
  - [x] 1.2 Creer `app/lib/server/auth.server.ts` avec la config Better Auth :
    - Adapter Drizzle (`drizzleAdapter`) connecte a `db` depuis `app/db/client.ts`
    - `emailAndPassword: { enabled: true }`
    - `basePath: "/api/auth"`
    - `user.additionalFields` : pseudo (string), role (string, default "member"), avatarUrl (string, optional), gdprConsent (boolean, default false), welcomeShown (boolean, default false)
    - `secondaryStorage` connecte a Redis (ioredis) pour le cache de sessions
  - [x] 1.3 Creer `app/lib/auth.client.ts` avec `createAuthClient` :
    - Exporter `signUp`, `signIn`, `signOut`, `useSession`
  - [x] 1.4 Creer la route catch-all `app/routes/api.auth.$.ts` :
    - Loader et Action delegues a `auth.handler(request)`
  - [x] 1.5 Enregistrer la route dans `app/routes.ts` : `route("api/auth/*", "routes/api.auth.$.ts")`

- [x] Task 2 : Schema DB utilisateurs avec Better Auth (AC: #2)
  - [x] 2.1 Generer les tables auth : `npx @better-auth/cli generate`
    - Tables attendues : `user`, `session`, `account`, `verification`
    - Colonnes custom : pseudo, role, avatar_url, gdpr_consent, welcome_shown
  - [x] 2.2 Mettre a jour `app/db/schema/users.ts` pour refleter le schema Better Auth + champs custom
  - [x] 2.3 Exporter le schema depuis `app/db/schema/index.ts`
  - [x] 2.4 Generer la migration Drizzle : `npm run db:generate`
  - [x] 2.5 Appliquer la migration : `npm run db:migrate`
  - [x] 2.6 Verifier que les tables sont creees dans PostgreSQL

- [x] Task 3 : Schema de validation Zod pour l'inscription (AC: #5, #6)
  - [x] 3.1 Creer `app/lib/validation/user.ts` avec `registerSchema` :
    ```typescript
    email: z.string().email("Email invalide"),
    pseudo: z.string().min(3, "Pseudo : 3 caracteres minimum").max(30).regex(/^[a-zA-Z0-9_-]+$/, "Pseudo : lettres, chiffres, _ et - uniquement"),
    password: z.string().min(8, "Mot de passe : 8 caracteres minimum").regex(/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, "Mot de passe : majuscule, minuscule et chiffre requis"),
    confirmPassword: z.string(),
    gdprConsent: z.literal(true, { errorMap: () => ({ message: "Vous devez accepter la politique de confidentialite" }) }),
    ```
    + `.refine(data => data.password === data.confirmPassword, "Les mots de passe ne correspondent pas")`
  - [x] 3.2 Messages d'erreur en francais pour chaque champ
  - [x] 3.3 Tests unitaires pour le schema de validation (cas valides + invalides)

- [x] Task 4 : Page d'inscription UI (AC: #1, #4, #6, #8)
  - [x] 4.1 Creer `app/routes/register.tsx` avec le formulaire :
    - Champs : email, pseudo, mot de passe, confirmation, checkbox RGPD
    - Composants shadcn/ui (Input, Button, Card, Label)
    - Labels et placeholders en francais
    - `aria-describedby` pour les messages d'erreur
    - Navigation clavier fonctionnelle (tabindex logique)
  - [x] 4.2 Enregistrer la route dans `app/routes.ts` : `route("inscription", "routes/register.tsx")`
  - [x] 4.3 Validation cote client avec affichage des erreurs sous chaque champ
  - [x] 4.4 Design responsive mobile-first avec palette blaugrana
  - [x] 4.5 Contrastes WCAG 2.1 AA (ratio minimum 4.5:1) — NFR15
  - [x] 4.6 Lien vers la page de connexion ("Deja membre ? Se connecter")

- [x] Task 5 : Action serveur d'inscription (AC: #2, #3, #7, #9)
  - [x] 5.1 Implementer l'action dans `app/routes/register.tsx` :
    - Validation Zod cote serveur (double validation client + serveur)
    - Verifier unicite du pseudo (query Drizzle)
    - Appeler `auth.api.signUpEmail()` avec les champs du formulaire
    - Better Auth gere le hash du mot de passe automatiquement
    - Gerer les erreurs : email deja utilise → message generique (securite AC #9)
  - [x] 5.2 Apres inscription reussie, connecter automatiquement le membre (AC #7)
  - [x] 5.3 Rediriger vers la page d'accueil authentifiee (ou `/feed` quand disponible)
  - [x] 5.4 Logger l'inscription via Pino : `{ action: "user-registered", userId }`

- [x] Task 6 : Gestion des erreurs securisee (AC: #9)
  - [x] 6.1 Si email deja utilise : afficher "Une erreur est survenue lors de l'inscription" (pas "cet email existe deja")
  - [x] 6.2 Rate limiting basique sur la route d'inscription (protection brute force) :
    - Utiliser Redis pour compter les tentatives par IP
    - Max 5 inscriptions par IP par heure
  - [x] 6.3 Erreur AppError typee : `new AppError("REGISTRATION_FAILED", message, 400)`

- [x] Task 7 : Tests (AC: #1-#9)
  - [x] 7.1 Tests unitaires : `app/lib/validation/user.test.ts`
    - Email valide/invalide
    - Pseudo trop court, trop long, caracteres interdits
    - Mot de passe faible (pas de majuscule, pas de chiffre, trop court)
    - Mots de passe qui ne correspondent pas
    - RGPD non accepte
  - [x] 7.2 Tests unitaires : rate limiting logic
  - [x] 7.3 Executer `npm run test:run` — TOUS les tests passent a 100%

## Dev Notes

### Architecture Compliance

- **Auth provider :** Better Auth v1.x — email/mot de passe, gestion des roles
- **Sessions :** `secondaryStorage` Redis pour le cache, DB comme source de verite
- **Hash :** Better Auth utilise bcrypt/argon2 en interne — NE PAS implementer de hash manuel
- **Roles :** champ `role` sur le user, valeurs : `"member"` | `"admin"` | `"partner"`
- **RGPD :** champ `gdprConsent` obligatoire a true, `welcomeShown` pour la notification de bienvenue (Story 2.4)

### Learnings Story 1.1 (CRITIQUE)

- **Routes RR7 v7.14 :** Toutes les routes doivent etre enregistrees dans `app/routes.ts` via `route()`. Pas de file-based routing automatique.
- **Convention fichiers :** Flat-file avec points (`api.auth.$.ts`, pas `api/auth/$.ts`)
- **Fichiers existants a reutiliser :**
  - `app/db/client.ts` — instance Drizzle + pool PostgreSQL
  - `app/lib/server/redis.server.ts` — client ioredis
  - `app/lib/server/logger.server.ts` — Pino logger
  - `app/lib/server/errors.server.ts` — AppError class
  - `app/lib/utils.ts` — cn() helper
  - `app/config/env.server.ts` — variables d'environnement validees Zod
- **Composants shadcn/ui deja installes :** button, card, input, label
- **Schema `users` actuel :** table minimale (id uuid, email, created_at) — sera REMPLACEE par le schema Better Auth

### Naming Conventions

| Contexte | Convention | Exemples |
|----------|-----------|----------|
| Tables DB | snake_case pluriel | `user`, `session`, `account` |
| Colonnes DB | snake_case | `avatar_url`, `gdpr_consent`, `welcome_shown` |
| Fichiers routes | flat-file avec points | `register.tsx`, `api.auth.$.ts` |
| Schemas Zod | camelCase + Schema | `registerSchema` |
| Types | PascalCase | `RegisterFormData` |

### Anti-Patterns

- **NE PAS** hasher les mots de passe manuellement — Better Auth le fait
- **NE PAS** reveler si un email existe deja (message generique)
- **NE PAS** creer de store global pour l'auth — utiliser les loaders RR7
- **NE PAS** utiliser `undefined` dans les reponses (utiliser `null`)
- **NE PAS** creer de couche service — les actions appellent Better Auth et Drizzle directement

### Better Auth Integration Notes

- **Catch-all route :** `api/auth/*` via `app/routes/api.auth.$.ts` — loader + action delegues a `auth.handler(request)`
- **Client :** `createAuthClient()` dans `app/lib/auth.client.ts`
- **Session check serveur :** `auth.api.getSession({ headers: request.headers })`
- **Inscription :** `auth.api.signUpEmail()` cote serveur ou `signUp.email()` cote client
- **Tables generees par Better Auth :** `user`, `session`, `account`, `verification` — la table `users` de la Story 1.1 sera remplacee

### File Structure

```
app/
  lib/
    server/
      auth.server.ts          # Config Better Auth (NOUVEAU)
    auth.client.ts             # Client-side auth (NOUVEAU)
    validation/
      user.ts                  # registerSchema (NOUVEAU)
      user.test.ts             # Tests validation (NOUVEAU)
  routes/
    register.tsx               # Page inscription (NOUVEAU)
    api.auth.$.ts              # Catch-all auth API (NOUVEAU)
  db/
    schema/
      users.ts                 # Schema Better Auth + custom fields (MODIFIE)
```

### References

- [Source: _bmad-output/planning-artifacts/architecture.md#Authentication & Security]
- [Source: _bmad-output/planning-artifacts/architecture.md#Implementation Patterns & Consistency Rules]
- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.2]
- [Source: _bmad-output/planning-artifacts/prd.md#ADN & Principes de Design]
- [Source: _bmad-output/implementation-artifacts/1-1-initialisation-du-projet-et-infrastructure-docker.md#Debug Log References]

### Tech Versions

| Library | Version | Notes |
|---------|---------|-------|
| Better Auth | 1.x (latest) | `npm i better-auth` |
| Better Auth CLI | latest | `npm i -D @better-auth/cli` |
| Zod | 4.3.6 | deja installe |
| shadcn/ui | deja installe | button, card, input, label |

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (1M context)

### Debug Log References

- Better Auth CLI (`npx @better-auth/cli generate`) est interactif et ne fonctionne pas en non-TTY. Schema cree manuellement selon la documentation Better Auth.
- Drizzle Kit `generate` demande une confirmation interactive quand une table est renommee (users → user). Resolu en supprimant l'ancienne migration et en regenerant de zero.
- Les routes RR7 doivent etre dans `app/routes.ts` (confirme par Story 1.1).

### Completion Notes List

- Better Auth 1.6.2 installe et configure avec Drizzle adapter + Redis secondaryStorage
- Schema DB complet : tables user, session, account, verification + champs custom (pseudo, role, avatarUrl, gdprConsent, welcomeShown)
- Migration Drizzle generee et appliquee — 4 tables creees dans PostgreSQL
- Route catch-all `api/auth/*` pour le handler Better Auth
- Client auth (`signUp`, `signIn`, `signOut`, `useSession`) exporte depuis auth.client.ts
- Schema Zod `registerSchema` avec validation stricte et messages en francais
- Page d'inscription `/inscription` responsive mobile-first avec composants shadcn/ui
- WCAG 2.1 AA : labels, aria-describedby, aria-invalid, navigation clavier
- Message d'erreur generique pour email deja utilise (securite)
- Rate limiting Redis (checkRateLimit) avec AppError
- Helper `requireAuth` avec verification de role (member/admin/partner)
- 29 tests passent a 100% (5 fichiers)

### Change Log

- 2026-04-11 : Implementation Story 1.2 — inscription membre avec Better Auth

### File List

- package.json (modifie — ajout better-auth)
- app/routes.ts (modifie — ajout routes auth + inscription)
- app/lib/server/auth.server.ts (cree — config Better Auth)
- app/lib/server/auth-utils.server.ts (cree — getSession, requireAuth)
- app/lib/server/rate-limit.server.ts (cree — rate limiting Redis)
- app/lib/server/rate-limit.server.test.ts (cree — 5 tests)
- app/lib/auth.client.ts (cree — client auth)
- app/lib/validation/user.ts (cree — registerSchema Zod)
- app/lib/validation/user.test.ts (cree — 12 tests)
- app/routes/register.tsx (cree — page inscription)
- app/routes/api.auth.$.ts (cree — catch-all auth)
- app/db/schema/users.ts (modifie — schema Better Auth complet)
- app/db/schema/index.ts (modifie — exports user, session, account, verification)
- app/db/migrations/0000_flawless_epoch.sql (regenere — tables Better Auth)
