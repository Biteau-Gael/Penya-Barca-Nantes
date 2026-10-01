# Rapport d'Analyse de Sécurité — Penya Blaugrana Nantes

> **Généré le :** 2026-10-01  
> **Portée :** Analyse des derniers commits + revue des conventions de sécurité  
> **Branche analysée :** `claude/sharp-fermi-mdzv57` (HEAD : `003faca`)

---

## Résumé des Derniers Commits

| Hash | Date | Description |
|------|------|-------------|
| `003faca` | 2026-04-13 | fix: évaluer les badges immédiatement après chaque action |
| `b1c88f6` | 2026-04-13 | feat: Phase 2 — soirée match live, micro-pronos, badges, séries, saisons |
| `d461ee5` | 2026-04-13 | Merge branch 'claude/deploy-synology-nas-cLkOL' |
| `554b873` | 2026-04-12 | Add deployment guide for Synology NAS updates |
| `68e22d2` | 2026-04-13 | feat: menu burger mobile pour la navigation |
| `6aebaf7` | 2026-04-12 | Fix Better Auth trusted origins for custom domain support |
| `9823bc5` | 2026-04-12 | Add migrate service to docker-compose.prod.yml |
| `aed5841` | 2026-04-12 | **security:** supprimer credentials du repo et renforcer .gitignore |
| `3d80133` | 2026-04-12 | docs: roadmap Phase 2 — 8 priorités documentées |
| `ab7fc5d` | antérieur | feat: intégration API Football + stats enrichies + classement Liga |

---

## Résultats de l'Analyse de Sécurité

### 🔴 CRITIQUE

#### 1. Path Traversal dans le serveur de fichiers uploadés

**Fichier :** `app/routes/uploads-files.ts`

```typescript
const filePath = path.join(process.cwd(), "uploads", params["*"]);
const file = await readFile(filePath);
```

**Problème :** Le paramètre wildcard `params["*"]` est utilisé directement dans `path.join` sans aucune vérification que le chemin final reste bien dans le répertoire `uploads/`. Un attaquant peut envoyer une requête du type `/uploads/../../../etc/passwd` pour lire n'importe quel fichier accessible au processus Node.js.

**Impact :** Lecture de fichiers arbitraires sur le serveur (`.env`, clés privées, fichiers système).

**Correction recommandée :**
```typescript
export async function loader({ params }: { params: { "*": string } }) {
  const requestedPath = params["*"];
  // Normaliser et vérifier que le chemin reste dans uploads/
  const uploadsDir = path.join(process.cwd(), "uploads");
  const filePath = path.resolve(uploadsDir, requestedPath);
  
  if (!filePath.startsWith(uploadsDir + path.sep)) {
    return new Response("Forbidden", { status: 403 });
  }
  // ... suite identique
}
```

---

### 🟠 ÉLEVÉ

#### 2. Mots de passe par défaut faibles en production

**Fichier :** `docker-compose.prod.yml`

```yaml
POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-changeme}
redis-server --requirepass ${REDIS_PASSWORD:-changeme}
```

**Problème :** Si les variables d'environnement ne sont pas définies, les services démarrent avec le mot de passe `changeme`. Une erreur de configuration (`.env` manquant, typo dans le nom de variable) expose silencieusement la base de données et Redis.

**Impact :** Compromission totale de la base de données et du cache (sessions, données utilisateurs).

**Correction recommandée :** Supprimer le fallback `:-changeme` pour forcer une erreur explicite au démarrage si le mot de passe n'est pas configuré, ou utiliser des secrets Docker.

---

#### 3. Dockerfile : exécution en tant que root

**Fichier :** `Dockerfile`

```dockerfile
FROM node:20-alpine
# ... aucun USER défini
CMD ["npm", "run", "start"]
```

**Problème :** L'application s'exécute en tant que `root` à l'intérieur du conteneur. En cas de vulnérabilité d'exécution de code (RCE), l'attaquant obtiendrait les droits root dans le conteneur.

**Impact :** Escalade de privilèges facilitée, contournement potentiel de l'isolation Docker.

**Correction recommandée :**
```dockerfile
FROM node:20-alpine
# ... étapes de build ...
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser
CMD ["npm", "run", "start"]
```

---

### 🟡 MOYEN

#### 4. Validation insuffisante des entrées admin dans les micro-pronos

**Fichier :** `app/routes/api.micro-predictions.ts`

```typescript
const type = (formData.get("type") as string) || "qcm";
// type est inséré directement en base sans vérification de valeur
await db.insert(microPredictions).values({ ..., type, ... }).returning();
```

