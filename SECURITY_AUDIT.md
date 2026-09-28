# Audit de sécurité — Penya Blaugrana Nantes

> Généré automatiquement le 2026-09-28  
> Périmètre : commits récents + analyse statique des fichiers sensibles

---

## Résumé des derniers commits

| Hash | Message | Auteur | Date |
|------|---------|--------|------|
| `003faca` | fix: évaluer les badges immédiatement après chaque action | Biteau Gaël | 13 avr. 2026 |
| `b1c88f6` | feat: Phase 2 — soirée match live, micro-pronos, badges, séries, saisons | Biteau Gaël | 13 avr. 2026 |
| `d461ee5` | Merge branch 'claude/deploy-synology-nas-cLkOL' | Claude | 12 avr. 2026 |
| `554b873` | Add deployment guide for Synology NAS updates | Claude | 12 avr. 2026 |
| `68e22d2` | feat: menu burger mobile pour la navigation | Biteau Gaël | 13 avr. 2026 |
| `6aebaf7` | Fix Better Auth trusted origins for custom domain support | Claude | — |
| `9823bc5` | Add migrate service to docker-compose.prod.yml for database migrations | Claude | — |
| `8d6e5e9` | Add production Docker Compose and backup script for Synology NAS | Claude | — |
| `3d80133` | docs: roadmap Phase 2 — 8 priorités documentées | Biteau Gaël | — |
| `aed5841` | security: supprimer credentials du repo et renforcer .gitignore | Biteau Gaël | — |

### Points notables des derniers changements

- **Phase 2 (b1c88f6)** — ajout massif de 2 965 lignes : micro-pronos en live, système de badges/séries/saisons, nouveau schéma DB (`micro-predictions`, `rewards`, `seasons`). C'est la surface d'attaque la plus récente et la plus large.
- **fix badges (003faca)** — les badges sont maintenant évalués immédiatement après chaque action (post, commentaire, réaction, pronostic) dans `feed.server.ts` et `match-detail.server.ts`.
- **Déploiement NAS** — ajout de `docker-compose.prod.yml`, script `backup.sh`, et guide `DEPLOY.md`.
- **aed5841** — suppression des credentials du repo et renforcement du `.gitignore` : bonne pratique déjà en place.

---

## Analyse de sécurité par ordre de criticité

### 🔴 CRITIQUE

#### 1. Mots de passe par défaut `changeme` en production
**Fichier :** `docker-compose.prod.yml` — lignes 23, 32, 34

```yaml
POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-changeme}
redis-server --requirepass ${REDIS_PASSWORD:-changeme}
```

Si le fichier `.env` de production est absent ou incomplet, PostgreSQL et Redis démarrent avec le mot de passe `changeme`. Tout attaquant sur le même réseau peut s'authentifier immédiatement.

**Correction :** Supprimer le fallback `:-changeme` pour forcer une erreur au démarrage si la variable est absente :
```yaml
POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?Variable POSTGRES_PASSWORD requise}
```

---

### 🟠 ÉLEVÉ

#### 2. Aucune validation des entrées sur l'API micro-pronos
**Fichier :** `app/routes/api.micro-predictions.ts` — lignes 21, 92

