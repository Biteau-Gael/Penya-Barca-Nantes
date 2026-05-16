# Analyse de sécurité — Penya Blaugrana Nantes

> Date de l'analyse : 2026-05-16  
> Branche analysée : `claude/sharp-fermi-Unurd`  
> Portée : commits récents + audit complet du code source

---

## 1. Résumé des derniers commits

| Hash | Date | Description |
|------|------|-------------|
| `003faca` | 13 avr. 2026 | **fix** — Évaluation immédiate des badges après chaque action utilisateur (pronostic, post, commentaire, réaction) |
| `b1c88f6` | 13 avr. 2026 | **feat** — Phase 2 complète : soirée match live, micro-pronostics, badges, séries de scores, saisons |
| `d461ee5` | 12 avr. 2026 | **merge** — Intégration de la branche de déploiement Synology NAS |
| `554b873` | 12 avr. 2026 | **docs** — Guide de mise à jour rapide du NAS (pull, rebuild, logs, backup) |
| `68e22d2` | 13 avr. 2026 | **feat** — Menu burger mobile pour la navigation responsive |

### Périmètre du sprint Phase 2 (`b1c88f6` + `003faca`)

- **Soirée match live** : route `/soiree/:matchId`, score en polling toutes les 60 s, fil d'événements temps réel, pronos communauté révélés au coup d'envoi
- **Micro-pronostics** : création/clôture admin, vote joueur, attribution automatique des points, suppression admin
- **Séries** : champs `currentStreak` / `bestStreak`, récompenses aux paliers 3/5/10 avec post automatique
- **Badges** : 10 badges évalués automatiquement, page `/badges`, affichage profil
- **Saisons** : table `seasons`, sélecteur sur le classement, archives `/classement?saison=XXXX`
- **Migration DB** : `0007_slimy_maria_hill.sql`

---

## 2. Analyse de sécurité par ordre de criticité

---

### 🔴 CRITIQUE

#### C-1 — Path Traversal dans le serveur de fichiers uploads

**Fichier** : `app/routes/uploads-files.ts`

```typescript
const filePath = path.join(process.cwd(), "uploads", params["*"]);
const file = await readFile(filePath);
```

**Risque** : `params["*"]` est passé directement à `path.join` sans aucune validation. Un attaquant peut requêter `/uploads/../.env` ou `/uploads/../../etc/passwd` pour lire des fichiers arbitraires sur le serveur, y compris les secrets d'environnement (`AUTH_SECRET`, `DATABASE_URL`, `API_FOOTBALL_KEY`).

**Correction recommandée** :

```typescript
const UPLOAD_ROOT = path.resolve(process.cwd(), "uploads");
const filePath = path.resolve(UPLOAD_ROOT, params["*"]);

// Vérification que le chemin reste dans le dossier autorisé
if (!filePath.startsWith(UPLOAD_ROOT + path.sep)) {
  return new Response("Forbidden", { status: 403 });
}
```

---

### 🟠 ÉLEVÉ

#### E-1 — Absence de rate limiting sur les actions du feed social

**Fichiers** : `app/routes/feed.server.ts`, `app/routes/api.micro-predictions.ts`

Le module `checkRateLimit` existe et est fonctionnel, mais il n'est **pas appliqué** sur les actions `create-post`, `comment`, `react` du fil social, ni sur les réponses aux micro-pronostics. Un utilisateur authentifié peut :
- Spammer le fil de publications ou de commentaires
- Déclencher massivement l'évaluation des badges (appel DB coûteux)

**Correction recommandée** : ajouter `checkRateLimit` au début de chaque action :

```typescript
// create-post : 10 posts par heure par utilisateur
await checkRateLimit({ key: `post:${session.user.id}`, maxAttempts: 10, windowSeconds: 3600 });

// comment : 30 commentaires par heure
await checkRateLimit({ key: `comment:${session.user.id}`, maxAttempts: 30, windowSeconds: 3600 });
```

---

#### E-2 — Validation insuffisante des entrées admin dans les micro-pronostics

**Fichier** : `app/routes/api.micro-predictions.ts`

