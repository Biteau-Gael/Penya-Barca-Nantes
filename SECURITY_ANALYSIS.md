# Analyse de sécurité — Penya Blaugrana Nantes

**Date** : 07 juin 2026  
**Branche analysée** : `main` (commit `003faca`)  
**Périmètre** : codebase complète (routes, lib serveur, schémas DB, config Docker)

---

## Résumé des derniers commits

| Commit | Date | Auteur | Description |
|--------|------|--------|-------------|
| `003faca` | 13/04/2026 | Biteau Gaël | fix: évaluer les badges immédiatement après chaque action |
| `b1c88f6` | 13/04/2026 | Biteau Gaël | feat: Phase 2 — soirée match live, micro-pronos, badges, séries, saisons |
| `68e22d2` | 13/04/2026 | Biteau Gaël | feat: menu burger mobile pour la navigation |
| `d461ee5` | 12/04/2026 | Claude | Merge branch deploy-synology-nas |
| `554b873` | 12/04/2026 | Claude | docs: guide de déploiement NAS Synology |
| `6aebaf7` | 12/04/2026 | Claude | fix: Better Auth trusted origins pour le domaine custom |
| `9823bc5` | 12/04/2026 | Claude | feat: service migrate dans docker-compose.prod.yml |
| `aed5841` | 12/04/2026 | Biteau Gaël | **security: suppression credentials du repo + renforcement .gitignore** |
| `6583da3` | 12/04/2026 | Biteau Gaël | docs: README complet |
| `ab7fc5d` | 12/04/2026 | Biteau Gaël | feat: intégration API Football + stats enrichies + classement Liga |
| `16c43e6` | 11/04/2026 | Biteau Gaël | feat: MVP Phase 1 |
| `fec3e63` | 11/04/2026 | Biteau Gaël | feat: initial commit |

### Points marquants des derniers commits

- **`003faca`** (fix) : ajout de l'appel `evaluateBadges()` après chaque action utilisateur (`feed.server.ts`, `match-detail.server.ts`). Correction mineure, aucun impact sécurité.
- **`b1c88f6`** (feat majeure) : introduction de 4 nouveaux schémas DB, d'un système de micro-pronostics en temps réel, de badges, séries et saisons. C'est le commit le plus volumineux (2 965 lignes), et il introduit la majorité des points identifiés ci-dessous.
- **`aed5841`** (security) : bonne initiative — suppression de credentials accidentellement commis et durcissement du `.gitignore`.

---

## Résultats de l'analyse — par ordre de criticité

---

### CRITIQUE

#### C1 — Path Traversal dans la route de fichiers uploadés

**Fichier** : `app/routes/uploads-files.ts`  
**Impact** : lecture de tout fichier accessible par le processus Node (`.env`, configs DB, code source…)

```typescript
// Code actuel — VULNÉRABLE
const filePath = path.join(process.cwd(), "uploads", params["*"]);
```

`params["*"]` n'est pas validé. Un attaquant peut envoyer :
```
GET /uploads/../../.env
GET /uploads/../../app/lib/server/auth.server.ts
```
`path.join` normalise le chemin mais **ne bloque pas** la sortie du répertoire `uploads/`.

**Correction recommandée** :

```typescript
export async function loader({ params }: { params: { "*": string } }) {
  const requested = params["*"];
  const filePath = path.join(process.cwd(), "uploads", requested);

  // Vérifier que le chemin résolu reste dans le répertoire uploads
  const uploadsDir = path.resolve(process.cwd(), "uploads");
  const resolvedPath = path.resolve(filePath);
  if (!resolvedPath.startsWith(uploadsDir + path.sep)) {
    return new Response("Forbidden", { status: 403 });
  }

  // ... reste du code inchangé
}
```

---

### ÉLEVÉ

#### E1 — Session non invalidée après suppression de compte

**Fichier** : `app/routes/profile.server.ts`  
**Impact** : après suppression, le token de session reste valide en Redis jusqu'à expiration naturelle. Quelqu'un possédant le token peut continuer à faire des requêtes authentifiées.

```typescript
// Code actuel — incomplet
if (intent === "delete-account") {
  await db.delete(user).where(eq(user.id, session.user.id));
  return { success: true, message: "Compte supprimé.", deleted: true };
  // ❌ La session Redis n'est pas révoquée
}
```

