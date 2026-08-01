# Rapport d'audit de sécurité — Penya Blaugrana Nantes

> **Date d'analyse :** 01/08/2026  
> **Branche analysée :** `main` (HEAD `003faca`)  
> **Analysé par :** Claude Code (automatique, tâche planifiée)

---

## Résumé des derniers commits

| Hash | Date | Description |
|------|------|-------------|
| `003faca` | 13/04/2026 | fix: évaluer les badges immédiatement après chaque action |
| `b1c88f6` | 13/04/2026 | feat: Phase 2 — soirée match live, micro-pronos, badges, séries, saisons |
| `68e22d2` | 13/04/2026 | feat: menu burger mobile pour la navigation |
| `d461ee5` | 12/04/2026 | Merge branch 'claude/deploy-synology-nas-cLkOL' |
| `554b873` | 12/04/2026 | Add deployment guide for Synology NAS updates |
| `6aebaf7` | 12/04/2026 | Fix Better Auth trusted origins for custom domain support |
| `9823bc5` | 12/04/2026 | Add migrate service to docker-compose.prod.yml for database migrations |
| `8d6e5e9` | 12/04/2026 | Add production Docker Compose and backup script for Synology NAS deployment |

### Périmètre Phase 2 (`b1c88f6`)
La Phase 2 a introduit **3 050 lignes** de code réparties sur 29 fichiers :
- Nouvelle route `/soiree/:matchId` avec score live et événements de match via API Football
- Système de **micro-pronostics** en temps réel (`api.micro-predictions.ts`)
- Moteur de **badges** (10 badges) avec évaluation automatique après chaque action
- Gestion des **séries** (`streaks.server.ts`) et des **saisons** (`seasons.server.ts`)
- Nouvelles tables BDD : `badges`, `user_badges`, `micro_predictions`, `micro_prediction_answers`, `rewards`, `seasons`

---

## Analyse de sécurité par ordre de criticité

### 🔴 CRITIQUE

#### C-1 — Mots de passe Docker par défaut faibles
**Fichier :** `docker-compose.prod.yml` (lignes 17, 22)

```yaml
POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-changeme}
redis-server --requirepass ${REDIS_PASSWORD:-changeme}
```

**Risque :** Si le fichier `.env` de production n'est pas correctement configuré, les services PostgreSQL et Redis démarrent avec le mot de passe `changeme`. Un attaquant ayant accès au réseau interne du NAS peut compromettre toute la base de données.

**Correctif :** Supprimer les valeurs par défaut pour forcer la configuration explicite, ou lever une erreur au démarrage si les variables ne sont pas définies :
```yaml
POSTGRES_PASSWORD=${POSTGRES_PASSWORD:?Variable POSTGRES_PASSWORD non définie}
```

---

### 🟠 ÉLEVÉ

#### H-1 — Container Docker exécuté en tant que root
**Fichier :** `Dockerfile` (dernière étape, ligne ~14)

Le `Dockerfile` ne définit aucune instruction `USER`. L'application Node.js s'exécute avec les privilèges `root` dans le conteneur. En cas d'exploitation d'une vulnérabilité applicative (ex. path traversal), l'attaquant dispose des droits root dans le conteneur.

**Correctif :** Ajouter avant le `CMD` :
```dockerfile
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser
```

#### H-2 — `trustedOrigins` vide si `APP_URL` n'est pas définie
**Fichier :** `app/lib/server/auth.server.ts` (ligne 12)

```ts
trustedOrigins: env.APP_URL ? [env.APP_URL] : [],
```

`APP_URL` est marqué comme optionnel dans `env.server.ts`. Si cette variable n'est pas configurée en production, Better Auth reçoit un tableau vide pour `trustedOrigins`. Selon le comportement de la bibliothèque, cela peut soit bloquer toutes les requêtes cross-origin, soit n'appliquer aucune restriction. Dans les deux cas, la configuration est non déterministe en l'absence de documentation explicite sur ce cas.

