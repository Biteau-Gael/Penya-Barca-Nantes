# Audit de Sécurité — Penya Blaugrana Nantes

**Date :** 18 juin 2026  
**Branche analysée :** `main`  
**Dernier commit analysé :** `003faca` — fix: évaluer les badges immédiatement après chaque action  

---

## Résumé des derniers commits

| Hash | Date | Auteur | Description |
|------|------|--------|-------------|
| `003faca` | 2026-04-13 | Biteau Gaël | fix: évaluer les badges immédiatement après chaque action |
| `b1c88f6` | 2026-04-13 | Biteau Gaël | feat: Phase 2 — soirée match live, micro-pronos, badges, séries, saisons |
| `68e22d2` | 2026-04-13 | Biteau Gaël | feat: menu burger mobile pour la navigation |
| `d461ee5` | 2026-04-12 | Claude | Merge branch deploy-synology-nas |
| `554b873` | 2026-04-12 | Claude | Add deployment guide for Synology NAS updates |
| `6aebaf7` | 2026-04-12 | Claude | Fix Better Auth trusted origins for custom domain support |
| `9823bc5` | 2026-04-12 | Claude | Add migrate service to docker-compose.prod.yml |
| `8d6e5e9` | 2026-04-12 | Claude | Add production Docker Compose and backup script for Synology NAS |

### Contenu de la Phase 2 (`b1c88f6`)

- **Sprint 2 — Soirée match live :** Route `/soiree/:matchId` avec score live (polling API 60s), fil du match en temps réel, pronos communauté révélés au coup d'envoi, indicateur "En direct" animé.
- **Sprint 3 — Micro-pronostics :** Création admin, vote joueur, clôture avec attribution automatique des points, suppression possible par l'admin. Points séparés du classement principal.
- **Sprint 3 — Séries :** `currentStreak` / `bestStreak` sur l'utilisateur, récompenses aux paliers 3/5/10 avec post automatique dans le fil.
- **Sprint 5 — Badges :** 10 badges avec évaluation automatique, page `/badges` avec grille visuelle, affichage sur le profil.
- **Sprint 5 — Saisons :** Table `seasons`, champ `season` sur les matchs, classement filtré par saison avec sélecteur et archives.
- **Schéma DB :** Migration `0007` — tables `seasons`, `badges`, `user_badges`, `rewards`, `micro_predictions`, `micro_prediction_answers`.

---

## Analyse de Sécurité

### Points positifs

- `.env` correctement exclu du dépôt git.
- Aucune clé API ni secret codé en dur dans les sources.
- L'ORM Drizzle paramétrise les requêtes par défaut — pas d'injection SQL via les méthodes ORM.
- Validation des entrées utilisateur via des schémas Zod dans les routes admin.
- Toutes les routes admin vérifient `requireAuth(request, ["admin"])`.
- Rate-limiting implémenté sur `/api/auth` (connexion : 10 tentatives/15 min, inscription : 5/h).
- Upload d'avatar : type MIME validé, taille limitée à 2 Mo, conversion forcée en WebP 256×256.
- Protection contre l'auto-modification du rôle admin.

---

## Vulnérabilités par ordre de criticité

---

### CRITIQUE

#### C-1 — Path Traversal sur le service de fichiers statiques

**Fichier :** `app/routes/uploads-files.ts`  
**Risque :** Lecture de fichiers arbitraires sur le serveur (`.env`, clés SSH, `package.json`, etc.)

```typescript
// Vulnérable : aucune vérification que le chemin reste dans /uploads
const filePath = path.join(process.cwd(), "uploads", params["*"]);
```

`path.join` normalise les séquences `../`, ce qui permet une requête comme :
```
GET /uploads/../../.env
→ résolu en : /app/.env  ← EXPOSÉ
```

**Correction recommandée :**

```typescript
import path from "node:path";
import { readFile } from "node:fs/promises";

export async function loader({ params }: { params: { "*": string } }) {
  const uploadsDir = path.join(process.cwd(), "uploads");
  const requestedPath = path.join(uploadsDir, params["*"]);

  // Vérification anti path-traversal
  if (!requestedPath.startsWith(uploadsDir + path.sep) && requestedPath !== uploadsDir) {
    return new Response("Forbidden", { status: 403 });
  }

  // ... reste de la logique
}
```

---

### ÉLEVÉ

#### H-1 — Credentials par défaut dans docker-compose.prod.yml

