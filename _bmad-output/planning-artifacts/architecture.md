---
stepsCompleted: [1, 2, 3, 4, 5, 6, 7, 8]
workflowCompleted: true
lastStep: 8
status: 'complete'
completedAt: '2026-04-10'
inputDocuments: ['planning-artifacts/prd.md']
workflowType: 'architecture'
project_name: 'Penya_Barca_Nantes'
user_name: 'Mrbit'
date: '2026-04-10'
---

# Architecture Decision Document

_This document builds collaboratively through step-by-step discovery. Sections are appended as we work through each architectural decision together._

## Project Context Analysis

### Requirements Overview

**Functional Requirements:**
36 exigences fonctionnelles couvrant 6 domaines :
- **Gestion des Membres (FR1-FR8)** — Inscription, authentification, profils, historique, administration des comptes. Point d'entrée de toute l'expérience.
- **Fil Communautaire (FR9-FR15)** — Posts, réactions, commentaires, temps réel, modération, annonces officielles. Cœur social de l'app.
- **Système de Pronostics (FR16-FR23)** — Soumission/modification avant deadline, calcul automatique des points, classements. Moteur d'engagement principal.
- **Calendrier des Matchs (FR24-FR27)** — Consultation, détails, lien direct vers les pronos, CRUD admin.
- **Administration (FR28-FR31)** — Tableau de bord, événements, rôles, paramètres. Back-office complet.
- **Accès Partenaire + Pages Publiques (FR32-FR36)** — Stats d'engagement pour le bar, pages d'accueil/inscription/calendrier publiques.

**Non-Functional Requirements:**
- **Performance :** < 3s chargement mobile 4G, < 1s mises à jour temps réel, < 2s confirmation pronos
- **Sécurité :** HTTPS/TLS, hash+salt mots de passe, sessions expirantes, séparation stricte des rôles, conformité RGPD
- **Scalabilité :** 500 utilisateurs simultanés, 500 connexions WebSocket/SSE, gestion des pics (deadlines pronos, buts)
- **Accessibilité :** WCAG 2.1 AA, contrastes 4.5:1, navigation clavier, ARIA
- **Disponibilité :** 99% mensuel, soirs de match critiques, dégradation gracieuse

**Scale & Complexity:**

- Primary domain: Full-stack web (MPA responsive + API REST + temps réel)
- Complexity level: Low-Medium
- Estimated architectural components: ~8-10 (auth, feed, pronostics, calendrier, profils, admin, partenaire, temps réel, pages publiques)

### Technical Constraints & Dependencies

- **MPA responsive mobile-first** — Rendu serveur pour les pages publiques (SEO), interactivité côté client pour le temps réel
- **API REST** — Backend découplé, préparé pour une future PWA
- **Authentification email/mot de passe** — OAuth prévu ultérieurement
- **Pas de paiement intégré** — Adhésion 20€/an gérée via Revolut externe
- **Développeur solo** — Architecture modulaire mais réaliste pour un seul développeur
- **Greenfield** — Aucune contrainte de legacy, liberté totale de choix technologiques

### Cross-Cutting Concerns Identified

- **Temps réel** — Touche 4 domaines (fil, pronos, classements, écran bar). Choix WebSocket vs SSE structurant.
- **Authentification & Autorisation** — 3 rôles (membre, admin, partenaire) avec séparation stricte, traversant toutes les fonctionnalités.
- **RGPD** — Impact sur le stockage, les profils, la suppression de compte, le consentement.
- **Responsive design** — Mobile-first avec breakpoints desktop, même base de code.
- **Accessibilité WCAG 2.1 AA** — Impact sur tous les composants UI.

## Starter Template Evaluation

### Primary Technology Domain

Full-stack web (MPA responsive + API + temps réel) basé sur React + TypeScript

### Starter Options Considered

