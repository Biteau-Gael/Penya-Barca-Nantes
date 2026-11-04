# Rapport d'analyse de sécurité — Penya Blaugrana Nantes

> Généré le 2026-11-04 | Branche analysée : `claude/sharp-fermi-3p1t3a`

---

## Résumé des derniers commits

| Hash | Date | Description |
|------|------|-------------|
| `003faca` | 2026-04-13 | fix: évaluer les badges immédiatement après chaque action |
| `b1c88f6` | 2026-04-13 | feat: Phase 2 — soirée match live, micro-pronos, badges, séries, saisons |
| `d461ee5` | 2026-04-12 | Merge branch deploy-synology-nas |
| `554b873` | 2026-04-12 | Add deployment guide for Synology NAS updates |
| `68e22d2` | 2026-04-13 | feat: menu burger mobile pour la navigation |
| `6aebaf7` | 2026-04-12 | Fix Better Auth trusted origins for custom domain support |
| `9823bc5` | 2026-04-12 | Add migrate service to docker-compose.prod.yml |
| `8d6e5e9` | 2026-04-12 | Add production Docker Compose and backup script for Synology NAS |

**Phase 2 (commit `b1c88f6`)** est le commit le plus important : il introduit 2 965 lignes couvrant 6 nouvelles tables DB (seasons, badges, user_badges, rewards, micro_predictions, micro_prediction_answers), 2 nouvelles routes, et les fonctionnalités de badges automatiques, micro-pronostics et soirée match en direct.

---

## Analyse de sécurité — par ordre de criticité

### 🔴 ÉLEVÉ

#### 1. Mots de passe par défaut dans docker-compose.prod.yml

**Fichier** : `docker-compose.prod.yml` (lignes 21, 28)

```yaml
POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-changeme}
redis-server --requirepass ${REDIS_PASSWORD:-changeme}
```

**Risque** : Si les variables d'environnement `POSTGRES_PASSWORD` et `REDIS_PASSWORD` ne sont pas définies lors du déploiement en production, les services démarrent avec le mot de passe `changeme`. En cas d'oubli ou d'erreur de configuration, la base de données et Redis seraient accessibles avec des credentials triviaux.

**Recommandation** : Supprimer les valeurs par défaut (`:-changeme`) pour forcer une erreur explicite si la variable est absente, et ajouter une vérification dans le script de démarrage.

```yaml
# À la place de :
POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-changeme}
# Utiliser :
POSTGRES_PASSWORD=${POSTGRES_PASSWORD:?POSTGRES_PASSWORD must be set}
```

---

#### 2. En-tête IP spoofable — contournement du rate limiting

**Fichier** : `app/routes/api.auth.$.ts` (lignes 7-9)

```ts
request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
request.headers.get("x-real-ip") ||
"unknown"
```

**Risque** : Sans proxy de confiance validé, n'importe quel client peut envoyer un en-tête `X-Forwarded-For` arbitraire pour usurper son adresse IP. Cela permet de contourner le rate limiting sur les routes `/sign-in` et `/sign-up` en changeant d'IP simulée à chaque tentative.

**Recommandation** : Accepter ces en-têtes uniquement si la requête provient d'un proxy de confiance (par exemple, l'IP du reverse proxy Nginx sur le NAS Synology), ou utiliser une bibliothèque comme `@fastify/forwarded` qui gère la validation de la chaîne de proxies.

---

### 🟡 MOYEN

#### 3. Validation des entrées manquante sur les micro-pronostics

**Fichier** : `app/routes/api.micro-predictions.ts`

**Risque** : Les champs `question`, `answer`, `options` et `correctAnswer` sont utilisés sans validation Zod ni limite de taille. Un utilisateur mal intentionné pourrait :
- Soumettre une réponse de taille arbitrairement grande (payload flooding)
- Injecter des caractères spéciaux dans `question` ou `options` qui seraient ensuite rendus dans l'UI

Contrairement aux autres routes (`admin.matches.server.ts`, `feed.ts`) qui utilisent des schémas Zod, cette route fait seulement des vérifications de nullité.

**Recommandation** : Ajouter un schéma Zod avec des limites explicites :

