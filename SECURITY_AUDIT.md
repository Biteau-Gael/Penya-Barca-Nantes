# Audit de sécurité — Penya Barca Nantes

**Date :** 19 avril 2026  
**Branche analysée :** `main` (commits jusqu'à `003faca`)  
**Analysé par :** Claude Code (claude-sonnet-4-6)

---

## Résumé des derniers commits

| Hash | Date | Auteur | Description |
|------|------|--------|-------------|
| `003faca` | 2026-04-13 | Biteau Gaël | fix: évaluer les badges immédiatement après chaque action |
| `b1c88f6` | 2026-04-13 | Biteau Gaël | feat: Phase 2 — soirée match live, micro-pronos, badges, séries, saisons |
| `d461ee5` | 2026-04-12 | Claude | Merge branch 'claude/deploy-synology-nas-cLkOL' |
| `554b873` | 2026-04-12 | Claude | Add deployment guide for Synology NAS updates |
| `68e22d2` | 2026-04-13 | Biteau Gaël | feat: menu burger mobile pour la navigation |
| `6aebaf7` | 2026-04-12 | Claude | Fix Better Auth trusted origins for custom domain support |
| `9823bc5` | 2026-04-12 | Claude | Add migrate service to docker-compose.prod.yml |
| `8d6e5e9` | 2026-04-12 | Claude | Add production Docker Compose and backup script for Synology NAS |

### Périmètre de la Phase 2 (commit `b1c88f6`)

Le commit majeur introduit :
- **Route `/soiree/:matchId`** — page live avec polling score toutes les 60 s
- **Micro-pronostics** — création/vote/clôture admin, attribution de points auto
- **Séries (streaks)** — `currentStreak` / `bestStreak` avec récompenses aux paliers 3/5/10
- **Badges** — 10 badges de base, évaluation automatique, page `/badges`
- **Saisons** — table `seasons`, filtre classement par saison
- **Migration DB 0007** — 6 nouvelles tables, colonnes sur `user` et `matches`

---

## Analyse de sécurité — Résultats par criticité

---

### 🔴 CRITIQUE

#### 1. Path Traversal dans le serveur de fichiers uploadés

**Fichier :** `app/routes/uploads-files.ts:5`

```ts
const filePath = path.join(process.cwd(), "uploads", params["*"]);
```

Le paramètre wildcard de la route est concaténé directement dans le chemin du fichier **sans vérification de containment**. Un attaquant peut forger une URL du type :

```
GET /uploads/../../.env
GET /uploads/../../etc/passwd
```

`path.join` résout les `../` et la lecture peut sortir du répertoire `uploads/`, permettant la lecture de **n'importe quel fichier accessible par le processus Node** (variables d'environnement, code source, etc.).

**Correction recommandée :**

```ts
export async function loader({ params }: { params: { "*": string } }) {
  const uploadsDir = path.resolve(process.cwd(), "uploads");
  const filePath = path.resolve(uploadsDir, params["*"]);

  // Vérifier que le chemin résolu est bien dans uploads/
  if (!filePath.startsWith(uploadsDir + path.sep)) {
    return new Response("Forbidden", { status: 403 });
  }
  // ... reste inchangé
}
```

---

#### 2. Absence de protection CSRF sur les actions à effet de bord

**Fichiers concernés :** tous les handlers `action` (`admin.members.server.ts`, `profile.server.ts`, `feed.server.ts`, `api.micro-predictions.ts`, etc.)

Tous les formulaires React Router utilisent `formData.get("intent")` pour déclencher des actions (suppression de membre, changement de rôle, suppression de post, etc.) sans valider de token CSRF. React Router ne protège pas automatiquement contre les CSRF.

Un attaquant peut créer une page externe qui soumet un formulaire silencieux vers l'application, déclenchant des actions au nom d'un utilisateur connecté.

**Correction recommandée :** Utiliser un token CSRF généré par session et vérifié côté serveur sur chaque action (ex. `csrf` package ou implémentation via Better Auth).

---

#### 3. IDOR sur les profils membres (accès non autorisé aux données d'autrui)

**Fichier :** `app/routes/member-profile.server.ts`

La route `/membres/:memberId` charge le profil de n'importe quel membre en se basant uniquement sur l'ID dans l'URL, sans vérifier si l'utilisateur connecté a le droit de voir ce profil. N'importe quel membre authentifié peut parcourir les profils de tous les autres en itérant sur les IDs.

