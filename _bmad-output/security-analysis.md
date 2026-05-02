# Rapport d'analyse de sécurité — Penya Barca Nantes

**Date :** 2026-05-02  
**Branche analysée :** `main` (commit HEAD : `003faca`)  
**Scope :** Revue complète du code source, configuration Docker et conventions de sécurité

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
| `9823bc5` | 2026-04-12 | Claude | Add migrate service to docker-compose.prod.yml for database migrations |
| `8d6e5e9` | 2026-04-12 | Claude | Add production Docker Compose and backup script for Synology NAS deployment |
| `aed5841` | 2026-04-12 | Biteau Gaël | security: supprimer credentials du repo et renforcer .gitignore |
| `ab7fc5d` | 2026-04-12 | Biteau Gaël | feat: intégration API Football + stats enrichies + classement Liga |

**Derniers commits Phase 2 (b1c88f6 + 003faca) :** 2 965 lignes ajoutées sur 26 fichiers. Introduce les tables `seasons`, `badges`, `user_badges`, `rewards`, `micro_predictions`, `micro_prediction_answers`, la page `/soiree/:matchId` avec score live et polling, les micro-pronostics admin, les badges automatiques, les séries de scores exacts et les archives de classement par saison.

---

## Analyse de sécurité par ordre de criticité

---

### CRITIQUE

#### SEC-01 — Path Traversal sur le endpoint de fichiers uploadés

**Fichier :** `app/routes/uploads-files.ts:5`  
**Sévérité :** CRITIQUE  

Le loader construit le chemin du fichier avec `path.join(process.cwd(), "uploads", params["*"])` sans valider que le chemin final reste bien dans le répertoire `uploads/`. Un attaquant peut injecter `../` dans l'URL pour lire n'importe quel fichier du système de fichiers accessible au processus Node (ex. : `GET /uploads/../.env`).

```ts
// Code actuel — VULNÉRABLE
const filePath = path.join(process.cwd(), "uploads", params["*"]);
```

**Correction recommandée :** Vérifier que le chemin résolu commence bien par le répertoire autorisé.

```ts
const UPLOADS_BASE = path.join(process.cwd(), "uploads");
const filePath = path.join(UPLOADS_BASE, params["*"]);

if (!filePath.startsWith(UPLOADS_BASE + path.sep) && filePath !== UPLOADS_BASE) {
  return new Response("Forbidden", { status: 403 });
}
```

---

### ÉLEVÉ

#### SEC-02 — Absence de headers de sécurité HTTP

**Fichier :** aucun fichier `entry.server.ts` n'existe ; `app/root.tsx`  
**Sévérité :** ÉLEVÉ  

Aucun header de sécurité n'est défini sur les réponses HTTP :
- Pas de `Content-Security-Policy` (CSP)
- Pas de `X-Frame-Options` (protection contre le clickjacking)
- Pas de `X-Content-Type-Options: nosniff`
- Pas de `Strict-Transport-Security` (HSTS)
- Pas de `Referrer-Policy`

**Correction recommandée :** Créer un `app/entry.server.tsx` avec un middleware qui injecte les headers sur toutes les réponses SSR, ou configurer un reverse-proxy (nginx) pour les ajouter.

```ts
// app/entry.server.tsx — exemple minimal
response.headers.set("X-Frame-Options", "DENY");
response.headers.set("X-Content-Type-Options", "nosniff");
response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
response.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
```

---

#### SEC-03 — Connexion PostgreSQL sans SSL en production

**Fichier :** `app/db/client.ts:6`  
**Sévérité :** ÉLEVÉ  

Le pool PostgreSQL est configuré avec `connectionString: process.env.DATABASE_URL` sans option SSL. Sur un NAS Synology où l'application et la base tournent dans des containers Docker sur le même réseau, le risque est limité. Toutefois, si la `DATABASE_URL` pointait vers un serveur externe, les données (credentials inclus) transitent en clair.

**Correction recommandée :** Ajouter la configuration SSL conditionnellement selon l'environnement.