| Option | Stack | Forces | Faiblesses |
|--------|-------|--------|------------|
| **React Router v7 Framework Mode** | RR7 + React 19 + Drizzle + PostgreSQL + Better Auth + Tailwind/shadcn | MPA natif, SSR, Docker-friendly, platform-agnostic, léger | Écosystème plus jeune que Next.js |
| **T3 Stack (Next.js)** | Next.js + tRPC + Drizzle + Tailwind | Écosystème mature, communauté large | Vercel-centric, self-hosting Docker limité, SPA/SSR hybride |
| **Vite + React + Hono** | SPA React + API Hono séparée | Séparation claire, Hono ultrarapide | Pas de SSR, 2 services Docker, plus de plomberie |

### Selected Starter: React Router v7 Framework Mode

**Rationale for Selection:**
- Architecture MPA native alignée avec le PRD
- SSR intégré pour les pages publiques (SEO)
- Platform-agnostic — déploiement Docker sans vendor lock-in
- Progressive enhancement — fiabilité maximale
- Vite comme bundler — développement rapide avec HMR

**Initialization Command:**

```bash
npx create-react-router@latest penya-barca-nantes --template remix-run/react-router/templates/default
```

**Architectural Decisions Provided by Starter:**

**Language & Runtime:**
- TypeScript 5.x strict mode
- React 19 avec Server Components support
- Node.js runtime (compatible Docker)

**Styling Solution:**
- Tailwind CSS v4 (utility-first, mobile-first natif)
- shadcn/ui (composants accessibles, personnalisables, design blaugrana)

**Database & ORM:**
- PostgreSQL (dockerisé, robuste, adapté au volume du projet)
- Drizzle ORM v0.45+ (type-safe, migrations, schéma déclaratif, ~7.4kb)

**Authentication:**
- Better Auth v1.6 (email/mot de passe, gestion des rôles membre/admin/partenaire, sessions, RGPD)

**Real-Time:**
- SSE (Server-Sent Events) via resource routes React Router pour les flux unidirectionnels (fil, classements)
- WebSocket via @hono/node-ws pour le bidirectionnel si nécessaire (écran bar)

**Validation:**
- Zod pour la validation de schémas partagée front/back

**Build Tooling:**
- Vite (build rapide, HMR, tree-shaking, optimisation)

**Testing Framework:**
- Vitest (compatible Vite, rapide, API Jest-compatible)

**Code Organization:**
- Structure par routes (app/routes/) avec loaders/actions colocalisés
- Modèles de données dans app/db/
- Composants UI réutilisables dans app/components/

**Development Experience:**
- Hot Module Replacement (HMR) via Vite
- Type-safety de bout en bout (DB → API → UI)
- DevTools React intégrés

**Deployment:**
- Docker Compose (app Node.js + PostgreSQL)
- VPS chez hébergeur français (Infomaniak, Hostinger, O2Switch)
- HTTPS via Let's Encrypt / reverse proxy Nginx

**Note:** L'initialisation du projet avec cette commande et la configuration de l'environnement Docker constitueront la première story d'implémentation.

## Core Architectural Decisions

### Decision Priority Analysis

**Critical Decisions (Block Implementation):**
- Data architecture : PostgreSQL + Drizzle ORM + Redis
- Authentication : Better Auth avec sessions Redis
- Temps réel : SSE + Redis Pub/Sub
- Déploiement : Docker Compose sur VPS

**Important Decisions (Shape Architecture):**
- Frontend : loaders RR7 + state local React, pas de store global
- Composants : shadcn/ui personnalisé blaugrana
- API : loaders/actions RR7 + resource routes pour écran bar
- CI/CD : GitHub Actions + déploiement SSH

**Deferred Decisions (Post-MVP):**
- WebSocket (si micro-pronos live Phase 2)
- Staging environment (Phase 2)
- Stack monitoring avancée Grafana/Prometheus (Phase 2+)
- OAuth (prévu ultérieurement)
- PWA / notifications push (Phase 3)

### Data Architecture