**Correctif :** Rendre `APP_URL` obligatoire en production ou définir un fallback explicite et documenté :
```ts
trustedOrigins: [env.APP_URL ?? "http://localhost:3000"],
```

#### H-3 — Absence d'en-têtes de sécurité HTTP
**Fichier :** `app/root.tsx`, aucun middleware global détecté

L'application ne positionne aucun en-tête de sécurité HTTP standard :
- `Content-Security-Policy` (XSS)
- `X-Frame-Options` / `frame-ancestors` (clickjacking)
- `X-Content-Type-Options: nosniff`
- `Strict-Transport-Security` (HSTS, forcer HTTPS)
- `Referrer-Policy`

**Correctif :** Ajouter un middleware dans `entry.server.ts` ou dans le loader racine pour injecter ces en-têtes sur toutes les réponses.

#### H-4 — Rate limiting absent sur les routes de création de contenu
**Fichier :** `app/routes/feed.server.ts`, `app/routes/api.micro-predictions.ts`

Le rate limiting est correctement implémenté sur les routes `/api/auth/sign-in` et `/api/auth/sign-up` (`app/routes/api.auth.$.ts`). Cependant, les routes de création de posts, de commentaires, de réactions, et de réponses aux micro-pronostics n'ont aucune limitation de débit. Un utilisateur authentifié peut spammer massivement ces endpoints.

**Correctif :** Appliquer `checkRateLimit` sur les actions de création dans `feed.server.ts` et `api.micro-predictions.ts`, en utilisant `userId` comme clé.

---

### 🟡 MOYEN

#### M-1 — Risque de spoofing de l'IP pour contourner le rate limiting
**Fichier :** `app/routes/api.auth.$.ts` (lignes 5-11)

```ts
request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
request.headers.get("x-real-ip") ||
"unknown"
```

Si un proxy inverse (Nginx, Traefik) n'est pas configuré pour écraser les en-têtes `X-Forwarded-For`, un attaquant peut forger cet en-tête pour contourner le rate limiting et réessayer indéfiniment avec de fausses IPs.

**Correctif :** Vérifier que le reverse proxy (Synology DSM / Nginx) est configuré pour écraser et non appender l'en-tête. Alternativement, utiliser le `userId` comme clé de rate limiting supplémentaire pour les tentatives de login.

#### M-2 — Validation insuffisante du champ `answer` dans les micro-pronostics
**Fichier :** `app/routes/api.micro-predictions.ts` (lignes 80-97)

Le champ `answer` soumis par l'utilisateur est inséré en base de données sans validation de longueur ni de format. Un utilisateur peut soumettre une chaîne arbitrairement longue.

**Correctif :**
```ts
if (!answer || answer.length > 500) {
  return Response.json({ error: "Réponse invalide" }, { status: 400 });
}
```

#### M-3 — MIME type des uploads basé sur la déclaration client
**Fichier :** `app/lib/server/upload.ts` (ligne 11)

```ts
if (!ALLOWED_TYPES.includes(file.type)) { ... }
```

`file.type` provient du client HTTP et peut être falsifié. Un fichier malveillant pourrait passer la vérification en déclarant `image/jpeg`.

**Atténuation existante :** L'utilisation de `sharp` pour retraiter l'image en WebP protège efficacement contre les payloads camouflés (SVG avec XSS, polyglots). Le risque est limité.

**Amélioration recommandée :** Valider les premiers octets du buffer (magic bytes) plutôt que le Content-Type déclaré, ou confirmer que Sharp lève bien une erreur sur un fichier non-image.

#### M-4 — Port applicatif exposé directement sans reverse proxy dans `docker-compose.prod.yml`
**Fichier :** `docker-compose.prod.yml` (ligne 5)

```yaml
ports:
  - "3000:3000"
```

Le port 3000 est exposé directement sur l'hôte. Sans reverse proxy (Nginx, Traefik) devant, l'application est accessible en HTTP brut, sans terminaison TLS native.

