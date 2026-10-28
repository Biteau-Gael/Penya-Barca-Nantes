# Analyse de sécurité — Penya Blaugrana Nantes

> Générée le 2026-10-28 — analyse des commits récents et revue du code

---

## Résumé des derniers commits

| Hash | Date | Auteur | Description |
|------|------|--------|-------------|
| `003faca` | 13 avr. 2026 | Biteau Gaël | fix: évaluer les badges immédiatement après chaque action |
| `b1c88f6` | 13 avr. 2026 | Biteau Gaël | feat: Phase 2 — soirée match live, micro-pronos, badges, séries, saisons |
| `d461ee5` | 12 avr. 2026 | Claude | Merge branch 'claude/deploy-synology-nas-cLkOL' |
| `554b873` | 12 avr. 2026 | Claude | Add deployment guide for Synology NAS updates |
| `68e22d2` | 13 avr. 2026 | Biteau Gaël | feat: menu burger mobile pour la navigation |
| `aed5841` | 12 avr. 2026 | Biteau Gaël | security: supprimer credentials du repo et renforcer .gitignore |

La Phase 2 est la contribution la plus significative (+2 965 lignes) : soirée match live, micro-pronostics, système de badges, séries de scores et gestion des saisons.

---

## Résultats de l'analyse de sécurité — par ordre de criticité

---

### 🔴 CRITIQUE — Path Traversal dans la route uploads

**Fichier :** `app/routes/uploads-files.ts`  
**Statut :** **CORRIGÉ** dans ce commit

**Problème :** La route `GET /uploads/*` construisait le chemin de fichier directement à partir du paramètre URL sans vérifier que le chemin résolu restait dans le répertoire `uploads/`. Une requête malveillante comme `/uploads/../../../etc/passwd` permettait de lire n'importe quel fichier accessible au processus Node.js.

```ts
// Avant — VULNÉRABLE
const filePath = path.join(process.cwd(), "uploads", params["*"]);
// filePath pouvait pointer vers /etc/passwd, les fichiers .env, etc.
```

**Correction appliquée :** Vérification que le chemin résolu commence bien par `UPLOADS_DIR + path.sep` avant toute lecture de fichier. Si ce n'est pas le cas, retour 404.

---

### 🟠 ÉLEVÉ — Accès direct à `process.env` sans validation dans 3 fichiers

**Fichiers :** `app/lib/server/logger.server.ts`, `app/lib/server/redis.server.ts`, `app/db/client.ts`  
**Statut :** À corriger

**Problème :** Ces fichiers lisent `process.env` directement, contournant la validation Zod centralisée de `app/config/env.server.ts`. Si une variable est absente ou mal formée, l'erreur est silencieuse (fallback sur valeur par défaut) ou non documentée.

```ts
// logger.server.ts
level: process.env.LOG_LEVEL || "info",  // aucune validation

// redis.server.ts
new Redis(process.env.REDIS_URL || "redis://localhost:6379", ...)  // idem

// db/client.ts
connectionString: process.env.DATABASE_URL  // undefined possible sans erreur claire
```

**Recommandation :** Importer et appeler `getEnv()` dans ces fichiers au lieu d'accéder à `process.env` directement.

---

### 🟡 MOYEN — Absence de rate limiting sur les routes d'actions utilisateur

**Fichier :** `app/routes/api.micro-predictions.ts`, `app/routes/feed.server.ts`  
**Statut :** À évaluer

**Problème :** Les actions utilisateur (soumettre un pronostic, publier un post, réagir) ne sont protégées que par l'authentification. Il n'y a pas de limite de fréquence sur ces endpoints. Un utilisateur connecté pourrait les appeler en boucle pour cumuler des points ou des badges artificiellement.

**Recommandation :** Appliquer `checkRateLimit` sur les actions sensibles (ex. 60 req/min par utilisateur). L'infrastructure Redis est déjà en place.

---

### 🟡 MOYEN — Comparaison de chaîne insensible à la casse pour les réponses de micro-pronostics

**Fichier :** `app/routes/api.micro-predictions.ts` (ligne ~65)  
**Statut :** À évaluer

**Problème :** La comparaison entre la réponse d'un joueur et la bonne réponse utilise `.toLowerCase().trim()`. Si la bonne réponse contient des caractères Unicode ou des espaces insécables, le comportement peut être imprévisible selon le contenu.

**Recommandation :** Normaliser les deux chaînes avec `String.prototype.normalize("NFC")` en plus du `.toLowerCase().trim()`.

---

### 🟢 FAIBLE — Logs sans masquage des données sensibles potentielles

**Fichier :** `app/lib/server/logger.server.ts` (pino)  
**Statut :** À surveiller

**Problème :** Les logs pino enregistrent les objets passés tels quels. Si un objet contenant une `password`, un `token` ou un `authSecret` est passé par inadvertance, la valeur se retrouve en clair dans les logs.

**Recommandation :** Configurer le `redact` de pino pour masquer les clés sensibles communes :
```ts
redact: ["password", "token", "authSecret", "authorization", "cookie"]
```

---

## Ce qui est bien fait

- **Credentials hors du repo** : le commit `aed5841` a supprimé les credentials en dur et renforcé le `.gitignore`. Les fichiers `.env`, `.claude/` et les secrets Docker ne sont plus trackés.
- **Validation des variables d'environnement** : `app/config/env.server.ts` valide les variables critiques avec Zod au démarrage.
- **Authentification cohérente** : toutes les routes protégées appellent `requireAuth()`, les routes admin passent `["admin"]` en second argument.
- **Rate limiting sur l'authentification** : login (10 req/15 min) et inscription (5 req/h) sont protégés par IP.
- **Validation des uploads** : `app/lib/server/upload.ts` vérifie le type MIME et la taille, et convertit en WebP via `sharp` avant stockage.
- **Zod sur les formulaires admin** : `admin.events.server.ts` valide les données avec un schéma Zod avant insertion en base.
- **Pas de XSS direct** : aucun `dangerouslySetInnerHTML` ou accès direct au DOM n'a été trouvé dans le code applicatif.
- **Sessions via Redis** : `better-auth` utilise Redis comme stockage secondaire, ce qui permet l'invalidation sans redéploiement.

---

## Actions prioritaires

| Priorité | Action | Fichier |
|----------|--------|---------|
| ✅ Fait | Corriger path traversal uploads | `app/routes/uploads-files.ts` |
| 1 | Migrer vers `getEnv()` dans logger, redis, db | 3 fichiers |
| 2 | Ajouter rate limiting sur micro-predictions et feed | `api.micro-predictions.ts`, `feed.server.ts` |
| 3 | Ajouter `redact` dans la config pino | `logger.server.ts` |
| 4 | Normaliser Unicode dans les comparaisons de réponses | `api.micro-predictions.ts` |
