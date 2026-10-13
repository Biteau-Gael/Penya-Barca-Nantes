# Analyse de Sécurité — Penya Blaugrana Nantes

**Date :** 13 octobre 2026  
**Branche analysée :** `main` (commit `003faca`)  
**Statut :** Corrections appliquées sur `claude/sharp-fermi-6u7eos`

---

## Résumé des derniers commits

| Date | Auteur | Commit | Description |
|------|--------|--------|-------------|
| 2026-04-13 | Biteau Gaël | `003faca` | fix: évaluer les badges immédiatement après chaque action |
| 2026-04-13 | Biteau Gaël | `b1c88f6` | feat: Phase 2 — soirée match live, micro-pronos, badges, séries, saisons |
| 2026-04-12 | Claude | `d461ee5` | Merge branch deploy Synology NAS |
| 2026-04-12 | Claude | `554b873` | Add deployment guide for Synology NAS updates |
| 2026-04-13 | Biteau Gaël | `68e22d2` | feat: menu burger mobile pour la navigation |
| 2026-04-12 | Claude | `6aebaf7` | Fix Better Auth trusted origins for custom domain support |
| 2026-04-12 | Claude | `9823bc5` | Add migrate service to docker-compose.prod.yml |
| 2026-04-12 | Biteau Gaël | `aed5841` | security: supprimer credentials du repo et renforcer .gitignore |

**Phase 2** (commit `b1c88f6`) est le commit le plus significatif : il introduit la soirée match live, les micro-pronostics, les badges, les séries et les saisons — soit ~2 000 lignes de code ajoutées.

---

## Résultats de l'analyse de sécurité

### 🔴 CRITIQUE — Corrigé

#### 1. Path Traversal dans le serveur de fichiers uploadés
- **Fichier :** `app/routes/uploads-files.ts`, ligne 5
- **Problème :** `path.join(process.cwd(), "uploads", params["*"])` acceptait des séquences `../` dans l'URL. Une requête vers `/uploads/../../.env` donnait accès au fichier `.env` du projet (clés API, secrets, URL base de données).
- **Impact :** Lecture de n'importe quel fichier accessible par le processus serveur, sans authentification.
- **Correction appliquée :** Résolution du chemin final avec `path.resolve()` et vérification que le chemin commence par `UPLOAD_DIR` avant toute lecture.

---

### 🟠 HAUT — Corrigé

#### 2. `trustedOrigins` vide quand `APP_URL` n'est pas défini
- **Fichier :** `app/lib/server/auth.server.ts`, ligne 12
- **Problème :** Si `APP_URL` n'est pas configuré (variable optionnelle), Better Auth reçoit un tableau vide, ce qui peut permettre des requêtes cross-origin vers les endpoints d'authentification (CSRF).
- **Correction appliquée :** Ajout de `http://localhost:3000` comme origine de repli garantie.

#### 3. Endpoint `/api/health` expose l'état de l'infrastructure
- **Fichier :** `app/routes/api.health.ts`
- **Problème :** L'endpoint de healthcheck retournait l'état détaillé de PostgreSQL et Redis sans aucune authentification, permettant à un attaquant d'identifier les services en cours d'exécution.
- **Correction appliquée :** Suppression du détail des services de la réponse — seul le statut global (`ok` / `degraded`) est exposé.

#### 4. Client base de données bypasse la validation d'environnement
- **Fichier :** `app/db/client.ts`, ligne 6
- **Problème :** `process.env.DATABASE_URL` lu directement, bypas­sant la validation Zod de `env.server.ts`. Si `DATABASE_URL` est absent, le pool est créé avec `undefined` sans erreur au démarrage.
- **Correction appliquée :** Utilisation de `getEnv().DATABASE_URL` pour garantir l'échec immédiat au démarrage si la variable est absente.

---

### 🟡 MOYEN — Corrigé

#### 5. Contournement du rate limiting par usurpation d'IP
- **Fichier :** `app/routes/api.auth.$.ts`, lignes 6–11
- **Problème :** L'IP client est extraite de `X-Forwarded-For` sans vérification de la chaîne de proxy. Un attaquant peut envoyer un en-tête forgé pour contourner la limite de tentatives.
- **Statut :** Non corrigé dans ce patch (nécessite une configuration au niveau du reverse proxy Nginx/Traefik). **Action requise :** Configurer le reverse proxy pour écraser ces en-têtes, ou implémenter un rate limiting basé sur le compte en complément.

#### 6. Champ `type` des micro-pronostics non validé
- **Fichier :** `app/routes/api.micro-predictions.ts`, ligne 22
- **Problème :** La valeur `type` était stockée en base sans validation contre une liste d'enum autorisée.
- **Correction appliquée :** Validation contre `["qcm", "open"]` avec repli sur `"qcm"`.

#### 7. Champ `pointsScheme` non validé (admin matches)
- **Fichier :** `app/routes/admin.matches.server.ts`, lignes 59 et 95
- **Problème :** La valeur `pointsScheme` était stockée sans validation.
- **Correction appliquée :** Validation contre `["standard", "double", "bonus"]` avec repli sur `"standard"`.

