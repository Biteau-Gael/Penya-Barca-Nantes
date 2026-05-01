# Audit de sécurité — Penya Blaugrana Nantes

**Date** : 2026-05-01  
**Branche analysée** : `main` (commits jusqu'à `003faca`)  
**Analyseur** : Claude Code (claude-sonnet-4-6)

---

## Résumé des derniers commits

| Commit | Description |
|--------|-------------|
| `003faca` | fix: évaluer les badges immédiatement après chaque action (prono, post, commentaire, réaction) |
| `b1c88f6` | feat: Phase 2 — soirée match live, micro-pronos, badges, séries, saisons (2965 lignes ajoutées) |
| `d461ee5` | Merge: intégration de la branche deploy-synology-nas |
| `554b873` | docs: guide de déploiement rapide pour le NAS Synology |
| `68e22d2` | feat: menu burger mobile pour la navigation |
| `6aebaf7` | fix: Better Auth — correction des trusted origins pour le domaine custom |
| `9823bc5` | fix: ajout du service migrate dans docker-compose.prod.yml |

---

## Analyse de sécurité par ordre de criticité

---

### CRITIQUE

#### 1. Path Traversal — Serveur de fichiers statiques

**Fichier** : `app/routes/uploads-files.ts:5`  
**Vecteur** : Accès non authentifié

```ts
const filePath = path.join(process.cwd(), "uploads", params["*"]);
```

Le chemin est construit directement depuis le paramètre de route sans vérifier que le résultat reste dans le répertoire `uploads/`. Un attaquant peut forger une requête HTTP brute avec des séquences `..%2F` (encodage non normalisé) pour accéder à des fichiers arbitraires du serveur (`/proc/1/environ`, `.env`, etc.).

**Correctif recommandé** : Ajouter une vérification `startsWith` après résolution du chemin.

```ts
const uploadsDir = path.resolve(process.cwd(), "uploads");
const filePath = path.resolve(uploadsDir, params["*"]);

if (!filePath.startsWith(uploadsDir + path.sep)) {
  return new Response("Forbidden", { status: 403 });
}
```

---

### HAUTE

#### 2. IP Spoofing possible dans le rate limiting

**Fichier** : `app/routes/api.auth.$.ts:7-9`  
**Vecteur** : Contournement du rate limiting par un attaquant

```ts
request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
request.headers.get("x-real-ip") ||
"unknown"
```

L'IP est lue directement depuis les en-têtes HTTP sans garantie que l'application est derrière un reverse proxy de confiance. Un attaquant peut injecter `X-Forwarded-For: 1.2.3.4` depuis une connexion directe et changer d'IP fictive à chaque tentative, contournant entièrement le rate limiting sur login/inscription.

**Correctif recommandé** : Configurer un reverse proxy (Nginx/Traefik) en amont qui réécrit cet en-tête, ou utiliser une liste blanche d'IP de proxy de confiance avant d'accepter `x-forwarded-for`.

---

#### 3. Mots de passe par défaut faibles en production

**Fichier** : `docker-compose.prod.yml:22,31`

```yaml
POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-changeme}
redis-server --requirepass ${REDIS_PASSWORD:-changeme}
```

Si le fichier `.env` de production est absent ou incomplet, les services démarrent avec le mot de passe `changeme`. Cela expose la base de données et Redis à une compromission immédiate si les ports sont accessibles (même sur le réseau local NAS).

**Correctif recommandé** : Supprimer les valeurs par défaut (ne pas utiliser `:-changeme`) et faire échouer explicitement le démarrage si les variables ne sont pas définies. Documenter l'obligation de créer le `.env` avant tout `docker compose up`.

---

### MOYENNE

#### 4. Absence de headers de sécurité HTTP

**Fichier** : `app/root.tsx` (aucun header de sécurité global)

L'application ne positionne pas les en-têtes de sécurité HTTP standard :
- `Content-Security-Policy` (protection XSS)
- `X-Frame-Options: DENY` (protection clickjacking)
- `X-Content-Type-Options: nosniff`
- `Strict-Transport-Security` (HSTS)
- `Referrer-Policy`

**Correctif recommandé** : Ajouter un middleware dans `entry.server.tsx` ou dans la configuration Nginx pour injecter ces en-têtes sur toutes les réponses.

---

#### 5. Champ `type` non validé dans les micro-pronostics

**Fichier** : `app/routes/api.micro-predictions.ts:21`

```ts
const type = (formData.get("type") as string) || "qcm";
```

La valeur `type` est insérée en base de données sans vérification contre une liste de valeurs autorisées. Un admin pourrait saisir une valeur inattendue qui causerait des erreurs silencieuses ou des comportements indéfinis côté affichage.

**Correctif recommandé** :

```ts
const ALLOWED_TYPES = ["qcm", "libre"] as const;
const rawType = formData.get("type") as string;
const type = ALLOWED_TYPES.includes(rawType as typeof ALLOWED_TYPES[number]) ? rawType : "qcm";
```

---

#### 6. Endpoint `/api/health` non protégé — fuite d'informations infrastructure

**Fichier** : `app/routes/api.health.ts`

L'endpoint est public et retourne l'état de PostgreSQL et Redis. Ces informations facilitent la reconnaissance de l'infrastructure (présence d'une base de données, état des services).

