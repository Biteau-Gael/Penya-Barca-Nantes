# Audit Sécurité — Penya Blaugrana Nantes

**Date :** 25 avril 2026  
**Branche analysée :** `main` (derniers commits jusqu'au 13 avril 2026)  
**Scope :** Revue des 6 derniers commits + analyse statique du code source

---

## 1. Résumé des derniers commits

| Hash | Date | Type | Description |
|------|------|------|-------------|
| `003faca` | 13/04/2026 | fix | Évaluation des badges immédiatement après chaque action utilisateur |
| `b1c88f6` | 13/04/2026 | feat | Phase 2 : soirée match live, micro-pronos, badges, séries, saisons |
| `68e22d2` | 13/04/2026 | feat | Menu burger mobile pour la navigation |
| `d461ee5` | 12/04/2026 | merge | Fusion de la branche de déploiement Synology NAS |
| `554b873` | 12/04/2026 | docs | Guide de mise à jour du déploiement NAS |
| `6aebaf7` | 12/04/2026 | fix | Correction des `trustedOrigins` Better Auth pour domaine custom |

### Périmètre fonctionnel de la Phase 2 (`b1c88f6`)

- **Sprint 2** — Page `/soiree/:matchId` avec score live (polling API 60s), fil du match en temps réel, pronos communauté révélés au coup d'envoi
- **Sprint 3** — Micro-pronostics (création admin, vote joueur, clôture avec points auto), suppression admin, séries de scores exacts (`currentStreak`/`bestStreak`)
- **Sprint 5** — 10 badges de base avec évaluation automatique, page `/badges`, table `seasons`, classement filtré par saison
- **DB** — Migration `0007` : tables `seasons`, `badges`, `user_badges`, `rewards`, `micro_predictions`, `micro_prediction_answers`

---

## 2. Points de sécurité bien maîtrisés

- **Validation des entrées** : Zod appliqué systématiquement sur tous les formulaires (auth, matches, feed, pronos, profil)
- **ORM paramétré** : Drizzle ORM utilisé pour la majorité des requêtes, éliminant les risques d'injection SQL
- **Rate limiting sur l'authentification** : 10 tentatives/15 min pour le login, 5 tentatives/1h pour l'inscription (via Redis)
- **Protection des routes** : `requireAuth()` appliqué sur toutes les routes protégées avec vérification du rôle `["admin"]`
- **Secrets exclus du dépôt** : `.env` dans `.gitignore`, commit `aed5841` "security: supprimer credentials du repo"
- **Protection admin** : un administrateur ne peut pas modifier ni supprimer son propre compte
- **Suppression en cascade** : FK `ON DELETE CASCADE` définis sur `user_badges`, `rewards`, `micro_prediction_answers` — suppression propre d'un membre
- **Sessions Redis** : Better Auth stocke les sessions dans Redis (`secondaryStorage`) — révocables immédiatement
- **Logs structurés** : pino sans données sensibles dans les messages (pas de mot de passe, pas de token)
- **XSS** : aucun usage de `dangerouslySetInnerHTML` ou `eval()` trouvé dans le code

---

## 3. Remarques de sécurité par ordre de criticité

---

### CRITIQUE

#### C1 — Bypass de la validation d'environnement dans `db/client.ts` et `redis.server.ts`

**Fichiers :**
- `app/db/client.ts:6` — `process.env.DATABASE_URL`
- `app/lib/server/redis.server.ts:3` — `process.env.REDIS_URL || "redis://localhost:6379"`

**Problème :** Ces deux fichiers accèdent directement à `process.env` au lieu de passer par `getEnv()` (qui valide les variables via Zod au démarrage). Si `DATABASE_URL` est absent ou mal formé, l'erreur sera silencieuse au boot et n'apparaîtra qu'au moment d'une requête DB. `redis.server.ts` a une valeur par défaut en clair (`redis://localhost:6379`) qui bypasse toute validation.

**Correctif recommandé :**
```ts
// app/db/client.ts
import { getEnv } from "~/config/env.server";
const pool = new pg.Pool({ connectionString: getEnv().DATABASE_URL });

// app/lib/server/redis.server.ts
import { getEnv } from "~/config/env.server";
export const redis = new Redis(getEnv().REDIS_URL, { ... });
```
Ajouter `REDIS_URL` comme champ requis dans `env.server.ts` (actuellement optionnel avec default).

---

### MOYEN

#### M1 — Absence de headers de sécurité HTTP

**Problème :** Aucun header de sécurité HTTP n'est configuré : pas de `Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Options`, `Strict-Transport-Security`, ni `Referrer-Policy`. Ces headers protègent contre le clickjacking, le MIME sniffing, et les injections de contenu.

**Correctif recommandé :** Ajouter un middleware dans `entry.server.tsx` ou configurer Nginx (reverse proxy) avec ces headers :
```
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Content-Security-Policy: default-src 'self'; img-src 'self' https://images.fotmob.com data:
Strict-Transport-Security: max-age=31536000; includeSubDomains
```

---

#### M2 — `trustedOrigins` vide si `APP_URL` non défini

**Fichier :** `app/lib/server/auth.server.ts:12`

```ts
trustedOrigins: env.APP_URL ? [env.APP_URL] : [],
```

**Problème :** Si `APP_URL` n'est pas renseigné en production, `trustedOrigins` est un tableau vide. Le comportement de Better Auth avec un tableau vide doit être vérifié : selon la version, cela peut soit bloquer toutes les origines cross-site, soit ne pas en vérifier. La variable `APP_URL` est marquée `optional()` dans le schema Zod, ce qui encourage à ne pas la définir.

**Correctif recommandé :** Rendre `APP_URL` obligatoire en production dans `env.server.ts` :
```ts
APP_URL: z.string().url().optional(), // ou .string().url() si NODE_ENV === production
```
Et documenter clairement dans `.env.example` que cette variable est requise en production.

---

#### M3 — Spoofing possible de l'IP pour le rate limiting

**Fichier :** `app/routes/api.auth.$.ts:5-11`

**Problème :** L'IP cliente est extraite depuis `x-forwarded-for` ou `x-real-ip`. Ces headers peuvent être forgés par un attaquant si l'application est exposée directement sans reverse proxy validant ces headers. En production sur Synology NAS (Nginx ou DSM reverse proxy), c'est atténué, mais non garanti selon la configuration.

**Correctif recommandé :** Documenter dans `DEPLOY.md` que le reverse proxy (Nginx) doit être configuré pour écraser ces headers côté upstream, et non les relayer tels quels depuis le client.

---

#### M4 — Mot de passe par défaut "changeme" dans `docker-compose.prod.yml`

**Fichier :** `docker-compose.prod.yml:20` et `:25`

```yaml
POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-changeme}
redis-server --requirepass ${REDIS_PASSWORD:-changeme}
```

**Problème :** Le fallback `changeme` est un mot de passe trivial. Si le fichier `.env` de production est absent ou ne définit pas ces variables, les services démarreront avec un mot de passe connu publiquement.

**Correctif recommandé :** Supprimer le fallback ou le remplacer par une erreur explicite. Idéalement, utiliser des Docker secrets ou forcer la définition via un `required: true` Docker Compose (non supporté nativement, mais documentable).

---

### FAIBLE

#### F1 — Réponses API externes non validées (type `any`)

**Fichier :** `app/routes/soiree.server.ts:93`

```ts
return res.value.json().then((data: any) => {
```

**Problème :** La réponse de l'API Football externe est castée en `any` sans schéma Zod de validation. Un changement de format de l'API ou une réponse malformée peut provoquer des erreurs silencieuses ou des comportements inattendus.

**Correctif recommandé :** Définir un schéma Zod pour la réponse des lineups (même partiel), comme cela est fait pour `ApiLineupResponse` dans `api-football.server.ts`.

---

#### F2 — Absence de validation sur les champs libres des micro-pronostics

**Fichier :** `app/routes/api.micro-predictions.ts`

**Problème :** Les champs `question` (ligne 23), `options` (ligne 26), et `answer` (ligne 73) ne sont pas validés en longueur. Un admin malveillant ou une requête forgée peut insérer des chaînes très longues en base de données.

**Correctif recommandé :** Ajouter un schéma Zod pour les intents `create`, `close` et `answer` :
```ts
const createMicroSchema = z.object({
  matchId: z.string().min(1),
  question: z.string().min(1).max(300),
  options: z.string().max(500).optional(),
  pointsValue: z.coerce.number().int().min(1).max(10),
  deadlineSeconds: z.coerce.number().int().min(30).max(600),
});
```

---

#### F3 — Raw SQL dans `badges.server.ts` incohérent avec le reste du code

**Fichier :** `app/lib/server/badges.server.ts:140-142`

```ts
const [userRow] = await db.select({ bestStreak: sql<number>`coalesce(best_streak, 0)::int` })
  .from(sql`"user"`)
  .where(sql`id = ${userId}`);
```

**Problème :** Bien que la valeur `userId` soit paramétrée (sûr contre l'injection), l'usage de `sql\`"user"\`` et `sql\`id = ${userId}\`` au lieu du schéma Drizzle (`user` table importée) est une incohérence qui complexifie la maintenance et la détection d'erreurs statiques.

**Correctif recommandé :** Utiliser la table `user` importée via le schéma Drizzle comme dans les autres fichiers :
```ts
const [userRow] = await db
  .select({ bestStreak: user.bestStreak })
  .from(user)
  .where(eq(user.id, userId));
```

---

#### F4 — `backup.sh` sans vérification d'intégrité

**Fichier :** `backup.sh`

**Problème :** Le script ne vérifie pas si le `pg_dump` a réussi (code de sortie non testé) et ne génère pas de checksum pour valider l'intégrité des sauvegardes. En cas d'échec silencieux, les sauvegardes semblent présentes mais sont corrompues.

**Correctif recommandé :**
```bash
if ! docker compose ... pg_dump ... > "$BACKUP_DIR/penya_$DATE.sql"; then
  echo "ERREUR : backup échoué" >&2
  exit 1
fi
sha256sum "$BACKUP_DIR/penya_$DATE.sql" > "$BACKUP_DIR/penya_$DATE.sql.sha256"
```

---

#### F5 — `logger.server.ts` accède à `process.env` directement

**Fichier :** `app/lib/server/logger.server.ts:4`

```ts
level: process.env.LOG_LEVEL || "info",
```

**Problème :** Même incohérence que C1 : `LOG_LEVEL` est défini dans `env.server.ts` avec validation Zod, mais le logger l'utilise directement depuis `process.env`. Cela ne pose pas de risque de sécurité direct mais rompt la cohérence de la validation centralisée.

**Correctif recommandé :** Importer `getEnv()` dans le logger, ou exporter la valeur depuis `env.server.ts` pour éviter les imports circulaires.

---

## 4. Tableau récapitulatif

| ID | Criticité | Fichier(s) | Résumé |
|----|-----------|-----------|--------|
| C1 | **CRITIQUE** | `db/client.ts`, `redis.server.ts` | `process.env` direct, bypass validation Zod |
| M1 | **MOYEN** | Application entière | Absence de headers de sécurité HTTP |
| M2 | **MOYEN** | `auth.server.ts` | `trustedOrigins` vide si `APP_URL` absent |
| M3 | **MOYEN** | `api.auth.$.ts` | IP spoofable pour rate limiting |
| M4 | **MOYEN** | `docker-compose.prod.yml` | Mot de passe fallback "changeme" |
| F1 | **FAIBLE** | `soiree.server.ts` | Réponse API externe non validée (`any`) |
| F2 | **FAIBLE** | `api.micro-predictions.ts` | Champs libres sans validation de longueur |
| F3 | **FAIBLE** | `badges.server.ts` | Raw SQL incohérent avec le schéma Drizzle |
| F4 | **FAIBLE** | `backup.sh` | Pas de vérification d'intégrité des dumps |
| F5 | **FAIBLE** | `logger.server.ts` | `process.env.LOG_LEVEL` direct |

---

*Document généré le 25 avril 2026 — à mettre à jour à chaque sprint.*
