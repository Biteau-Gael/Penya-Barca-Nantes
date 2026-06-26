# Audit de sécurité — Penya Blaugrana Nantes

**Date :** 26/06/2026  
**Branche analysée :** `main`  
**Analyseur :** Revue automatisée + analyse statique

---

## 1. Résumé des derniers commits

| Hash | Date | Message |
|------|------|---------|
| `003faca` | 13/04/2026 | `fix:` évaluer les badges immédiatement après chaque action |
| `b1c88f6` | 13/04/2026 | `feat:` Phase 2 — soirée match live, micro-pronos, badges, séries, saisons |
| `d461ee5` | 12/04/2026 | Merge branch `claude/deploy-synology-nas-cLkOL` |
| `554b873` | 12/04/2026 | Add deployment guide for Synology NAS updates |
| `68e22d2` | 13/04/2026 | `feat:` menu burger mobile pour la navigation |

### Périmètre du sprint analysé (b1c88f6)

Le commit `b1c88f6` représente l'essentiel du sprint Phase 2 et constitue la surface d'attaque principale de cet audit. Il introduit :

- **26 fichiers modifiés, +2 965 lignes** de code de production
- Routes : `/soiree/:matchId`, `/badges`, `/api/micro-predictions`
- Schéma DB : 6 nouvelles tables (`seasons`, `badges`, `user_badges`, `rewards`, `micro_predictions`, `micro_prediction_answers`)
- Migration `0007_slimy_maria_hill.sql`
- Logique serveur : `badges.server.ts`, `streaks.server.ts`, `seasons.server.ts`

---

## 2. Points positifs identifiés

- `.gitignore` correctement configuré (`.env` exclu, pas de credentials en clair dans le repo)
- Commit `aed5841` (antérieur) a déjà supprimé des credentials du repo — bonne réaction
- `env.server.ts` valide toutes les variables d'environnement avec Zod au démarrage
- `requireAuth` utilisé systématiquement sur les routes protégées
- Vérification `role === "admin"` présente sur les actions d'administration
- Protection IDOR basique sur la suppression de posts/commentaires (`authorId !== session.user.id`)
- Check de doublon réponse micro-pronostic (`existing` query avant insert)
- `.env.example` documenté sans vraies valeurs

---

## 3. Vulnérabilités par ordre de criticité

---

### 🔴 CRITIQUE

