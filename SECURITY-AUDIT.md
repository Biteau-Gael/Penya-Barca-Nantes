# Audit de Sécurité — Penya Blaugrana Nantes

> Date de l'analyse : 2026-08-06  
> Branche analysée : `main` (commits jusqu'à `003faca`)  
> Analyste : Claude Code (automatisé)

---

## Résumé des derniers commits

| Hash | Date | Description |
|------|------|-------------|
| `003faca` | 13 avr. 2026 | **fix**: évaluer les badges immédiatement après chaque action (pronos, posts, commentaires, réactions) |
| `b1c88f6` | 13 avr. 2026 | **feat**: Phase 2 — soirée match live, micro-pronos, badges, séries, saisons |
| `d461ee5` | 12 avr. 2026 | Merge `claude/deploy-synology-nas-cLkOL` → main |
| `554b873` | 12 avr. 2026 | **docs**: guide de mise à jour déploiement NAS |
| `68e22d2` | 13 avr. 2026 | **feat**: menu burger mobile pour la navigation |
| `6aebaf7` | 12 avr. 2026 | **fix**: `trustedOrigins` Better Auth pour domaine personnalisé |
| `9823bc5` | 12 avr. 2026 | **feat**: service `migrate` dans docker-compose.prod.yml |
| `8d6e5e9` | 12 avr. 2026 | **feat**: Docker Compose production + script backup Synology |
| `aed5841` | 12 avr. 2026 | **security**: suppression des credentials du repo, renforcement `.gitignore` |
| `6583da3` | 12 avr. 2026 | **docs**: README complet avec guide déploiement NAS |
| `ab7fc5d` | 12 avr. 2026 | **feat**: intégration API Football + stats enrichies + classement Liga |
| `16c43e6` | 11 avr. 2026 | **feat**: MVP Phase 1 — Penya Blaugrana Nantes |

---

## Analyse de sécurité — Classement par criticité

---

### 🔴 CRITIQUE

#### 1. Path Traversal dans le service de fichiers

**Fichier** : `app/routes/uploads-files.ts:5`

```typescript
const filePath = path.join(process.cwd(), "uploads", params["*"]);
```

**Problème** : Le paramètre wildcard (`params["*"]`) provenant de l'URL est utilisé directement dans `path.join` sans vérification que le chemin résultant reste dans le répertoire `uploads/`. Un attaquant peut construire une URL avec `../../.env` ou `../../app/config/env.server.ts` pour lire des fichiers arbitraires sur le serveur.

**Exemple d'attaque** :
```
GET /uploads/../../.env
```

**Correction recommandée** :
```typescript
const uploadsDir = path.join(process.cwd(), "uploads");
const filePath = path.resolve(uploadsDir, params["*"]);

// Vérifier que le chemin reste dans le répertoire autorisé
if (!filePath.startsWith(uploadsDir + path.sep)) {
  return new Response("Accès interdit", { status: 403 });
}
```

---

### 🟠 ÉLEVÉ

#### 2. Mots de passe Docker par défaut en production

**Fichier** : `docker-compose.prod.yml:18,22`

```yaml
POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-changeme}
command: redis-server --requirepass ${REDIS_PASSWORD:-changeme}
```

**Problème** : Si le fichier `.env` de production n'est pas présent ou ne définit pas ces variables, les services démarrent avec le mot de passe `changeme`. Ce mot de passe par défaut est prévisible et trivial à deviner.

**Correction recommandée** : Supprimer les valeurs par défaut et faire échouer le démarrage si les variables ne sont pas définies :
```yaml
POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?POSTGRES_PASSWORD doit être défini}
```

#### 3. Absence d'en-têtes HTTP de sécurité

**Fichier** : Aucun fichier dans `app/`

**Problème** : Aucun en-tête de sécurité HTTP n'est configuré :
- Pas de `Content-Security-Policy` (protection XSS)
- Pas de `X-Frame-Options` (protection clickjacking)
- Pas de `X-Content-Type-Options`
- Pas de `Strict-Transport-Security` (HSTS)
- Pas de `Referrer-Policy`

**Correction recommandée** : Ajouter un middleware dans `app/root.tsx` ou via la configuration React Router :
```typescript
// Dans entry.server.tsx ou un middleware
headers.set("X-Content-Type-Options", "nosniff");
headers.set("X-Frame-Options", "DENY");
headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
headers.set("Content-Security-Policy", "default-src 'self'; ...");
```

---

### 🟡 MOYEN

#### 4. Rate limiting absent sur les endpoints d'action

**Fichiers** : `app/routes/api.micro-predictions.ts`, `app/routes/feed.server.ts`, `app/routes/soiree.server.ts`

**Problème** : Le module `checkRateLimit` existe et est correctement appliqué sur les routes `/api/auth/sign-in` et `/api/auth/sign-up`. Cependant, aucune limitation de taux n'est appliquée sur :
- Soumission de micro-pronostics (`/api/micro-predictions`)
- Publication de posts/commentaires/réactions (`/feed`)
- Actions sur la soirée live

Cela expose ces endpoints à du spam ou à des attaques de type "vote stuffing".

**Correction recommandée** : Appliquer `checkRateLimit` sur les actions utilisateur sensibles, par exemple :
```typescript
await checkRateLimit({ key: `micro-answer:${session.user.id}`, maxAttempts: 20, windowSeconds: 60 });
```

#### 5. Dockerfile exécute l'application en tant que root

**Fichier** : `Dockerfile`

**Problème** : L'image finale ne définit pas d'utilisateur non-root. L'application tourne avec les droits root dans le conteneur, ce qui agrandit la surface d'attaque en cas de compromission applicative.

**Correction recommandée** :
```dockerfile
FROM node:20-alpine
# ... copie des fichiers ...
RUN addgroup -S penya && adduser -S penya -G penya
USER penya
CMD ["npm", "run", "start"]
```

#### 6. Requêtes SQL brutes dans badges.server.ts

**Fichier** : `app/lib/server/badges.server.ts:141-142`

```typescript
.from(sql`"user"`)
.where(sql`id = ${userId}`);
```

**Problème** : L'utilisation du template tag `sql` de Drizzle avec interpolation directe du nom de table contourne la couche ORM et son suivi de schéma. Bien que `userId` provienne d'une session vérifiée (risque faible d'injection), cette pratique est fragile et difficile à maintenir. Le nom de table `"user"` est un mot réservé PostgreSQL, ce qui explique ce contournement, mais il existe une meilleure approche.

**Correction recommandée** : Importer et utiliser directement la table `user` via le schéma Drizzle, ou utiliser `getTableName()` :
```typescript
import { user } from "~/db/schema";
const [userRow] = await db.select({ bestStreak: user.bestStreak })
  .from(user)
  .where(eq(user.id, userId));
```

---

### 🔵 FAIBLE

#### 7. Détection d'IP via header X-Forwarded-For falsifiable

**Fichier** : `app/routes/api.auth.$.ts:5-10`

```typescript
request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
```

**Problème** : Si le reverse proxy ne remplace pas ce header mais l'ajoute simplement, un attaquant peut forger `X-Forwarded-For: 1.2.3.4` pour usurper une IP et contourner le rate limiting par IP.

**Correction recommandée** : S'assurer que le reverse proxy (Nginx, Traefik, etc.) est configuré pour définir `X-Forwarded-For` de manière autoritaire. En production sur NAS Synology, vérifier la configuration du reverse proxy DSM.

#### 8. Dumps de sauvegarde non chiffrés

**Fichier** : `backup.sh`

**Problème** : Les backups PostgreSQL sont stockés en clair (fichiers `.sql`) dans `/volume1/docker/backups/penya`. Si le stockage NAS est compromis ou accessible sans authentification, les données personnelles des membres sont exposées.

**Recommandation** : Chiffrer les backups avec GPG ou similaire :
```bash
docker compose exec -T postgres pg_dump ... | gpg --encrypt --recipient backup@penya > "$BACKUP_DIR/penya_$DATE.sql.gpg"
```

#### 9. Extension de fichier non restreinte dans le service uploads

**Fichier** : `app/routes/uploads-files.ts:14`

**Problème** : Les types MIME non reconnus sont servis avec `application/octet-stream` au lieu d'un refus. Combiné avec la vulnérabilité de path traversal (point 1), un fichier avec une extension inhabituelle pourrait être servi.

**Correction recommandée** : Rejeter toute extension non reconnue :
```typescript
const contentType = mimeTypes[ext];
if (!contentType) {
  return new Response("Type de fichier non autorisé", { status: 403 });
}
```

---

## Points positifs identifiés

| Domaine | Statut |
|---------|--------|
| Credentials retirés du repo (`aed5841`) | ✅ Corrigé |
| `.gitignore` couvre `.env`, `.claude/`, `node_modules` | ✅ Bon |
| Validation Zod sur les inputs utilisateur (posts, commentaires, prédictions) | ✅ Présent |
| Rate limiting sur login/register | ✅ Présent |
| Logger structuré Pino (pas de `console.log`) | ✅ Bon |
| Authentification via `requireAuth` sur toutes les routes protégées | ✅ Présent |
| Contrôle de rôle admin/member sur les actions sensibles | ✅ Présent |
| Vérification anti-double réponse (micro-pronos) | ✅ Présent |
| Validation env au démarrage avec Zod (`getEnv()`) | ✅ Présent |
| Vérification propriétaire avant suppression post/commentaire | ✅ Présent |
| Uploads avatars limités à 2 Mo et aux formats image | ✅ Présent |

---

## Priorité d'action recommandée

1. **Immédiat** — Corriger le path traversal dans `uploads-files.ts` (risque critique, correction simple)
2. **Court terme** — Ajouter les en-têtes HTTP de sécurité
3. **Court terme** — Corriger les mots de passe Docker par défaut
4. **Moyen terme** — Appliquer le rate limiting sur les endpoints d'action
5. **Moyen terme** — Ajouter un utilisateur non-root au Dockerfile
6. **Moyen terme** — Refactoriser les requêtes SQL brutes dans badges.server.ts
