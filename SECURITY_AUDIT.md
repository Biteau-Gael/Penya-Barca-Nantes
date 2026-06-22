# Audit Sécurité — Penya Blaugrana Nantes
**Date :** 2026-06-22  
**Scope :** Commits jusqu'au `003faca` (Phase 2 complète)  
**Analysé par :** Revue de code manuelle (routes API, serveur, DB, Docker)

---

## Résumé des derniers commits

| Hash | Date | Auteur | Description |
|------|------|--------|-------------|
| `003faca` | 13 avr. 2026 | Biteau Gaël | **fix:** évaluer les badges immédiatement après chaque action (soumission prono, post, commentaire, réaction) |
| `b1c88f6` | 13 avr. 2026 | Biteau Gaël | **feat:** Phase 2 — soirée match live, micro-pronos, badges, séries, saisons (migration 0007) |
| `d461ee5` | 12 avr. 2026 | Biteau Gaël | **merge:** intégration branche deploy-synology-nas |
| `554b873` | 12 avr. 2026 | Biteau Gaël | **docs:** guide de déploiement NAS Synology (mises à jour) |
| `68e22d2` | 13 avr. 2026 | Biteau Gaël | **feat:** menu burger mobile pour la navigation |
| `6aebaf7` | 12 avr. 2026 | Biteau Gaël | **fix:** Better Auth trusted origins pour support domaine personnalisé |
| `9823bc5` | 12 avr. 2026 | Biteau Gaël | **feat:** service migrate dans docker-compose.prod.yml |
| `8d6e5e9` | 12 avr. 2026 | Biteau Gaël | **feat:** Docker Compose production + script backup pour Synology NAS |
| `aed5841` | 12 avr. 2026 | Biteau Gaël | **security:** suppression credentials du repo, renforcement .gitignore |
| `ab7fc5d` | 12 avr. 2026 | Biteau Gaël | **feat:** intégration API Football + stats enrichies + classement Liga |
| `16c43e6` | 11 avr. 2026 | Biteau Gaël | **feat:** MVP Phase 1 — application complète (auth, pronos, feed, profil, admin) |

---

## Analyse de sécurité par criticité

---

### 🔴 CRITIQUE

#### C-1 — Path Traversal dans le serveur de fichiers statiques
**Fichier :** `app/routes/uploads-files.ts` — ligne 5  
**Commit introduit :** `16c43e6` (MVP Phase 1)

**Problème :**
```ts
const filePath = path.join(process.cwd(), "uploads", params["*"]);
```
Le paramètre de route `params["*"]` est utilisé directement dans la construction du chemin sans aucune validation. Un attaquant peut injecter des séquences `../` pour sortir du répertoire `uploads/` et lire des fichiers arbitraires sur le système :

- `/uploads/../../etc/passwd` → lit `/etc/passwd`
- `/uploads/../.env` → expose la clé `AUTH_SECRET` et `API_FOOTBALL_KEY`

**Correction recommandée :**
```ts
const uploadRoot = path.resolve(process.cwd(), "uploads");
const filePath = path.resolve(uploadRoot, params["*"]);

// Bloquer tout chemin qui sort du répertoire autorisé
if (!filePath.startsWith(uploadRoot + path.sep)) {
  return new Response("Forbidden", { status: 403 });
}
```

---

### 🟠 ÉLEVÉ

#### H-1 — Race Condition (TOCTOU) sur les votes micro-pronostics
**Fichier :** `app/routes/api.micro-predictions.ts` — lignes 109–128  
**Commit introduit :** `b1c88f6` (Phase 2)

