# Audit de Sécurité — Penya Barca Nantes
**Date :** 23 mai 2026  
**Branche :** `claude/sharp-fermi-lQVGS`  
**Analyste :** Claude Code (claude-sonnet-4-6)

---

## 1. Résumé des derniers commits

| Date | Hash | Type | Description |
|------|------|------|-------------|
| 13/04/2026 | `003faca` | fix | Évaluation des badges immédiatement après chaque action (pronostic, post, commentaire, réaction) |
| 13/04/2026 | `b1c88f6` | feat | **Phase 2** — Soirée match live, micro-pronos, badges, séries, saisons (migration DB 0007, 2965 lignes ajoutées) |
| 13/04/2026 | `68e22d2` | feat | Menu burger mobile pour la navigation |
| 12/04/2026 | `d461ee5` | merge | Merge branche `deploy-synology-nas-cLkOL` |
| 12/04/2026 | `554b873` | docs | Guide de déploiement NAS Synology (mises à jour, logs, backups) |
| 12/04/2026 | `6aebaf7` | fix | Correction des origines de confiance Better Auth pour le domaine personnalisé |
| 12/04/2026 | `9823bc5` | fix | Ajout du service `migrate` dans `docker-compose.prod.yml` |
| 12/04/2026 | `8d6e5e9` | feat | Docker Compose production + script de backup Synology |
| 12/04/2026 | `3d80133` | docs | Roadmap Phase 2 — 8 priorités documentées |
| 12/04/2026 | `aed5841` | security | **Suppression des credentials du repo, renforcement du .gitignore** |

### Points notables
- La Phase 2 est le commit le plus impactant (~3 000 lignes) : nouvelles tables DB, routes API, page soirée live, système de badges/séries.
- Un commit dédié à la sécurité (`aed5841`) a déjà traité la suppression de secrets exposés — bonne pratique.
- Le fix badges (`003faca`) corrige un bug de timing dans l'évaluation post-action.

---

## 2. Analyse de sécurité

### Synthèse

| Criticité | Nombre | Statut |
|-----------|--------|--------|
| 🔴 CRITIQUE | 3 | À corriger immédiatement |
| 🟠 ÉLEVÉE | 4 | À corriger dans le sprint suivant |
| 🟡 MOYENNE | 6 | À planifier |
| 🔵 FAIBLE | 3 | À surveiller |

---

### 🔴 CRITIQUE

#### C1 — Path Traversal sur le serveur de fichiers
- **Fichier :** `app/routes/uploads-files.ts:5`
- **Impact :** Lecture arbitraire de fichiers sur le serveur (`.env`, fichiers système)
- **Description :** Le paramètre catch-all `params["*"]` est concaténé directement avec `process.cwd()` via `path.join()` sans validation. Un attaquant peut requêter `/uploads-files/../../.env` pour lire n'importe quel fichier accessible au processus Node.
```typescript
// VULNÉRABLE — aucune validation du chemin résolu
const filePath = path.join(process.cwd(), "uploads", params["*"]);
const file = await readFile(filePath);
```
- **Correction :**
```typescript
const UPLOADS_ROOT = path.resolve(process.cwd(), "uploads");
const filePath = path.resolve(UPLOADS_ROOT, params["*"]);
if (!filePath.startsWith(UPLOADS_ROOT + path.sep)) {
  return new Response("Forbidden", { status: 403 });
}
```

---

#### C2 — Mots de passe par défaut en production Docker
- **Fichier :** `docker-compose.prod.yml:22,32`
- **Impact :** Accès non autorisé à la base de données PostgreSQL et Redis si le `.env` n'est pas configuré
- **Description :** Les services PostgreSQL et Redis utilisent `changeme` comme fallback si `POSTGRES_PASSWORD` / `REDIS_PASSWORD` ne sont pas définis.
```yaml
POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-changeme}   # ligne 22
redis-server --requirepass ${REDIS_PASSWORD:-changeme}  # ligne 32
```
- **Correction :** Supprimer le fallback `:- changeme` pour forcer un échec explicite si la variable n'est pas définie.

---

#### C3 — Race condition sur la clôture des micro-pronostics
- **Fichier :** `app/routes/api.micro-predictions.ts:56-86`
- **Impact :** Attribution incorrecte ou double attribution de points
- **Description :** L'opération de clôture (mise à jour + attribution des points) n'est pas enveloppée dans une transaction DB. Deux requêtes concurrentes peuvent lire un état intermédiaire.
```typescript
// Pas de transaction — 2 opérations non atomiques
const [micro] = await db.update(microPredictions).set(...).returning();
const answers = await db.select().from(microPredictionAnswers)...;
for (const answer of answers) {
  await db.update(microPredictionAnswers).set({ points })...;
}
```
- **Correction :** Envelopper dans `db.transaction(async (tx) => { ... })`.

