# Revue de sécurité & résumé des commits — 2 novembre 2026

> Analyse automatique quotidienne — branche `main` — 17 commits au total

---

## Résumé des derniers commits

### 1. `003faca` — fix: évaluer les badges immédiatement après chaque action *(13 avril 2026)*
Correction du déclenchement des badges après chaque action utilisateur :
- Soumission de pronostic → badges « Premier pas », « Régulier », « Fidèle »
- Publication de post → badge « Auteur »
- Publication de commentaire → badge « Commentateur »
- Réaction → badge « Réactif »

**Fichiers modifiés :** `app/routes/feed.server.ts`, `app/routes/match-detail.server.ts`

---

### 2. `b1c88f6` — feat: Phase 2 — soirée match live, micro-pronos, badges, séries, saisons *(13 avril 2026)*
Feature majeure (26 fichiers, +2965 / -47 lignes) couvrant :
- **Soirée match live** : route `/soiree/:matchId`, score en temps réel (polling 60 s via API Football), fil d'événements (buts, cartons, remplacements), pronos communauté révélés au coup d'envoi
- **Micro-pronostics** : création admin, vote joueur, clôture avec attribution automatique de points, suppression admin
- **Badges** : 10 badges, grille visuelle `/badges`, affichage profil
- **Séries** : `currentStreak`/`bestStreak` sur l'utilisateur, récompenses aux paliers 3/5/10
- **Saisons** : table `seasons`, filtre classement par saison
- **Migration DB** : `0007_slimy_maria_hill.sql`

---

### 3. `554b873` / `d461ee5` — Add deployment guide for Synology NAS *(merge PR #2)*
Ajout du fichier `DEPLOY.md` (79 lignes) : guide de mise à jour du NAS Synology.

---

### 4. `68e22d2` — feat: menu burger mobile pour la navigation
Refonte du header mobile avec menu burger animé (`app/components/layout/header.tsx`, +121/-56 lignes).

---

### 5. `6aebaf7` — Fix Better Auth trusted origins for custom domain support
Correction des origines de confiance dans `auth.server.ts` pour supporter le domaine personnalisé.

---

## Analyse de sécurité

### 🔴 CRITIQUE

> Aucun problème critique détecté.

---

### 🟠 MAJEUR

#### M1 — Requête SQL brute sur la table `user` dans `badges.server.ts:142`

```typescript
// app/lib/server/badges.server.ts, ligne ~140
const [userRow] = await db.select({ bestStreak: sql<number>`coalesce(best_streak, 0)::int` })
  .from(sql`"user"`)
  .where(sql`id = ${userId}`);
```

**Risque :** L'usage de `sql` template tag de Drizzle est sécurisé contre l'injection SQL grâce au paramétrage automatique — le `${userId}` est bien un paramètre lié, pas une interpolation de chaîne. Cependant, utiliser `sql\`"user"\`` comme source de table contourne l'API Drizzle et rend le code plus fragile. Si le schéma change ou si cette table est renommée, aucune erreur de type ne sera levée à la compilation.

**Recommandation :** Remplacer par une référence à l'objet `user` du schéma Drizzle :
```typescript
const [userRow] = await db.select({ bestStreak: sql<number>`coalesce(${user.bestStreak}, 0)::int` })
  .from(user)
  .where(eq(user.id, userId));
```

---

### 🟡 MODÉRÉ

#### Mo1 — Absence de rate limiting sur l'API micro-pronostics

L'endpoint `api.micro-predictions.ts` (vote joueur) n'est soumis à aucune limite de débit. Un utilisateur authentifié pourrait tenter de soumettre des requêtes en masse, potentiellement pour tester plusieurs réponses avant clôture (même si un doublon est refusé en base).

**Impact :** Faible grâce à la vérification d'unicité en base, mais absence de protection côté réseau.

**Recommandation :** Ajouter `checkRateLimit` sur l'intent `"answer"` (ex. 10 votes/minute/IP).

---

#### Mo2 — Parsing sans validation des champs `pointsValue` et `deadlineSeconds` (admin)