#### 8. Absence d'en-têtes HTTP de sécurité
- **Fichiers :** Aucun middleware ni export `headers` dans `app/root.tsx`
- **Problème :** Pas de `Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Options`, ni `Strict-Transport-Security`. Sans CSP, toute future faille XSS serait sans mitigation. Sans `X-Frame-Options`, l'application peut être intégrée dans un iframe (clickjacking).
- **Statut :** Non corrigé dans ce patch. **Action requise :** Ajouter un export `headers` dans `app/root.tsx` ou configurer ces en-têtes au niveau du reverse proxy.

#### 9. Mots de passe par défaut faibles dans Docker Compose prod
- **Fichier :** `docker-compose.prod.yml`, lignes 22 et 32
- **Problème :** `:-changeme` comme valeur de repli signifie qu'en l'absence des variables d'environnement, les services démarrent avec le mot de passe `changeme` en production.
- **Correction appliquée :** Remplacement par `:?` qui force Docker Compose à échouer au démarrage si la variable n'est pas définie.

---

### 🔵 FAIBLE — Partiellement corrigé

#### 10. Variants `.env` non exclus du git
- **Fichier :** `.gitignore`
- **Problème :** Seul `.env` était exclu ; `.env.local`, `.env.production`, etc. pouvaient être commités accidentellement.
- **Correction appliquée :** Ajout de `.env.*` au `.gitignore`.

#### 11. Cast `any` pour la vérification de rôle dans le feed
- **Fichier :** `app/routes/feed.server.ts`, lignes 99, 124, 184
- **Problème :** `(session.user as any).role === "admin"` contourne le typage TypeScript.
- **Statut :** Non corrigé dans ce patch (risque faible, refactoring fonctionnel). **Recommandation :** Utiliser le type `Role` de `auth-utils.server.ts`.

#### 12. Réponse API externe typée `any`
- **Fichier :** `app/routes/soiree.server.ts`, ligne 93
- **Problème :** Données de l'API externe parsées sans type guard.
- **Statut :** Non corrigé dans ce patch (risque faible). **Recommandation :** Ajouter un schéma Zod de validation.

---

## Ce qui est propre (vérifié sain)

- Aucun secret hardcodé (clés API, mots de passe) dans le code source
- Toutes les requêtes DB utilisent Drizzle ORM avec requêtes paramétrées → pas d'injection SQL
- Aucun `dangerouslySetInnerHTML` ni `eval()` dans les composants React → pas de XSS direct
- Aucune variable `VITE_` n'expose de secrets côté client
- Toutes les routes admin (`admin.*`) vérifient correctement `requireAuth(request, ["admin"])`
- L'upload d'avatar valide le type MIME et la taille avant traitement
- Le fichier `.env` est absent du dépôt
- Rate limiting actif sur les endpoints de connexion et d'inscription

---

## Tableau récapitulatif

| # | Criticité | Fichier | Problème | Statut |
|---|-----------|---------|----------|--------|
| 1 | 🔴 Critique | `uploads-files.ts:5` | Path traversal | ✅ Corrigé |
| 2 | 🟠 Haut | `auth.server.ts:12` | trustedOrigins vide | ✅ Corrigé |
| 3 | 🟠 Haut | `api.health.ts` | Exposition infra sans auth | ✅ Corrigé |
| 4 | 🟠 Haut | `db/client.ts:6` | Bypass validation env DB | ✅ Corrigé |
| 5 | 🟡 Moyen | `api.auth.$.ts:6-11` | IP spoofing rate limit | ⚠️ Config proxy requise |
| 6 | 🟡 Moyen | `api.micro-predictions.ts:22` | `type` non validé | ✅ Corrigé |
| 7 | 🟡 Moyen | `admin.matches.server.ts:59,95` | `pointsScheme` non validé | ✅ Corrigé |
| 8 | 🟡 Moyen | `app/root.tsx` (absent) | Pas d'en-têtes sécurité HTTP | ⚠️ Action requise |
| 9 | 🟡 Moyen | `docker-compose.prod.yml:22,32` | Mots de passe par défaut faibles | ✅ Corrigé |
| 10 | 🔵 Faible | `.gitignore` | Variants .env non exclus | ✅ Corrigé |
| 11 | 🔵 Faible | `feed.server.ts:99,124,184` | Cast `any` pour rôle admin | ⚠️ Refactoring suggéré |
| 12 | 🔵 Faible | `soiree.server.ts:93` | API externe typée `any` | ⚠️ Validation Zod suggérée |

---

## Actions restantes prioritaires

1. **En-têtes HTTP de sécurité** — Ajouter dans `app/root.tsx` ou au niveau Nginx :
   ```
   Content-Security-Policy: default-src 'self'; ...
   X-Frame-Options: DENY
   X-Content-Type-Options: nosniff
   Strict-Transport-Security: max-age=31536000; includeSubDomains
   ```

2. **Rate limiting IP** — Configurer Nginx/Traefik pour écraser `X-Forwarded-For` avec l'IP réelle du client, ou ajouter un rate limiting par compte en base.