#### C-1 — Exposition de clé API dans les logs d'erreur
**Fichier :** `app/routes/soiree.server.ts` (lignes ~38–40, ~69, ~132)  
**Description :** La clé `API_FOOTBALL_KEY` est passée en header HTTP lors des appels fetch vers l'API externe. En cas d'erreur, les objets `error` sont transmis à `logger.error()` sans filtrer les headers. Selon la configuration du logger (Pino), des informations de la requête peuvent être incluses dans la sortie.  
**Impact :** Compromission de la clé API Football si les logs sont accessibles (fichier, console, service d'agrégation).  
**Correction :**
```typescript
logger.error({ error: error.message, externalFixtureId }, "Erreur API Football");
// Ne jamais passer l'objet error brut qui peut contenir les headers
```

#### C-2 — Absence de validation des entrées admin sur micro-pronostics
**Fichier :** `app/routes/api.micro-predictions.ts` (lignes 19–34)  
**Description :** Les champs `type`, `options`, `pointsValue` et `deadlineSeconds` sont acceptés sans whitelist ni validation de type au-delà d'un simple `parseInt`.  
**Impact :** Insertion de données malveillantes en base, stockage de valeurs `type` arbitraires qui cassent la logique de scoring, XSS côté client si les options sont réaffichées sans échappement.  
**Correction :**
```typescript
const VALID_TYPES = ["qcm", "score", "player"] as const;
if (!VALID_TYPES.includes(type as any)) {
  return Response.json({ error: "Type invalide" }, { status: 400 });
}
const pointsValue = Math.max(1, Math.min(10, parseInt(...) || 1));
const deadlineSeconds = Math.max(30, Math.min(3600, parseInt(...) || 120));
```

#### C-3 — Injection JSON sans validation de schéma (cache match)
**Fichier :** `app/routes/soiree.server.ts` (lignes ~81–90)  
**Description :** Les données brutes de l'API Football sont stockées via `JSON.stringify()` et relues via `JSON.parse()` sans valider la structure. Si l'API renvoie des champs inattendus (ex. contenant du HTML), ceux-ci sont propagés au client.  
**Impact :** XSS potentiel si des données de l'API externe contiennent du HTML affiché sans échappement côté client, corruption silencieuse du cache.  
**Correction :** Valider le schéma de l'API avec Zod avant stockage.

#### C-4 — ON DELETE CASCADE sur les réponses de micro-pronostics
**Fichier :** `app/db/migrations/0007_slimy_maria_hill.sql` (ligne ~64)  
**Description :** La FK `micro_prediction_answers.microPredictionId` est configurée avec `ON DELETE CASCADE`. La suppression d'un micro-pronostic (action admin) efface silencieusement toutes les réponses et les points associés.  
**Impact :** Perte définitive de données historiques, impossibilité d'audit. Un admin malveillant (ou une erreur) peut effacer des points déjà attribués.  
**Correction :** Passer à `ON DELETE RESTRICT` et gérer la suppression explicitement en deux étapes dans le code applicatif, ou implémenter un soft-delete.

---

### 🟠 HAUTE

#### H-1 — Race condition sur les réponses aux micro-pronostics
**Fichier :** `app/routes/api.micro-predictions.ts` (lignes 109–127)  
**Description :** Le check d'existence `existing` et l'insertion ne sont pas dans une transaction atomique. Deux requêtes concurrentes peuvent passer le check simultanément et insérer deux réponses pour le même utilisateur.  
**Impact :** Double comptage de points, contournement de la règle "une seule réponse par utilisateur".  
**Correction :**
```typescript
await db.transaction(async (tx) => {
  const [existing] = await tx.select()...
  if (existing) throw new Error("Déjà répondu");
  await tx.insert(...)...
});
```

#### H-2 — Race condition sur l'attribution des badges
**Fichier :** `app/lib/server/badges.server.ts` (lignes ~169–194)  
**Description :** La vérification `ownedBadgeIds.has(badge.id)` et l'insertion du badge ne sont pas dans une transaction. Deux évaluations parallèles (ex. soumission de pronostic + publication de post simultanées) peuvent attribuer le même badge deux fois.  
**Impact :** Badges dupliqués en base, incohérence de l'affichage profil.  
**Correction :** Ajouter une contrainte d'unicité `(userId, badgeId)` sur la table `user_badges` et gérer le conflit avec `ON CONFLICT DO NOTHING`.

#### H-3 — Absence de rate limiting sur les endpoints API
**Fichiers :** `app/routes/api.micro-predictions.ts`, `app/routes/feed.server.ts`  
**Description :** Aucune limitation de débit n'est implémentée sur les actions de création de posts, commentaires, réactions et réponses aux micro-pronostics.  
**Impact :** Spam, DoS applicatif par saturation des tables, abus de système de points.  
**Correction :** Utiliser le middleware Redis disponible (le projet dispose déjà de Redis) pour implémenter un rate limiting par `userId`.

#### H-4 — Cast `as any` sur le rôle utilisateur
**Fichier :** `app/routes/feed.server.ts` (lignes ~99, 124, 184, 200)  
**Description :** `(session.user as any).role` contourne le système de types TypeScript. Si la structure de session change, la vérification de rôle peut échouer silencieusement.  
**Impact :** Régression de sécurité possible si le typage Better Auth évolue ; élévation de privilèges non détectée à la compilation.  
**Correction :** Déclarer le type étendu de la session Better Auth et utiliser un type guard explicite.

#### H-5 — Pas de transaction sur mise à jour de série (streak) + récompense
**Fichier :** `app/lib/server/streaks.server.ts` (lignes ~21–91)  
**Description :** La lecture du streak, la création de la récompense, la publication du post automatique et la mise à jour du compteur sont effectuées en plusieurs requêtes non atomiques.  
**Impact :** En cas de crash ou de concurrence, un utilisateur peut recevoir une récompense sans mise à jour du compteur, ou vice versa.  
**Correction :** Encapsuler l'ensemble de la logique dans une transaction Drizzle.

#### H-6 — Validation `externalFixtureId` absente avant concaténation URL
**Fichier :** `app/routes/soiree.server.ts` (lignes ~34, 83–88)  
**Description :** `externalFixtureId` est inséré directement dans l'URL du fetch sans vérifier qu'il s'agit d'un entier.  
**Impact :** Si la valeur est manipulée en amont, injection dans l'URL, potentiel SSRF.  
**Correction :**
```typescript
if (!/^\d+$/.test(String(externalFixtureId))) {
  throw new Error("externalFixtureId invalide");
}
```

#### H-7 — Validation Zod absente sur les IDs de ressources
**Fichier :** `app/routes/feed.server.ts` (lignes ~141, 163, 183, 199)  
**Description :** `postId`, `commentId` sont extraits de `formData` sans validation de format (UUID/cuid).  
**Impact :** Requêtes SQL avec des valeurs inattendues, messages d'erreur révélateurs de la structure interne.  
**Correction :** Appliquer Zod sur tous les IDs comme c'est déjà fait pour `content`.

---

### 🟡 MOYENNE

#### M-1 — Timing attack possible sur `correctAnswer`
**Fichier :** `app/routes/api.micro-predictions.ts` (lignes ~49, 74)  
**Description :** La comparaison `answer.toLowerCase().trim() === correctAnswer.toLowerCase().trim()` révèle la réponse correcte à travers les différences de temps de réponse selon le nombre d'entrées correctes.  
**Impact :** Un attaquant observant les temps de réponse peut deviner la réponse correcte avant la clôture officielle.  
**Correction :** Niveau de risque limité en pratique compte tenu du contexte applicatif, mais utiliser une comparaison à temps constant si les enjeux augmentent.

#### M-2 — Absence de timeout sur les appels API externes
**Fichier :** `app/routes/soiree.server.ts` (lignes ~36–41, 82–88)  
**Description :** Les appels `fetch` vers l'API Football n'ont pas de `signal: AbortSignal.timeout(N)`.  
**Impact :** En cas de lenteur ou de non-réponse de l'API, les connexions côté serveur restent suspendues, épuisant le pool de workers.  
**Correction :**
```typescript
fetch(url, { headers, signal: AbortSignal.timeout(5000) })
```

#### M-3 — N+1 queries sur le fil d'actualité
**Fichier :** `app/routes/feed.server.ts` (lignes ~38–94)  
**Description :** Pour chaque post chargé, une query supplémentaire récupère les réactions et une autre les commentaires.  
**Impact :** 50 posts = 100+ requêtes DB ; dégradation de performance sous charge, vecteur de DoS indirect.  
**Correction :** Utiliser des jointures ou des requêtes `IN (postIds)` groupées.

#### M-4 — Post automatique généré sans sanitization du pseudo
**Fichier :** `app/lib/server/streaks.server.ts` (lignes ~55–72)  
**Description :** Le message du post automatique (récompense de série) est construit en interpolant directement `pseudo` ou `name` de l'utilisateur.  
**Impact :** Si un utilisateur a un pseudo contenant des caractères HTML/Markdown spéciaux, cela peut affecter le rendu côté client.  
**Correction :** Échapper le pseudo avant interpolation, ou construire le message depuis un template sans interpolation directe de données utilisateur.

#### M-5 — Logging excessif d'identifiants utilisateur
**Fichiers :** `app/routes/soiree.server.ts` (ligne ~209), `app/lib/server/badges.server.ts` (ligne ~193), `app/lib/server/streaks.server.ts` (ligne ~76)  
**Description :** Les IDs utilisateur sont loggés en clair dans plusieurs endroits.  
**Impact :** Fuite d'identifiants dans les logs si ceux-ci ne sont pas suffisamment protégés.  
**Correction :** Hasher ou tronquer les IDs dans les logs, ou les envoyer dans un champ structuré séparé marqué "PII".

#### M-6 — Type assertion sans validation sur `matchDetails`
**Fichier :** `app/routes/match-detail.server.ts` (ligne ~83)  
**Description :** `JSON.parse(match.matchDetails) as MatchDetails` accepte sans vérification que les données correspondent au type attendu.  
**Impact :** Crash runtime ou comportement imprévisible si la structure du JSON change côté API.  
**Correction :** Valider avec un schéma Zod après le `JSON.parse`.

#### M-7 — Pas de contrainte d'unicité saison active
**Fichier :** `app/lib/server/seasons.server.ts` (lignes ~19–27)  
**Description :** `getOrCreateActiveSeason()` ne protège pas contre la création concurrente de deux saisons actives.  
**Impact :** Incohérence des classements si plusieurs saisons actives coexistent.  
**Correction :** Ajouter une contrainte `UNIQUE` partielle sur `isActive = true` en DB.

#### M-8 — Pas d'`updatedAt` sur les tables critiques
**Fichiers :** `app/db/schema/badges.ts`, `app/db/schema/seasons.ts`, `app/db/schema/rewards.ts`  
**Description :** Absence de colonne `updatedAt`, rendant impossible l'audit des modifications.  
**Impact :** Impossibilité de détecter des modifications non autorisées en base.

---

### 🔵 FAIBLE

#### F-1 — Dates de saison hardcodées
**Fichier :** `app/lib/server/seasons.server.ts` (lignes ~24–25)  
**Description :** Les bornes de saison (`2025-08-01`, `2026-06-30`) sont en dur dans le code.  
**Impact :** Nécessite un déploiement pour chaque changement de saison.  
**Correction :** Déplacer vers la configuration ou une table `settings` en DB.

#### F-2 — Énumérations stockées en `text` libre
**Fichier :** `app/db/schema/micro-predictions.ts` (colonne `type`)  
**Description :** La colonne `type` accepte n'importe quelle chaîne au lieu d'un enum PostgreSQL.  
**Impact :** Données invalides possibles si la validation applicative est contournée.  
**Correction :** Utiliser `pgEnum` de Drizzle.

#### F-3 — Absence d'index sur les colonnes de jointure fréquentes
**Fichiers :** Schémas de `user_badges`, `micro_prediction_answers`, `rewards`  
**Description :** Pas d'index déclaré sur `userId`, `matchId`, `postId` dans les tables de jointure.  
**Impact :** Full-table scans sur des tables qui grossissent, dégradation progressive des performances.

#### F-4 — Pas de soft-delete
**Description :** Aucune table n'implémente de suppression logique (`deletedAt`).  
**Impact :** Suppressions définitives, pas d'audit trail, restauration impossible.

---

## 4. Tableau de synthèse

| ID | Criticité | Fichier principal | Effort de correction |
|----|-----------|-------------------|----------------------|
| C-1 | 🔴 CRITIQUE | `soiree.server.ts` | Faible (1h) |
| C-2 | 🔴 CRITIQUE | `api.micro-predictions.ts` | Faible (2h) |
| C-3 | 🔴 CRITIQUE | `soiree.server.ts` | Moyen (4h) |
| C-4 | 🔴 CRITIQUE | `migration 0007` | Moyen (4h + migration) |
| H-1 | 🟠 HAUTE | `api.micro-predictions.ts` | Faible (2h) |
| H-2 | 🟠 HAUTE | `badges.server.ts` | Faible (2h) |
| H-3 | 🟠 HAUTE | `api.micro-predictions.ts`, `feed.server.ts` | Moyen (1j) |
| H-4 | 🟠 HAUTE | `feed.server.ts` | Faible (2h) |
| H-5 | 🟠 HAUTE | `streaks.server.ts` | Faible (2h) |
| H-6 | 🟠 HAUTE | `soiree.server.ts` | Faible (1h) |
| H-7 | 🟠 HAUTE | `feed.server.ts` | Faible (2h) |
| M-1 | 🟡 MOYENNE | `api.micro-predictions.ts` | Faible |
| M-2 | 🟡 MOYENNE | `soiree.server.ts` | Faible (30min) |
| M-3 | 🟡 MOYENNE | `feed.server.ts` | Moyen (4h) |
| M-4 | 🟡 MOYENNE | `streaks.server.ts` | Faible (1h) |
| M-5 | 🟡 MOYENNE | Plusieurs | Faible (2h) |
| M-6 | 🟡 MOYENNE | `match-detail.server.ts` | Faible (1h) |
| M-7 | 🟡 MOYENNE | `seasons.server.ts` | Moyen (2h + migration) |
| M-8 | 🟡 MOYENNE | Schémas DB | Moyen (migration) |
| F-1 | 🔵 FAIBLE | `seasons.server.ts` | Faible |
| F-2 | 🔵 FAIBLE | Schéma DB | Faible |
| F-3 | 🔵 FAIBLE | Schémas DB | Faible |
| F-4 | 🔵 FAIBLE | Tous schémas | Élevé |

---

## 5. Plan d'action recommandé

### Sprint correctif prioritaire (cette semaine)

1. **C-1** : Filtrer les objets d'erreur dans les logs de `soiree.server.ts`
2. **C-2** : Ajouter validation Zod + whitelist sur `api.micro-predictions.ts`
3. **H-1, H-2** : Passer les opérations critiques en transactions
4. **H-6** : Valider `externalFixtureId` comme entier
5. **M-2** : Ajouter `AbortSignal.timeout()` sur tous les fetch externes
6. **H-4** : Typer correctement le rôle utilisateur depuis Better Auth

### Sprint suivant

7. **C-3** : Valider le schéma JSON de l'API Football avec Zod
8. **H-3** : Implémenter le rate limiting via Redis (middleware déjà disponible)
9. **H-7** : Valider tous les IDs avec Zod dans `feed.server.ts`
10. **M-3** : Optimiser les N+1 queries du fil d'actualité

### Backlog technique

11. **C-4** : Migrer `ON DELETE CASCADE` → `ON DELETE RESTRICT` + soft-delete
12. **M-7** : Contrainte unicité saison active en DB
13. **F-3** : Ajouter les index sur les colonnes de jointure
14. **F-1** : Externaliser les dates de saison vers la configuration

---

*Document généré automatiquement le 26/06/2026 — à conserver dans le repo et à mettre à jour après chaque sprint.*