**Correction recommandée :** Vérifier que l'accès est réservé à l'admin ou à l'utilisateur lui-même, ou accepter explicitement que les profils sont publics (et ne pas y exposer de données sensibles).

---

#### 4. Endpoint de fichiers uploadés accessible sans authentification

**Fichier :** `app/routes/uploads-files.ts`

La route `/uploads/*` sert les fichiers sans aucune vérification d'authentification. Les avatars de tous les utilisateurs sont accessibles publiquement.

**Correction recommandée :** Ajouter `getSession(request)` et retourner 401 si la session est absente, ou accepter explicitement que les avatars sont publics (ce qui est généralement acceptable).

---

### 🟠 ÉLEVÉ

#### 5. Fuite de la réponse correcte des micro-pronostics encore ouverts

**Fichier :** `app/routes/soiree.server.ts:253`

```ts
correctAnswer: m.correctAnswer,  // retourné même si closedAt est null
```

Le champ `correctAnswer` est retourné dans la réponse JSON pour **tous** les micro-pronostics, y compris ceux encore ouverts. N'importe quel utilisateur connecté peut lire la bonne réponse via les DevTools et voter en conséquence.

**Correction recommandée :**

```ts
correctAnswer: m.closedAt ? m.correctAnswer : null,
```

---

#### 6. Absence de rate limiting sur les endpoints sensibles

**Fichiers concernés :** `api.auth.$.ts`, `api.micro-predictions.ts`, `feed.server.ts`, `match-detail.server.ts`

Aucun mécanisme de limitation de débit n'est implémenté sur les routes critiques. Cela expose l'application à :

- Brute-force des mots de passe sur `/api/auth/sign-in`
- Spam de pronostics, posts, commentaires
- Enumération de ressources (matchs, profils)

**Correction recommandée :** Implémenter `rate-limiter-flexible` avec Redis sur les routes d'authentification et d'action.

---

#### 7. Endpoint `/api/health` accessible sans authentification

**Fichier :** `app/routes/api.health.ts:11`

La route `GET /api/health` révèle l'état opérationnel de l'infrastructure (PostgreSQL up/down, Redis up/down) à tout visiteur non authentifié. Ces informations facilitent les attaques en ciblant les fenêtres de maintenance.

**Correction recommandée :** Restreindre par IP via Nginx, ou conditionner les détails au rôle admin.

---

#### 8. Absence de headers de sécurité HTTP

Aucun header de sécurité n'est configuré ni dans l'application ni dans le reverse proxy :

| Header | Risque si absent |
|--------|-----------------|
| `Content-Security-Policy` | XSS, injection de scripts |
| `X-Frame-Options` | Clickjacking |
| `X-Content-Type-Options` | MIME sniffing |
| `Strict-Transport-Security` | Downgrade HTTPS → HTTP |
| `Referrer-Policy` | Fuite d'URL dans les requêtes |

**Correction recommandée :** Configurer ces headers dans Nginx ou via un middleware React Router dans `entry.server.tsx`.

---

#### 9. Race condition dans la soumission de micro-pronostics

**Fichier :** `app/routes/api.micro-predictions.ts:109-128`

```ts
const [existing] = await db.select()...where(...);  // check
if (existing) return error;
await db.insert(microPredictionAnswers).values({...});  // insert
```

Entre le `SELECT` de vérification et le `INSERT`, une deuxième requête concurrente peut s'intercaler, insérant une réponse en double et attribuant des points deux fois.

**Correction recommandée :** Utiliser une contrainte d'unicité en base (`UNIQUE(microPredictionId, userId)`) et/ou une transaction avec `FOR UPDATE`.

---

### 🟡 MOYEN

#### 10. Mots de passe fallback "changeme" en production

**Fichier :** `docker-compose.prod.yml:24,33`

```yaml
POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-changeme}
redis-server --requirepass ${REDIS_PASSWORD:-changeme}
```

Si les variables ne sont pas définies dans `.env`, les mots de passe `changeme` sont appliqués silencieusement en production.

**Correction recommandée :**

```yaml
POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?POSTGRES_PASSWORD must be set}
```

---

#### 11. Mot de passe Redis exposé dans la commande healthcheck

**Fichier :** `docker-compose.prod.yml:34`

```yaml
test: ["CMD", "redis-cli", "-a", "${REDIS_PASSWORD:-changeme}", "ping"]
```

Le mot de passe Redis apparaît en clair dans la commande healthcheck, visible via `docker inspect <container>` et les logs Docker.

