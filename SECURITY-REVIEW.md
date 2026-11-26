# Analyse Sécurité — Penya Blaugrana Nantes

> Généré automatiquement le 2026-11-26 | Branche : `claude/sharp-fermi-f0d2xi`

---

## Résumé des derniers commits

| Hash | Message | Auteur | Date |
|------|---------|--------|------|
| `003faca` | fix: évaluer les badges immédiatement après chaque action | Biteau Gaël | 13 avr. 2026 |
| `b1c88f6` | feat: Phase 2 — soirée match live, micro-pronos, badges, séries, saisons | Biteau Gaël | 13 avr. 2026 |
| `d461ee5` | Merge branch 'claude/deploy-synology-nas-cLkOL' | Claude | 12 avr. 2026 |
| `554b873` | Add deployment guide for Synology NAS updates | Claude | 12 avr. 2026 |
| `68e22d2` | feat: menu burger mobile pour la navigation | Biteau Gaël | 13 avr. 2026 |

### Détail Phase 2 (`b1c88f6`)
Ajout de 26 fichiers / 2965 lignes :
- Schémas DB : `micro-predictions`, `rewards`, `seasons`
- Services : `badges.server.ts`, `seasons.server.ts`, `streaks.server.ts`
- Routes : `soiree.server.ts` / `soiree.tsx` (soirée live), `api.micro-predictions.ts`, `badges.tsx`
- Mises à jour : `profile.tsx`, `rankings.tsx`, `calendar.tsx`

---

## Analyse de sécurité — par ordre de criticité

### 🔴 ÉLEVÉ

Aucun problème de criticité élevée identifié.

---

### 🟠 MOYEN

#### M1 — Absence de validation sur les champs de réponse utilisateur (`api.micro-predictions.ts`)

**Fichier :** `app/routes/api.micro-predictions.ts` (ligne ~92)

**Problème :** Le champ `answer` soumis par l'utilisateur est inséré en base sans validation de longueur ni de contenu. Un utilisateur authentifié peut stocker une chaîne arbitrairement longue.

```ts
// Actuel — aucune contrainte
const answer = formData.get("answer") as string;
if (!microId || !answer) { ... }
await db.insert(microPredictionAnswers).values({ ..., answer });
```

**Risque :** Surcharge de la base de données, stockage de données malformées.

**Correction suggérée :**
```ts
if (!answer || answer.length > 500) {
  return Response.json({ error: "Réponse invalide" }, { status: 400 });
}
```

---

#### M2 — Champs admin non validés à la création d'un micro-pronostic (`api.micro-predictions.ts`)

**Fichier :** `app/routes/api.micro-predictions.ts` (lignes ~21-28)

**Problème :** Les champs `question`, `type` et `options` ne sont pas validés contre des valeurs ou longueurs acceptables. Le champ `type` notamment est inséré directement sans contrôle sur les valeurs autorisées.

```ts
const type = (formData.get("type") as string) || "qcm"; // aucune vérification d'enum
const question = formData.get("question") as string;    // pas de limite de longueur
```

**Correction suggérée :** Utiliser un schéma Zod (cohérent avec les autres routes) :
```ts
const ALLOWED_TYPES = ["qcm", "binary", "number"] as const;
// Valider type, question (max 300 chars), options (max 5 options)
```

---

### 🟡 FAIBLE

#### F1 — Requête SQL brute sur la table `user` dans `badges.server.ts`

**Fichier :** `app/lib/server/badges.server.ts` (lignes 140-142)

**Problème :** Utilisation d'une requête SQL brute pour cibler la table `user` au lieu du schéma Drizzle. Bien que `${userId}` soit paramétré (pas d'injection directe), cela contourne la sécurité de types de l'ORM.

```ts
const [userRow] = await db.select({ bestStreak: sql<number>`coalesce(best_streak, 0)::int` })
  .from(sql`"user"`)               // ← raw SQL
  .where(sql`id = ${userId}`);     // ← raw SQL (paramétré mais non typé)
```

**Correction :** Utiliser la référence Drizzle directe :
```ts
import { user } from "~/db/schema";
const [userRow] = await db.select({ bestStreak: user.bestStreak })
  .from(user)
  .where(eq(user.id, userId));
```

---

#### F2 — Absence de rate limiting sur les endpoints de jeu

**Fichier :** `app/routes/api.micro-predictions.ts`, `app/routes/feed.server.ts`

**Problème :** Le rate limiting (`checkRateLimit`) est appliqué uniquement sur les routes d'authentification (`api.auth.$.ts`). Les endpoints de réponse aux micro-pronos et de publication de posts/commentaires n'ont pas de limitation de débit.

**Risque :** Un utilisateur authentifié peut tenter de spammer des réponses ou posts (malgré les guards d'unicité côté base).

**Correction :** Appliquer un rate limit par `userId` sur `intent === "answer"` :
```ts
await checkRateLimit({ key: `micro-answer:${session.user.id}`, maxAttempts: 30, windowSeconds: 60 });
```

---

#### F3 — `trustedOrigins` vide si `APP_URL` non défini

**Fichier :** `app/lib/server/auth.server.ts` (ligne 12)

**Problème :** `trustedOrigins` retourne un tableau vide si `APP_URL` n'est pas renseigné dans les variables d'environnement.

```ts
trustedOrigins: env.APP_URL ? [env.APP_URL] : [],
```

**Risque :** En production sans `APP_URL`, Better Auth peut avoir un comportement imprévisible sur la validation CSRF / origines croisées.

**Action :** S'assurer que `APP_URL` est bien défini dans le `.env` de production (NAS Synology). La variable est actuellement commentée dans `.env.example`.

---

### ✅ Points positifs observés

| Contrôle | État |
|----------|------|
| Pas de `dangerouslySetInnerHTML` | ✅ |
| `requireAuth` sur toutes les routes sensibles | ✅ |
| Vérification du rôle admin pour les actions privilégiées | ✅ |
| Pas de secrets committés (`.env` dans `.gitignore`) | ✅ |
| Validation Zod sur les variables d'environnement | ✅ |
| Validation Zod sur le contenu du fil (posts/commentaires) | ✅ |
| Rate limiting sur l'authentification | ✅ |
| Requêtes SQL paramétrées via Drizzle ORM | ✅ |
| Logs structurés (pino) sans données sensibles exposées | ✅ |

---

## Recommandations prioritaires

1. **[MOYEN – M1]** Ajouter une limite de longueur sur `answer` dans `api.micro-predictions.ts`
2. **[MOYEN – M2]** Valider `type` contre un enum et `question` avec longueur max
3. **[FAIBLE – F1]** Remplacer les raw SQL de `badges.server.ts` par des références Drizzle typées
4. **[FAIBLE – F2]** Ajouter un rate limit léger par utilisateur sur `intent === "answer"`
5. **[FAIBLE – F3]** Documenter `APP_URL` comme requis en production dans le `.env.example`
