# Audit de Sécurité — Penya Blaugrana Nantes
> Généré automatiquement le 2026-10-20 | Branche : `claude/sharp-fermi-vzo41a`

---

## Résumé des derniers commits analysés

| Commit | Auteur | Description |
|--------|--------|-------------|
| `003faca` | Biteau Gaël + Claude | fix: évaluer les badges immédiatement après chaque action |
| `b1c88f6` | Biteau Gaël + Claude | feat: Phase 2 — soirée match live, micro-pronos, badges, séries, saisons |
| `d461ee5` | Claude | Merge branch deploy-synology-nas |
| `554b873` | Claude | Add deployment guide for Synology NAS updates |
| `68e22d2` | Biteau Gaël + Claude | feat: menu burger mobile pour la navigation |
| `6aebaf7` | Claude | Fix Better Auth trusted origins for custom domain support |
| `9823bc5` | Claude | Add migrate service to docker-compose.prod.yml |
| `aed5841` | Biteau Gaël + Claude | **security: supprimer credentials du repo et renforcer .gitignore** |

---

## Analyse de Sécurité — Résultats par Criticité

---

### 🔴 CRITIQUE — [CORRIGÉ dans ce commit]

#### C-1 · Path Traversal dans la route de fichiers uploadés

**Fichier :** `app/routes/uploads-files.ts`

**Problème :** L'ancienne implémentation utilisait `path.join()` sans valider que le chemin résolu restait dans le dossier `uploads/`. Un attaquant authentifié ou anonyme pouvait lire **n'importe quel fichier du serveur** en manipulant l'URL.

```
GET /uploads/avatars/../../.env
→ /home/user/Penya-Barca-Nantes/.env  (DATABASE_URL, AUTH_SECRET, API_FOOTBALL_KEY)

GET /uploads/../../../../etc/passwd
→ /etc/passwd
```

**Impact :** Exposition de `DATABASE_URL`, `AUTH_SECRET`, `API_FOOTBALL_KEY` contenus dans `.env`. Compromission totale de l'application possible (escalade de privilèges, accès base de données).

**Correctif appliqué :**

```typescript
const UPLOADS_DIR = path.resolve(process.cwd(), "uploads");
const filePath = path.resolve(UPLOADS_DIR, params["*"]);

if (!filePath.startsWith(UPLOADS_DIR + path.sep) && filePath !== UPLOADS_DIR) {
  return new Response("Not found", { status: 404 });
}
```

`path.resolve()` normalise les séquences `../` avant la vérification du préfixe. Tous les chemins hors de `uploads/` retournent désormais un 404.

---

### 🟠 ÉLEVÉ

#### H-1 · Absence de rate-limiting sur les routes métier critiques

**Fichiers :** `app/routes/api.micro-predictions.ts`, `app/routes/soiree.server.ts`, `app/routes/feed.server.ts`

**Problème :** La fonction `checkRateLimit()` existe (`app/lib/server/rate-limit.server.ts`) et est utilisée sur les routes d'authentification (`api.auth.$.ts`), mais elle n'est **pas appliquée** sur :
- La soumission de micro-pronostics (un utilisateur pourrait spammer des réponses)
- La publication de posts/commentaires dans le feed
- La synchronisation des matchs via API Football (route admin, mais non limitée)

**Recommandation :**
```typescript
// Exemple pour api.micro-predictions.ts — intent "answer"
await checkRateLimit({
  key: `micro-pred:${session.user.id}:${microId}`,
  maxAttempts: 3,
  windowSeconds: 60,
});
```

**Priorité :** À implémenter avant mise en production. Risque de déni de service applicatif et d'abus de points/badges.

---

#### H-2 · Ports base de données exposés dans docker-compose.yml (dev)

**Fichier :** `docker-compose.yml`

**Problème :** Le fichier de composition par défaut expose les ports `5432` (PostgreSQL) et `6379` (Redis) sur `0.0.0.0`. En développement sur un NAS accessible depuis le LAN, ces services sont joignables sans authentification réseau.