**Correctif :** Faire passer le trafic via le reverse proxy du NAS Synology (déjà mentionné dans `DEPLOY.md`). Ne pas exposer le port 3000 directement si Nginx gère le TLS.

---

### 🔵 FAIBLE

#### L-1 — Contournement du typage TypeScript sur `session.user.role`
**Fichiers :** `app/routes/feed.server.ts` (lignes 96, 107), plusieurs routes

```ts
(session.user as any).role
```

L'utilisation de `as any` désactive la vérification de type. Si le champ `role` est un jour renommé ou retiré, ce contournement ne générera pas d'erreur de compilation.

**Correctif :** Étendre le type de session fourni par Better Auth pour inclure les champs additionnels, ou utiliser le type `Session` exporté depuis `auth.server.ts`.

#### L-2 — Requête N+1 dans le loader du fil d'actualité
**Fichier :** `app/routes/feed.server.ts` (lignes 41-79)

Pour chaque post (jusqu'à 50), 3 requêtes sont exécutées en parallèle (réactions, commentaires, like utilisateur). Cela génère jusqu'à 150 requêtes SQL par chargement de page, ce qui peut devenir un vecteur de DoS indirecte si la liste de posts grandit.

**Correctif :** Regrouper les requêtes avec des agrégats SQL ou une jointure avec `GROUP BY`.

#### L-3 — Pas de validation du `Content-Type` des requêtes API
**Fichier :** `app/routes/api.micro-predictions.ts`

L'action accepte `formData` sans vérifier que la requête a bien le `Content-Type: application/x-www-form-urlencoded` ou `multipart/form-data`. Des clients non-navigateur peuvent envoyer des formats inattendus.

---

## Points positifs constatés

| Domaine | État |
|---------|------|
| Variables d'environnement validées avec Zod | ✅ |
| Schémas de validation Zod sur tous les formulaires (user, match, feed) | ✅ |
| Authentification via Better Auth sur toutes les routes protégées | ✅ |
| Rate limiting sur les routes de login et d'inscription | ✅ |
| Credentials exclus du repo (`aed5841 security`) | ✅ |
| Requêtes SQL via ORM Drizzle (protégé contre l'injection SQL) | ✅ |
| Logs structurés (Pino) sans fuite d'informations sensibles | ✅ |
| Retraitement des avatars via Sharp (mitigation upload malveillant) | ✅ |
| Vérification anti-doublon sur les réponses aux micro-pronos | ✅ |
| Vérification du rôle admin sur toutes les actions admin | ✅ |

---

## Synthèse des actions recommandées

| Priorité | ID | Action | Effort |
|----------|----|--------|--------|
| 🔴 CRITIQUE | C-1 | Supprimer les mots de passe par défaut Docker | Faible |
| 🟠 ÉLEVÉ | H-1 | Ajouter un utilisateur non-root dans le Dockerfile | Faible |
| 🟠 ÉLEVÉ | H-2 | Rendre `APP_URL` obligatoire ou documenter le comportement | Faible |
| 🟠 ÉLEVÉ | H-3 | Ajouter les en-têtes de sécurité HTTP (middleware) | Moyen |
| 🟠 ÉLEVÉ | H-4 | Rate limiting sur les routes de création de contenu | Moyen |
| 🟡 MOYEN | M-1 | Vérifier la configuration du reverse proxy pour l'IP | Faible |
| 🟡 MOYEN | M-2 | Valider la longueur du champ `answer` | Faible |
| 🟡 MOYEN | M-3 | Valider les magic bytes des uploads | Faible |
| 🟡 MOYEN | M-4 | Ne pas exposer le port 3000 directement en prod | Faible |
| 🔵 FAIBLE | L-1 | Typer correctement `session.user.role` | Faible |
| 🔵 FAIBLE | L-2 | Optimiser les requêtes N+1 du feed | Moyen |
| 🔵 FAIBLE | L-3 | Valider le Content-Type des requêtes API | Faible |
