# Story 1.1 : Initialisation du Projet et Infrastructure Docker

Status: review

## Story

As a developpeur,
I want initialiser le projet React Router v7 avec l'environnement Docker Compose complet,
so that j'ai une base de developpement fonctionnelle pour construire toutes les fonctionnalites.

## Acceptance Criteria

1. Le projet demarre via `npx create-react-router@latest` avec le template par defaut
2. Docker Compose orchestre 4 services : app, postgres, redis, nginx
3. Le hot reload fonctionne via Vite HMR en dev
4. La structure de dossiers suit l'architecture definie (app/routes, app/db, app/lib, app/components)
5. Tailwind CSS v4 est configure avec les design tokens blaugrana (primary, secondary, accent)
6. shadcn/ui est installe et les composants de base sont disponibles
7. Drizzle ORM est connecte a PostgreSQL avec la commande de migration fonctionnelle
8. Redis est accessible depuis l'app
9. Pino logging est configure cote serveur
10. Le fichier `.env.example` est cree avec toutes les variables documentees
11. L'endpoint `/health` retourne le statut de l'app, DB et Redis

## Tasks / Subtasks

- [x] Task 1 : Scaffolding React Router v7 (AC: #1)
  - [x] 1.1 Executer `npx create-react-router@latest penya-barca-nantes`
  - [x] 1.2 Verifier que le projet demarre (`npm run dev`) et que la page par defaut s'affiche
  - [x] 1.3 Configurer TypeScript strict mode dans `tsconfig.json`

- [x] Task 2 : Structure de dossiers projet (AC: #4)
  - [x] 2.1 Creer la structure de dossiers complete :
    ```
    app/config/
    app/db/schema/
    app/db/migrations/
    app/lib/
    app/lib/validation/
    app/lib/server/
    app/components/ui/
    app/components/layout/
    app/components/feed/
    app/components/predictions/
    app/components/matches/
    app/components/members/
    app/components/shared/
    app/styles/
    docker/nginx/
    docker/postgres/
    tests/integration/
    public/images/
    ```
  - [x] 2.2 Creer les fichiers index de chaque dossier cle (app/db/schema/index.ts, etc.) avec des exports vides

- [x] Task 3 : Configuration Tailwind CSS v4 + Design Tokens Blaugrana (AC: #5)
  - [x] 3.1 Installer Tailwind CSS v4 : `npm i tailwindcss @tailwindcss/vite`
  - [x] 3.2 Configurer le plugin Vite dans `vite.config.ts` — `tailwindcss()` AVANT `reactRouter()`
  - [x] 3.3 Creer `app/styles/globals.css` avec les design tokens blaugrana :
    ```css
    @import "tailwindcss";

    @theme {
      --color-primary: #A50044;      /* Blaugrana rouge */
      --color-secondary: #004D98;    /* Blaugrana bleu */
      --color-accent: #EDBB00;       /* Or Barca */
      --color-background: #FAFAFA;
      --color-foreground: #1A1A1A;
      --color-muted: #6B7280;
      --color-destructive: #DC2626;
      --color-success: #16A34A;
    }
    ```
  - [x] 3.4 Importer `globals.css` dans `app/root.tsx`
  - [x] 3.5 Verifier que les couleurs blaugrana sont accessibles via les classes Tailwind (`bg-primary`, etc.)

- [x] Task 4 : Installation shadcn/ui (AC: #6)
  - [x] 4.1 Executer `npx shadcn@latest init` — selectionner framework "React Router"
  - [x] 4.2 Ajouter les composants de base : `npx shadcn@latest add button card input label`
  - [x] 4.3 Verifier que les composants sont copies dans `app/components/ui/`
  - [x] 4.4 Verifier qu'un composant shadcn se rend correctement dans une page test

- [x] Task 5 : Configuration Docker Compose (AC: #2, #3)
  - [x] 5.1 Creer `Dockerfile` multi-stage (dev + production) :
    - Stage dev : Node.js, volume monte, `npm run dev`
    - Stage prod : build optimise, `npm start`
  - [x] 5.2 Creer `docker-compose.yml` avec 4 services :
    ```yaml
    services:
      app:
        build: .
        ports: ["3000:3000"]
        depends_on: [postgres, redis]
        environment: [voir .env.example]
      postgres:
        image: postgres:16-alpine
        volumes: [pgdata:/var/lib/postgresql/data]
        environment: [POSTGRES_DB, POSTGRES_USER, POSTGRES_PASSWORD]
      redis:
        image: redis:7-alpine
        ports: ["6379:6379"]
      nginx:
        image: nginx:alpine
        ports: ["80:80"]
        volumes: [./docker/nginx/nginx.conf:/etc/nginx/nginx.conf]
        depends_on: [app]
    ```
  - [x] 5.3 Creer `docker-compose.dev.yml` (override dev) :
    - Volume monte pour hot reload : `./:/app`
    - Command : `npm run dev`
    - Ports exposes pour debug
  - [x] 5.4 Creer `docker/nginx/nginx.conf` (reverse proxy vers app:3000)
  - [x] 5.5 Creer `docker/postgres/init.sql` (creation DB si necessaire)
  - [x] 5.6 Verifier que `docker compose -f docker-compose.yml -f docker-compose.dev.yml up` demarre les 4 services
  - [x] 5.7 Verifier que le hot reload fonctionne (modifier un composant → changement visible sans redemarrage)

- [x] Task 6 : Configuration Drizzle ORM + PostgreSQL (AC: #7)
  - [x] 6.1 Installer : `npm i drizzle-orm pg` et `npm i -D drizzle-kit @types/pg`
  - [x] 6.2 Creer `drizzle.config.ts` a la racine :
    ```typescript
    import { defineConfig } from "drizzle-kit";
    export default defineConfig({
      schema: "./app/db/schema/index.ts",
      out: "./app/db/migrations",
      dialect: "postgresql",
      dbCredentials: { url: process.env.DATABASE_URL! },
    });
    ```
  - [x] 6.3 Creer `app/db/client.ts` — connexion PostgreSQL + instance Drizzle
  - [x] 6.4 Creer un schema minimal de test dans `app/db/schema/users.ts` (table `users` avec id, email, created_at) pour valider la connexion
  - [x] 6.5 Exporter le schema depuis `app/db/schema/index.ts`
  - [x] 6.6 Executer `npx drizzle-kit generate` — verifier que la migration est generee
  - [x] 6.7 Executer `npx drizzle-kit migrate` — verifier que la table est creee dans PostgreSQL
  - [x] 6.8 Ajouter scripts npm : `"db:generate": "drizzle-kit generate"`, `"db:migrate": "drizzle-kit migrate"`

- [x] Task 7 : Configuration Redis (AC: #8)
  - [x] 7.1 Installer : `npm i ioredis`
  - [x] 7.2 Creer `app/lib/server/redis.server.ts` :
    ```typescript
    import Redis from "ioredis";
    export const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379");
    ```
  - [x] 7.3 Verifier la connexion Redis (set/get de test dans le health check)

- [x] Task 8 : Configuration Pino Logging (AC: #9)
  - [x] 8.1 Installer : `npm i pino` et `npm i -D pino-pretty`
  - [x] 8.2 Creer `app/lib/server/logger.server.ts` :
    ```typescript
    import pino from "pino";
    export const logger = pino({
      level: process.env.LOG_LEVEL || "info",
      transport: process.env.NODE_ENV === "development"
        ? { target: "pino-pretty" }
        : undefined,
    });
    ```
  - [x] 8.3 Format log : `{ level, msg, timestamp, context: { userId?, action } }`

- [x] Task 9 : Variables d'environnement (AC: #10)
  - [x] 9.1 Creer `.env.example` :
    ```env
    # App
    NODE_ENV=development
    PORT=3000
    LOG_LEVEL=info

    # Database
    DATABASE_URL=postgresql://penya:penya_secret@localhost:5432/penya_barca_nantes

    # Redis
    REDIS_URL=redis://localhost:6379

    # Auth (Better Auth - configure dans Story 1.2)
    AUTH_SECRET=change-me-in-production
    ```
  - [x] 9.2 Creer `app/config/env.server.ts` avec validation Zod des variables d'environnement :
    ```typescript
    import { z } from "zod";
    const envSchema = z.object({
      NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
      PORT: z.coerce.number().default(3000),
      DATABASE_URL: z.string().url(),
      REDIS_URL: z.string().default("redis://localhost:6379"),
      AUTH_SECRET: z.string().min(16),
      LOG_LEVEL: z.enum(["error", "warn", "info", "debug"]).default("info"),
    });
    export const env = envSchema.parse(process.env);
    ```
  - [x] 9.3 Installer Zod : `npm i zod`
  - [x] 9.4 Ajouter `.env` au `.gitignore`

- [x] Task 10 : Endpoint /health (AC: #11)
  - [x] 10.1 Creer `app/routes/api/health.ts` (resource route sans UI) :
    ```typescript
    // GET /api/health
    // Retourne { status: "ok", services: { app: "ok", db: "ok"|"error", redis: "ok"|"error" } }
    ```
  - [x] 10.2 Verifier la connexion DB (query simple `SELECT 1`)
  - [x] 10.3 Verifier la connexion Redis (`PING`)
  - [x] 10.4 Retourner status HTTP 200 si tout OK, 503 si un service est down
  - [x] 10.5 Logger le resultat du health check via Pino

- [x] Task 11 : Fichiers de configuration projet (AC: #1)
  - [x] 11.1 Configurer `vitest.config.ts` :
    ```typescript
    import { defineConfig } from "vitest/config";
    export default defineConfig({
      test: {
        globals: true,
        environment: "node",
        include: ["**/*.test.{ts,tsx}"],
      },
    });
    ```
  - [x] 11.2 Installer Vitest : `npm i -D vitest`
  - [x] 11.3 Creer `.gitignore` complet (node_modules, .env, dist, uploads, etc.)
  - [x] 11.4 Ajouter scripts npm : `"test": "vitest", "test:run": "vitest run"`

- [x] Task 12 : Utilitaires de base (AC: #4)
  - [x] 12.1 Creer `app/lib/server/errors.server.ts` :
    ```typescript
    export class AppError extends Error {
      constructor(public code: string, message: string, public status: number) {
        super(message);
        this.name = "AppError";
      }
    }
    ```
  - [x] 12.2 Creer `app/lib/utils.ts` avec helper `cn()` (classnames merger pour shadcn/ui)
  - [x] 12.3 Creer `app/components/shared/error-fallback.tsx` (error boundary UI de base)

- [x] Task 13 : Tests de validation (AC: #1-#11)
  - [x] 13.1 Test unitaire : `app/config/env.server.test.ts` — validation des variables d'environnement
  - [x] 13.2 Test unitaire : `app/lib/server/errors.server.test.ts` — AppError class
  - [x] 13.3 Test d'integration : `tests/integration/health.test.ts` — endpoint /health retourne 200 avec structure correcte
  - [x] 13.4 Test unitaire : `app/lib/utils.test.ts` — helper cn()
  - [x] 13.5 Executer `npm run test:run` — TOUS les tests passent a 100%

## Dev Notes

### Architecture Compliance

- **Stack exacte :** React Router v7 Framework Mode + React 19 + TypeScript 5.x strict + Vite
- **DB :** PostgreSQL 16 + Drizzle ORM 0.45+ — driver `pg`
- **Cache/Pub/Sub :** Redis 7 via `ioredis`
- **Auth :** Better Auth 1.6 — PAS installe dans cette story (Story 1.2), mais prevoir `AUTH_SECRET` dans `.env.example`
- **Styling :** Tailwind CSS v4 (pas de `tailwind.config.js` — config via `@theme` dans CSS) + shadcn/ui
- **Logging :** Pino 9.x avec `pino-pretty` en dev
- **Testing :** Vitest 3.x — tests co-localises avec les fichiers testes

### Naming Conventions (STRICTEMENT respecter)

| Contexte | Convention | Exemples |
|----------|-----------|----------|
| Tables DB | snake_case pluriel | `users`, `match_predictions`, `feed_posts` |
| Colonnes DB | snake_case | `user_id`, `created_at` |
| Routes API | kebab-case | `/api/health`, `/api/sse.feed` |
| Fichiers composants | kebab-case | `match-card.tsx`, `error-fallback.tsx` |
| Fichiers routes RR7 | segments avec `.` et `$` | `_app.matches.$matchId.tsx` |
| Fonctions/variables | camelCase | `getUserById`, `matchDate` |
| Types/interfaces | PascalCase | `User`, `MatchPrediction` |
| Constantes | UPPER_SNAKE_CASE | `MAX_PREDICTIONS_PER_MATCH` |
| Schemas Zod | camelCase + Schema | `createPredictionSchema` |
| Schemas Drizzle | camelCase pluriel | `users`, `matchPredictions` |

### Anti-Patterns a eviter

- **NE PAS** creer de dossiers `controllers/`, `services/`, `repositories/`
- **NE PAS** utiliser `undefined` dans les reponses API (utiliser `null`)
- **NE PAS** nommer les tables en PascalCase ou camelCase
- **NE PAS** creer de store global (Redux, Zustand)
- **NE PAS** creer de couche service intermediaire — les loaders/actions appellent Drizzle directement

### Tailwind CSS v4 — Specifites critiques

- **Pas de `tailwind.config.js`** — la config se fait dans le CSS via `@theme`
- **Plugin Vite :** `@tailwindcss/vite` — doit etre place AVANT `reactRouter()` dans `vite.config.ts`
- **Import :** `@import "tailwindcss"` dans `globals.css`

### Docker — Notes techniques

- **Dev :** `docker compose -f docker-compose.yml -f docker-compose.dev.yml up`
- **Prod :** `docker compose up -d` (Dockerfile multi-stage)
- **Volumes :** `pgdata` pour PostgreSQL persistant, volume monte `./:/app` en dev pour hot reload
- **Nginx :** reverse proxy simple vers `app:3000`, pas de HTTPS en dev (HTTPS = production uniquement)

### API Response Format (resource routes)

```typescript
// Succes
{ data: T, meta?: { total: number, page: number, pageSize: number } }
// Erreur
{ error: { code: string, message: string } }
```

### Project Structure Notes

- La structure creee dans cette story est le squelette complet — les dossiers vides seront remplis par les stories suivantes
- Les fichiers `.server.ts` garantissent la separation client/serveur (React Router v7 convention)
- `app/routes/api/` contient les resource routes (sans UI)

### References

- [Source: _bmad-output/planning-artifacts/architecture.md#Starter Template Evaluation]
- [Source: _bmad-output/planning-artifacts/architecture.md#Core Architectural Decisions]
- [Source: _bmad-output/planning-artifacts/architecture.md#Implementation Patterns & Consistency Rules]
- [Source: _bmad-output/planning-artifacts/architecture.md#Complete Project Directory Structure]
- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.1]
- [Source: _bmad-output/planning-artifacts/prd.md#Classification du Projet]

### Tech Versions Reference

| Library | Version | Install |
|---------|---------|---------|
| React Router | v7.x | `npx create-react-router@latest` |
| React | 19 | inclus avec RR7 |
| TypeScript | 5.x strict | inclus avec RR7 |
| Tailwind CSS | v4 | `npm i tailwindcss @tailwindcss/vite` |
| shadcn/ui | latest | `npx shadcn@latest init` |
| Drizzle ORM | 0.45+ | `npm i drizzle-orm pg` |
| Drizzle Kit | latest | `npm i -D drizzle-kit @types/pg` |
| Better Auth | 1.6+ | PAS dans cette story |
| Pino | 9.x | `npm i pino` |
| Vitest | 3.x | `npm i -D vitest` |
| ioredis | 5.x | `npm i ioredis` |
| Zod | latest | `npm i zod` |
| PostgreSQL | 16-alpine | image Docker |
| Redis | 7-alpine | image Docker |
| Nginx | alpine | image Docker |

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (1M context)

### Debug Log References

- RR7 v7.14 utilise `app/routes.ts` pour definir les routes (pas le filesystem automatiquement). Les resource routes doivent etre enregistrees dans `routes.ts` via `route()`.
- Le fichier health a ete renomme de `app/routes/api/health.ts` vers `app/routes/api.health.ts` (convention flat-file).

### Completion Notes List

- Projet scaffold via `npx create-react-router@latest` (RR7 v7.14.0, React 19, TypeScript 5.9 strict)
- Tailwind CSS v4.2.2 configure avec tokens blaugrana (primary #A50044, secondary #004D98, accent #EDBB00)
- shadcn/ui initialise avec composants button, card, input, label
- Docker Compose 4 services (app, postgres:16-alpine, redis:7-alpine, nginx:alpine) + override dev
- Drizzle ORM 0.45.2 connecte a PostgreSQL, schema users minimal, migration generee et appliquee
- Redis via ioredis 5.10.1, client configure dans redis.server.ts
- Pino 10.3.1 avec pino-pretty en dev
- Validation env via Zod 4.3.6 dans env.server.ts
- Endpoint /health (GET /api/health) verifie app + DB + Redis — teste OK (200, services: ok)
- Vitest 4.1.4 configure, 12 tests passent a 100%
- AppError class + ErrorFallback component + cn() utility
- Docker : PostgreSQL et Redis demarres et healthy, migration appliquee, table users creee

### Change Log

- 2026-04-11 : Implementation complete de la Story 1.1 — infrastructure projet initialisee
- 2026-04-11 : Fix route /api/health — passage a convention routes.ts explicite (RR7 v7.14)

### File List

- package.json (modifie — deps + scripts)
- tsconfig.json (existant — strict deja actif)
- vite.config.ts (existant — tailwindcss + reactRouter plugins)
- vitest.config.ts (cree)
- drizzle.config.ts (cree)
- react-router.config.ts (existant)
- docker-compose.yml (cree)
- docker-compose.dev.yml (cree)
- Dockerfile (existant — multi-stage)
- .env.example (cree)
- .gitignore (modifie)
- docker/nginx/nginx.conf (cree)
- docker/postgres/init.sql (cree)
- app/app.css (modifie — tokens blaugrana + shadcn/ui)
- app/routes.ts (modifie — ajout route api/health)
- app/config/env.server.ts (cree)
- app/config/env.server.test.ts (cree)
- app/db/client.ts (cree)
- app/db/schema/index.ts (cree)
- app/db/schema/users.ts (cree)
- app/db/migrations/0000_yielding_union_jack.sql (genere par drizzle-kit)
- app/lib/utils.ts (cree par shadcn — cn helper)
- app/lib/utils.test.ts (cree)
- app/lib/server/redis.server.ts (cree)
- app/lib/server/logger.server.ts (cree)
- app/lib/server/errors.server.ts (cree)
- app/lib/server/errors.server.test.ts (cree)
- app/components/ui/button.tsx (cree par shadcn)
- app/components/ui/card.tsx (cree par shadcn)
- app/components/ui/input.tsx (cree par shadcn)
- app/components/ui/label.tsx (cree par shadcn)
- app/components/shared/error-fallback.tsx (cree)
- app/routes/api.health.ts (cree)
