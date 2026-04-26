# Audit de sécurité — Penya Blaugrana Nantes
**Date :** 26 avril 2026  
**Branche analysée :** `main` (HEAD : `003faca`)  
**Analysé par :** Claude Sonnet 4.6

---

## 1. Résumé des derniers commits

| Hash | Date | Description |
|------|------|-------------|
| `003faca` | 2026-04-13 | **fix:** évaluer les badges immédiatement après chaque action (soumission prono, post, commentaire, réaction) |
| `b1c88f6` | 2026-04-13 | **feat:** Phase 2 — soirée match live, micro-pronos, badges, séries, saisons (sprint 2/3/5 complets) |
| `68e22d2` | 2026-04-13 | **feat:** menu burger mobile pour la navigation |
| `554b873` | 2026-04-12 | **docs:** guide de déploiement Synology NAS (mises à jour) |
| `6aebaf7` | 2026-04-12 | **fix:** correction des `trustedOrigins` Better Auth pour domaine custom |
| `9823bc5` | 2026-04-12 | **feat:** service `migrate` dans `docker-compose.prod.yml` |
| `8d6e5e9` | 2026-04-12 | **feat:** Docker Compose production + script de backup Synology |
| `3d80133` | 2026-04-12 | **docs:** roadmap Phase 2 — 8 priorités documentées |
| `aed5841` | 2026-04-12 | **security:** suppression des credentials du repo + renforcement `.gitignore` |
| `6583da3` | 2026-04-12 | **docs:** README complet avec guide déploiement NAS |
| `ab7fc5d` | 2026-04-12 | **feat:** intégration API Football + stats enrichies + classement Liga |
| `16c43e6` | 2026-04-11 | **feat:** MVP Phase 1 — application complète (auth, pronos, feed, profil, admin) |

### Points notables des derniers sprints
- **Phase 2** (commit `b1c88f6`) est le plus impactant : 2 965 lignes ajoutées, 6 nouvelles tables DB, 3 nouvelles routes publiques (`/soiree/:matchId`, `/badges`, API micro-pronos), extension du profil et du classement.
- Le **fix badge** (`003faca`) corrige un bug de timing : l'évaluation était différée, elle est maintenant déclenchée immédiatement après chaque action.
- Les **déploiements Synology** ont introduit des fichiers Docker de production et un script `backup.sh`.

---

## 2. Analyse de sécurité — par ordre de criticité

---

### 🔴 CRITIQUE

#### C1 — Mots de passe par défaut `changeme` en production
**Fichier :** `docker-compose.prod.yml` — lignes 23 et 32  
**Description :** Les variables d'environnement `POSTGRES_PASSWORD` et `REDIS_PASSWORD` ont un fallback `changeme` si `.env` est absent ou incomplet.
```yaml
POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-changeme}
redis-server --requirepass ${REDIS_PASSWORD:-changeme}
```
**Risque :** En cas d'oubli de configuration du `.env` en production, la base de données et Redis sont accessibles avec un mot de passe trivial, connu publiquement.  
**Correction recommandée :** Supprimer les valeurs par défaut ; si elles sont absentes, Docker doit refuser de démarrer.
```yaml
POSTGRES_PASSWORD=${POSTGRES_PASSWORD:?POSTGRES_PASSWORD must be set}
```

---