**Correction recommandée** : appeler `auth.api.signOut()` ou supprimer directement la clé de session Redis avant de retourner la réponse.

```typescript
if (intent === "delete-account") {
  await db.delete(user).where(eq(user.id, session.user.id));
  // Révoquer la session active
  await auth.api.signOut({ headers: request.headers });
  return { success: true, message: "Compte supprimé.", deleted: true };
}
```

---

#### E2 — Absence de rate limiting sur les routes sensibles

**Fichiers concernés** :
- `app/routes/api.micro-predictions.ts` (action `answer` — réponse illimitée)
- `app/routes/profile.server.ts` (upload avatar — traitement Sharp coûteux)
- `app/routes/feed.server.ts` (création de posts et commentaires)

Le `checkRateLimit` de Redis est implémenté et fonctionnel (`app/lib/server/rate-limit.server.ts`) mais n'est appliqué que sur `app/routes/api.auth.$.ts` (login/register).

**Risques** :
- Spam de micro-pronostics ou de posts par un bot authentifié
- DoS applicatif via de nombreuses requêtes d'upload (Sharp est CPU-intensif)

**Correction recommandée** : appliquer `checkRateLimit` sur chaque action :

```typescript
// Exemple dans api.micro-predictions.ts, intent "answer"
const ip = request.headers.get("x-forwarded-for") ?? "unknown";
await checkRateLimit({
  key: `micro-answer:${session.user.id}`,
  maxAttempts: 20,
  windowSeconds: 60,
});
```

---

### MOYEN

#### M1 — Race condition (TOCTOU) sur les réponses aux micro-pronos

**Fichier** : `app/routes/api.micro-predictions.ts`  
**Impact** : deux requêtes simultanées peuvent toutes deux passer la vérification `existing` et insérer une double réponse.

```typescript
// Vérification puis insertion — non atomique
const [existing] = await db.select()...where(userId AND microId);
if (existing) return { error: "Déjà répondu" };
// ← une 2e requête concurrente peut passer ici
await db.insert(microPredictionAnswers).values({...});
```

**Correction recommandée** : ajouter une contrainte `UNIQUE(microPredictionId, userId)` dans le schéma Drizzle. L'insert échouera naturellement en cas de doublon et l'erreur DB peut être interceptée proprement.

```typescript
// Dans app/db/schema/micro-predictions.ts
export const microPredictionAnswers = pgTable("micro_prediction_answers", {
  ...
}, (t) => ({
  uniqueUserAnswer: unique().on(t.microPredictionId, t.userId),
}));
```

---

#### M2 — Absence de validation de longueur sur le champ `answer`

**Fichier** : `app/routes/api.micro-predictions.ts`  
**Impact** : un utilisateur peut soumettre une réponse de taille arbitraire (plusieurs Mo), saturant la base de données.

```typescript
const answer = formData.get("answer") as string;
if (!microId || !answer) { ... }
// ❌ Aucune limite de longueur
await db.insert(microPredictionAnswers).values({ ..., answer });
```

**Correction recommandée** :

```typescript
if (!answer || answer.length > 200) {
  return Response.json({ error: "Réponse invalide (200 caractères max)" }, { status: 400 });
}
```

---

#### M3 — Absence de headers de sécurité HTTP

**Fichier** : `app/root.tsx`  
**Impact** : exposé à du clickjacking, de l'injection MIME, et des attaques XSS amplifiées.