Le champ `type` (intent `create`, admin) n'est pas validé contre une enum. Le champ `answer` (intent `answer`, joueur) n'a aucune limite de taille — un utilisateur authentifié peut soumettre une chaîne de plusieurs mégaoctets qui sera écrite en base.  
Drizzle paramétrise les requêtes (pas d'injection SQL), mais cela expose la base à un remplissage abusif (DoS DB).

**Correction :** Ajouter un schéma Zod (pattern déjà utilisé dans `feed.ts` / `prediction.ts`) :
- `type` → `z.enum(["qcm", ...])`
- `answer` / `question` → `z.string().max(500)`
- `matchId` → validation de format

#### 3. Échec d'authentification retourné en HTTP 200 au lieu de 401
**Fichier :** `app/routes/match-detail.server.ts` — lignes 124–126

`matchDetailAction` utilise `getSession` (non `requireAuth`) et retourne `{ error: "..." }` avec un statut HTTP 200 sur requête non authentifiée. Tout code client vérifiant le statut HTTP traite silencieusement cela comme un succès.

**Correction :**
```ts
// Remplacer :
if (!session) return json({ error: "Non authentifié" });
// Par :
if (!session) throw new Response("Non authentifié", { status: 401 });
```

---

### 🟡 MOYEN

#### 4. Aucun rate limiting sur les endpoints d'écriture
**Fichiers :** `api.micro-predictions.ts`, `feed.server.ts`

Aucun rate limiting côté serveur sur les actions `answer` (micro-pronos) et `create-post` / `comment` / `react` (feed). Un utilisateur authentifié peut saturer la base en rafales.

**Correction :** Implémenter un rate limiter Redis (le service Redis est déjà présent) keyed sur `session.user.id` par endpoint.

#### 5. Sauvegardes SQL non chiffrées contenant des données sensibles
**Fichier :** `backup.sh` — ligne 13

Les dumps sont écrits en clair dans `/volume1/docker/backups/penya/`. Ils contiennent : tokens OAuth (`account` table), tokens de session actifs, PII utilisateurs, tokens de vérification email.

**Correction :** Chiffrer le dump avant écriture :
```bash
pg_dump ... | gpg --symmetric --cipher-algo AES256 -o "$BACKUP_FILE.sql.gpg"
```
Restreindre les permissions du répertoire à `root` uniquement.

#### 6. `JSON.parse` sans try/catch pouvant crasher le loader global
**Fichier :** `app/routes/soiree.server.ts` — ligne 250

`JSON.parse(m.options)` sans try/catch : une ligne corrompue en base (édition directe, migration) fait planter le loader pour **tous les utilisateurs** sur toutes les soirées.

**Correction :**
```ts
let options = [];
try { options = JSON.parse(m.options); } catch { /* fallback */ }
```

#### 7. `userMicroPoints` agrège tous les matchs, pas seulement la soirée courante
**Fichier :** `app/routes/soiree.server.ts` — lignes 203–225

La requête récupère toutes les réponses de l'utilisateur sans filtre sur `matchId`. Le score affiché est donc le score total toutes soirées confondues. Bug de cohérence et surcharge inutile.

**Correction :** Ajouter `.where(inArray(microPredictionAnswers.microPredictionId, activeMicros.map(m => m.id)))`.

#### 8. Fragment SQL brut au lieu de l'abstraction ORM
**Fichier :** `app/lib/server/badges.server.ts` — lignes 140–142

```ts
.from(sql`"user"`)
.where(sql`id = ${userId}`)
```

Drizzle paramétrise l'interpolation donc pas d'injection directe, mais le pattern contourne les garanties ORM et fragilise les futures modifications.

**Correction :** Utiliser les références ORM :
```ts
.from(user)
.where(eq(user.id, userId))
```

---

### 🟢 FAIBLE

#### 9. Absence de contrainte enum au niveau DB sur la colonne `role`
**Fichier :** `app/db/schema/users.ts` — ligne 20

`role` est un `varchar(20)`. Une écriture directe en base ou une migration défectueuse peut insérer une valeur arbitraire, causant des échecs silencieux dans les vérifications de rôle.

**Correction :** Utiliser un type enum Postgres ou une contrainte `CHECK`.

#### 10. Tokens OAuth stockés en clair
**Fichier :** `app/db/schema/users.ts` — lignes 49–51

`accessToken`, `refreshToken`, `idToken` sont des colonnes `text` non chiffrées. Compromission de la base = exposition immédiate de tous les tokens OAuth.

*(Trade-off connu de Better Auth — à documenter dans le threat model.)*

#### 11. `JSON.parse` sans try/catch sur le cache match
**Fichier :** `app/routes/match-detail.server.ts` — ligne 83

`JSON.parse(match.matchDetails)` — même problème qu'en point 6, mais limité au loader d'un seul match.

#### 12. Parsing fragile de `ls` dans le script de nettoyage
**Fichier :** `backup.sh` — ligne 16

```bash
ls -t "$BACKUP_DIR"/*.sql | tail -n +31 | xargs rm -f
```

Anti-pattern connu (noms de fichiers avec espaces/newlines). Remplacer par `find ... | sort | tail | xargs`.

#### 13. Absence de limites de ressources sur les conteneurs Docker
**Fichier :** `docker-compose.prod.yml`

Aucun `mem_limit` / `cpus` défini. Un spike de trafic peut épuiser les ressources hôte et affecter tous les conteneurs co-localisés.

---

## Points positifs confirmés

- ✅ Aucune injection SQL — Drizzle ORM paramétrise toutes les requêtes
- ✅ Aucun secret hardcodé dans les fichiers source (chargement via `getEnv()`)
- ✅ Les opérations admin dans `api.micro-predictions.ts` vérifient bien `session.user.role === "admin"`
- ✅ Les suppressions dans `feedAction` vérifient la propriété ou le rôle admin
- ✅ `.env` correctement ignoré par `.gitignore`
- ✅ Commit `aed5841` a déjà nettoyé les credentials du repo

---

## Tableau de synthèse

| # | Criticité | Fichier | Ligne | Problème |
|---|-----------|---------|-------|----------|
| 1 | 🔴 CRITIQUE | `docker-compose.prod.yml` | 23, 32, 34 | Fallback `changeme` pour Postgres et Redis |
| 2 | 🟠 ÉLEVÉ | `api.micro-predictions.ts` | 21, 92 | Aucune validation des entrées (type, answer) |
| 3 | 🟠 ÉLEVÉ | `match-detail.server.ts` | 124 | Auth failure retourne HTTP 200 au lieu de 401 |
| 4 | 🟡 MOYEN | Tous les endpoints d'action | — | Aucun rate limiting |
| 5 | 🟡 MOYEN | `backup.sh` | 13 | Dumps SQL non chiffrés (tokens + PII) |
| 6 | 🟡 MOYEN | `soiree.server.ts` | 250 | JSON.parse non protégé (crash global) |
| 7 | 🟡 MOYEN | `soiree.server.ts` | 203–225 | Score micro-pronos agrège tous les matchs |
| 8 | 🟡 MOYEN | `badges.server.ts` | 140–142 | Fragment SQL brut (contourne ORM) |
| 9 | 🟢 FAIBLE | `users.ts` | 20 | Pas de contrainte enum DB sur `role` |
| 10 | 🟢 FAIBLE | `users.ts` | 49–51 | Tokens OAuth en clair en base |
| 11 | 🟢 FAIBLE | `match-detail.server.ts` | 83 | JSON.parse non protégé (crash loader match) |
| 12 | 🟢 FAIBLE | `backup.sh` | 16 | Parsing `ls` fragile dans le nettoyage |
| 13 | 🟢 FAIBLE | `docker-compose.prod.yml` | — | Absence de limites de ressources conteneurs |
