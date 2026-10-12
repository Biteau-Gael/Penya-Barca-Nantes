# Rapport d'audit de sécurité — Penya Blaugrana Nantes

**Date :** 2026-10-12  
**Branche analysée :** `claude/sharp-fermi-glo5v3`  
**Dernier commit analysé :** `003faca` — fix: évaluer les badges immédiatement après chaque action

---

## Résumé des derniers commits

| Commit | Date | Description |
|--------|------|-------------|
| `003faca` | 2026-04-13 | fix: évaluer les badges immédiatement après chaque action |
| `b1c88f6` | 2026-04-13 | feat: Phase 2 — soirée match live, micro-pronos, badges, séries, saisons |
| `d461ee5` | 2026-04-12 | Merge branch 'claude/deploy-synology-nas-cLkOL' |
| `554b873` | 2026-04-12 | Add deployment guide for Synology NAS updates |
| `68e22d2` | 2026-04-13 | feat: menu burger mobile pour la navigation |
| `6aebaf7` | 2026-04-12 | Fix Better Auth trusted origins for custom domain support |
| `9823bc5` | 2026-04-12 | Add migrate service to docker-compose.prod.yml for database migrations |
| `8d6e5e9` | 2026-04-12 | Add production Docker Compose and backup script for Synology NAS deployment |
| `aed5841` | 2026-04-12 | security: supprimer credentials du repo et renforcer .gitignore |

### Points positifs des derniers commits

- Le commit `aed5841` a correctement supprimé les credentials du dépôt et renforcé le `.gitignore` (ajout de `.claude/`, suppression de `.claude/settings.local.json` du tracking).
- Le `.env.example` ne contient que des placeholders (`YOUR_PASSWORD_HERE`, `your-rapidapi-key`).
- La Phase 2 (`b1c88f6`) a correctement utilisé l'ORM Drizzle pour toutes les requêtes DB (pas d'injection SQL détectée).
- Les suppressions de posts/commentaires vérifient correctement `authorId === session.user.id || isAdmin`.

---

## Analyse de sécurité par ordre de criticité

### 🔴 HIGH — 3 problèmes

---

#### H1 — Ports base de données et Redis exposés sur toutes les interfaces

**Fichier :** `docker-compose.yml`, lignes 23-24 et 36-37  
**Sévérité :** HIGH

**Problème :** PostgreSQL (`"5432:5432"`) et Redis (`"6379:6379"`) sont liés à `0.0.0.0`, exposant les services à toutes les interfaces réseau. N'importe quel hôte atteignable sur le même réseau local peut se connecter directement à la base de données et au cache sans passer par la couche applicative. De plus, le Redis dans `docker-compose.yml` n'a pas de directive `command: redis-server --requirepass …`, donc il accepte les connexions non authentifiées.

**Recommandation :**
```yaml
# Restreindre à localhost uniquement
ports:
  - "127.0.0.1:5432:5432"
  - "127.0.0.1:6379:6379"
```
Ajouter également `command: redis-server --requirepass ${REDIS_PASSWORD:-devpassword}` au service Redis en développement.

---

#### H2 — Mots de passe "changeme" par défaut en production

**Fichier :** `docker-compose.prod.yml`, lignes 22 et 32  
**Sévérité :** HIGH

**Problème :** Les variables `POSTGRES_PASSWORD` et `REDIS_PASSWORD` ont un fallback `:-changeme`. Si ces variables ne sont pas définies lors du déploiement (erreur courante en CI/CD), les bases de données démarrent avec un mot de passe largement connu.

```yaml
# Actuel — DANGEREUX
POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-changeme}
redis-server --requirepass ${REDIS_PASSWORD:-changeme}
```