**Fichier :** `docker-compose.prod.yml` — lignes 22 et 32  
**Risque :** Si les variables d'environnement ne sont pas définies, les services démarrent avec des mots de passe `changeme`.

```yaml
POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-changeme}
redis-server --requirepass ${REDIS_PASSWORD:-changeme}
```

**Correction recommandée :** Utiliser la syntaxe Docker Compose qui force l'erreur si la variable est absente :

```yaml
POSTGRES_PASSWORD=${POSTGRES_PASSWORD:?POSTGRES_PASSWORD must be set}
# et pour redis :
command: redis-server --requirepass ${REDIS_PASSWORD:?REDIS_PASSWORD must be set}
```

---

#### H-2 — Fallback Redis sans authentification

**Fichier :** `app/lib/server/redis.server.ts` — ligne 3  
**Risque :** En production, si `REDIS_URL` n'est pas définie, l'application se connecte à `redis://localhost:6379` sans mot de passe, contournant toute protection.

```typescript
export const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379", {
```

**Correction recommandée :**

```typescript
const redisUrl = process.env.REDIS_URL;
if (!redisUrl && process.env.NODE_ENV === "production") {
  throw new Error("REDIS_URL must be set in production");
}
export const redis = new Redis(redisUrl || "redis://localhost:6379", {
  maxRetriesPerRequest: 3,
  lazyConnect: true,
});
```

---

#### H-3 — Absence de protection CSRF

**Fichiers concernés :** Toutes les routes `action` (`profile.server.ts`, `admin.*.server.ts`, `api.micro-predictions.ts`, etc.)  
**Risque :** Un attaquant peut forger des requêtes depuis un site tiers pour déclencher des actions au nom d'un utilisateur connecté (changement de rôle, suppression de compte, votes).

React Router ne fournit pas de protection CSRF native. Better Auth dispose d'un plugin CSRF, à activer.

**Correction recommandée :** Activer le plugin CSRF dans `auth.server.ts` et valider le token côté action.

---

### MOYEN

#### M-1 — Endpoint `/api/health` accessible sans authentification

**Fichier :** `app/routes/api.health.ts`  
**Risque :** Divulgue l'état interne des services (PostgreSQL, Redis) sans authentification. Un attaquant peut utiliser cette information pour cibler les composants défaillants ou identifier les plages de maintenance.

**Correction recommandée :** Restreindre à l'admin ou ne retourner qu'un statut minimal en public :

```typescript
// Option 1 : version minimale publique
return Response.json({ status: allHealthy ? "ok" : "degraded" }, { status: allHealthy ? 200 : 503 });

// Option 2 : détail complet réservé aux admins
const session = await requireAuth(request, ["admin"]).catch(() => null);
if (!session) return Response.json({ status: allHealthy ? "ok" : "degraded" }, { status: allHealthy ? 200 : 503 });
```

---

#### M-2 — Absence de rate-limiting sur les endpoints API métier

**Fichiers concernés :** `api.micro-predictions.ts`, `api.sync-matches.ts`, `api.welcome-dismiss.ts`, routes admin.  
**Risque :** Un utilisateur peut spammer les réponses aux micro-pronos, déclencher des synchronisations répétées avec l'API Football, ou tenter des actions admin en masse.

Le rate-limiting est uniquement implémenté sur les routes d'authentification.

**Correction recommandée :** Appliquer `checkRateLimit` sur les actions sensibles :

```typescript
// Dans api.micro-predictions.ts — action
await checkRateLimit({ key: `micro-pred-answer:${session.user.id}`, maxAttempts: 30, windowSeconds: 60 });
```

---

#### M-3 — Absence d'en-têtes de sécurité HTTP

**Fichiers concernés :** Configuration serveur globale  
**Risque :** Sans `Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Options`, l'application est exposée au clickjacking, au MIME sniffing et à l'injection de scripts tiers.

**Correction recommandée :** Ajouter un middleware dans `entry.server.tsx` ou via la configuration React Router :

```typescript
headers: {
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Content-Security-Policy": "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'",
}
```

---

#### M-4 — Champ `role` sans contrainte d'énumération en base de données

**Fichier :** `app/lib/server/auth.server.ts` — ligne 26  
**Risque :** Le rôle est un champ `string` sans validation au niveau du schéma DB. Une manipulation directe de la base (ou un bug futur) pourrait introduire des valeurs non prévues qui court-circuiteraient les vérifications de permission.

```typescript
role: {
  type: "string",  // pas de validation enum
  defaultValue: "member",
}
```