Les headers suivants sont absents :
- `Content-Security-Policy`
- `X-Frame-Options: DENY`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Strict-Transport-Security` (en production)

**Correction recommandée** : ajouter un middleware Express/Vite ou des headers dans le loader racine :

```typescript
// app/root.tsx
export function headers() {
  return {
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Content-Security-Policy":
      "default-src 'self'; img-src 'self' https://images.fotmob.com data:; font-src 'self' https://fonts.gstatic.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  };
}
```

---

#### M4 — Mots de passe Docker par défaut "changeme"

**Fichier** : `docker-compose.prod.yml`  
**Impact** : si le fichier `.env` de production est absent ou incomplet, PostgreSQL et Redis démarrent avec le mot de passe `changeme`.

```yaml
POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-changeme}
command: redis-server --requirepass ${REDIS_PASSWORD:-changeme}
```

**Correction recommandée** : supprimer les valeurs fallback pour forcer l'échec explicite si les variables ne sont pas définies :

```yaml
POSTGRES_PASSWORD=${POSTGRES_PASSWORD:?POSTGRES_PASSWORD must be set}
command: redis-server --requirepass ${REDIS_PASSWORD:?REDIS_PASSWORD must be set}
```

---

#### M5 — Casts `(session.user as any).role` — contournement du typage

**Fichiers concernés** : `app/routes/feed.server.ts` (2 occurrences), `app/routes/profile.server.ts`  
**Impact** : pas d'impact sécurité direct, mais contourne le système de types TypeScript sur la propriété `role`, masquant d'éventuelles régressions lors de refactoring.

```typescript
// Pattern répété — à éviter
const isAdmin = (session.user as any).role === "admin";
```

**Correction recommandée** : le type `Session` est exporté depuis `auth.server.ts`. L'étendre pour inclure `role` ou utiliser la fonction `requireAuth` avec `allowedRoles` qui gère déjà la vérification de rôle.

---

### FAIBLE

#### F1 — Absence de vérification d'existence du match lors de la création d'un micro-pronostic

**Fichier** : `app/routes/api.micro-predictions.ts`  
**Impact** : un admin peut créer un micro-pronostic avec un `matchId` inexistant, créant un enregistrement orphelin en base.

**Correction recommandée** : vérifier que le match existe avant l'insert :
```typescript
const [match] = await db.select({ id: matches.id }).from(matches).where(eq(matches.id, matchId));
if (!match) return Response.json({ error: "Match introuvable" }, { status: 404 });
```

---

#### F2 — URL de highlights externe non contrôlée

**Fichier** : `app/lib/server/api-football.server.ts`  
**Impact** : la propriété `highlightUrl` provient directement de l'API externe et est affichée dans le frontend sans validation. Si l'API renvoie une URL `javascript:` ou une URL vers un contenu inapproprié, elle sera rendue telle quelle.

**Correction recommandée** : valider que l'URL commence par `https://` avant de la retourner :
```typescript
highlightUrl = url.startsWith("https://") ? url : null;
```

---

## Bonnes pratiques constatées

| Contrôle | Statut | Détail |
|----------|--------|--------|
| `.env` dans `.gitignore` | ✅ | Correctement exclu |
| Credentials supprimés du repo | ✅ | Commit `aed5841` |
| Validation des inputs utilisateur | ✅ | Zod systématiquement utilisé |
| Injection SQL | ✅ | Drizzle ORM avec requêtes paramétrées |
| Authentification | ✅ | `requireAuth` sur toutes les routes protégées |
| Contrôle d'accès admin | ✅ | Vérification de rôle en place |
| `AUTH_SECRET` validé | ✅ | Minimum 16 caractères forcé par Zod |
| Rate limiting sur auth | ✅ | Login et register protégés |
| Consentement GDPR | ✅ | Champ `gdprConsent` requis à l'inscription |
| Upload avatar sécurisé | ✅ | Type MIME vérifié, taille limitée (2 Mo), conversion WebP via Sharp |
| Auto-protection admin | ✅ | Un admin ne peut pas modifier/supprimer son propre rôle |

---

## Récapitulatif des actions recommandées

| Priorité | Réf. | Action | Effort |
|----------|------|--------|--------|
| CRITIQUE | C1 | Corriger le path traversal dans `uploads-files.ts` | ~30 min |
| ÉLEVÉ | E1 | Invalider la session après suppression de compte | ~30 min |
| ÉLEVÉ | E2 | Appliquer `checkRateLimit` sur micro-pronos, upload, feed | ~2h |
| MOYEN | M1 | Ajouter contrainte `UNIQUE` en DB pour les réponses micro-pronos | ~30 min |
| MOYEN | M2 | Valider la longueur du champ `answer` | ~15 min |
| MOYEN | M3 | Ajouter les headers de sécurité HTTP dans `root.tsx` | ~1h |
| MOYEN | M4 | Supprimer les fallback "changeme" dans docker-compose.prod.yml | ~15 min |
| MOYEN | M5 | Éliminer les casts `as any` sur `role` | ~1h |
| FAIBLE | F1 | Vérifier existence du match avant création micro-pronostic | ~15 min |
| FAIBLE | F2 | Valider les URLs externes avant utilisation | ~15 min |