**Problème :** Le champ `type` est accepté tel quel depuis le formulaire et inséré en base sans vérification qu'il correspond à une valeur attendue (`qcm`, `free`). Les autres champs (`question`, `matchId`) ne sont pas non plus validés avec Zod, contrairement aux autres routes du projet.

**Impact :** Incohérence des données, risque d'injection si le schéma évolue vers des requêtes SQL dynamiques.

**Correction recommandée :** Ajouter un schéma Zod dans `app/lib/validation/` et l'utiliser dans l'action, à l'instar de `createPostSchema` dans `feed.server.ts`.

---

#### 5. Absence de Content Security Policy (CSP) et headers de sécurité HTTP

**Fichier :** `app/root.tsx` (et configuration globale)

**Problème :** Aucune configuration de headers HTTP de sécurité n'a été trouvée (`Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Options`, `Strict-Transport-Security`). React Router / Vite ne les ajoutent pas par défaut.

**Impact :** Exposition aux attaques XSS (même si aucun `dangerouslySetInnerHTML` n'est utilisé), clickjacking, MIME sniffing.

**Correction recommandée :** Ajouter un middleware dans `app/root.tsx` ou via un reverse proxy (nginx) pour positionner ces headers.

---

### 🔵 FAIBLE

#### 6. Rate limiting appliqué uniquement sur `/api/auth/*`

**Fichier :** `app/routes/api.auth.$.ts`

**Observation :** Le rate limiting est bien implémenté et correctement appliqué sur les endpoints d'authentification Better Auth. En revanche, les routes `POST` publiques (création de post, commentaire, réaction) n'ont pas de protection contre les abus répétitifs.

**Impact :** Spam potentiel sur le fil d'actualités si un compte est compromis (mais reste derrière `requireAuth`).

**Recommandation :** À considérer pour les endpoints d'action fréquente (`/api/feed`, `/api/micro-predictions`).

---

#### 7. `APP_URL` optionnel — `trustedOrigins` vide en développement

**Fichier :** `app/lib/server/auth.server.ts`

```typescript
trustedOrigins: env.APP_URL ? [env.APP_URL] : [],
```

**Observation :** Si `APP_URL` n'est pas défini, `trustedOrigins` est un tableau vide. Better Auth utilise alors sa logique par défaut, qui peut accepter des origines inattendues en développement.

**Impact :** Faible en production si `APP_URL` est bien configuré. Risque de CSRF limité en développement local.

**Recommandation :** Documenter clairement la nécessité de définir `APP_URL` en production dans le `.env.example`.

---

## Bonnes Pratiques Confirmées ✅

| Aspect | Statut |
|--------|--------|
| Variables d'environnement validées avec Zod (`env.server.ts`) | ✅ |
| Credentials retirés du repo (commit `aed5841`) | ✅ |
| `.gitignore` couvrant `.env`, `.claude/`, `node_modules/` | ✅ |
| Authentification via Better Auth (sessions Redis) | ✅ |
| Autorisation RBAC sur les routes admin (`requireAuth(request, ["admin"])`) | ✅ |
| ORM Drizzle utilisé (protection injection SQL) | ✅ |
| Validation des fichiers uploadés (type MIME + taille max 2 Mo) | ✅ |
| Rate limiting sur les endpoints d'auth | ✅ |
| Mots de passe hashés via Better Auth | ✅ |
| Pas d'utilisation de `dangerouslySetInnerHTML` ni `eval()` | ✅ |
| Secrets non commités (`.env` en `.gitignore`) | ✅ |

---

## Plan d'Action Prioritaire

| Priorité | Action | Fichier | Effort |
|----------|--------|---------|--------|
| 🔴 P0 | Corriger le path traversal dans le serveur d'uploads | `uploads-files.ts` | 30 min |
| 🟠 P1 | Supprimer les fallbacks `:-changeme` dans docker-compose | `docker-compose.prod.yml` | 15 min |
| 🟠 P1 | Ajouter un utilisateur non-root dans le Dockerfile | `Dockerfile` | 15 min |
| 🟡 P2 | Valider les entrées admin avec Zod dans micro-predictions | `api.micro-predictions.ts` | 1h |
| 🟡 P2 | Ajouter les headers HTTP de sécurité (CSP, X-Frame-Options…) | `root.tsx` ou nginx | 2h |
| 🔵 P3 | Rate limiting sur les routes d'action social | `feed`, `micro-predictions` | 1h |
