# Audit de Sécurité — Penya Blaugrana Nantes

**Date** : 2026-09-26  
**Branche analysée** : `main` (commits jusqu'à `003faca`)  
**Périmètre** : Code source, configuration Docker, scripts de déploiement

---

## Résumé des derniers commits analysés

| SHA | Description |
|-----|-------------|
| `003faca` | fix: évaluer les badges immédiatement après chaque action |
| `b1c88f6` | feat: Phase 2 — soirée match live, micro-pronos, badges, séries, saisons |
| `d461ee5` | Merge branch 'claude/deploy-synology-nas-cLkOL' |
| `68e22d2` | feat: menu burger mobile pour la navigation |
| `aed5841` | **security**: supprimer credentials du repo et renforcer .gitignore |
| `8d6e5e9` | Add production Docker Compose and backup script for Synology NAS deployment |
| `ab7fc5d` | feat: intégration API Football + stats enrichies + classement Liga |
| `16c43e6` | feat: MVP Phase 1 — Penya Blaugrana Nantes |

---

## Résultats par ordre de criticité

---

### 🔴 CRITIQUE — Path Traversal sur la route `/uploads/*`

**Fichier** : `app/routes/uploads-files.ts`

**Description** : Le chemin de fichier est construit directement depuis le paramètre de route sans vérification des séquences `../`. Un attaquant authentifié ou non peut lire n'importe quel fichier du système de fichiers du conteneur.

```typescript
// Code vulnérable actuel
const filePath = path.join(process.cwd(), "uploads", params["*"]);
// Requête : GET /uploads/../../app/config/env.server.ts
// Résolution : /home/user/Penya-Barca-Nantes/app/config/env.server.ts ✗
```

**Correctif recommandé** :

```typescript
export async function loader({ params }: { params: { "*": string } }) {
  const UPLOAD_BASE = path.resolve(process.cwd(), "uploads");
  const filePath = path.resolve(UPLOAD_BASE, params["*"]);

  // Bloquer toute sortie du répertoire uploads/
  if (!filePath.startsWith(UPLOAD_BASE + path.sep)) {
    return new Response("Forbidden", { status: 403 });
  }

  // Vérifier l'extension autorisée
  const ext = path.extname(filePath).toLowerCase();
  const ALLOWED_EXTS = [".webp", ".jpg", ".jpeg", ".png"];
  if (!ALLOWED_EXTS.includes(ext)) {
    return new Response("Forbidden", { status: 403 });
  }
  // ... reste du code
}
```

---

### 🔴 CRITIQUE — Credentials dans l'historique Git

**Commit** : `aed5841` (suppression), mais les données restent accessibles via `git log`

**Description** : Avant le commit de sécurité `aed5841`, des credentials réels/faibles étaient présents dans le dépôt :
- `DATABASE_URL=postgresql://penya:penya_secret@...` dans `.env.example`
- `AUTH_SECRET=change-me-in-production-min-16-chars` dans `.env.example`
- Credentials en dur dans `docker-compose.yml` et `docker-compose.dev.yml`
- `settings.local.json` Claude tracké avec potentiellement des clés API

Ces données restent accessibles via `git show aed5841^` ou `git log -p`. Si le dépôt a été poussé sur GitHub avant la suppression, elles sont potentiellement indexées.

**Actions recommandées** :
1. Faire pivoter immédiatement les clés `AUTH_SECRET`, `API_FOOTBALL_KEY` et mots de passe DB si les valeurs supprimées étaient utilisées en production.
2. Pour purger l'historique Git : utiliser `git filter-repo` ou contacter GitHub pour supprimer les commits historiques si nécessaire.
3. Vérifier qu'aucun autre secret n'est présent via `git log -p --all | grep -E "(password|secret|key|token).*=.*[a-zA-Z0-9]{8,}"`.

---

### 🟠 ÉLEVÉ — Mots de passe Docker par défaut en production

**Fichiers** : `docker-compose.yml`, `docker-compose.prod.yml`

**Description** : Les deux fichiers Docker Compose utilisent `changeme` comme valeur de repli :

```yaml
POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-changeme}
redis-server --requirepass ${REDIS_PASSWORD:-changeme}
```

Si le fichier `.env` est absent ou incomplet au démarrage, les services démarrent avec des mots de passe triviaux.

**Correctif recommandé** : Supprimer les valeurs de repli pour forcer une erreur explicite plutôt qu'un démarrage silencieux avec des credentials faibles :

```yaml
POSTGRES_PASSWORD=${POSTGRES_PASSWORD:?POSTGRES_PASSWORD must be set}
```

---

### 🟠 ÉLEVÉ — Absence de headers de sécurité HTTP (nginx)

**Fichier** : `docker/nginx/nginx.conf`

**Description** : La configuration nginx ne définit aucun en-tête de sécurité. En l'absence de ces headers, le navigateur applique des comportements permissifs par défaut.

En-têtes manquants :
- `X-Content-Type-Options: nosniff` — protection contre le MIME sniffing
- `X-Frame-Options: DENY` — protection contre le clickjacking
- `Strict-Transport-Security` — force HTTPS
- `Content-Security-Policy` — contrôle les ressources chargées
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy`

**Correctif recommandé** : Ajouter dans le bloc `server` de nginx :

```nginx
add_header X-Content-Type-Options "nosniff" always;
add_header X-Frame-Options "DENY" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;
# En production derrière HTTPS :
# add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
```

---

### 🟠 ÉLEVÉ — Absence de HTTPS dans nginx (production)

**Fichier** : `docker/nginx/nginx.conf`

**Description** : La configuration nginx n'écoute que sur le port 80 (HTTP). Même si Synology NAS gère le reverse proxy HTTPS, le fichier inclus dans le dépôt ne documente ni ne configure le chiffrement TLS.

**Correctif recommandé** : La documentation `DEPLOY.md` devrait explicitement indiquer que le NAS Synology doit être configuré avec HTTPS + Let's Encrypt, et que le port 80 doit rediriger vers 443. À minima, ajouter une note dans le fichier `DEPLOY.md`.

---

### 🟡 MOYEN — Absence de rate limiting sur l'API micro-pronostics

**Fichier** : `app/routes/api.micro-predictions.ts`

**Description** : Contrairement à la route d'authentification (`app/routes/api.auth.$.ts`) qui implémente correctement un rate limiting via Redis, la route de soumission de micro-pronostics ne dispose d'aucune limitation. Un utilisateur malveillant pourrait générer du bruit dans les logs ou tenter une exploitation.

**Correctif recommandé** :

```typescript
import { checkRateLimit } from "~/lib/server/rate-limit.server";
// Au début de la fonction action :
const ip = request.headers.get("x-forwarded-for") ?? "unknown";
await checkRateLimit(`micro-prediction:${session.user.id}`, 20, 60); // 20 req/min
```

---

### 🟡 MOYEN — Validation insuffisante des paramètres numériques admin

**Fichier** : `app/routes/api.micro-predictions.ts` (ligne 23-24)

**Description** : Les champs `pointsValue` et `deadlineSeconds` sont parsés sans vérification de plage :

```typescript
const pointsValue = parseInt(formData.get("pointsValue") as string) || 1;
const deadlineSeconds = parseInt(formData.get("deadlineSeconds") as string) || 120;
```

Un admin pourrait (par erreur) créer un micro-pronostic avec des valeurs négatives ou extrêmement grandes.

**Correctif recommandé** : Ajouter une validation de plage :

```typescript
const pointsValue = Math.max(1, Math.min(100, parseInt(formData.get("pointsValue") as string) || 1));
const deadlineSeconds = Math.max(10, Math.min(3600, parseInt(formData.get("deadlineSeconds") as string) || 120));
```

---

### 🟡 MOYEN — Backups en clair sans restriction de permissions

**Fichier** : `backup.sh`

**Description** : Les dumps PostgreSQL sont stockés en texte clair dans `/volume1/docker/backups/penya/`. Les fichiers `.sql` contiennent l'intégralité de la base de données (utilisateurs, tokens de session, pronostics).

**Correctif recommandé** :
1. Chiffrer les dumps avec GPG ou openssl avant stockage.
2. Restreindre les permissions du répertoire de backup (`chmod 700`).
3. Envisager une rétention chiffrée ou un stockage offsite.

---

### 🟢 INFO — Bonnes pratiques confirmées

Les points suivants sont correctement implémentés :

- **Authentification** : `requireAuth()` utilisé systématiquement sur les routes protégées (`soiree.server.ts`, `feed.server.ts`, `api.micro-predictions.ts`)
- **Autorisation admin** : Vérification `session.user.role === "admin"` sur toutes les actions d'administration
- **ORM Drizzle** : Requêtes paramétrées via Drizzle, pas de SQL dynamique brut → protection contre l'injection SQL
- **Validation des entrées** : Schémas Zod pour les formulaires principaux (`createPostSchema`, `createCommentSchema`, `predictionSchema`)
- **Upload sécurisé** : `processAvatar()` valide le type MIME, la taille (2 Mo max) et convertit en WebP avec sharp
- **Rate limiting auth** : Présent et fonctionnel sur `/api/auth/*`
- **Variables d'environnement** : `.env` dans `.gitignore`, `.env.example` avec placeholders
- **Protection double-soumission** : Vérification d'existence avant insert dans les micro-pronostics

---

## Récapitulatif

| Criticité | Nombre | Items |
|-----------|--------|-------|
| 🔴 Critique | 2 | Path traversal, credentials en historique Git |
| 🟠 Élevé | 3 | Mots de passe Docker fallback, headers HTTP manquants, HTTPS absent |
| 🟡 Moyen | 3 | Rate limiting API, validation numérique, backups en clair |
| 🟢 Info | 8 | Bonnes pratiques confirmées |

**Action prioritaire** : corriger la vulnérabilité de path traversal dans `app/routes/uploads-files.ts` avant tout déploiement en production.