---

### 🟠 ÉLEVÉE

#### H1 — Contournement du rate-limiting par IP spoofing
- **Fichier :** `app/routes/api.auth.$.ts`
- **Impact :** Brute-force illimité sur les endpoints login/register
- **Description :** Le rate-limiting utilise le header `x-forwarded-for`, contrôlé par le client en l'absence d'un proxy de confiance en amont.
- **Correction :** Ne faire confiance à ce header que si la requête provient d'un proxy connu (adresse IP de confiance), sinon utiliser l'IP socket.

---

#### H2 — Message d'erreur interne exposé au client
- **Fichier :** `app/routes/api.sync-matches.ts:21`
- **Impact :** Fuite d'informations sur l'infrastructure (URLs d'API, stack traces)
- **Description :**
```typescript
const message = error instanceof Error ? error.message : "Erreur inconnue";
return Response.json({ error: message }, { status: 500 });
```
- **Correction :** Logger l'erreur côté serveur (`logger.error`) et retourner un message générique `"Erreur serveur interne"` au client.

---

#### H3 — Entropie insuffisante pour AUTH_SECRET
- **Fichier :** `app/config/env.server.ts:10`
- **Impact :** Secret de session potentiellement faible, risque de forge de tokens
- **Description :** `AUTH_SECRET` n'impose qu'un minimum de 16 caractères, ce qui est insuffisant pour une clé cryptographique robuste.
```typescript
AUTH_SECRET: z.string().min(16),  // trop permissif
```
- **Correction :** Passer à `.min(32)` et documenter qu'une clé de 64 caractères aléatoires est recommandée.

---

#### H4 — Absence d'en-têtes de sécurité HTTP
- **Fichier :** Toutes les routes (pas de middleware global)
- **Impact :** Clickjacking, MIME-sniffing, XSS réfléchi
- **Description :** Aucun des headers suivants n'est configuré : `Strict-Transport-Security`, `X-Frame-Options`, `X-Content-Type-Options`, `Content-Security-Policy`.
- **Correction :** Ajouter un middleware dans `app/root.tsx` ou un `entry.server.ts` pour injecter ces headers sur chaque réponse.

---

### 🟡 MOYENNE

#### M1 — CSRF non protégé sur les formulaires d'action
- **Fichier :** `app/routes/feed.server.ts`, `admin.matches.server.ts`, `profile.server.ts`, etc.
- **Impact :** Un attaquant peut déclencher des actions (post, pronostic, suppression de compte) depuis un site tiers
- **Description :** React Router ne fournit pas de protection CSRF native. Aucun token CSRF n'est généré ou validé.
- **Correction :** Implémenter des tokens CSRF côté serveur (ex. via `better-auth` ou une librairie dédiée).

---

#### M2 — `JSON.parse()` sans try/catch sur données DB
- **Fichiers :**
  - `app/routes/soiree.server.ts:250` — `JSON.parse(m.options)`
  - `app/routes/match-detail.server.ts` — `JSON.parse(match.matchDetails)`
- **Impact :** Crash du loader si la donnée est corrompue
- **Description :** Les données issues de la DB sont parsées sans gestion d'erreur.
- **Correction :** Envelopper dans `try/catch` ou utiliser un schéma Zod pour valider après parsing.

---

#### M3 — Validation MIME type côté client uniquement (upload avatar)
- **Fichier :** `app/lib/server/upload.ts:13`
- **Impact :** Upload de fichiers malveillants déguisés en images
- **Description :** `file.type` est fourni par le navigateur et peut être falsifié. La vérification ne lit pas les octets magiques réels du fichier.
```typescript
if (!ALLOWED_TYPES.includes(file.type)) { ... }
```
- **Correction :** Utiliser la librairie `file-type` pour vérifier la signature binaire réelle du fichier. Note : `sharp` rejette en pratique les non-images, ce qui atténue partiellement le risque.

---

#### M4 — Absence de rate-limiting sur les endpoints sensibles
- **Fichiers :** `app/routes/feed.server.ts`, `app/routes/profile.server.ts`, `app/routes/api.micro-predictions.ts`
- **Impact :** Spam de posts/commentaires, saturation des uploads, abus des micro-pronos
- **Description :** Seuls les endpoints d'authentification sont limités. Aucune limite sur la création de posts, d'avatars ou de réponses aux micro-pronos.
- **Correction :** Appliquer `rateLimit()` aux actions d'écriture avec des seuils adaptés (ex. 10 posts/minute par utilisateur).

---

#### M5 — Suppression de compte sans confirmation par mot de passe
- **Fichier :** `app/routes/profile.server.ts`
- **Impact :** Suppression de compte via session volée (XSS, réseau non sécurisé)
- **Description :** L'action de suppression de compte vérifie uniquement la présence d'une session active, sans demander le mot de passe.
- **Correction :** Exiger la saisie du mot de passe actuel avant suppression.

---

#### M6 — Validation des variables d'environnement non déclenchée au démarrage
- **Fichier :** `app/config/env.server.ts:20-22`
- **Impact :** Crash en production lors du premier accès à une route si `DATABASE_URL` ou `AUTH_SECRET` est absent
- **Description :** `getEnv()` est appelée à la demande — une variable manquante n'est pas détectée au démarrage.
- **Correction :** Appeler `getEnv()` dans `app/root.tsx` ou `entry.server.ts` au démarrage de l'application pour un échec rapide (_fail fast_).

---

### 🔵 FAIBLE

#### L1 — IDs d'avatars prévisibles (IDOR potentiel)
- **Fichier :** `app/lib/server/upload.ts:30`
- **Impact :** Énumération des avatars utilisateurs
- **Description :** Le nom du fichier est `{userId}.webp`. Si les `userId` sont prévisibles, un attaquant peut lister les avatars.
- **Correction :** Ajouter un composant aléatoire : `${userId}-${randomBytes(8).toString('hex')}.webp` ou vérifier que `createId()` génère des IDs suffisamment opaques (ce qui semble être le cas avec `nanoid`).

---

#### L2 — Normalisation Unicode absente sur le pseudo
- **Fichier :** `app/lib/validation/user.ts`
- **Impact :** Usurpation visuelle de pseudo via homoglyphes (ex. `Аdmin` vs `Admin`)
- **Description :** Le pseudo est limité à 30 caractères mais n'est pas normalisé (NFKC) ni filtré pour les caractères invisibles (zero-width).
- **Correction :** Appliquer `.normalize('NFKC')` et rejeter les caractères de contrôle Unicode.

---

#### L3 — `correctAnswer` exposé dans la réponse du loader soirée
- **Fichier :** `app/routes/soiree.server.ts:254`
- **Impact :** Un joueur peut lire la réponse correcte avant la clôture officielle
- **Description :** Le champ `correctAnswer` est inclus dans les données envoyées au client même si le micro-pronostic n'est pas encore clôturé.
- **Correction :** N'envoyer `correctAnswer` que lorsque `closedAt !== null`.

---

## 3. Points positifs constatés

- **Suppression des credentials** déjà effectuée (`aed5841`) : bon réflexe.
- **Validation Zod** des variables d'environnement en place (`env.server.ts`).
- **ORM Drizzle** utilisé correctement — pas de requêtes SQL brutes, pas de risque d'injection SQL direct.
- **`requireAuth()`** présent et utilisé de façon cohérente sur toutes les routes protégées.
- **Vérification de rôle admin** systématique sur les actions sensibles des micro-pronos.
- **Pas d'utilisation de `dangerouslySetInnerHTML`** dans le codebase (aucun risque XSS côté React).
- **Logger structuré** (`pino` ou équivalent) en place, sans exposition de données sensibles.
- **Sharp** retraite toutes les images à l'upload, éliminant les métadonnées et limitant le risque de fichiers malicieux.

---

## 4. Plan d'action recommandé

### Sprint immédiat (avant mise en production)
1. [ ] **C1** — Fix path traversal `uploads-files.ts` (30 min)
2. [ ] **C2** — Supprimer les fallbacks `changeme` dans `docker-compose.prod.yml` (5 min)
3. [ ] **H3** — Augmenter `AUTH_SECRET` minimum à 32 caractères (5 min)
4. [ ] **M6** — Valider les env vars au démarrage (15 min)
5. [ ] **L3** — Masquer `correctAnswer` si `closedAt === null` (10 min)

### Sprint suivant
6. [ ] **C3** — Envelopper la clôture micro-pronos dans une transaction DB
7. [ ] **H1** — Sécuriser la détection d'IP pour le rate-limiting
8. [ ] **H2** — Retourner des messages d'erreur génériques au client
9. [ ] **H4** — Ajouter les en-têtes de sécurité HTTP (middleware global)
10. [ ] **M1** — Implémenter la protection CSRF

### Backlog
11. [ ] **M2** — Ajouter try/catch sur les `JSON.parse` côté DB
12. [ ] **M3** — Validation des magic bytes sur les uploads
13. [ ] **M4** — Rate limiting sur les endpoints d'écriture
14. [ ] **M5** — Confirmation par mot de passe avant suppression de compte
15. [ ] **L1, L2** — Hardening des identifiants et pseudos

---

*Document généré automatiquement le 23/05/2026 — à réviser à chaque sprint.*