#### C2 — Rate limiting absent sur les endpoints d'action sensibles
**Fichiers :** `app/routes/api.micro-predictions.ts`, `app/routes/feed.server.ts`, `app/routes/profile.server.ts`  
**Description :** Le rate limiting (`checkRateLimit`) n'est appliqué **que** sur les routes d'authentification (`/api/auth/*`). Toutes les autres actions POST (création de posts, réponses aux micro-pronos, upload d'avatar) n'ont aucune limitation.  
**Risque :**
- Flood de posts/commentaires (spam automatisé du fil)
- Brute-force de réponses aux micro-pronostics pour maximiser les points
- Abus de l'endpoint d'upload d'avatars (charge serveur / disque)

**Correction recommandée :** Appliquer `checkRateLimit` par `userId` sur les actions writes :
```typescript
await checkRateLimit({ key: `post:${session.user.id}`, maxAttempts: 10, windowSeconds: 60 });
```

---

### 🟠 ÉLEVÉ

#### H1 — Validation MIME des fichiers côté serveur insuffisante
**Fichier :** `app/lib/server/upload.ts` — ligne 13  
**Description :** La vérification du type de fichier repose sur `file.type`, qui est fourni par le client HTTP et peut être falsifié.
```typescript
if (!ALLOWED_TYPES.includes(file.type)) { ... }
```
**Risque :** Un attaquant peut envoyer un fichier `.php`, `.svg` (XSS) ou exécutable en déclarant un type `image/jpeg`. Bien que `sharp` traite le buffer et réduit le risque, un fichier SVG malveillant peut contenir du JavaScript si sharp ne le refuse pas.  
**Correction recommandée :** Vérifier les *magic bytes* du buffer avec une librairie comme `file-type` :
```typescript
import { fileTypeFromBuffer } from 'file-type';
const detected = await fileTypeFromBuffer(buffer);
if (!detected || !ALLOWED_TYPES.includes(detected.mime)) { throw new Error(...) }
```

---

#### H2 — Contournement du typage TypeScript pour les vérifications de rôles
**Fichier :** `app/routes/feed.server.ts` — lignes 99, 124, 184, 200  
**Description :** Les vérifications de rôle utilisent `(session.user as any).role` au lieu du type `Role` défini dans `auth-utils.server.ts`.
```typescript
isAdmin: (session.user as any).role === "admin",
if (isAnnouncement && (session.user as any).role !== "admin") { ... }
```
**Risque :** Le cast `as any` désactive les vérifications TypeScript. Si la structure de `session.user` change, les contrôles d'accès peuvent silencieusement échouer sans erreur de compilation.  
**Correction recommandée :** Utiliser `requireAuth(request, ["admin"])` qui gère déjà le contrôle de rôle, ou typer correctement via `session.user.role as Role`.

---

#### H3 — Absence totale de headers de sécurité HTTP
**Fichier :** `app/root.tsx`, configuration serveur  
**Description :** Aucun header de sécurité n'est configuré : pas de `Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Options`, `Strict-Transport-Security`, ni `Referrer-Policy`.  
**Risque :**
- Clickjacking (absence de `X-Frame-Options`)
- MIME sniffing (absence de `X-Content-Type-Options: nosniff`)
- Injection de scripts via ressources tiers (absence de CSP)

**Correction recommandée :** Configurer les headers dans le loader root ou via un middleware :
```typescript
export const headers = () => ({
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
});
```

---

#### H4 — Suppression de compte sans ré-authentification
**Fichier :** `app/routes/profile.server.ts` — ligne 127  
**Description :** L'action `delete-account` supprime le compte sans demander le mot de passe de confirmation ni utiliser de token CSRF dédié.
```typescript
if (intent === "delete-account") {
  await db.delete(user).where(eq(user.id, session.user.id));
```
**Risque :** Si un attaquant obtient une session active (XSS, session hijacking), ou via une attaque CSRF ciblée, il peut supprimer le compte sans connaître le mot de passe.  
**Correction recommandée :** Exiger la saisie du mot de passe courant avant suppression et le vérifier via `auth.api.signIn`.

---

### 🟡 MOYEN

#### M1 — IP spoofing possible sur le rate limiting
**Fichier :** `app/routes/api.auth.$.ts` — lignes 5-10  
**Description :** La fonction `getClientIp` lit `x-forwarded-for` sans validation. Ce header peut être injecté par un client si le reverse proxy n'est pas configuré pour le réécrire.
```typescript
return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || ...
```
**Risque :** Un attaquant peut contourner le rate limiting en faisant varier la valeur du header `X-Forwarded-For`.  
**Correction recommandée :** En production derrière Nginx, configurer `set_real_ip_from` et `real_ip_header` pour que Nginx écrase ce header, et ne lire que le header de confiance.

---

#### M2 — Validation des inputs insuffisante pour les micro-pronostics
**Fichier :** `app/routes/api.micro-predictions.ts` — lignes 19-24, 93-128  
**Description :** Les champs `question`, `answer`, `type`, et `options` (intent `create`/`answer`) ne sont pas validés par un schéma Zod. Seule une vérification de présence est effectuée.
```typescript
const question = formData.get("question") as string;  // pas de limite de longueur
const answer = formData.get("answer") as string;       // pas de validation de format
```
**Risque :** Injection de contenu très long (déni de service DB/mémoire), contenu inattendu dans les réponses stockées.  
**Correction recommandée :** Créer un schéma Zod dédié (similaire à `createPostSchema`) pour chaque intent.

---

#### M3 — Usage de `sql\`\`` raw avec table `"user"` dans les badges
**Fichier :** `app/lib/server/badges.server.ts` — lignes 140-142  
**Description :** Requête avec SQL brut pour contourner le conflit de nom avec le mot réservé PostgreSQL `user`.
```typescript
.from(sql`"user"`)
.where(sql`id = ${userId}`)
```
**Risque :** Bien que `userId` soit issu de la session (non contrôlé par l'utilisateur), l'usage de raw SQL est une surface de risque qui doit être minimisée. Une future refactorisation pourrait introduire un paramètre non sûr.  
**Correction recommandée :** Utiliser la référence Drizzle directement : `.from(user).where(eq(user.id, userId))` (ce qui fonctionne déjà ailleurs dans la codebase).

---

#### M4 — `seedBadges()` exécuté à chaque évaluation
**Fichier :** `app/lib/server/badges.server.ts` — ligne 157  
**Description :** `evaluateBadges` appelle `seedBadges()` qui effectue un SELECT sur la table `badges` à chaque action utilisateur (post, commentaire, réaction, pronostic).  
**Risque :** Génère une charge DB inutile à chaque interaction. Avec un nombre croissant d'utilisateurs, cela peut devenir un vecteur de dégradation de performance.  
**Correction recommandée :** Initialiser les badges au démarrage de l'application une seule fois, ou utiliser un flag en cache Redis.

---

#### M5 — `.gitignore` incomplet pour les environnements multiples
**Fichier :** `.gitignore`  
**Description :** Le `.gitignore` ne couvre pas certains fichiers d'environnement courants :
```
# Manquants :
.env.*
.env.local
.env.production
*.log
logs/
```
**Risque :** Un développeur pourrait accidentellement committer un `.env.production` contenant de vraies credentials.  
**Correction recommandée :** Ajouter les patterns manquants au `.gitignore`.

---

### 🔵 FAIBLE

#### L1 — Logger initialise `LOG_LEVEL` depuis `process.env` directement
**Fichier :** `app/lib/server/logger.server.ts` — ligne 3  
**Description :** Le logger accède à `process.env.LOG_LEVEL` directement au lieu de passer par `getEnv()` qui valide via Zod.
```typescript
level: process.env.LOG_LEVEL || "info",
```
**Risque :** Faible — mais incohérence avec le reste de l'application. Une valeur invalide ne sera pas rejetée au démarrage.  
**Correction recommandée :** Utiliser `getEnv().LOG_LEVEL`.

---

#### L2 — Pagination absente sur le fil d'actualité (N+1 queries)
**Fichier :** `app/routes/feed.server.ts` — lignes 19-94  
**Description :** Le loader du feed charge les 50 derniers posts, puis pour chacun effectue 3 requêtes supplémentaires (réactions, commentaires, réaction utilisateur). Soit potentiellement 151 requêtes DB par chargement de page.  
**Risque :** Pas une vulnérabilité de sécurité directe, mais constitue une surface d'attaque DoS par accès répété à la page (amplification DB).  
**Correction recommandée :** Utiliser des JOIN SQL pour agréger en une seule requête, et implémenter une pagination.

---

#### L3 — Absence de `APP_URL` obligatoire en production
**Fichier :** `app/lib/server/auth.server.ts` — ligne 12  
**Description :** `trustedOrigins` peut être vide si `APP_URL` n'est pas défini dans l'environnement.
```typescript
trustedOrigins: env.APP_URL ? [env.APP_URL] : [],
```
**Risque :** Better Auth peut accepter des requêtes d'origines non vérifiées si `APP_URL` est omis.  
**Correction recommandée :** Rendre `APP_URL` obligatoire dans `env.server.ts` (supprimer `.optional()`).

---

## 3. Tableau de synthèse

| ID | Criticité | Fichier principal | Effort de correction |
|----|-----------|-------------------|----------------------|
| C1 | 🔴 CRITIQUE | `docker-compose.prod.yml` | Faible (1 ligne) |
| C2 | 🔴 CRITIQUE | `api.micro-predictions.ts`, `feed.server.ts`, `profile.server.ts` | Moyen |
| H1 | 🟠 ÉLEVÉ | `upload.ts` | Faible (`file-type` lib) |
| H2 | 🟠 ÉLEVÉ | `feed.server.ts` | Faible (refactoring) |
| H3 | 🟠 ÉLEVÉ | `root.tsx` / config | Faible |
| H4 | 🟠 ÉLEVÉ | `profile.server.ts` | Moyen |
| M1 | 🟡 MOYEN | `api.auth.$.ts` | Config Nginx |
| M2 | 🟡 MOYEN | `api.micro-predictions.ts` | Faible (Zod) |
| M3 | 🟡 MOYEN | `badges.server.ts` | Faible |
| M4 | 🟡 MOYEN | `badges.server.ts` | Moyen |
| M5 | 🟡 MOYEN | `.gitignore` | Faible (1 ligne) |
| L1 | 🔵 FAIBLE | `logger.server.ts` | Trivial |
| L2 | 🔵 FAIBLE | `feed.server.ts` | Élevé |
| L3 | 🔵 FAIBLE | `auth.server.ts` | Trivial |

---

## 4. Points positifs constatés

- ✅ **Pas de credentials hardcodés** dans le code source (commit `aed5841` a nettoyé cela)
- ✅ **Validation Zod** sur les inputs utilisateur (register, login, posts, commentaires, matchs, pseudo)
- ✅ **ORM Drizzle** utilisé systématiquement → pas d'injection SQL directe
- ✅ **`requireAuth`** appelé en tête de chaque loader/action protégé
- ✅ **Contrôle d'ownership** avant suppression de posts/commentaires
- ✅ **Rate limiting** sur login (10 req/15 min) et inscription (5 req/h)
- ✅ **Sessions stockées dans Redis** (TTL automatique)
- ✅ **Schéma d'environnement validé** au démarrage via Zod (`env.server.ts`)
- ✅ **Upload avatar** : taille max 2 Mo, retraitement via `sharp` (supprime métadonnées EXIF)
- ✅ **Logs structurés** avec Pino (pas de données sensibles loggées explicitement)
