# Analyse de sécurité — Penya Blaugrana Nantes

**Date d'analyse :** 29 avril 2026  
**Branche analysée :** `main` (dernier commit : `003faca`)  
**Portée :** Commits Phase 2 (b1c88f6, 003faca) + infrastructure de déploiement

---

## Résumé des derniers commits

| Hash | Date | Description |
|------|------|-------------|
| `003faca` | 13 avr. 2026 | fix: évaluation immédiate des badges après chaque action |
| `b1c88f6` | 13 avr. 2026 | feat: Phase 2 — soirée match live, micro-pronos, badges, séries, saisons |
| `d461ee5` | 12 avr. 2026 | Merge branche déploiement Synology NAS |
| `554b873` | 12 avr. 2026 | Guide de déploiement NAS (mises à jour) |
| `68e22d2` | 13 avr. 2026 | feat: menu burger mobile pour la navigation |
| `6aebaf7` | 12 avr. 2026 | Fix Better Auth trusted origins pour le domaine personnalisé |
| `9823bc5` | 12 avr. 2026 | Service migrate ajouté dans docker-compose.prod.yml |
| `aed5841` | 12 avr. 2026 | security: suppression des credentials du repo, renforcement du .gitignore |

---

## Analyse de sécurité par criticité

---

### CRITIQUE

#### 1. Path traversal dans le serveur de fichiers statiques

**Fichier :** `app/routes/uploads-files.ts`

```typescript
const filePath = path.join(process.cwd(), "uploads", params["*"]);
const file = await readFile(filePath);
```

**Problème :** Le paramètre wildcard `params["*"]` est utilisé directement dans `path.join` sans validation. Un attaquant peut forger une requête du type `/uploads/../../../etc/passwd` pour lire n'importe quel fichier accessible au processus Node.

**Recommandation :**
```typescript
const safePath = path.join(process.cwd(), "uploads", params["*"]);
const uploadDir = path.join(process.cwd(), "uploads");
if (!safePath.startsWith(uploadDir + path.sep)) {
  return new Response("Forbidden", { status: 403 });
}
```

---

### ÉLEVÉE

#### 2. Absence d'en-têtes de sécurité HTTP

**Fichier :** Aucun — non implémenté

L'application ne configure aucun en-tête de sécurité HTTP :
- Pas de `Content-Security-Policy` (CSP)
- Pas de `X-Frame-Options`
- Pas de `Strict-Transport-Security` (HSTS)
- Pas de `X-Content-Type-Options`
- Pas de `Referrer-Policy`

**Impact :** Exposition au clickjacking, MIME sniffing, fuites de données via Referer, et injection de scripts si du contenu tiers est introduit.

**Recommandation :** Ajouter un middleware dans `react-router.config.ts` ou via un wrapper de réponse pour injecter ces en-têtes sur toutes les réponses.

---

#### 3. Rate limiting absent sur les routes sensibles

**Fichiers :** `app/routes/api.micro-predictions.ts`, `app/routes/feed.server.ts`

Le rate limiting n'est appliqué que sur `/api/auth` (connexion/inscription). Les actions suivantes n'ont aucune protection contre les abus en masse :
- Soumission de réponses aux micro-pronostics
- Publication de posts et commentaires
- Suppression de contenu

**Impact :** Un utilisateur malveillant peut spammer le fil communautaire, tenter du brute-force sur les IDs de matchs/micro-pronostics, ou saturer la base de données.

**Recommandation :** Appliquer `checkRateLimit` (déjà présent dans `app/lib/server/rate-limit.server.ts`) sur les actions de mutation, avec des fenêtres adaptées (ex. : 10 posts par heure, 30 commentaires par heure).

---

#### 4. Vérification MIME côté client uniquement pour les uploads

**Fichier :** `app/lib/server/upload.ts`

```typescript
if (!ALLOWED_TYPES.includes(file.type)) { ... }
```

La vérification repose sur `file.type`, qui est fourni par le client via le header HTTP multipart et peut être falsifié. Un fichier PHP ou HTML peut être uploadé avec `Content-Type: image/jpeg`.

**Note positive :** `sharp` retraite le binaire pour produire un WebP, ce qui neutralise la plupart des charges utiles. Toutefois, la validation doit être renforcée.

**Recommandation :** Ajouter une vérification de la signature magique (magic bytes) du fichier binaire avant traitement par `sharp`, ou valider le type réel après le retraitement.

---

### MODÉRÉE

#### 5. Utilisation de `as any` pour les vérifications de rôle

**Fichier :** `app/routes/feed.server.ts` (lignes 99, 124, 184, 200)

```typescript
isAdmin: (session.user as any).role === "admin"
```

Le cast `as any` contourne le système de types TypeScript, rendant impossible la détection statique d'erreurs sur le champ `role`. Si la structure de `session.user` évolue, cette vérification peut silencieusement échouer.

**Recommandation :** Utiliser le type `Session` exporté par `auth.server.ts` correctement, ou extraire une fonction helper `isAdmin(session)` typée.

---

#### 6. Requête SQL brute non typée dans `badges.server.ts`

**Fichier :** `app/lib/server/badges.server.ts` (lignes 141-142)