**Problème :**
La vérification "l'utilisateur a-t-il déjà voté ?" et l'insertion de la réponse sont deux opérations séparées et non atomiques :
```ts
// 1. Vérification
const [existing] = await db.select()...where(and(eq(...microId), eq(...userId)));
if (existing) return { error: "Déjà répondu" };

// 2. Insertion (race condition ici)
await db.insert(microPredictionAnswers).values({ ... });
```
Deux requêtes simultanées (double-clic, replay d'une requête HTTP) peuvent passer la vérification avant qu'une des deux n'ait inséré. Si la table `micro_prediction_answers` a une contrainte `UNIQUE(microPredictionId, userId)`, cela lèvera une exception non gérée. Si elle n'en a pas, un utilisateur peut voter plusieurs fois.

**Correction recommandée :**
1. Ajouter une contrainte `UNIQUE` en base : `unique(microPredictions.id, microPredictionAnswers.userId)` dans le schéma Drizzle.
2. Utiliser `INSERT ... ON CONFLICT DO NOTHING` ou gérer l'exception d'unicité dans un `try/catch`.

#### H-2 — Dockerfile : exécution en root
**Fichier :** `Dockerfile` — image finale (ligne 17)  
**Commit introduit :** `8d6e5e9`

**Problème :**
L'image finale n'ajoute aucun utilisateur non-privilégié. L'application Node.js s'exécute donc en tant que `root` dans le conteneur. En cas de RCE (Remote Code Execution), l'attaquant obtient les droits root dans le conteneur, simplifiant l'escalade ou la sortie du conteneur.

**Correction recommandée :**
```dockerfile
FROM node:20-alpine
# ... copies ...
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser
CMD ["npm", "run", "start"]
```

---

### 🟡 MOYEN

#### M-1 — Requête SQL brute dans badges.server.ts
**Fichier :** `app/lib/server/badges.server.ts` — ligne 141  
**Commit introduit :** `b1c88f6` (Phase 2)

**Problème :**
```ts
const [userRow] = await db
  .select({ bestStreak: sql<number>`coalesce(best_streak, 0)::int` })
  .from(sql`"user"`)          // ← SQL brut pour la table
  .where(sql`id = ${userId}`); // ← paramètre correctement échappé par Drizzle
```
Le `userId` est bien paramétré donc pas d'injection SQL directe, mais l'utilisation de `sql\`"user"\`` pour référencer la table contourne l'API Drizzle. Si le nom de table change, aucune erreur de compilation ne se produira. La syntaxe correcte est `.from(user)` avec l'objet de schéma importé.

**Correction recommandée :**
```ts
import { user } from "~/db/schema";

const [userRow] = await db
  .select({ bestStreak: user.bestStreak })
  .from(user)
  .where(eq(user.id, userId));
```

#### M-2 — Mots de passe de fallback "changeme" en production
**Fichier :** `docker-compose.prod.yml` — lignes 22 et 29  
**Commit introduit :** `8d6e5e9`

**Problème :**
```yaml
POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-changeme}
# redis-server --requirepass ${REDIS_PASSWORD:-changeme}
```
Si les variables `POSTGRES_PASSWORD` et `REDIS_PASSWORD` ne sont pas définies dans le fichier `.env` de production, les services démarrent avec le mot de passe `changeme`. Ce comportement de fallback est silencieux et dangereux.

**Correction recommandée :**
Supprimer le fallback `:-changeme` et s'assurer que la validation côté `getEnv()` (`app/config/env.server.ts`) couvre également ces variables, ou utiliser un `required: true` dans le Compose :
```yaml
POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?POSTGRES_PASSWORD must be set}
```

#### M-3 — Absence de rate-limiting sur les actions utilisateur
**Fichiers :** `app/routes/api.micro-predictions.ts`, `app/routes/feed.server.ts`  
**Commit introduit :** `b1c88f6` (Phase 2)

**Problème :**
Le module `rate-limit.server.ts` existe et est fonctionnel, mais il n'est appliqué sur aucune des routes sensibles introduites en Phase 2 :
- Soumission de micro-pronostic → spam possible
- Publication de post / commentaire → flood du fil
- Réaction → manipulation des compteurs

**Correction recommandée :**
Appliquer `checkRateLimit` sur les intentions sensibles, en identifiant par `userId` :
```ts
await checkRateLimit({
  key: `micro-answer:${session.user.id}`,
  maxAttempts: 10,
  windowSeconds: 60,
});
```

#### M-4 — Cast `as any` pour les vérifications de rôle
**Fichier :** `app/routes/feed.server.ts` — lignes 99, 124, 184  
**Commit introduit :** `16c43e6` (MVP Phase 1)

**Problème :**
```ts
const isAdmin = (session.user as any).role === "admin";
```
Le cast `as any` supprime la vérification TypeScript. Si le type `Session` de Better Auth évolue ou si le champ `role` est renommé, le contrôle d'accès sera silencieusement cassé sans erreur de compilation. La fonction `requireAuth(request, ["admin"])` disponible dans `auth-utils.server.ts` devrait être utilisée à la place.

**Correction recommandée :**
Importer et utiliser `Role` depuis `auth-utils.server.ts` :
```ts
const isAdmin = (session.user.role as Role) === "admin";
// ou mieux, forcer via requireAuth
```

---

### 🟢 FAIBLE

#### F-1 — trustedOrigins vide si APP_URL absent
**Fichier :** `app/lib/server/auth.server.ts` — ligne 12  
**Commit introduit :** `6aebaf7`

**Problème :**
```ts
trustedOrigins: env.APP_URL ? [env.APP_URL] : [],
```
Si `APP_URL` n'est pas défini en production, `trustedOrigins` est un tableau vide. Le comportement de Better Auth dans ce cas (tout accepter ou tout refuser) n'est pas documenté clairement et mérite une vérification.

**Recommandation :** Rendre `APP_URL` obligatoire dans `env.server.ts` en production ou définir explicitement une valeur par défaut sûre.

#### F-2 — Email utilisateur inclus dans le payload loader profil
**Fichier :** `app/routes/profile.server.ts` — ligne 83  
**Commit introduit :** `16c43e6`

**Problème :**
```ts
email: userData.email,
```
L'email est inclus dans les données hydratées côté client (accessible dans le JS du navigateur). C'est attendu pour la page de profil propre à l'utilisateur, mais si cette structure était réutilisée pour afficher des profils publics, l'email serait exposé.

**Recommandation :** Bien s'assurer que ce loader n'est jamais réutilisé pour des profils tiers (la route `member-profile.server.ts` doit ne pas exposer les emails).

#### F-3 — Pas de timeout sur les appels API Football externe
**Fichier :** `app/routes/soiree.server.ts` — lignes 36, 83–86  
**Commit introduit :** `b1c88f6`

**Problème :**
Les appels `fetch()` vers l'API RapidAPI externe n'ont pas de `AbortSignal` / timeout. Si l'API est lente ou indisponible, la requête serveur peut rester bloquée indéfiniment, bloquant potentiellement le pool de connexions.

**Correction recommandée :**
```ts
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 5000);
const response = await fetch(url, { signal: controller.signal, headers: { ... } });
clearTimeout(timeout);
```

---

### ℹ️ INFO

#### I-1 — seedBadges() appelé à chaque évaluation
**Fichier :** `app/lib/server/badges.server.ts` — ligne 157  
**Commit introduit :** `b1c88f6`

`seedBadges()` effectue une requête SELECT + potentiellement 10 INSERT à chaque appel à `evaluateBadges()`, lui-même appelé à chaque post, commentaire et réaction. En charge, cela génère un volume de requêtes inutile.

**Recommandation :** Appeler `seedBadges()` uniquement au démarrage de l'application ou lors du bootstrap, pas à chaque évaluation.

#### I-2 — Pas de Content Security Policy (CSP)
Aucun header `Content-Security-Policy` n'est configuré dans les réponses serveur. En cas de faille XSS, l'absence de CSP facilite l'exfiltration de données.

**Recommandation :** Ajouter un middleware de headers de sécurité (ex: `helmet` pour Express, ou configuration manuelle dans le `entry.server.tsx`).

#### I-3 — Logs avec IDs utilisateurs (conformité RGPD)
Les logs structurés incluent régulièrement `userId` (ex: `logger.info({ userId: session.user.id })`). En cas de fuite des logs, les IDs sont exposés. Ce n'est pas une vulnérabilité critique mais mérite d'être documenté dans la politique de rétention des logs.

---

## Points positifs constatés

- **Authentification systématique** : toutes les routes sensibles utilisent `requireAuth()` ou `requireAuth(request, ["admin"])`.
- **Validation des entrées** : les routes admin utilisent des schémas Zod (`createMatchSchema`, `updateMatchSchema`, `updateProfileSchema`).
- **ORM paramétré** : l'ensemble des requêtes DB utilise Drizzle ORM avec des paramètres liés, sans concaténation SQL directe (sauf le cas M-1).
- **Gestion du upload avatar** : validation du type MIME, limite de taille (2 Mo), conversion via Sharp — bonne pratique.
- **Séparation des rôles** : la vérification admin est cohérente sur toutes les routes d'administration (`admin.*`).
- **Secrets retirés du repo** : commit `aed5841` a correctement nettoyé les credentials et renforcé le `.gitignore`.
- **Healthchecks Docker** : PostgreSQL et Redis ont des healthchecks configurés dans docker-compose.prod.yml.

---

---

### Findings complémentaires (revue approfondie)

#### C-2 — Race Condition sur le double vote pronostic de match
**Fichier :** `app/routes/match-detail.server.ts`  
Même problème TOCTOU que C-1 sur les micro-pronos : SELECT puis INSERT/UPDATE non atomique. Le schéma `matchPredictions` n'a pas de contrainte `UNIQUE(userId, matchId)`.  
**Correction :** Ajouter un `uniqueIndex` Drizzle + utiliser `.onConflictDoUpdate()`.

#### H-3 — `correctAnswer` exposée avant clôture officielle
**Fichier :** `app/routes/soiree.server.ts` — ligne 254  
La bonne réponse d'un micro-pronostic était renvoyée au client même si le micro-pronostic n'était pas encore clôturé. ✅ **Corrigé dans ce commit.**

#### H-4 — Champs admin non validés sur création micro-pronostic
**Fichier :** `app/routes/api.micro-predictions.ts` — lignes 21–39  
`type`, `pointsValue` et `deadlineSeconds` ne passent pas par un schéma Zod. Un admin pourrait créer un micro-pronostic à `pointsValue = -100`, retirant des points aux joueurs.  
**Correction :** Valider avec `z.enum(["qcm", "score", "player"])`, `z.number().int().min(1).max(100)`, etc.

#### H-5 — Aucun header de sécurité HTTP (CSP, HSTS, X-Frame-Options)
**Fichier :** `docker/nginx/nginx.conf`  
Pas de `Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Options`, ni `Strict-Transport-Security`.  
**Correction :** Ajouter les headers dans la config nginx.

#### M-5 — Suppression de compte sans révocation des sessions Redis
**Fichier :** `app/routes/profile.server.ts` — ligne 128  
L'entrée `user` est supprimée mais les sessions Better Auth stockées dans Redis peuvent rester actives. Appeler `auth.api.revokeAllSessions()` avant suppression.

#### M-6 — Endpoint `/api/health` public expose l'état des services internes
**Fichier :** `app/routes/api.health.ts`  
Accessible sans authentification, révèle si PostgreSQL et Redis sont opérationnels. Restreindre par IP ou supprimer les détails dans la réponse publique.

#### F-3 — Erreurs `evaluateBadges` silencieuses
**Fichiers :** `app/routes/feed.server.ts`, `app/routes/match-detail.server.ts`  
`.catch(() => {})` supprime silencieusement toutes les erreurs. Remplacer par `.catch((err) => logger.error({ err }, "Erreur evaluateBadges"))`.

#### F-4 — Validation MIME avatar par `file.type` (forgeable)
**Fichier :** `app/lib/server/upload.ts` — ligne 13  
`file.type` est fourni par le client et peut être forgé. Valider les magic bytes via la librairie `file-type`.

---

## Plan d'action prioritaire

| Priorité | Ticket | Statut | Effort restant |
|----------|--------|--------|----------------|
| 🔴 C-1 — Path Traversal uploads | Corriger `uploads-files.ts` | ✅ Corrigé | — |
| 🔴 C-2 — Race condition match-predictions | Contrainte UNIQUE en DB | ⏳ À faire | 1h |
| 🟠 H-1 — Race condition micro-pronos | Contrainte UNIQUE en DB | ⏳ À faire | 1h |
| 🟠 H-3 — correctAnswer exposée | `soiree.server.ts` masquage | ✅ Corrigé | — |
| 🟠 H-2 — Dockerfile root | Ajouter `USER appuser` | ⏳ À faire | 15 min |
| 🟠 H-4 — Validation champs admin micro-pronos | Schéma Zod | ⏳ À faire | 1h |
| 🟠 H-5 — Headers HTTP sécurité | Config nginx | ⏳ À faire | 1h |
| 🟡 M-1 — SQL brut badges | `.from(user)` Drizzle | ✅ Corrigé | — |
| 🟡 M-2 — Mots de passe fallback Docker | `${VAR:?message}` | ✅ Corrigé | — |
| 🟡 M-3 — Rate limiting routes API | `checkRateLimit` sur feed et micro-pronos | ⏳ À faire | 1h |
| 🟡 M-4 — Cast `as any` rôle | Typer correctement le rôle | ⏳ À faire | 30 min |
| 🟡 M-5 — Révocation sessions à suppression compte | `revokeAllSessions()` | ⏳ À faire | 30 min |
| 🟡 M-6 — Health endpoint public | Restreindre par IP/token | ⏳ À faire | 30 min |
| 🟢 F-3 — Erreurs evaluateBadges silencieuses | Logger les erreurs | ⏳ À faire | 15 min |
| 🟢 F-4 — MIME avatar forgeable | Validation magic bytes | ⏳ À faire | 1h |