Les champs suivants ne sont pas validés au-delà d'une vérification de présence :
- `answer` (réponse d'un joueur) : aucune limite de longueur → risque de pollution DB
- `pointsValue` : pas de borne supérieure → un admin peut attribuer des millions de points
- `deadlineSeconds` : pas de borne → valeur négative ou excessivement grande acceptée
- `question` / `options` : pas de longueur max → texte volumineux accepté

**Correction recommandée** : introduire un schéma Zod pour chaque intention :

```typescript
const createMicroSchema = z.object({
  matchId: z.string().min(1),
  question: z.string().min(3).max(200),
  type: z.enum(["qcm", "text"]).default("qcm"),
  options: z.string().max(500).optional(),
  pointsValue: z.coerce.number().int().min(1).max(10),
  deadlineSeconds: z.coerce.number().int().min(30).max(3600),
});

const answerMicroSchema = z.object({
  microId: z.string().min(1),
  answer: z.string().min(1).max(100),
});
```

---

#### E-3 — Mot de passe par défaut dans `docker-compose.prod.yml`

**Fichier** : `docker-compose.prod.yml`

```yaml
POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-changeme}
# ...
redis-server --requirepass ${REDIS_PASSWORD:-changeme}
```

Si l'opérateur déploie sans définir ces variables d'environnement, la base de données et Redis sont accessibles avec le mot de passe `changeme`. En réseau local (NAS Synology), le risque est limité mais réel si les ports sont exposés.

**Correction recommandée** : supprimer la valeur de repli `:-changeme` pour forcer une erreur explicite au démarrage si les variables ne sont pas définies, ou documenter l'obligation dans un `.env.prod.example` dédié avec des avertissements clairs.

---

#### E-4 — Duplication de la logique d'appel API dans `soiree.server.ts`

**Fichier** : `app/routes/soiree.server.ts`

La route construit les requêtes API Football avec interpolation de string directe :

```typescript
fetch(`${API_BASE}/football-get-hometeam-lineup?eventid=${externalFixtureId}`, {
  headers: { "x-rapidapi-key": env.API_FOOTBALL_KEY, ... }
```

Ce code duplique la logique du client centralisé `apiFetch()` de `api-football.server.ts`, sans passer par l'URL builder sécurisé (`new URL()`). Bien que `externalFixtureId` soit un nombre issu de la DB (risque d'injection limité), cette fragmentation complique la maintenance et peut conduire à des incohérences de sécurité.

**Correction recommandée** : exporter et réutiliser `apiFetch` depuis `api-football.server.ts` dans `soiree.server.ts`.

---

### 🟡 MODÉRÉ

#### M-1 — Cast `as any` sur le rôle utilisateur

**Fichiers** : `app/routes/feed.server.ts`, `app/routes/soiree.server.ts`

```typescript
const isAdmin = (session.user as any).role === "admin";
```

Ce cast contourne la vérification TypeScript et masque une lacune de typage. Si la structure de la session évolue, ce code échouera silencieusement en production.

**Correction recommandée** : étendre correctement le type `Session` ou utiliser le helper `requireAuth` avec le paramètre `allowedRoles` déjà disponible.

---

#### M-2 — Absence de headers de sécurité HTTP

Aucun header de sécurité n'est configuré au niveau de l'application :
- `Content-Security-Policy` — absent (risque XSS sur contenu utilisateur du feed)
- `X-Frame-Options` — absent (risque clickjacking)
- `X-Content-Type-Options` — absent
- `Referrer-Policy` — absent

**Correction recommandée** : ajouter un middleware dans `app/root.tsx` ou via le reverse proxy Nginx/Caddy du NAS.

---

#### M-3 — URL de highlights non validée (open redirect potentiel)

**Fichier** : `app/lib/server/api-football.server.ts`

```typescript
highlightUrl = highlightsRes.value.response.highlights?.url ?? null;
```

L'URL est retournée telle quelle depuis l'API externe et transmise au client. Si l'API est compromise ou renvoie une URL malveillante (javascript:, data:, URL vers un site malveillant), elle peut être utilisée comme vecteur d'attaque dans l'interface.

**Correction recommandée** : valider que l'URL commence par `https://` avant de la retourner :

```typescript
const rawUrl = highlightsRes.value.response.highlights?.url;
if (rawUrl?.startsWith("https://")) {
  highlightUrl = rawUrl;
}
```

---

#### M-4 — N+1 queries dans le loader du feed

**Fichier** : `app/routes/feed.server.ts`