```typescript
.from(sql`"user"`)
.where(sql`id = ${userId}`)
```

Bien que Drizzle paramétrise les interpolations `${}`, l'usage de `sql` template literals pour désigner une table contourne les garanties de l'ORM. Une refactorisation vers `from(user)` (table typée) est préférable pour la maintenabilité et la sécurité à long terme.

**Recommandation :** Remplacer par la référence Drizzle standard :
```typescript
.from(user).where(eq(user.id, userId))
```

---

#### 7. Mot de passe par défaut dans docker-compose.prod.yml

**Fichier :** `docker-compose.prod.yml`

```yaml
POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-changeme}
redis-server --requirepass ${REDIS_PASSWORD:-changeme}
```

La valeur de fallback `changeme` est utilisée si les variables d'environnement ne sont pas définies. En cas de déploiement sans fichier `.env` correct, la base et Redis seront accessibles avec ce mot de passe trivial.

**Recommandation :** Supprimer les valeurs de fallback pour provoquer une erreur explicite plutôt qu'un déploiement non sécurisé :
```yaml
POSTGRES_PASSWORD=${POSTGRES_PASSWORD:?Variable POSTGRES_PASSWORD requise}
```

---

### FAIBLE / AMÉLIORATION

#### 8. Exposition de l'e-mail dans l'admin membres

**Fichier :** `app/routes/admin.members.server.ts`

Le champ `email` est inclus dans la liste des membres retournée au front. Si l'interface admin est jamais accessible à un rôle non-admin par erreur de configuration, les e-mails sont exposés.

**Recommandation :** Confirmer que la route admin vérifie bien `requireAuth(request, ["admin"])` (c'est le cas), et envisager de masquer partiellement l'e-mail côté UI si la liste est copiée/exportée.

---

#### 9. `JSON.parse` sans validation de schéma

**Fichiers :** `app/lib/server/badges.server.ts` (ligne 172), `app/routes/soiree.server.ts` (ligne 250)

```typescript
const condition = JSON.parse(badge.condition) as { type: string; threshold: number };
```

Un cast TypeScript post-`JSON.parse` ne valide pas la structure réelle. Si la donnée en base est corrompue, l'application plantera à l'exécution avec un message d'erreur peu explicite.

**Recommandation :** Ajouter une validation Zod sur les résultats de `JSON.parse` pour les données critiques.

---

#### 10. IP source non canonisée dans le rate limiting

**Fichier :** `app/routes/api.auth.$.ts`

```typescript
request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
```

Si un proxy ou load balancer n'est pas configuré pour sanitiser `X-Forwarded-For`, un attaquant peut forger cet en-tête pour contourner le rate limiting en changeant l'IP apparente.

**Recommandation :** Documenter la configuration du reverse proxy (Nginx/Traefik) pour que seule l'IP réelle soit transmise, ou utiliser une IP de session (session token) comme clé de rate limiting en complément.

---

## Points positifs constatés

- **Credentials retirés du repo** (`aed5841`) : historique nettoyé, `.gitignore` renforcé.
- **Rate limiting sur l'authentification** : 10 tentatives/15 min pour le login, 5/h pour l'inscription.
- **Better Auth** : bibliothèque d'authentification moderne avec gestion des sessions via Redis.
- **Validation Zod** sur les formulaires critiques : pronostics, posts, commentaires, création de matchs.
- **Protection des routes admin** : `requireAuth(request, ["admin"])` systématiquement utilisé.
- **Vérification ownership** avant suppression : posts et commentaires vérifiés côté serveur.
- **Retraitement des images** via `sharp` → conversion WebP, redimensionnement 256×256.
- **Logs structurés** via `pino` avec niveaux configurables.
- **Santé de l'infrastructure** : endpoint `/api/health` opérationnel (PostgreSQL + Redis).
- **trustedOrigins** configuré dans Better Auth pour limiter les origines acceptées.

---

## Tableau de synthèse

| # | Problème | Criticité | Effort | Fichier(s) |
|---|----------|-----------|--------|------------|
| 1 | Path traversal fichiers statiques | CRITIQUE | Faible | `uploads-files.ts` |
| 2 | Absence d'en-têtes de sécurité HTTP | ÉLEVÉE | Moyen | Config globale |
| 3 | Rate limiting absent sur actions | ÉLEVÉE | Moyen | `feed.server.ts`, `api.micro-predictions.ts` |
| 4 | Validation MIME uploads insuffisante | ÉLEVÉE | Faible | `upload.ts` |
| 5 | `as any` sur les rôles | MODÉRÉE | Faible | `feed.server.ts` |
| 6 | SQL brut dans badges | MODÉRÉE | Faible | `badges.server.ts` |
| 7 | Mot de passe de fallback Docker | MODÉRÉE | Trivial | `docker-compose.prod.yml` |
| 8 | E-mail exposé dans admin liste | FAIBLE | Trivial | `admin.members.server.ts` |
| 9 | `JSON.parse` sans validation | FAIBLE | Faible | `badges.server.ts`, `soiree.server.ts` |
| 10 | IP forgeable dans rate limiting | FAIBLE | Documentation | `api.auth.$.ts` |