**Correction recommandée :** Ajouter une contrainte `CHECK` dans la migration SQL ou utiliser un `pgEnum` Drizzle :

```typescript
// Dans le schéma Drizzle
export const roleEnum = pgEnum("role", ["member", "admin", "partner"]);
```

---

### FAIBLE

#### F-1 — Pattern SQL brut dans `badges.server.ts`

**Fichier :** `app/lib/server/badges.server.ts` — lignes 141-142  
**Risque :** Faible en l'état (valeur issue de la session authentifiée, paramétrisée par Drizzle), mais le pattern `sql\`"user"\`` contourne le typage ORM et deviendra dangereux si copié avec une entrée utilisateur directe.

```typescript
const [userRow] = await db.select({ bestStreak: sql<number>`coalesce(best_streak, 0)::int` })
  .from(sql`"user"`)          // utiliser la référence ORM
  .where(sql`id = ${userId}`); // utiliser eq(user.id, userId)
```

**Correction recommandée :**

```typescript
import { user } from "~/db/schema";
import { eq } from "drizzle-orm";

const [userRow] = await db
  .select({ bestStreak: user.bestStreak })
  .from(user)
  .where(eq(user.id, userId));
```

---

#### F-2 — Cookies de session sans flags explicites

**Fichier :** `app/lib/server/auth.server.ts`  
**Risque :** Les flags `Secure`, `HttpOnly` et `SameSite=Lax` ne sont pas configurés explicitement. Better Auth applique des valeurs par défaut raisonnables, mais il est préférable de les rendre explicites pour auditer et contrôler le comportement.

**Correction recommandée :** Vérifier la documentation Better Auth pour les options `advanced.cookies` et forcer `secure: true` en production.

---

#### F-3 — Route `/calendar` et `/membres` sans authentification

**Fichiers :** `app/routes/calendar.server.ts`, `app/routes/members-list.server.ts`  
**Risque :** Ces routes sont accessibles sans connexion. Si l'accès public est volontaire (penya ouverte), documenter ce choix. Sinon, ajouter `await requireAuth(request)`.

---

## Tableau de synthèse

| ID | Sévérité | Problème | Fichier | Effort de correction |
|----|----------|----------|---------|----------------------|
| C-1 | **CRITIQUE** | Path traversal sur fichiers statiques | `uploads-files.ts` | Faible |
| H-1 | **ÉLEVÉ** | Credentials par défaut docker-compose | `docker-compose.prod.yml` | Faible |
| H-2 | **ÉLEVÉ** | Fallback Redis sans auth | `redis.server.ts` | Faible |
| H-3 | **ÉLEVÉ** | Absence de protection CSRF | Toutes les actions | Moyen |
| M-1 | **MOYEN** | Health endpoint sans auth | `api.health.ts` | Faible |
| M-2 | **MOYEN** | Rate-limiting manquant sur API métier | Multiple | Moyen |
| M-3 | **MOYEN** | Absence d'en-têtes sécurité HTTP | Global | Faible |
| M-4 | **MOYEN** | Rôle sans contrainte enum en DB | `auth.server.ts` + schéma | Moyen |
| F-1 | **FAIBLE** | Pattern SQL brut dans badges | `badges.server.ts` | Faible |
| F-2 | **FAIBLE** | Flags cookies non explicites | `auth.server.ts` | Faible |
| F-3 | **FAIBLE** | Routes publiques non documentées | `calendar`, `members-list` | Faible |

---

## Plan d'action recommandé

### Priorité immédiate (avant tout déploiement en production)

1. **C-1** — Corriger le path traversal dans `uploads-files.ts` (30 min)
2. **H-1** — Supprimer les mots de passe par défaut dans `docker-compose.prod.yml` (5 min)
3. **H-2** — Rendre `REDIS_URL` obligatoire en production (5 min)

### Court terme (sprint suivant)

4. **H-3** — Implémenter la protection CSRF via le plugin Better Auth
5. **M-3** — Ajouter les en-têtes de sécurité HTTP globaux
6. **M-1** — Restreindre ou minimaliser l'endpoint `/api/health`

### Moyen terme

7. **M-2** — Étendre le rate-limiting aux endpoints métier sensibles
8. **M-4** — Ajouter une contrainte enum sur le champ `role` en base
9. **F-1** — Remplacer le pattern SQL brut dans `badges.server.ts`
10. **F-2/F-3** — Documenter les choix de visibilité publique et contrôler les cookies