**Correctif recommandé** : Restreindre l'accès par IP (liste blanche dans Nginx) ou ajouter un token secret dans les headers pour les vérifications externes (monitoring).

---

#### 7. Dockerfile — conteneur s'exécute en tant que root

**Fichier** : `Dockerfile:17-21`

L'image finale `node:20-alpine` contient un utilisateur `node` (UID 1000) mais il n'est jamais activé. L'application tourne donc en `root` dans le conteneur, ce qui amplifie l'impact d'une éventuelle compromission applicative.

**Correctif recommandé** : Ajouter avant `CMD` :

```dockerfile
USER node
```

Et s'assurer que le répertoire `/app` est accessible à cet utilisateur (`COPY --chown=node:node`).

---

### FAIBLE / INFORMATIONNEL

#### 8. Cast `as any` pour accéder au rôle utilisateur

**Fichiers** : `app/routes/feed.server.ts:99,124,184`, `app/routes/match-detail.server.ts`

```ts
isAdmin: (session.user as any).role === "admin"
```

Le contournement du typage TypeScript via `as any` masque d'éventuelles régressions si la structure de `session.user` change. La protection fonctionnelle est correcte, mais le code est fragile.

**Correctif recommandé** : Étendre le type `session.user` avec le champ `role` ou utiliser une fonction utilitaire typée.

---

#### 9. `seedBadges` appelée à chaque évaluation de badge

**Fichier** : `app/lib/server/badges.server.ts:157`

```ts
export async function evaluateBadges(userId: string) {
  await seedBadges(); // Requête DB systématique
  ...
}
```

`seedBadges` exécute une requête `SELECT` sur la table `badges` à chaque appel d'`evaluateBadges`. En production, cette table est statique et ce pattern génère une requête superflue à chaque action utilisateur (post, commentaire, réaction, pronostic).

**Correctif recommandé** : Utiliser un flag en mémoire (`let seeded = false`) ou appeler `seedBadges` une seule fois au démarrage de l'application.

---

#### 10. Credentials supprimés du dépôt — historique git potentiellement sensible

**Commit** : `aed5841` — `security: supprimer credentials du repo et renforcer .gitignore`

Des credentials (`.claude/settings.local.json`) ont été committés puis supprimés. Le commit `aed5841` montre que des données sensibles existent dans l'historique git. Si le dépôt est ou devient public, ces données restent accessibles via `git show`.

**Correctif recommandé** : Effectuer un `git filter-repo` pour purger le fichier de l'historique complet si le dépôt risque d'être rendu public, et révoquer/régénérer tous les secrets éventuellement exposés.

---

## Points positifs constatés

- **Rate limiting** sur login et inscription avec Redis, fenêtre glissante correcte.
- **Validation Zod** systématique sur les formulaires critiques (création/modification de match, profil).
- **ORM Drizzle** utilisé pour toutes les requêtes DB — pas de SQL brut concaténé, pas de risque d'injection SQL directe.
- **Contrôle d'autorisation** cohérent : `requireAuth` sur toutes les routes protégées, vérification du rôle `admin` sur les actions sensibles.
- **Traitement des avatars** via `sharp` : conversion WebP + redimensionnement + validation MIME avant écriture disque.
- **Variables d'environnement** validées avec Zod au démarrage (`env.server.ts`), `AUTH_SECRET` forcé à 16 caractères minimum.
- **Protection auto-suppression admin** : un admin ne peut pas supprimer ni changer le rôle de son propre compte.
- **Logs structurés** avec pino sur toutes les actions sensibles.

---

## Tableau de synthèse

| # | Criticité | Fichier | Problème | Effort correctif |
|---|-----------|---------|----------|-----------------|
| 1 | CRITIQUE | `uploads-files.ts:5` | Path Traversal | Faible (2 lignes) |
| 2 | HAUTE | `api.auth.$.ts:7` | IP Spoofing / contournement rate limit | Moyen (config proxy) |
| 3 | HAUTE | `docker-compose.prod.yml:22,31` | Mots de passe par défaut `changeme` | Faible (supprimer defaults) |
| 4 | MOYENNE | `root.tsx` | Absence de headers de sécurité HTTP | Moyen (middleware) |
| 5 | MOYENNE | `api.micro-predictions.ts:21` | Champ `type` non validé | Faible (whitelist) |
| 6 | MOYENNE | `api.health.ts` | Endpoint public révèle l'infra | Faible (auth token) |
| 7 | MOYENNE | `Dockerfile:21` | Conteneur tourne en root | Faible (USER node) |
| 8 | FAIBLE | `feed.server.ts:99` | Cast `as any` sur le rôle | Faible (typage) |
| 9 | FAIBLE | `badges.server.ts:157` | `seedBadges` appelée trop souvent | Faible (flag mémoire) |
| 10 | INFO | git history | Credentials dans l'historique git | Moyen (filter-repo) |