- **Base de données :** PostgreSQL (dockerisé, volume persistant)
- **ORM :** Drizzle ORM v0.45+ — modélisation relationnelle classique (tables, relations, foreign keys)
- **Cache & Pub/Sub :** Redis — sessions, cache applicatif, backbone temps réel via Pub/Sub
- **Migrations :** Drizzle Kit (`generate` + `migrate`), versionnées dans le repo
- **Validation :** Zod — schémas partagés front/back, validation aux frontières du système

### Authentication & Security

- **Auth provider :** Better Auth v1.6 — email/mot de passe, gestion des rôles
- **Sessions :** Stockées dans Redis — invalidation instantanée, visibilité admin sur les sessions actives
- **Autorisation :** Middleware par route avec vérification du rôle (public, membre, admin, partenaire)
- **Rate limiting :** Redis-based — protection brute force login, spam pronos
- **CSRF :** Protection intégrée React Router v7
- **Sanitization :** Validation Zod sur tous les inputs
- **Headers sécurité :** Helmet ou équivalent (X-Frame-Options, CSP, HSTS)
- **RGPD :** Consentement explicite, droit de suppression via Better Auth, données minimales (email, pseudo, avatar, historique pronos)

### API & Communication Patterns

- **Pattern principal :** Loaders (GET) et Actions (POST/mutations) React Router v7 — pas d'API REST séparée pour le frontend
- **Resource routes :** Endpoints sans UI pour SSE temps réel et API lecture seule écran bar
- **Temps réel :** SSE (Server-Sent Events) via resource routes + Redis Pub/Sub comme backbone. Couvre fil communautaire, classements, pronos, écran bar
- **WebSocket :** Différé — SSE suffit pour le MVP. Réévalué en Phase 2 pour les micro-pronos live
- **Erreurs métier :** Typées (PronoDeadlinePassed, UnauthorizedRole, etc.)
- **Error boundaries :** React Router error boundaries pour le rendu d'erreurs côté client
- **Logging :** Pino — logs structurés JSON côté serveur

### Frontend Architecture

- **State management :** Aucun store global — loaders RR7 pour les données serveur, React state local pour l'UI
- **Temps réel côté client :** SSE events via useEffect, patch des données du loader
- **Composants :** shadcn/ui (copiés dans le projet, personnalisables), organisés en ui/ (primitives) et composants métier (PronoCard, MatchCard, FeedPost)
- **Design tokens :** Tailwind CSS avec palette blaugrana (primary, secondary, accent)
- **Performance mobile :**
  - Lazy loading / pagination infinie pour le fil communautaire
  - Optimistic UI sur pronos et réactions
  - Prefetch des routes via React Router
  - Images optimisées (compression upload, WebP/AVIF)

### Infrastructure & Deployment

