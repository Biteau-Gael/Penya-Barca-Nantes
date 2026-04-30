# Rapport d'Analyse Sécurité — Penya Blaugrana Nantes

**Date :** 2026-04-30  
**Branche analysée :** `main` (HEAD : `003faca`)  
**Périmètre :** Audit complet du code applicatif, de la configuration Docker et des conventions de sécurité

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
| `aed5841` | 2026-04-12 | Biteau Gaël | security: supprimer credentials du repo et renforcer .gitignore |
| `ab7fc5d` | 2026-04-12 | Biteau Gaël | feat: intégration API Football + stats enrichies + classement Liga |

---

## Bilan global

| Niveau | Nombre de findings |
|--------|-------------------|
| 🔴 Critique | 1 |
| 🟠 Élevé | 3 |
| 🟡 Moyen | 3 |
| 🔵 Faible | 2 |

---

## Findings par ordre de criticité

---

### 🔴 CRITIQUE — Path Traversal sur le serveur de fichiers statiques

**Fichier :** `app/routes/uploads-files.ts:5`

**Description :**  
Le paramètre wildcard `params["*"]` issu de l'URL est directement passé à `path.join()` sans aucune validation ni sanitisation. `path.join()` normalise les séquences `../`, ce qui permet à un attaquant de remonter l'arborescence et de lire n'importe quel fichier accessible par le processus Node.

```ts
// VULNÉRABLE — aucune validation du chemin résultant
const filePath = path.join(process.cwd(), "uploads", params["*"]);
const file = await readFile(filePath);
```

**Scénario d'exploitation :**  
Une requête vers `/uploads/../../.env` ou `/uploads/avatars/../../../../etc/passwd` (via requête HTTP brute avec encodage URL) retourne le contenu du fichier cible, exposant potentiellement `DATABASE_URL`, `AUTH_SECRET` et `API_FOOTBALL_KEY`.

**Correction recommandée :**  
Vérifier que le chemin résolu reste dans le dossier `uploads/` autorisé :

```ts
const UPLOAD_DIR = path.join(process.cwd(), "uploads");
const filePath = path.resolve(UPLOAD_DIR, params["*"]);

if (!filePath.startsWith(UPLOAD_DIR + path.sep) && filePath !== UPLOAD_DIR) {
  return new Response("Forbidden", { status: 403 });
}
```

---

### 🟠 ÉLEVÉ — Absence de rate limiting sur les actions applicatives

**Fichiers :** `app/routes/api.micro-predictions.ts`, `app/routes/feed.server.ts`, `app/routes/match-detail.server.ts`

**Description :**  
Le rate limiting est correctement appliqué sur les routes d'authentification (`/api/auth/sign-in`, `/api/auth/sign-up`). En revanche, **aucune limite de requêtes** n'est appliquée sur les actions métier : soumission de pronostics, réponses aux micro-pronos, création de posts et commentaires, réactions.

Cela expose l'application à :
- Spam massif de posts/commentaires
- Flood de réponses aux micro-pronos (même si la duplication est bloquée en BDD)
- Abus de la logique de badges (déclenchements répétés de `evaluateBadges`)

**Correction recommandée :**  
Réutiliser `checkRateLimit` (déjà implémenté dans `app/lib/server/rate-limit.server.ts`) sur les actions sensibles, en clé `action:{userId}` plutôt qu'IP pour les utilisateurs connectés.

---

### 🟠 ÉLEVÉ — Réponse aux micro-pronos sans validation de longueur

**Fichier :** `app/routes/api.micro-predictions.ts:92`

**Description :**  
Le champ `answer` soumis par un utilisateur est inséré en base sans aucune contrainte de taille ou de format côté serveur. Pour les micro-pronos de type QCM, les options valides sont connues (`options` JSON) mais ne sont pas vérifiées lors de la soumission.

```ts
// Pas de validation : longueur, format, ni cohérence avec les options QCM
const answer = formData.get("answer") as string;
await db.insert(microPredictionAnswers).values({ answer, ... });
```

**Risques :**
- Stockage de chaînes arbitrairement longues en base
- Injection de contenu inattendu dans les logs ou l'interface
- Contournement de la logique QCM (réponse hors options)

**Correction recommandée :**  
Ajouter une validation Zod avant l'insertion, et pour les QCM, vérifier que `answer` fait partie des `options` enregistrées.

---

### 🟠 ÉLEVÉ — Réponse correcte exposée dans les logs

**Fichier :** `app/routes/api.micro-predictions.ts:85`

**Description :**  
La réponse correcte d'un micro-pronostic est enregistrée en clair dans les logs au moment de la clôture :

```ts
logger.info({ microId, correctAnswer, scored, total: answers.length }, "Micro-pronostic clôturé");
```

Si les logs sont agrégés dans un système de monitoring (Datadog, Loki, Sentry…) accessible à plus d'une personne, cela permet à quiconque ayant accès aux logs de connaître la réponse correcte avant la révélation publique.

**Correction recommandée :**  
Retirer `correctAnswer` des métadonnées loguées, ou le hasher :

```ts
logger.info({ microId, scored, total: answers.length }, "Micro-pronostic clôturé");
```

---

### 🟡 MOYEN — Absence de headers HTTP de sécurité

**Fichier :** aucun middleware détecté

**Description :**  
Aucun header de sécurité HTTP n'est configuré dans l'application :
- `Content-Security-Policy` (XSS)
- `X-Frame-Options` (clickjacking)
- `X-Content-Type-Options: nosniff`
- `Strict-Transport-Security` (HSTS — production)
- `Referrer-Policy`