**Correction recommandée :**

```yaml
test: ["CMD-SHELL", "redis-cli ping"]
environment:
  - REDISCLI_AUTH=${REDIS_PASSWORD}
```

---

#### 12. Validation du type MIME côté client pour les uploads

**Fichier :** `app/lib/server/upload.ts:13`

```ts
if (!ALLOWED_TYPES.includes(file.type)) {
```

`file.type` est contrôlé par le navigateur et peut être falsifié. Sharp échouera à traiter un fichier non-image (protection implicite), mais cette défense est non documentée et peut changer.

**Correction recommandée :** Utiliser le package `file-type` pour détecter le type réel par magic bytes :

```ts
import { fileTypeFromBuffer } from "file-type";
const detected = await fileTypeFromBuffer(buffer);
if (!detected || !ALLOWED_TYPES.includes(detected.mime)) {
  throw new Error("Format non supporté.");
}
```

---

#### 13. Absence de validation Zod sur les micro-pronostics (admin)

**Fichier :** `app/routes/api.micro-predictions.ts:21-24`

```ts
const type = (formData.get("type") as string) || "qcm";
const optionsRaw = formData.get("options") as string;
const pointsValue = parseInt(formData.get("pointsValue") as string) || 1;
const deadlineSeconds = parseInt(formData.get("deadlineSeconds") as string) || 120;
```

Les champs `type`, `options`, `pointsValue`, `deadlineSeconds` ne sont pas validés via Zod. Un `pointsValue` arbitrairement élevé ou un `type` inconnu peut être persisté en base.

**Correction recommandée :**

```ts
const microPredictionSchema = z.object({
  matchId: z.string().min(1),
  question: z.string().min(1).max(500),
  type: z.enum(["qcm", "open"]),
  options: z.string().optional(),
  pointsValue: z.coerce.number().int().min(1).max(10),
  deadlineSeconds: z.coerce.number().int().min(30).max(600),
});
```

---

#### 14. `trustedOrigins` vide si `APP_URL` non défini

**Fichier :** `app/lib/server/auth.server.ts:12`

```ts
trustedOrigins: env.APP_URL ? [env.APP_URL] : [],
```

Si `APP_URL` n'est pas défini, la liste `trustedOrigins` est vide. Selon le comportement de Better Auth, cela peut désactiver la vérification d'origine (CSRF) ou rejeter toutes les requêtes légitimes.

**Correction recommandée :** Rendre `APP_URL` obligatoire en production dans le schema Zod.

---

#### 15. Données JSON de la DB parsées sans validation de schéma

**Fichiers :** `match-detail.server.ts:83`, `soiree.server.ts:250`, `badges.server.ts:172`

```ts
matchDetails = JSON.parse(match.matchDetails) as MatchDetails;
const condition = JSON.parse(badge.condition) as { type: string; threshold: number };
```

Les données JSON lues depuis la base de données sont castées sans validation Zod. Si la DB est corrompue ou qu'un bug insère un format inattendu, l'application peut se comporter de façon imprévisible.

**Correction recommandée :** Valider les données JSON parsées avec un schema Zod avant utilisation.

---

#### 16. Suppression de membre sans nettoyage des données associées

**Fichier :** `app/routes/admin.members.server.ts:71`

```ts
await db.delete(user).where(eq(user.id, memberId));
```

La suppression d'un membre ne supprime pas ses données associées (pronostics, posts, commentaires, réactions, badges, récompenses). Cela crée des enregistrements orphelins en base et peut causer des erreurs sur les JOIN.

**Correction recommandée :** Ajouter des `ON DELETE CASCADE` dans le schéma Drizzle ou supprimer manuellement les données liées avant de supprimer l'utilisateur.

---

### 🔵 FAIBLE

#### 17. Cast `as any` sur le rôle utilisateur

**Fichiers :** `feed.server.ts:99,124`, `admin.dashboard.server.ts`

```ts
isAdmin: (session.user as any).role === "admin",
```

Le contournement du système de types TypeScript pour lire le rôle est fragile. Une refactorisation du type `session.user` pourrait briser silencieusement les vérifications d'autorisation sans erreur de compilation.

**Correction recommandée :** Utiliser le type `Role` déjà défini dans `auth-utils.server.ts` et étendre correctement le type de session Better Auth.

---

#### 18. `.gitignore` ne couvre pas toutes les variantes de fichiers `.env`

**Fichier :** `.gitignore`