**Recommandation :** Supprimer complètement le fallback `:-changeme`. Faire échouer le déploiement si les variables sont absentes (via un script d'entrée qui valide les variables obligatoires). Envisager Docker Secrets pour les credentials de base de données.

---

#### H3 — Aucun rate limiting sur les actions d'écriture

**Fichier :** `app/routes/feed.server.ts`, lignes 114-213 (`feedAction`)  
**Sévérité :** HIGH

**Problème :** Les intents `create-post`, `comment`, `react`, `delete-post` et `delete-comment` n'ont aucune limitation de débit. Un utilisateur authentifié peut envoyer des milliers de requêtes par seconde, permettant :
- Saturation de la base de données via création de posts/commentaires
- Spam de toggle sur l'intent `react` (2 requêtes DB par appel)
- Saturation via le pattern N+1 dans `feedLoader` (jusqu'à 3 requêtes par post × 50 posts)

**Recommandation :** Appliquer un rate limit par utilisateur (ex. : compteur sliding-window Redis sur `userId + intent`). Appliquer le même mécanisme à `api.micro-predictions.ts`.

---

### 🟠 MEDIUM — 6 problèmes

---

#### M1 — Redis sans mot de passe en développement

**Fichier :** `docker-compose.yml`, lignes 35-37  
**Sévérité :** MEDIUM

**Problème :** Le service Redis de développement n'a pas de directive `command:` et le health check utilise `redis-cli ping` sans flag `-a`. Si ce compose est utilisé dans un environnement staging ou si la machine du développeur est accessible depuis l'extérieur, Redis est totalement ouvert.

**Recommandation :**
```yaml
redis:
  command: redis-server --requirepass ${REDIS_PASSWORD:-devpassword}
  healthcheck:
    test: ["CMD", "redis-cli", "-a", "${REDIS_PASSWORD:-devpassword}", "ping"]
```

---

#### M2 — Champs `type` et `answer` stockés sans validation

**Fichier :** `app/routes/api.micro-predictions.ts`, lignes 21 et 92  
**Sévérité :** MEDIUM

**Problème :**
- Ligne 21 : `type` est accepté du formulaire et stocké sans validation contre un ensemble autorisé (`["qcm", "free"]`). N'importe quelle chaîne arbitraire est persistée.
- Ligne 92 : `answer` est accepté et stocké sans contrainte de longueur ou de contenu. Un utilisateur peut soumettre une chaîne de plusieurs mégaoctets.

**Recommandation :** Utiliser Zod pour valider les inputs :
```typescript
import { z } from "zod";
const typeSchema = z.enum(["qcm", "free"]);
const answerSchema = z.string().min(1).max(500);
```

---

#### M3 — `deadlineSeconds` non appliqué côté serveur

**Fichier :** `app/routes/api.micro-predictions.ts`, lignes 99-106  
**Sévérité :** MEDIUM

**Problème :** Le handler `answer` vérifie uniquement `micro.closedAt` (champ défini manuellement par l'admin). La deadline temporelle (`deadlineSeconds`) n'est jamais appliquée côté serveur. Un utilisateur peut soumettre une réponse après expiration de la fenêtre si l'admin n'a pas encore appelé l'action `close`.

**Recommandation :**
```typescript
const deadline = new Date(micro.createdAt.getTime() + micro.deadlineSeconds * 1000);
if (new Date() > deadline) {
  return Response.json({ error: "Délai expiré" }, { status: 400 });
}
```

---

#### M4 — Champs internes DB exposés via spread d'objet

**Fichier :** `app/routes/match-detail.server.ts`, lignes 100-108  
**Sévérité :** MEDIUM

**Problème :** L'utilisation de `...match` dans la réponse expose toutes les colonnes DB au client, notamment `externalFixtureId` (révèle l'ID API tiers), `pointsScheme`, `season`, `updatedAt` et toute future colonne ajoutée.

**Recommandation :** Remplacer le spread par une liste explicite des champs nécessaires au frontend.

---

#### M5 — URL externe non validée retournée au client

**Fichier :** `app/lib/server/api-football.server.ts`, ligne 444  
**Sévérité :** MEDIUM

**Problème :**
```typescript
highlightUrl = highlightsRes.value.response.highlights?.url ?? null;
```
L'URL est prise verbatim d'une réponse API tierce. Si l'API est compromise ou retourne un URI `javascript:`, `data:`, ou une URL contrôlée par un attaquant, le client pourrait la rendre dans un `<video src>`, une ancre ou un iframe.

**Recommandation :**
```typescript
const url = highlightsRes.value.response.highlights?.url;
if (url && url.startsWith("https://")) {
  highlightUrl = url;
}
```

---

#### M6 — `loadComments` exportée sans garde d'authentification

**Fichier :** `app/routes/feed.server.ts`, lignes 216-231  
**Sévérité :** MEDIUM

**Problème :** La fonction `loadComments(postId: string)` est exportée et requête tous les commentaires d'un post sans vérification d'authentification. Si elle est importée dans un loader qui n'applique pas l'auth indépendamment, n'importe quel utilisateur non authentifié peut énumérer les commentaires.

**Recommandation :** Soit supprimer l'export (non utilisé ailleurs actuellement), soit ajouter un paramètre session obligatoire.

---

### 🟡 LOW — 4 problèmes

---

#### L1 — Template SQL brut contourne la sécurité de type de l'ORM

**Fichier :** `app/lib/server/badges.server.ts`, lignes 140-142  
**Sévérité :** LOW

**Problème :**
```typescript
const [userRow] = await db.select({ bestStreak: sql<number>`coalesce(best_streak, 0)::int` })
  .from(sql`"user"`)
  .where(sql`id = ${userId}`);
```
Bien que Drizzle paramétrise `${userId}` correctement (pas d'injection SQL), ce pattern contourne la vérification de type au niveau des colonnes et est fragile aux fautes de frappe. Un développeur futur pourrait ne pas réaliser que la paramétrisation est nécessaire.

**Recommandation :** Importer le schéma `user` et utiliser `eq(user.id, userId)` avec les colonnes typées de l'ORM.

---

#### L2 — `getSession` au lieu de `requireAuth` dans l'action match-detail

**Fichier :** `app/routes/match-detail.server.ts`, ligne 123  
**Sévérité :** LOW

**Problème :** `matchDetailAction` appelle `getSession(request)` et vérifie manuellement `if (!session?.user)` en retournant une erreur JSON avec statut 200. Inconsistant avec le reste du code qui utilise `requireAuth` (qui lève une `Response` 401).

**Recommandation :**
```typescript
// Remplacer
const session = await getSession(request);
if (!session?.user) return { error: "..." };

// Par
try {
  const session = await requireAuth(request);
} catch {
  return Response.json({ error: "Non authentifié" }, { status: 401 });
}
```

---

#### L3 — Absence de segmentation réseau Docker

**Fichiers :** `docker-compose.yml`, `docker-compose.prod.yml` (tous les services)  
**Sévérité :** LOW

**Problème :** Tous les services (app, postgres, redis, nginx, migrate) partagent le réseau bridge par défaut de Docker. Si le container applicatif est compromis, l'attaquant a un accès réseau direct à la base de données et au cache.

**Recommandation :** Définir deux réseaux explicites :
```yaml
networks:
  frontend:   # nginx + app
  backend:    # app + postgres + redis
```

---

#### L4 — Condition de badge parsée sans validation de schéma

**Fichier :** `app/lib/server/badges.server.ts`, ligne 172  
**Sévérité :** LOW

**Problème :**
```typescript
const condition = JSON.parse(badge.condition) as { type: string; threshold: number };
```
Le cast `as` ne valide pas l'objet parsé. Un enregistrement mal formé en DB peut provoquer une exception `JSON.parse` ou un comportement silencieusement incorrect (badge jamais attribué).

**Recommandation :** Entourer le `JSON.parse` d'un try/catch et valider la structure avec une type guard ou Zod.

---

## Points non signalés (conformes)

- **Injection SQL** : Toutes les requêtes utilisent l'ORM Drizzle avec des inputs paramétrés. Aucune interpolation de chaîne brute dans le SQL (hors template tag Drizzle correctement paramétrée).
- **Authentification des routes principales** : `soireeLoader`, `feedAction`/`feedLoader` utilisent correctement `requireAuth`.
- **IDOR** : Les actions de suppression vérifient `authorId === session.user.id || isAdmin`.
- **Secrets hardcodés** : Aucun secret réel trouvé. Le `.env.example` ne contient que des placeholders.
- **XSS** : React échappe le contenu texte par défaut. Aucun `dangerouslySetInnerHTML` détecté.

---

## Tableau récapitulatif

| # | Sévérité | Fichier | Ligne(s) | Problème |
|---|----------|---------|----------|----------|
| H1 | 🔴 HIGH | `docker-compose.yml` | 23-24, 36-37 | Ports DB/Redis exposés sur 0.0.0.0 |
| H2 | 🔴 HIGH | `docker-compose.prod.yml` | 22, 32 | Mots de passe "changeme" en production |
| H3 | 🔴 HIGH | `feed.server.ts` | 114-213 | Aucun rate limiting sur les actions d'écriture |
| M1 | 🟠 MEDIUM | `docker-compose.yml` | 35-37 | Redis sans mot de passe en développement |
| M2 | 🟠 MEDIUM | `api.micro-predictions.ts` | 21, 92 | `type` et `answer` non validés |
| M3 | 🟠 MEDIUM | `api.micro-predictions.ts` | 99-106 | `deadlineSeconds` non appliqué côté serveur |
| M4 | 🟠 MEDIUM | `match-detail.server.ts` | 100-108 | Champs internes DB exposés via spread |
| M5 | 🟠 MEDIUM | `api-football.server.ts` | 444 | URL externe non validée retournée au client |
| M6 | 🟠 MEDIUM | `feed.server.ts` | 216-231 | `loadComments` exportée sans garde d'auth |
| L1 | 🟡 LOW | `badges.server.ts` | 140-142 | Template SQL brut contourne le type safety |
| L2 | 🟡 LOW | `match-detail.server.ts` | 123 | `getSession` au lieu de `requireAuth` |
| L3 | 🟡 LOW | `docker-compose.yml`, `docker-compose.prod.yml` | tous | Absence de segmentation réseau Docker |
| L4 | 🟡 LOW | `badges.server.ts` | 172 | Condition badge parsée sans validation |

---

*Rapport généré automatiquement lors de la routine de surveillance du dépôt.*