**Correction recommandée :**  
Ajouter un middleware dans `app/root.tsx` ou via un `entry.server.tsx` pour injecter ces headers sur toutes les réponses :

```ts
headers.set("X-Content-Type-Options", "nosniff");
headers.set("X-Frame-Options", "DENY");
headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
```

Pour CSP, une politique minimale doit être définie puis affinée.

---

### 🟡 MOYEN — Mots de passe Docker par défaut en production

**Fichier :** `docker-compose.prod.yml:24,30`

**Description :**  
Les variables d'environnement PostgreSQL et Redis utilisent `changeme` comme valeur de fallback :

```yaml
POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-changeme}
command: redis-server --requirepass ${REDIS_PASSWORD:-changeme}
```

Si le fichier `.env` n'est pas correctement configuré sur le NAS Synology (déploiement neuf, restauration, etc.), les services démarrent avec des credentials triviaux.

**Correction recommandée :**  
Supprimer les valeurs par défaut et faire échouer le démarrage si les variables manquent :

```yaml
POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?Variable POSTGRES_PASSWORD requise}
```

---

### 🟡 MOYEN — Contournement du typage TypeScript sur le rôle utilisateur

**Fichier :** `app/routes/feed.server.ts:99,124,184,200`

**Description :**  
Le rôle de l'utilisateur est accédé via un cast `any` au lieu d'utiliser `requireAuth` avec le paramètre `allowedRoles` :

```ts
const isAdmin = (session.user as any).role === "admin";
```

Ce pattern contourne la vérification statique de TypeScript. Si le type de `session.user` évolue, cette vérification peut silencieusement devenir incorrecte. L'API `requireAuth(request, ["admin"])` existe déjà et est la bonne approche (utilisée dans les routes admin).

**Correction recommandée :**  
Typer correctement `session.user` ou utiliser `requireAuth` avec les rôles appropriés. À minima, utiliser le type `Role` défini dans `auth-utils.server.ts`.

---

### 🔵 FAIBLE — Dockerfile sans utilisateur non-root

**Fichier :** `Dockerfile`

**Description :**  
Le conteneur de production s'exécute en tant que `root` (comportement par défaut). En cas de compromission de l'application (ex : RCE), l'attaquant dispose des privilèges root dans le conteneur.

**Correction recommandée :**  
Ajouter un utilisateur dédié dans le Dockerfile final :

```dockerfile
RUN addgroup -S app && adduser -S app -G app
USER app
```

---

### 🔵 FAIBLE — Absence de journal de connexion réussie

**Fichier :** `app/routes/api.auth.$.ts`

**Description :**  
Seuls les dépassements de rate limit sont loggés. Les connexions réussies ne laissent aucune trace dans les logs applicatifs, ce qui rend difficile la détection d'accès non autorisés (credential stuffing aboutissant à une connexion).

**Correction recommandée :**  
Ajouter un log de niveau `info` pour chaque authentification réussie, avec l'IP source et un identifiant utilisateur anonymisé (pas l'email en clair).

---

## Points positifs identifiés

- **Secrets hors dépôt :** Le commit `aed5841` a supprimé les credentials du repo et `.gitignore` inclut `.env` — bonne pratique respectée.
- **ORM paramétré (Drizzle) :** Toutes les requêtes SQL passent par Drizzle ORM avec des paramètres liés — pas d'injection SQL détectée.
- **Validation Zod côté serveur :** Les routes critiques (inscription, création de match, pseudo) utilisent des schémas Zod stricts.
- **Rate limiting sur l'authentification :** `checkRateLimit` est correctement appliqué sur `/sign-in` (10 req/15 min) et `/sign-up` (5 req/heure).
- **Upload d'avatar sécurisé :** `processAvatar` valide le type MIME, limite la taille à 2 Mo, et retranscode systématiquement en WebP via `sharp` — élimine les risques de fichiers malveillants.
- **Contrôle d'accès admin :** Les routes admin utilisent `requireAuth(request, ["admin"])` avec vérification correcte du rôle en base.
- **Protection auto-modification :** Un admin ne peut pas modifier son propre rôle ni se supprimer lui-même.
- **Sessions Redis :** Les sessions sont stockées côté serveur (Redis), pas en cookie JWT — permet la révocation.
- **Validation de l'environnement au démarrage :** `env.server.ts` utilise Zod pour valider toutes les variables d'environnement au boot, avec `AUTH_SECRET` exigeant 16 caractères minimum.

---

## Plan d'action recommandé

| Priorité | Action | Fichier | Effort |
|----------|--------|---------|--------|
| 1 | Corriger path traversal sur `/uploads/*` | `uploads-files.ts` | 30 min |
| 2 | Rate limiting sur actions métier (pronos, posts) | `api.micro-predictions.ts`, `feed.server.ts` | 2h |
| 3 | Valider et borner le champ `answer` des micro-pronos | `api.micro-predictions.ts` | 1h |
| 4 | Retirer `correctAnswer` des logs | `api.micro-predictions.ts` | 5 min |
| 5 | Ajouter headers HTTP de sécurité | `entry.server.tsx` (nouveau) | 1h |
| 6 | Supprimer les mots de passe par défaut Docker | `docker-compose.prod.yml` | 15 min |
| 7 | Typer correctement le rôle dans `feed.server.ts` | `feed.server.ts` | 30 min |
| 8 | Ajouter `USER app` dans le Dockerfile | `Dockerfile` | 15 min |
| 9 | Logger les connexions réussies | `api.auth.$.ts` | 30 min |
