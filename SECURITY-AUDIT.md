# Audit de Sécurité — Penya Blaugrana Nantes

**Date :** 2026-11-05  
**Branch analysée :** `main` (commits jusqu'au `003faca`)  
**Analyste :** Claude Code (automatisé)

---

## Résumé des derniers commits

| Commit | Message | Date |
|--------|---------|------|
| `003faca` | fix: évaluer les badges immédiatement après chaque action | 13 avr. 2026 |
| `b1c88f6` | feat: Phase 2 — soirée match live, micro-pronos, badges, séries, saisons | 13 avr. 2026 |
| `d461ee5` | Merge branch 'claude/deploy-synology-nas-cLkOL' | 12 avr. 2026 |
| `554b873` | Add deployment guide for Synology NAS updates | 12 avr. 2026 |
| `68e22d2` | feat: menu burger mobile pour la navigation | 13 avr. 2026 |
| `6aebaf7` | Fix Better Auth trusted origins for custom domain support | — |
| `9823bc5` | Add migrate service to docker-compose.prod.yml for database migrations | — |

---

## Analyse de sécurité — par ordre de criticité

### 🔴 CRITIQUE — Corrigé

#### 1. Path Traversal dans le routeur de fichiers uploadés
**Fichier :** `app/routes/uploads-files.ts`  
**Statut :** ✅ **CORRIGÉ dans ce commit**

**Description :** Le paramètre wildcard `params["*"]` de l'URL était directement joint au chemin de base sans aucune validation. Un attaquant pouvait forger une URL de type `/uploads/../../.env` ou `/uploads/../../../etc/passwd` pour lire n'importe quel fichier accessible par le processus Node.js.

**Exemple d'exploitation :**
```
GET /uploads/../../.env
→ Lecture des credentials (DATABASE_URL, AUTH_SECRET, API_FOOTBALL_KEY)
```

**Correction appliquée :**
- Rejet de toute séquence `..` et `\0` dans le paramètre brut
- Vérification que le chemin résolu (`path.resolve`) reste bien sous `uploads/`
- Liste blanche des extensions autorisées (`.webp`, `.jpg`, `.jpeg`, `.png`)

---

### 🟠 HAUTE

#### 2. Mots de passe par défaut faibles en production
**Fichier :** `docker-compose.prod.yml`

**Description :** Les variables d'environnement PostgreSQL et Redis utilisent des valeurs de repli (`:-changeme`) si les variables ne sont pas définies. En cas d'oubli de configuration du `.env`, les services démarrent avec des credentials triviaux.

```yaml
POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-changeme}
redis-server --requirepass ${REDIS_PASSWORD:-changeme}
```

**Recommandation :** Supprimer les valeurs de repli (`:-changeme`) pour forcer un échec explicite si les variables ne sont pas définies :
```yaml
POSTGRES_PASSWORD=${POSTGRES_PASSWORD:?POSTGRES_PASSWORD must be set}
```

---

#### 3. Absence de headers de sécurité HTTP
**Fichier :** aucun fichier de middleware HTTP global trouvé

**Description :** Aucun header de sécurité n'est configuré :
- `Content-Security-Policy` absent → risque XSS aggravé
- `X-Frame-Options` absent → risque de clickjacking
- `Strict-Transport-Security` absent → pas de HSTS en production
- `X-Content-Type-Options` absent

**Recommandation :** Ajouter un middleware Express/React Router qui pose ces headers sur toutes les réponses, ou configurer le reverse proxy (nginx) pour les injecter.

---

### 🟡 MOYENNE

#### 4. Contournement du système de types TypeScript pour les vérifications de rôle
**Fichier :** `app/routes/feed.server.ts` (lignes 99, 124, 184, 200)

**Description :** Le rôle de l'utilisateur est accédé via `(session.user as any).role`, ce qui court-circuite la vérification TypeScript. Si la structure du type `session.user` change, ces vérifications critiques de sécurité ne provoqueront aucune erreur de compilation.

```typescript
// Risqué — TypeScript ne validera pas cela
isAdmin: (session.user as any).role === "admin",
```

**Recommandation :** Étendre le type `Session` de Better Auth pour inclure le champ `role`, ou utiliser `auth-utils.server.ts::requireAuth` avec le paramètre `allowedRoles`.

---

#### 5. Pas d'invalidation de session lors de la suppression de compte
**Fichier :** `app/routes/profile.server.ts`

**Description :** Lors de la suppression du compte (`intent === "delete-account"`), seul l'utilisateur en base est supprimé. Les sessions actives dans Redis (gérées par Better Auth) ne sont pas explicitement invalidées. Si l'utilisateur a plusieurs sessions ouvertes, elles restent valides jusqu'à leur expiration naturelle.

**Recommandation :** Appeler `auth.api.revokeUserSessions` ou équivalent de Better Auth avant la suppression en base.

---

#### 6. Rate limiting absent sur l'upload d'avatars
**Fichier :** `app/routes/profile.server.ts`, `app/lib/server/upload.ts`

**Description :** L'endpoint `update-avatar` n'est pas protégé par le rate limiter Redis disponible dans `rate-limit.server.ts`. Un utilisateur malveillant pourrait envoyer des milliers de fichiers pour saturer le disque ou le CPU (traitement sharp).

**Recommandation :** Appliquer `checkRateLimit` avec une fenêtre raisonnable (ex. 5 uploads par heure par utilisateur) avant l'appel à `processAvatar`.

---

### 🔵 FAIBLE

#### 7. Niveau de log trop verbeux en production possible
**Fichier :** `app/lib/server/logger.server.ts`

**Description :** Le niveau de log est configuré via `LOG_LEVEL` dans `.env`. Si `LOG_LEVEL=debug` est activé par inadvertance en production, des informations sensibles (IDs, payloads) pourraient être exposées dans les logs.

**Recommandation :** S'assurer que `LOG_LEVEL` vaut `warn` ou `error` en production. Idéalement, contraindre la valeur selon `NODE_ENV`.

---

#### 8. Clé API Football non obligatoire mais utilisée sans garde
**Fichier :** `app/config/env.server.ts`, `app/lib/server/api-football.server.ts`

**Description :** `API_FOOTBALL_KEY` est déclarée comme `optional()` dans le schéma de validation, mais son absence génèrerait des erreurs non catchées si la sync est déclenchée par un admin.

**Recommandation :** Vérifier la présence de la clé au début de `syncMatches()` et retourner une erreur explicite plutôt que de laisser l'appel HTTP échouer avec un message cryptique.

---

## Points positifs observés

- ✅ Validation des entrées utilisateur via Zod (pseudo, email, mot de passe, contenu des posts)
- ✅ ORM Drizzle utilisé partout → pas de SQL brut, injection SQL non applicable
- ✅ `requireAuth` systématiquement appelé sur toutes les routes protégées
- ✅ Vérification de rôle admin côté serveur avant toute action administrative
- ✅ Vérification d'ownership avant suppression (posts, commentaires)
- ✅ Credentials exclus du dépôt git (commit `aed5841` + `.gitignore`)
- ✅ Limitation de taille et de type MIME pour les uploads d'avatars
- ✅ Redimensionnement et conversion en WebP via sharp (élimination des métadonnées EXIF)
- ✅ Rate limiter Redis disponible et utilisé sur d'autres routes
- ✅ Better Auth avec stockage de session Redis (invalidation possible)