```ts
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
});
```

---

#### SEC-04 — Mots de passe Docker par défaut en production

**Fichier :** `docker-compose.prod.yml:19,26`  
**Sévérité :** ÉLEVÉ  

Les variables `POSTGRES_PASSWORD` et `REDIS_PASSWORD` ont une valeur de repli `changeme` si les variables d'environnement ne sont pas définies. Un déploiement oubliant de renseigner le fichier `.env` expose les services avec ce mot de passe trivial.

```yaml
POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-changeme}   # DANGEREUX
redis-server --requirepass ${REDIS_PASSWORD:-changeme}  # DANGEREUX
```

**Correction recommandée :** Supprimer la valeur par défaut pour forcer une erreur explicite si la variable n'est pas définie.

```yaml
POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?POSTGRES_PASSWORD must be set}
```

---

### MOYEN

#### SEC-05 — Absence de rate limiting sur les actions métier sensibles

**Fichier :** `app/routes/api.micro-predictions.ts`, `app/routes/feed.server.ts`  
**Sévérité :** MOYEN  

Le rate limiting (`checkRateLimit`) n'est appliqué qu'aux endpoints d'authentification (`/api/auth/sign-in`, `/api/auth/sign-up`). Les actions suivantes ne sont pas protégées par un rate limit :
- Soumission de micro-pronostics (possibilité de script automatisé)
- Publication de posts / commentaires dans le fil (flood)
- Réactions répétées

**Correction recommandée :** Appliquer `checkRateLimit` sur les actions à risque avec des seuils raisonnables (ex. 30 posts / 10 min par user).

---

#### SEC-06 — Validation insuffisante du type MIME des uploads (côté serveur)

**Fichier :** `app/lib/server/upload.ts:12`  
**Sévérité :** MOYEN  

La vérification du type de fichier repose uniquement sur `file.type`, qui provient du header `Content-Type` de la requête multipart — cette valeur est contrôlée par le client et peut être falsifiée. Un fichier `.php` ou `.html` peut être uploadé avec `Content-Type: image/jpeg`.

La conversion via `sharp` atténue partiellement le risque (une image invalide lèvera une erreur), mais ce n'est pas une garantie complète pour tous les vecteurs d'attaque.

**Correction recommandée :** Vérifier la signature magique du fichier (magic bytes) en plus du MIME déclaré, par exemple avec la bibliothèque `file-type`.

```ts
import { fileTypeFromBuffer } from "file-type";
const detected = await fileTypeFromBuffer(buffer);
if (!detected || !["image/jpeg", "image/png", "image/webp"].includes(detected.mime)) {
  throw new Error("Format de fichier invalide.");
}
```

---

#### SEC-07 — Le endpoint `/api/health` est public et expose des informations d'infrastructure

**Fichier :** `app/routes/api.health.ts`  
**Sévérité :** MOYEN  

Le health check répond publiquement avec le statut détaillé de chaque service (`db: "ok"|"error"`, `redis: "ok"|"error"`) sans authentification. Cette information peut aider un attaquant à identifier les services actifs et à cibler ses attaques lors d'une panne partielle.

**Correction recommandée :** Restreindre l'accès au health check à un réseau interne / IP de confiance (configuration reverse-proxy), ou supprimer les détails de service de la réponse publique.

---

#### SEC-08 — Suppression de compte sans confirmation de mot de passe

**Fichier :** `app/routes/profile.server.ts:85`  
**Sévérité :** MOYEN  

L'action `delete-account` supprime définitivement le compte de l'utilisateur connecté sans demander de confirmation par mot de passe. Un CSRF ou une session volée suffit à déclencher la suppression.

**Correction recommandée :** Exiger la saisie du mot de passe actuel avant de procéder à la suppression, et valider ce mot de passe via Better Auth avant l'opération DB.

---

### FAIBLE

#### SEC-09 — Rotation des sessions non configurée après changement de rôle

**Fichier :** `app/routes/admin.members.server.ts`  
**Sévérité :** FAIBLE  