Pour chaque post (jusqu'à 50), 3 requêtes séquentielles sont effectuées :
1. Compter les réactions
2. Charger les commentaires
3. Vérifier si l'utilisateur a réagi

Soit jusqu'à **150 requêtes DB** par chargement de page. Sous charge, cela peut dégrader les performances et potentiellement servir de vecteur de DoS indirect.

**Correction recommandée** : remplacer par des requêtes groupées (`WHERE postId IN (...)`) ou utiliser des agrégations SQL en une seule passe.

---

### 🔵 FAIBLE / INFORMATIF

#### I-1 — Redis sans authentification en mode développement

**Fichier** : `app/lib/server/redis.server.ts`

```typescript
new Redis(process.env.REDIS_URL || "redis://localhost:6379")
```

En développement, le Redis démarre sans authentification. En soi acceptable, mais si une instance de dev est accessible depuis un réseau partagé, les sessions utilisateurs stockées dans Redis sont exposées.

---

#### I-2 — Logs contenant des identifiants utilisateurs (RGPD)

Les logs incluent systématiquement `userId`, `postId`, etc. Si ces logs sont externalisés (agrégateur de logs, monitoring), ils doivent être couverts par la politique RGPD du projet.

---

#### I-3 — `AUTH_SECRET` sans mécanisme de rotation documenté

La configuration Better-Auth repose sur un secret statique (`AUTH_SECRET`). Il n'existe pas de procédure documentée pour invalider toutes les sessions en cas de compromission de ce secret. Ajouter une note dans `DEPLOY.md`.

---

#### I-4 — Pagination hardcodée à 50 posts

**Fichier** : `app/routes/feed.server.ts`

```typescript
.limit(50)
```

Valeur fixe sans pagination progressive. À mesure que le feed grandit, les 50 premiers posts monopoliseront les requêtes N+1 (cf. M-4). À traiter conjointement avec M-4.

---

## 3. Tableau de synthèse

| Réf | Criticité | Fichier | Description | Effort de correction |
|-----|-----------|---------|-------------|---------------------|
| C-1 | 🔴 Critique | `uploads-files.ts` | Path traversal — lecture de fichiers arbitraires | Faible (5 lignes) |
| E-1 | 🟠 Élevé | `feed.server.ts`, `api.micro-predictions.ts` | Absence de rate limiting sur les actions sociales | Faible |
| E-2 | 🟠 Élevé | `api.micro-predictions.ts` | Validation insuffisante des entrées admin/joueur | Modéré |
| E-3 | 🟠 Élevé | `docker-compose.prod.yml` | Mots de passe par défaut en production | Faible |
| E-4 | 🟠 Élevé | `soiree.server.ts` | Duplication logique API — appels non sécurisés | Modéré |
| M-1 | 🟡 Modéré | `feed.server.ts`, `soiree.server.ts` | Cast `as any` sur le rôle — contournement TypeScript | Faible |
| M-2 | 🟡 Modéré | Global | Absence de headers de sécurité HTTP | Modéré |
| M-3 | 🟡 Modéré | `api-football.server.ts` | URL de highlights non validée | Faible |
| M-4 | 🟡 Modéré | `feed.server.ts` | N+1 queries — jusqu'à 150 requêtes DB par page | Élevé |
| I-1 | 🔵 Faible | `redis.server.ts` | Redis sans auth en dev | Informatif |
| I-2 | 🔵 Faible | Logs | IDs utilisateurs dans les logs (RGPD) | Informatif |
| I-3 | 🔵 Faible | `DEPLOY.md` | Absence de procédure de rotation de l'AUTH_SECRET | Documentation |
| I-4 | 🔵 Faible | `feed.server.ts` | Pagination hardcodée à 50 | À coupler avec M-4 |

---

## 4. Points positifs relevés

- **Validation Zod systématique** sur les entrées utilisateurs clés (inscription, login, pronostics, posts, commentaires)
- **ORM Drizzle** utilisé partout — aucune requête SQL brute vulnérable à l'injection SQL
- **`requireAuth`** appliqué sur toutes les routes protégées avec séparation claire member/admin
- **Vérification de propriété** avant suppression (posts, commentaires) — pas d'IDOR détecté
- **Rate limiter** implémenté et fonctionnel (Redis INCR/EXPIRE) — manque uniquement d'application sur le feed
- **Better-Auth** avec stockage de sessions Redis et `trustedOrigins` configuré
- **Upload avatars** : type MIME vérifié, taille bornée à 2 Mo, re-encodage WebP via Sharp
- **Variables d'environnement** validées au démarrage via Zod (`env.server.ts`)
- **Secrets absents du repo** — commit `aed5841` a nettoyé les credentials, `.gitignore` correct