```ts
const createMicroSchema = z.object({
  matchId: z.string().min(1).max(50),
  question: z.string().min(5).max(300),
  type: z.enum(["qcm", "libre"]),
  options: z.string().max(500).optional(),
  pointsValue: z.coerce.number().int().min(1).max(10),
  deadlineSeconds: z.coerce.number().int().min(30).max(600),
});

const answerMicroSchema = z.object({
  microId: z.string().min(1).max(50),
  answer: z.string().min(1).max(200),
});
```

---

#### 4. `trustedOrigins` vide si `APP_URL` non défini

**Fichier** : `app/lib/server/auth.server.ts` (ligne 12)

```ts
trustedOrigins: env.APP_URL ? [env.APP_URL] : [],
```

**Risque** : Si `APP_URL` n'est pas défini (cas possible en développement ou si oublié en production), `trustedOrigins` vaut `[]`. Le comportement de Better Auth avec une liste d'origines vide n'est pas clairement documenté — cela pourrait soit bloquer toutes les requêtes cross-origin, soit accepter toutes les origines selon la version.

Le commit `6aebaf7` a partiellement adressé ce point, mais sans solution complète.

**Recommandation** : Rendre `APP_URL` obligatoire dans le schéma Zod d'environnement, ou fournir une valeur par défaut explicite pour le développement :

```ts
APP_URL: z.string().url().default("http://localhost:3000"),
```

---

### 🟢 FAIBLE / BONNES PRATIQUES

#### 5. Absence d'en-têtes HTTP de sécurité (CSP, HSTS, X-Frame-Options)

**Risque** : Aucun en-tête de sécurité HTTP (`Content-Security-Policy`, `Strict-Transport-Security`, `X-Frame-Options`, `X-Content-Type-Options`) n'est configuré au niveau de l'application. Ces en-têtes protègent contre le clickjacking, le XSS via injection de scripts externes, et le downgrade HTTPS.

**Recommandation** : Configurer ces en-têtes soit dans le reverse proxy Nginx du NAS (recommandé), soit dans le middleware React Router :

```nginx
# Nginx
add_header X-Frame-Options "SAMEORIGIN";
add_header X-Content-Type-Options "nosniff";
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains";
add_header Content-Security-Policy "default-src 'self'; ...";
```

---

#### 6. Rate limiting uniquement sur auth — pas sur les autres API

**Risque** : Le rate limiting est correctement appliqué sur `/api/auth/sign-in` et `/api/auth/sign-up`, mais les autres endpoints d'action (`/api/micro-predictions`, `/api/sync-matches`) n'ont pas de limitation. Un utilisateur authentifié pourrait spammer les micro-pronostics ou la synchronisation des matchs.

**Recommandation** : Envisager d'étendre le rate limiting aux actions sensibles (vote micro-prono : 1 vote/question/user déjà contrôlé en DB, mais sync-matches pourrait être limité à quelques appels par minute).

---

## Points positifs confirmés

| Domaine | Statut | Détail |
|---------|--------|--------|
| Authentification | ✅ | Better Auth avec sessions sécurisées et stockage Redis |
| Autorisation RBAC | ✅ | Vérification `role === "admin"` sur toutes les actions admin |
| Rate limiting auth | ✅ | 10 tentatives/15min (login), 5/heure (inscription) |
| Validation d'entrée | ✅ | Zod sur match, prediction, user, feed |
| Prévention SQL injection | ✅ | Drizzle ORM avec requêtes paramétrées |
| Secrets non commités | ✅ | `.env` dans `.gitignore`, `.env.example` avec placeholders |
| Validation d'env au démarrage | ✅ | Schéma Zod sur `process.env` au boot |
| Pas de secrets dans les logs | ✅ | Logs structurés (Pino) sans données sensibles |
| Double vote micro-prono | ✅ | Vérification en DB avant insertion |

---

## Résumé exécutif

Le codebase présente un niveau de sécurité solide pour une application communautaire. Les deux points les plus urgents à corriger avant une mise en production sont :

1. **Supprimer les mots de passe par défaut** (`changeme`) dans `docker-compose.prod.yml` — risque direct de compromission de la base de données si mal configuré.
2. **Ajouter la validation Zod** sur les micro-pronostics (`api.micro-predictions.ts`) pour être cohérent avec le reste du codebase et prévenir les abus.

Les points sur les en-têtes HTTP de sécurité et l'IP spoofing sont à traiter idéalement au niveau du reverse proxy Nginx lors du déploiement sur le NAS Synology.
