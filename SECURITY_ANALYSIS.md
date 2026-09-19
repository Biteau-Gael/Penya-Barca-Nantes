# Analyse de sécurité — Penya Blaugrana Nantes

> Générée le 19/09/2026 — branche `claude/sharp-fermi-y26159`

---

## 1. Résumé des derniers commits

| Commit | Date | Message |
|--------|------|---------|
| `003faca` | 13/04/2026 | fix: évaluer les badges immédiatement après chaque action |
| `b1c88f6` | 13/04/2026 | feat: Phase 2 — soirée match live, micro-pronos, badges, séries, saisons |
| `d461ee5` | 12/04/2026 | Merge branch 'claude/deploy-synology-nas-cLkOL' |
| `554b873` | 12/04/2026 | Add deployment guide for Synology NAS updates |
| `68e22d2` | 13/04/2026 | feat: menu burger mobile pour la navigation |
| `6aebaf7` | 12/04/2026 | Fix Better Auth trusted origins for custom domain support |
| `9823bc5` | 12/04/2026 | Add migrate service to docker-compose.prod.yml for database migrations |

### Points notables

- **Phase 2** est le commit le plus volumineux (+2 965 lignes) : il introduit la soirée match live, les micro-pronostics, les badges, les séries et la gestion des saisons. La surface d'attaque augmente proportionnellement.
- Le commit `fix: évaluer les badges` complète la Phase 2 en déclenchant le calcul de badges depuis les routes `feed` et `match-detail` (appel asynchrone non bloquant).
- `Fix Better Auth trusted origins` corrige un problème de CORS en production liée aux origines de confiance.

---

## 2. Analyse de sécurité par ordre de criticité

### 🔴 CRITIQUE — Path Traversal sur le endpoint de fichiers uploadés

**Fichier :** `app/routes/uploads-files.ts`  
**Statut :** **CORRIGÉ** dans ce commit

**Description :** Le chemin du fichier était construit depuis le paramètre URL `params["*"]` sans vérification que le chemin résolu restait dans le dossier `uploads/`. Une requête `/uploads/../.env` ou `/uploads/../../../etc/passwd` permettait de lire n'importe quel fichier accessible au processus Node.

```
// Avant (vulnérable)
const filePath = path.join(process.cwd(), "uploads", params["*"]);
// aucune vérification que filePath est sous uploads/
```

**Correction appliquée :** Vérification que `filePath` commence bien par `UPLOADS_DIR + path.sep` avant toute lecture.

---

### 🟠 ÉLEVÉ — Absence de Security Headers HTTP

**Fichiers :** `vite.config.ts`, `react-router.config.ts`  
**Statut :** Non corrigé

**Description :** Aucun en-tête de sécurité HTTP n'est configuré :
- `Content-Security-Policy` absent → risque XSS
- `X-Frame-Options` absent → risque clickjacking
- `X-Content-Type-Options` absent → risque MIME sniffing
- `Referrer-Policy` absent → fuite d'URL en referer

**Recommandation :** Ajouter un middleware dans le gestionnaire de requêtes React Router ou configurer un reverse-proxy (nginx) pour injecter ces en-têtes. Exemple minimal :

```ts
// dans react-router.config.ts ou un middleware express
res.setHeader("X-Frame-Options", "DENY");
res.setHeader("X-Content-Type-Options", "nosniff");
res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
res.setHeader("Content-Security-Policy", "default-src 'self'; ...");
```

---

### 🟠 ÉLEVÉ — Rate Limiting absent sur les actions du fil et des micro-pronos

**Fichiers :** `app/routes/feed.server.ts`, `app/routes/api.micro-predictions.ts`  
**Statut :** Non corrigé

**Description :** Les endpoints `/feed` (créer post, commenter, réagir) et `/api/micro-predictions` (répondre) n'appliquent aucune limitation de débit. Un attaquant authentifié peut spammer des posts, des commentaires ou des réponses à toute vitesse.

La protection existe uniquement sur `/api/auth` (login/register) via `checkRateLimit`.

**Recommandation :** Appliquer `checkRateLimit` dans les actions concernées :

```ts
// exemple dans feedAction
await checkRateLimit({
  key: `feed:post:${session.user.id}`,
  maxAttempts: 10,
  windowSeconds: 60,
});
```

---

### 🟡 MODÉRÉ — Mot de passe PostgreSQL par défaut en production

**Fichier :** `docker-compose.prod.yml` (ligne `POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-changeme}`)  
**Statut :** Non corrigé

**Description :** Si la variable d'environnement `POSTGRES_PASSWORD` n'est pas définie au démarrage, Docker utilise la valeur `changeme` comme mot de passe PostgreSQL. Un oubli lors du déploiement expose la base de données.

**Recommandation :** Supprimer la valeur par défaut pour forcer l'obligation de la définir :

```yaml
POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}
```

Même correction pour `REDIS_PASSWORD`.

---

### 🟡 MODÉRÉ — Accès `process.env` hors de la configuration centralisée

**Fichiers :** `app/lib/server/logger.server.ts`, `app/lib/server/redis.server.ts`, `app/db/client.ts`  
**Statut :** Non corrigé

**Description :** Ces trois fichiers accèdent directement à `process.env` sans passer par `getEnv()` de `app/config/env.server.ts`, contournant ainsi la validation Zod et les valeurs par défaut centralisées. En cas d'erreur de configuration, l'application démarrera avec une configuration incomplète sans avertissement clair.

**Recommandation :** Migrer ces accès vers `getEnv()`.

---

### 🔵 INFO — Health endpoint public

**Fichier :** `app/routes/api.health.ts`  
**Statut :** Acceptable, à documenter

**Description :** L'endpoint `/api/health` est accessible sans authentification et révèle l'état des services internes (DB, Redis). C'est une pratique courante pour les checks de monitoring, mais il convient de s'assurer que :
1. L'endpoint est seulement accessible depuis le réseau interne ou le load balancer, pas depuis Internet.
2. Le `status 503` est bien retourné en cas de dégradation (c'est déjà le cas).

---

## 3. Points conformes aux bonnes pratiques

| Pratique | Statut |
|----------|--------|
| Authentification via Better Auth (sessions DB + Redis) | ✅ |
| Protection des routes admin avec `requireAuth(request, ["admin"])` | ✅ |
| Validation des entrées utilisateur avec Zod | ✅ (feed, env) |
| Rate limiting sur login/register | ✅ |
| Requêtes SQL via ORM paramétré (Drizzle) — pas d'injection SQL | ✅ |
| Secrets hors du dépôt — `.env` dans `.gitignore`, `.env.example` fourni | ✅ |
| Upload d'avatar avec vérification MIME et resize (sharp) | ✅ |
| Logs structurés avec pino (sans données sensibles apparentes) | ✅ |
| Rôle lu depuis la DB à chaque requête (`root.tsx`) | ✅ |
| Vérification du propriétaire avant suppression post/commentaire | ✅ |

---

## 4. Actions prioritaires

1. **[FAIT]** Corriger le path traversal sur `/uploads/*`
2. Ajouter les Security Headers HTTP (CSP, X-Frame-Options, etc.)
3. Appliquer `checkRateLimit` sur les actions du feed et des micro-pronos
4. Supprimer les valeurs par défaut faibles dans `docker-compose.prod.yml`
5. Centraliser tous les accès `process.env` via `getEnv()`