```yaml
postgres:
  ports:
    - "5432:5432"   # accessible depuis le LAN
redis:
  ports:
    - "6379:6379"   # pas de mot de passe en mode dev
```

**Recommandation :** Lier sur `127.0.0.1` en dev ou utiliser un réseau Docker interne :
```yaml
postgres:
  ports:
    - "127.0.0.1:5432:5432"
```

Le fichier `docker-compose.prod.yml` ne ré-expose pas ces ports — bonne pratique.

---

### 🟡 MOYEN

#### M-1 · SQL brut sur la table `user` dans badges.server.ts

**Fichier :** `app/lib/server/badges.server.ts` (lignes 141-142)

**Problème :** Le code utilise des fragments SQL bruts plutôt que la référence Drizzle ORM :
```typescript
.from(sql`"user"`)
.where(sql`id = ${userId}`)
```

Bien que `userId` provienne de la session (valeur de confiance), l'usage de `sql\`\`` contourne les protections du type-system de Drizzle et ouvre la porte à des erreurs futures si la logique est réutilisée avec une entrée non validée.

**Recommandation :** Utiliser la référence de table Drizzle directement :
```typescript
import { user } from "~/db/schema";
.from(user)
.where(eq(user.id, userId))
```

---

#### M-2 · Container Docker exécuté en root

**Fichier :** `Dockerfile`

**Problème :** Le Dockerfile ne spécifie pas d'utilisateur non-root. L'application tourne en tant que `root` dans le container.

**Recommandation :** Ajouter avant `CMD` :
```dockerfile
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser
```

---

### 🔵 FAIBLE / INFORMATIF

#### I-1 · Absence de headers de sécurité HTTP

Aucun en-tête de sécurité n'est configuré (ni dans l'app, ni dans le nginx de développement) :
- `Content-Security-Policy` — protection XSS
- `X-Frame-Options: DENY` — protection clickjacking
- `X-Content-Type-Options: nosniff`
- `Strict-Transport-Security` (HTTPS uniquement)

**Recommandation :** Ajouter ces headers dans `docker/nginx/nginx.conf` ou dans un middleware React Router.

---

#### I-2 · Clé API Football exposable dans les logs d'erreur

**Fichier :** `app/routes/soiree.server.ts`

Les appels API font un `logger.error({ error, externalFixtureId }, ...)`. Si l'objet `error` contient la requête HTTP sortante (certains frameworks exposent l'URL avec la clé dans les erreurs réseau), la clé API pourrait apparaître dans les logs. À vérifier au niveau du logger Pino.

---

## Points Positifs Constatés

| Contrôle | État |
|----------|------|
| Credentials retirés du repo (commit `aed5841`) | ✅ |
| `.env` et `.claude/` dans `.gitignore` | ✅ |
| Validation des variables d'environnement avec Zod | ✅ |
| Contrôle d'accès rôle (`requireAuth`, `["admin"]`) sur toutes les routes sensibles | ✅ |
| Rate limiting sur les routes d'authentification | ✅ |
| Validation des types de fichiers uploadés (MIME + sharp retraitement) | ✅ |
| ORM Drizzle (requêtes paramétrées par défaut — pas d'injection SQL) | ✅ |
| Pas de `dangerouslySetInnerHTML` ni `eval()` dans le code React | ✅ |
| Better Auth avec session Redis et origines de confiance configurées | ✅ |
| Protection anti-auto-suppression de rôle admin | ✅ |

---

## Actions Recommandées (par priorité)

1. **[FAIT]** Corriger la path traversal dans `uploads-files.ts`
2. **[TODO]** Ajouter `checkRateLimit` sur micro-predictions et feed
3. **[TODO]** Lier PostgreSQL/Redis sur `127.0.0.1` dans `docker-compose.yml` (dev)
4. **[TODO]** Remplacer le `sql\`\`` brut dans `badges.server.ts` par les références Drizzle
5. **[TODO]** Ajouter un utilisateur non-root dans le `Dockerfile`
6. **[TODO]** Configurer les headers de sécurité HTTP dans nginx

---

*Document généré par analyse automatisée — vérifier les TODOs en sprint suivant.*