```typescript
// app/routes/api.micro-predictions.ts, lignes 23-24
const pointsValue = parseInt(formData.get("pointsValue") as string) || 1;
const deadlineSeconds = parseInt(formData.get("deadlineSeconds") as string) || 120;
```

Ces valeurs ne sont pas bornées. Un admin pourrait accidentellement (ou volontairement) créer un micro-pronostic valant 10 000 points ou avec un délai de plusieurs jours.

**Recommandation :** Ajouter une validation Zod ou des bornes manuelles (ex. `pointsValue` entre 1 et 10, `deadlineSeconds` entre 30 et 600).

---

#### Mo3 — `process.env` direct dans `redis.server.ts` et `db/client.ts`

```typescript
// app/lib/server/redis.server.ts
export const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379", ...);

// app/db/client.ts
connectionString: process.env.DATABASE_URL,
```

Ces fichiers accèdent directement à `process.env` sans passer par `getEnv()`, contournant la validation Zod centralisée. Une variable manquante échouera silencieusement au démarrage plutôt que de lever une erreur claire.

**Recommandation :** Utiliser `getEnv()` depuis `~/config/env.server`.

---

### 🔵 MINEUR / INFORMATIONNEL

#### Mi1 — IP client basée sur `x-forwarded-for` sans vérification de proxy de confiance

```typescript
// app/routes/api.auth.$.ts
request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
```

Si l'application n'est pas derrière un reverse proxy de confiance, cet en-tête peut être forgé par le client, rendant le rate limiting contournable.

**Recommandation :** Documenter que l'application doit toujours être derrière un reverse proxy (Nginx/Traefik) qui écrase cet en-tête, ce qui est déjà le cas en production NAS selon `DEPLOY.md`.

---

#### Mi2 — `correctAnswer` exposé aux admins dans le loader soirée

```typescript
// app/routes/soiree.server.ts
correctAnswer: m.correctAnswer,
```

Le champ `correctAnswer` est retourné dans le payload JSON du loader, visible par les admins via les DevTools. Ce n'est pas un risque de sécurité pour les joueurs (seuls les admins voient `isAdmin: true` et la page correspondante), mais mérite une revue intentionnelle.

**Recommandation :** Confirmer que c'est voulu pour l'interface admin, ou filtrer selon `isAdmin`.

---

## Bonnes pratiques confirmées ✅

| Point | Statut |
|---|---|
| Authentification requise sur toutes les routes sensibles (`requireAuth`) | ✅ |
| Contrôle de rôle admin via `session.user.role === "admin"` sur toutes les actions admin | ✅ |
| Rate limiting sur login (10/15min) et inscription (5/h) | ✅ |
| Variables d'environnement validées par Zod dans `env.server.ts` | ✅ |
| Secrets exclus du dépôt (`.env` dans `.gitignore`, commit `aed5841`) | ✅ |
| Utilisation de Drizzle ORM avec requêtes paramétrées (protection SQL injection) | ✅ |
| Logger structuré (pino) sans exposition de données sensibles | ✅ |
| Gestion des erreurs avec classes typées (`AppError`) | ✅ |
| Pas de `dangerouslySetInnerHTML` ni `eval` dans les composants React | ✅ |

---

## Résumé des actions recommandées

| Priorité | ID | Action | Fichier |
|---|---|---|---|
| 🟠 Majeur | M1 | Remplacer `sql\`"user"\`` par référence schema Drizzle | `app/lib/server/badges.server.ts` |
| 🟡 Modéré | Mo1 | Ajouter rate limiting sur l'intent `answer` des micro-pronos | `app/routes/api.micro-predictions.ts` |
| 🟡 Modéré | Mo2 | Ajouter validation des bornes `pointsValue` et `deadlineSeconds` | `app/routes/api.micro-predictions.ts` |
| 🟡 Modéré | Mo3 | Passer par `getEnv()` dans `redis.server.ts` et `db/client.ts` | `app/lib/server/redis.server.ts`, `app/db/client.ts` |
| 🔵 Mineur | Mi1 | Documenter la dépendance au reverse proxy pour l'IP forwarding | `app/routes/api.auth.$.ts` |
| 🔵 Mineur | Mi2 | Vérifier l'exposition intentionnelle de `correctAnswer` | `app/routes/soiree.server.ts` |