- **Docker Compose — 4 services :**
  - app (Node.js / React Router v7, port 3000)
  - postgres (PostgreSQL, volume persistant)
  - redis (sessions, cache, pub/sub)
  - nginx (reverse proxy, HTTPS Let's Encrypt, gzip)
- **CI/CD :** GitHub Actions (build, lint, tests) → déploiement SSH `docker compose up` sur merge main
- **Environnements :** Dev local (Docker + hot reload) + Production (Docker build optimisé sur VPS)
- **Monitoring :** Pino logs JSON + Docker logs natifs + endpoint /health (app + DB + Redis)
- **Backup :** pg_dump quotidien automatisé (cron), rotation des backups

### Decision Impact Analysis

**Implementation Sequence:**
1. Initialisation projet React Router v7 + Docker Compose (app + postgres + redis)
2. Configuration Drizzle ORM + schéma DB initial
3. Intégration Better Auth (inscription, login, rôles)
4. Infrastructure SSE + Redis Pub/Sub
5. Fonctionnalités métier (fil, pronos, calendrier, admin)
6. Nginx reverse proxy + HTTPS
7. CI/CD GitHub Actions

**Cross-Component Dependencies:**
- Redis est central : sessions (auth) + cache + pub/sub (temps réel). Sa disponibilité impacte toute l'app.
- Better Auth dépend de PostgreSQL (stockage users) et Redis (sessions)
- SSE dépend de Redis Pub/Sub pour la distribution des événements
- L'écran bar consomme les mêmes resource routes SSE que le frontend

## Implementation Patterns & Consistency Rules

### Pattern Categories Defined

**Critical Conflict Points Identified:** 5 catégories où les agents IA pourraient faire des choix divergents — naming, structure, format, communication, process.

### Naming Patterns

**Database Naming Conventions (PostgreSQL + Drizzle):**
- Tables : snake_case pluriel → `users`, `match_predictions`, `feed_posts`
- Colonnes : snake_case → `user_id`, `created_at`, `match_date`
- Foreign keys : {table_singulier}_id → `user_id`, `match_id`
- Index : idx_{table}_{colonnes} → `idx_users_email`

**API / Route Naming Conventions:**
- Routes : kebab-case pluriel → `/matches`, `/feed-posts`, `/match-predictions`
- Paramètres : :camelCase → `/matches/:matchId`
- Query params : camelCase → `?sortBy=date&pageSize=20`

**Code Naming Conventions (TypeScript):**
- Fichiers composants : kebab-case → `match-card.tsx`, `prono-form.tsx`
- Fichiers routes RR7 : kebab-case avec segments → `matches.$matchId.tsx`
- Fonctions/variables : camelCase → `getUserById`, `matchDate`
- Types/interfaces : PascalCase → `User`, `MatchPrediction`, `FeedPost`
- Constantes : UPPER_SNAKE_CASE → `MAX_PREDICTIONS_PER_MATCH`
- Schémas Zod : camelCase + Schema → `createPredictionSchema`
- Schémas Drizzle : camelCase pluriel → `users`, `matchPredictions`

### Structure Patterns

**Project Organization:**
- Tests co-localisés avec les fichiers testés → `match-card.test.tsx` à côté de `match-card.tsx`
- Tests d'intégration dans `tests/integration/`
- Organisation par feature (domaine métier), pas par type technique
- Utilitaires partagés dans `app/lib/`
- Utilitaires serveur-only dans `app/lib/server/`
- Configuration app dans `app/config/`
- Assets statiques dans `public/`
- Variables d'environnement : `.env` / `.env.example` à la racine

### Format Patterns

**API Response Formats (resource routes):**

```typescript
// Succès
{ data: T, meta?: { total: number, page: number, pageSize: number } }

// Erreur
{ error: { code: string, message: string } }
```

**Data Exchange Formats:**
- JSON fields : camelCase → `{ userId, matchDate, createdAt }`
- Dates : ISO 8601 strings en JSON → `"2026-04-10T21:00:00Z"`, affichage localisé fr-FR côté client
- Nulls : `null` explicite (pas `undefined` dans les réponses API), champs optionnels omis

### Communication Patterns

**Event System Patterns (SSE + Redis Pub/Sub):**
- Nommage événements : domaine:action → `feed:new-post`, `prediction:submitted`, `ranking:updated`, `match:score-updated`
- Payload SSE : `{ event: string, data: T, timestamp: string }`

**Logging Patterns (Pino):**
- Niveaux : `error` (bugs, crashes), `warn` (comportement inattendu), `info` (actions métier), `debug` (dev only)
- Format : `{ level, msg, timestamp, context: { userId?, matchId?, action } }`

### Process Patterns

**Error Handling Patterns:**

```typescript
class AppError extends Error {
  constructor(public code: string, message: string, public status: number) {}
}
// Exemples :
// new AppError("PRONO_DEADLINE_PASSED", "La deadline est dépassée", 400)
// new AppError("UNAUTHORIZED_ROLE", "Accès non autorisé", 403)
```

- Error boundary par route RR7 — message convivial blaugrana, log serveur
- Distinction claire : erreurs métier (AppError) vs erreurs système (500)

**Loading State Patterns:**
- `useNavigation()` de React Router pour les transitions de page
- `useActionData()` + état local pour les soumissions de formulaires
- Skeleton loaders pour le fil communautaire

**Optimistic UI Patterns:**
- `useFetcher()` de React Router pour les actions sans navigation (réactions, pronos)
- Rollback automatique si l'action échoue

### Enforcement Guidelines

**All AI Agents MUST:**
- Suivre les conventions de nommage définies ci-dessus sans exception
- Co-localiser les tests avec les fichiers testés
- Utiliser le format de réponse API standardisé pour toutes les resource routes
- Typer les erreurs métier via AppError avec code, message et status
- Nommer les événements SSE au format domaine:action
- Logger via Pino avec le format structuré défini

**Anti-Patterns à éviter:**
- ❌ Créer des dossiers `controllers/`, `services/`, `repositories/` génériques
- ❌ Utiliser undefined dans les réponses API (utiliser null ou omettre le champ)
- ❌ Nommer les tables en PascalCase ou camelCase
- ❌ Créer un store global (Redux, Zustand) — les loaders RR7 suffisent
- ❌ Mélanger snake_case et camelCase dans le même contexte

## Project Structure & Boundaries

### Complete Project Directory Structure

```
penya-barca-nantes/
├── .github/
│   └── workflows/
│       └── ci.yml                        # GitHub Actions (build, lint, tests)
├── docker/
│   ├── nginx/
│   │   └── nginx.conf                    # Config reverse proxy + HTTPS
│   └── postgres/
│       └── init.sql                      # Script init DB (si nécessaire)
├── public/
│   ├── favicon.ico
│   ├── logo-blaugrana.svg
│   └── images/                           # Assets statiques branding
├── app/
│   ├── config/
│   │   ├── env.server.ts                 # Variables d'environnement typées
│   │   └── constants.ts                  # Constantes app (barème pronos, etc.)
│   │
│   ├── db/
│   │   ├── schema/
│   │   │   ├── users.ts                  # Table users + roles
│   │   │   ├── matches.ts                # Table matches
│   │   │   ├── predictions.ts            # Table match_predictions
│   │   │   ├── feed-posts.ts             # Table feed_posts
│   │   │   ├── comments.ts               # Table comments
│   │   │   ├── reactions.ts              # Table reactions
│   │   │   ├── events.ts                 # Table events
│   │   │   └── index.ts                  # Export centralisé des schémas
│   │   ├── migrations/                   # Migrations Drizzle Kit
│   │   ├── seed.ts                       # Données de seed (dev)
│   │   └── client.ts                     # Connexion PostgreSQL + Drizzle instance
│   │
│   ├── lib/
│   │   ├── utils.ts                      # Helpers génériques (formatage, etc.)
│   │   ├── date.ts                       # Formatage dates fr-FR
│   │   ├── points.ts                     # Calcul des points pronos
│   │   ├── validation/
│   │   │   ├── prediction.ts             # createPredictionSchema, etc.
│   │   │   ├── feed-post.ts              # createPostSchema, etc.
│   │   │   ├── match.ts                  # createMatchSchema, etc.
│   │   │   └── user.ts                   # registerSchema, loginSchema, etc.
│   │   └── server/
│   │       ├── auth.server.ts            # Config Better Auth
│   │       ├── redis.server.ts           # Client Redis + helpers
│   │       ├── sse.server.ts             # Helper SSE (création streams)
│   │       ├── middleware.server.ts       # Auth middleware, role check
│   │       └── errors.server.ts          # AppError class + error handler
│   │
│   ├── components/
│   │   ├── ui/                           # Composants shadcn/ui (button, card, input, etc.)
│   │   ├── layout/
│   │   │   ├── header.tsx
│   │   │   ├── footer.tsx
│   │   │   ├── nav-mobile.tsx
│   │   │   └── sidebar-admin.tsx
│   │   ├── feed/
│   │   │   ├── feed-post.tsx
│   │   │   ├── feed-post.test.tsx
│   │   │   ├── comment-list.tsx
│   │   │   └── reaction-bar.tsx
│   │   ├── predictions/
│   │   │   ├── prono-form.tsx
│   │   │   ├── prono-form.test.tsx
│   │   │   ├── prono-card.tsx
│   │   │   └── ranking-table.tsx
│   │   ├── matches/
│   │   │   ├── match-card.tsx
│   │   │   ├── match-card.test.tsx
│   │   │   └── match-calendar.tsx
│   │   ├── members/
│   │   │   ├── member-card.tsx
│   │   │   └── profile-form.tsx
│   │   └── shared/
│   │       ├── error-fallback.tsx         # Error boundary UI
│   │       ├── skeleton-loader.tsx
│   │       └── empty-state.tsx
│   │
│   ├── routes/
│   │   ├── _index.tsx                    # Page d'accueil publique
│   │   ├── _auth.tsx                     # Layout auth (login/register)
│   │   ├── _auth.login.tsx
│   │   ├── _auth.register.tsx
│   │   ├── _app.tsx                      # Layout app authentifié (header, nav)
│   │   ├── _app.feed.tsx                 # Fil communautaire
│   │   ├── _app.matches.tsx              # Calendrier des matchs
│   │   ├── _app.matches.$matchId.tsx     # Détail match + prono
│   │   ├── _app.predictions.tsx          # Mes pronos + classement
│   │   ├── _app.profile.tsx              # Mon profil
│   │   ├── _app.members.$memberId.tsx    # Profil d'un membre
│   │   ├── _admin.tsx                    # Layout admin (sidebar)
│   │   ├── _admin.dashboard.tsx          # Tableau de bord admin
│   │   ├── _admin.matches.tsx            # CRUD matchs
│   │   ├── _admin.members.tsx            # Gestion membres
│   │   ├── _admin.events.tsx             # Gestion événements
│   │   ├── _admin.moderation.tsx         # Modération fil
│   │   ├── _admin.settings.tsx           # Paramètres app
│   │   ├── api/
│   │   │   ├── sse.feed.ts               # Stream SSE fil communautaire
│   │   │   ├── sse.predictions.ts        # Stream SSE pronos + classement
│   │   │   ├── sse.bar-screen.ts         # Stream SSE écran bar
│   │   │   └── health.ts                 # Endpoint /health
│   │   ├── bar-screen.tsx                # Écran d'affichage bar (lecture seule)
│   │   └── calendar.tsx                  # Calendrier public (sans auth)
│   │
│   ├── styles/
│   │   └── globals.css                   # Tailwind directives + tokens blaugrana
│   │
│   ├── entry.client.tsx                  # Point d'entrée client RR7
│   ├── entry.server.tsx                  # Point d'entrée serveur RR7
│   └── root.tsx                          # Root layout (html, head, body)
│
├── tests/
│   └── integration/
│       ├── auth.test.ts                  # Tests intégration auth
│       ├── predictions.test.ts           # Tests intégration pronos
│       └── feed.test.ts                  # Tests intégration fil
│
├── drizzle.config.ts                     # Config Drizzle Kit
├── docker-compose.yml                    # 4 services : app, postgres, redis, nginx
├── docker-compose.dev.yml                # Override dev (hot reload, volumes)
├── Dockerfile                            # Build production Node.js
├── .env.example                          # Template variables d'environnement
├── .gitignore
├── package.json
├── tsconfig.json
├── tailwind.config.ts
├── vite.config.ts
└── vitest.config.ts
```

### Architectural Boundaries

**API Boundaries:**
- Routes `_app.*` → requièrent auth membre
- Routes `_admin.*` → requièrent auth admin
- Routes `api/sse.*` → requièrent auth (sauf `sse.bar-screen`)
- Routes `_index`, `calendar`, `_auth.*` → publiques

**Component Boundaries:**
- `app/components/ui/` → primitives shadcn/ui, aucune logique métier
- `app/components/{feature}/` → composants métier, peuvent importer ui/ et shared/
- `app/components/layout/` → structure de page, importe ui/ uniquement

**Data Boundaries:**
- `app/db/` → seul point d'accès à PostgreSQL (via Drizzle)
- `app/lib/server/redis.server.ts` → seul point d'accès Redis
- Les loaders/actions des routes appellent directement les queries Drizzle — pas de couche service intermédiaire pour le MVP

### Requirements to Structure Mapping

| Domaine PRD | Routes | Composants | DB Schema | Validation |
|-------------|--------|------------|-----------|------------|
| **Membres (FR1-FR8)** | `_auth.*`, `_app.profile`, `_app.members.$memberId` | `members/`, `layout/` | `users.ts` | `user.ts` |
| **Fil communautaire (FR9-FR15)** | `_app.feed` | `feed/` | `feed-posts.ts`, `comments.ts`, `reactions.ts` | `feed-post.ts` |
| **Pronostics (FR16-FR23)** | `_app.predictions`, `_app.matches.$matchId` | `predictions/` | `predictions.ts` | `prediction.ts` |
| **Calendrier (FR24-FR27)** | `_app.matches`, `calendar` | `matches/` | `matches.ts` | `match.ts` |
| **Admin (FR28-FR31)** | `_admin.*` | `layout/sidebar-admin` | Toutes tables | Tous schémas |
| **Partenaire (FR32-FR33)** | Future route `_partner.*` | — | — | — |
| **Pages publiques (FR34-FR36)** | `_index`, `calendar`, `_auth.register` | `layout/` | — | `user.ts` |

### Data Flow

1. **Requête utilisateur** → Route RR7 → Loader/Action → Drizzle query → PostgreSQL
2. **Mutation** → Action RR7 → Drizzle insert/update → Redis publish → SSE broadcast
3. **Temps réel** → Client SSE connect → `api/sse.*` → Redis subscribe → Stream events

### Development Workflow

**Dev local :** `docker compose -f docker-compose.yml -f docker-compose.dev.yml up` → hot reload via volume monté + Vite HMR
**Production :** `docker compose up -d` → build optimisé Dockerfile multi-stage, Nginx reverse proxy
**CI/CD :** Push → GitHub Actions (lint + type-check + tests) → Merge main → SSH deploy

## Architecture Validation Results

### Coherence Validation ✅

**Decision Compatibility:**
Toutes les technologies fonctionnent ensemble sans conflit. React Router v7 + React 19 + TypeScript + Vite forment la stack officielle. Drizzle + PostgreSQL, Better Auth, Redis (sessions + Pub/Sub), Tailwind v4 + shadcn/ui, Pino, Vitest — chaque choix s'intègre nativement avec les autres.

**Pattern Consistency:**
Les conventions de nommage sont cohérentes par couche : snake_case en DB, camelCase en TypeScript, kebab-case pour les fichiers. Les loaders/actions RR7 éliminent le besoin d'API REST séparée. Les patterns SSE + Redis Pub/Sub couvrent tous les besoins temps réel du MVP.

**Structure Alignment:**
Le tree projet est aligné avec le pattern par feature. Les fichiers `.server.ts` garantissent la séparation client/serveur. Les resource routes SSE, les boundaries par rôle et le mapping FR → fichiers sont complets.

### Requirements Coverage Validation ✅

**Functional Requirements Coverage:**

| Domaine | FRs | Statut | Support architectural |
|---------|-----|--------|----------------------|
| Membres | FR1-FR8 | ✅ | Better Auth + routes auth/profils |
| Fil communautaire | FR9-FR15 | ✅ | Routes feed + SSE + modération admin |
| Pronostics | FR16-FR23 | ✅ | Routes predictions + calcul points + classements SSE |
| Calendrier | FR24-FR27 | ✅ | Routes matches + page publique |
| Admin | FR28-FR31 | ✅ | Routes admin complètes + dashboard |
| Partenaire | FR32-FR33 | ⏳ | Différé Phase 2 (conforme PRD) |
| Pages publiques | FR34-FR36 | ✅ | Routes publiques + SSR SEO |

**Non-Functional Requirements Coverage:**

| NFR | Statut | Support |
|-----|--------|---------|
| Performance < 3s mobile 4G | ✅ | SSR + Vite + lazy loading + optimistic UI + prefetch |
| Temps réel < 1s | ✅ | SSE + Redis Pub/Sub |
| Sécurité | ✅ | Better Auth + Redis sessions + Zod + Helmet + CSRF RR7 |
| RGPD | ✅ | Better Auth (suppression compte) + données minimales |
| Scalabilité 500 users | ✅ | SSE + Redis Pub/Sub dimensionné |
| WCAG 2.1 AA | ✅ | shadcn/ui accessible + Tailwind tokens contrastes |
| Disponibilité 99% | ✅ | Docker + healthcheck + backup pg_dump |

### Implementation Readiness Validation ✅

**Decision Completeness:** Toutes les décisions critiques sont documentées avec versions. Stack complète, patterns définis, exemples fournis.

**Structure Completeness:** Tree projet complet avec tous les fichiers, dossiers, et commentaires explicatifs. Mapping FR → structure exhaustif.

**Pattern Completeness:** Conventions de nommage, formats API, événements SSE, gestion d'erreurs, loading states, optimistic UI — tous documentés avec exemples et anti-patterns.

### Gap Analysis Results

**Aucun gap critique.**

**Gaps importants (résolus) :**
- **Upload d'images :** Stockage local volume Docker `/uploads` pour le MVP. Migration S3-compatible en Phase 2 si nécessaire.
- **Envoi d'emails :** Notification de bienvenue en message in-app au MVP. Service email (Resend, Mailgun) ajouté ultérieurement.

**Gaps nice-to-have (différés) :**
- Seuils de rate limiting détaillés par endpoint
- Politique de rétention des logs
- Monitoring des performances (APM)

### Architecture Completeness Checklist

**✅ Requirements Analysis**
- [x] Project context thoroughly analyzed
- [x] Scale and complexity assessed
- [x] Technical constraints identified
- [x] Cross-cutting concerns mapped

**✅ Architectural Decisions**
- [x] Critical decisions documented with versions
- [x] Technology stack fully specified
- [x] Integration patterns defined
- [x] Performance considerations addressed

**✅ Implementation Patterns**
- [x] Naming conventions established
- [x] Structure patterns defined
- [x] Communication patterns specified
- [x] Process patterns documented

**✅ Project Structure**
- [x] Complete directory structure defined
- [x] Component boundaries established
- [x] Integration points mapped
- [x] Requirements to structure mapping complete

### Architecture Readiness Assessment

**Overall Status:** READY FOR IMPLEMENTATION

**Confidence Level:** HIGH

**Key Strengths:**
- Stack moderne, cohérente et légère — adaptée à un dev solo
- Architecture MPA native alignée avec le PRD
- Temps réel SSE + Redis Pub/Sub — simple, fiable, scalable
- Type-safety de bout en bout (DB → API → UI)
- Docker-first — déploiement reproductible sur n'importe quel VPS
- Patterns clairs pour la cohérence inter-agents

**Areas for Future Enhancement:**
- WebSocket pour micro-pronos live (Phase 2)
- Accès partenaire bar (Phase 2)
- PWA + notifications push (Phase 3)
- Monitoring avancé (Grafana/Prometheus)
- Service email transactionnel
- Stockage images S3-compatible

### Implementation Handoff

**AI Agent Guidelines:**
- Suivre toutes les décisions architecturales exactement comme documentées
- Utiliser les patterns d'implémentation de manière cohérente dans tous les composants
- Respecter la structure projet et les frontières définies
- Se référer à ce document pour toute question architecturale

**First Implementation Priority:**

```bash
npx create-react-router@latest penya-barca-nantes --template remix-run/react-router/templates/default
```

Suivi de la configuration Docker Compose (app + PostgreSQL + Redis), Drizzle ORM, et Better Auth.