Seul `.env` est ignoré. Les fichiers `.env.production`, `.env.local`, `.env.*.local` ne sont pas couverts.

**Correction recommandée :**

```gitignore
.env
.env.*
!.env.example
```

---

#### 19. Requêtes N+1 dans le fil d'actualité

**Fichier :** `app/routes/feed.server.ts:38-94`

Chaque post déclenche 3 requêtes SQL séparées. Pour 50 posts, cela représente jusqu'à 151 requêtes par chargement de page — vecteur de dégradation sous charge.

**Correction recommandée :** Utiliser des `LEFT JOIN` et agrégats SQL en une seule requête.

---

#### 20. LOG_LEVEL par défaut à "info" — risque de fuite de données dans les logs

**Fichier :** `app/config/env.server.ts:12`

En production, le niveau `info` peut exposer des données utilisateur dans les fichiers de log si des objets complets sont loggés par inadvertance.

**Correction recommandée :** Configurer `LOG_LEVEL=warn` dans `.env` de production et auditer les appels `logger.info` contenant des données utilisateur.

---

## Récapitulatif

| # | Criticité | Fichier | Description |
|---|-----------|---------|-------------|
| 1 | 🔴 CRITIQUE | `uploads-files.ts:5` | Path traversal — lecture de fichiers arbitraires |
| 2 | 🔴 CRITIQUE | Tous les endpoints action | Absence de protection CSRF |
| 3 | 🔴 CRITIQUE | `member-profile.server.ts` | IDOR — accès aux profils sans autorisation |
| 4 | 🔴 CRITIQUE | `uploads-files.ts` | Fichiers uploadés accessibles sans auth |
| 5 | 🟠 ÉLEVÉ | `soiree.server.ts:253` | `correctAnswer` exposé sur micro-pronos ouverts |
| 6 | 🟠 ÉLEVÉ | Tous les endpoints | Absence de rate limiting |
| 7 | 🟠 ÉLEVÉ | `api.health.ts:11` | Endpoint health public (info infra) |
| 8 | 🟠 ÉLEVÉ | Application entière | Absence de headers de sécurité HTTP |
| 9 | 🟠 ÉLEVÉ | `api.micro-predictions.ts:109` | Race condition sur soumission micro-pronos |
| 10 | 🟡 MOYEN | `docker-compose.prod.yml:24,33` | Fallback passwords "changeme" |
| 11 | 🟡 MOYEN | `docker-compose.prod.yml:34` | Mot de passe Redis en clair dans healthcheck |
| 12 | 🟡 MOYEN | `upload.ts:13` | Validation MIME type côté client uniquement |
| 13 | 🟡 MOYEN | `api.micro-predictions.ts:21-24` | Absence de validation Zod sur micro-pronos |
| 14 | 🟡 MOYEN | `auth.server.ts:12` | `trustedOrigins` vide si `APP_URL` absent |
| 15 | 🟡 MOYEN | `match-detail.server.ts`, `badges.server.ts` | JSON DB parsé sans validation de schéma |
| 16 | 🟡 MOYEN | `admin.members.server.ts:71` | Suppression membre sans nettoyage des données liées |
| 17 | 🔵 FAIBLE | `feed.server.ts:99,124` | Cast `as any` sur le rôle utilisateur |
| 18 | 🔵 FAIBLE | `.gitignore` | Couverture incomplète des fichiers `.env` |
| 19 | 🔵 FAIBLE | `feed.server.ts:38-94` | Requêtes N+1 sur le fil d'actualité |
| 20 | 🔵 FAIBLE | `env.server.ts:12` | LOG_LEVEL "info" par défaut en production |

---

## Points positifs

- Authentification déléguée à **Better Auth** avec session Redis — bonne pratique.
- Vérification des rôles systématique via `requireAuth(request, ["admin"])` sur toutes les routes admin dédiées.
- Validation des inputs utilisateurs via **Zod** sur les formulaires principaux (pronostics, posts, commentaires).
- Pas de credentials dans le repo (commit `aed5841` : suppression et renforcement `.gitignore`).
- Autorisation de modification/suppression vérifiée côté serveur (`post.authorId !== session.user.id`).
- Logs structurés avec **pino** (pas de log de données sensibles observé).
- L'upload avatar utilise **Sharp** pour retraiter l'image (élimine les métadonnées EXIF et les payloads cachés).
- Validation forte de l'environnement au démarrage via **Zod** (`env.server.ts`).