Lorsqu'un admin modifie le rôle d'un utilisateur, la session active de cet utilisateur n'est pas invalidée. L'utilisateur promu ou rétrogradé conserve son ancien rôle jusqu'à sa prochaine reconnexion.

**Correction recommandée :** Appeler `auth.api.revokeUserSessions({ userId })` après tout changement de rôle.

---

#### SEC-10 — `evaluateBadges` appelé sans attendre le résultat (fire-and-forget)

**Fichier :** `app/routes/feed.server.ts:136`, `app/routes/match-detail.server.ts:186`  
**Sévérité :** FAIBLE / INFO  

Le pattern `evaluateBadges(session.user.id).catch(() => {})` est fonctionnel et non bloquant, ce qui est intentionnel. Cependant, l'erreur est silencieusement ignorée sans aucun log.

**Correction recommandée :** Logger l'erreur pour faciliter le diagnostic.

```ts
evaluateBadges(session.user.id).catch((err) => {
  logger.warn({ err, userId: session.user.id }, "evaluateBadges failed");
});
```

---

## Points positifs constatés

| Domaine | Observation |
|---------|-------------|
| **Authentification** | Better Auth correctement intégré avec session Redis, `trustedOrigins` configuré |
| **Autorisation** | `requireAuth(request, ["admin"])` systématiquement utilisé sur toutes les routes admin |
| **Rate Limiting** | Implémenté sur sign-in (10 tentatives / 15 min) et sign-up (5 / 1h) via Redis |
| **Validation des entrées** | Zod utilisé côté serveur sur toutes les mutations (posts, commentaires, matchs, profil) |
| **Variables d'environnement** | Validation Zod au démarrage via `getEnv()`, `AUTH_SECRET` minimum 16 caractères imposé |
| **Gestion des secrets** | `.env` exclus du dépôt, `.env.example` sans valeurs réelles, commit `aed5841` de nettoyage |
| **ORM paramétré** | Drizzle ORM utilisé partout — pas de requêtes SQL brutes, risque d'injection SQL nul |
| **Upload d'image** | Conversion systématique en WebP via `sharp`, vérification taille (2 Mo max) et types MIME |
| **Séparation server/client** | Fichiers `.server.ts` correctement séparés, pas de fuite de variables d'env côté client |
| **Contrôle d'accès propriétaire** | Suppression de post/commentaire vérifie l'ownership avant autorisation |
| **Protection admin auto-modification** | Un admin ne peut pas modifier son propre rôle |
| **Logging structuré** | Pino utilisé avec contexte métier sur toutes les actions sensibles |

---

## Tableau récapitulatif

| ID | Titre | Sévérité | Fichier principal | Statut |
|----|-------|----------|-------------------|--------|
| SEC-01 | Path Traversal uploads | CRITIQUE | `routes/uploads-files.ts:5` | À corriger |
| SEC-02 | Absence headers sécurité HTTP | ÉLEVÉ | `root.tsx` / entry.server | À corriger |
| SEC-03 | PostgreSQL sans SSL | ÉLEVÉ | `db/client.ts:6` | À corriger |
| SEC-04 | Mots de passe Docker par défaut | ÉLEVÉ | `docker-compose.prod.yml:19` | À corriger |
| SEC-05 | Pas de rate limit sur actions métier | MOYEN | `api.micro-predictions.ts` | À corriger |
| SEC-06 | Validation MIME upload côté client uniquement | MOYEN | `lib/server/upload.ts:12` | À corriger |
| SEC-07 | Health check public avec détails infra | MOYEN | `routes/api.health.ts` | À corriger |
| SEC-08 | Suppression compte sans confirmation MDP | MOYEN | `routes/profile.server.ts:85` | À corriger |
| SEC-09 | Sessions non invalidées après changement rôle | FAIBLE | `routes/admin.members.server.ts` | À corriger |
| SEC-10 | evaluateBadges : erreurs silencieuses | FAIBLE | `routes/feed.server.ts:136` | Amélioration |
