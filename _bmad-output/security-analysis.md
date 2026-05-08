# Analyse de Sécurité — Penya Barca Nantes

**Date d'analyse** : 2026-05-08  
**Branche analysée** : `main` (HEAD `003faca`)  
**Analyseur** : Claude Sonnet 4.6

---

## Résumé des Derniers Commits

| Commit | Date | Description |
|--------|------|-------------|
| `003faca` | 2026-04-13 | fix: évaluer les badges immédiatement après chaque action (pronos, posts, commentaires, réactions) |
| `b1c88f6` | 2026-04-13 | feat: Phase 2 — soirée match live, micro-pronos, badges, séries, saisons |
| `d461ee5` | 2026-04-12 | Merge branch `deploy-synology-nas-cLkOL` |
| `554b873` | 2026-04-12 | docs: guide de mise à jour déploiement NAS Synology |
| `68e22d2` | 2026-04-13 | feat: menu burger mobile pour la navigation |
| `6aebaf7` | 2026-04-12 | fix: Better Auth trusted origins pour le support de domaine personnalisé |
| `9823bc5` | 2026-04-12 | fix: service migrate dans docker-compose.prod.yml |
| `8d6e5e9` | 2026-04-12 | feat: Docker Compose production + script backup Synology NAS |
| `3d80133` | 2026-04-12 | docs: roadmap Phase 2 — 8 priorités |
| `aed5841` | 2026-04-12 | **security: supprimer credentials du repo et renforcer .gitignore** |
| `6583da3` | 2026-04-12 | docs: README complet avec guide déploiement |
| `ab7fc5d` | 2026-04-12 | feat: intégration API Football + stats enrichies + classement Liga |
| `16c43e6` | 2026-04-11 | feat: MVP Phase 1 — Penya Blaugrana Nantes |

### Points notables sur les commits récents

- **Phase 2** (b1c88f6) : ajout de 7 nouvelles routes (`/soiree/:matchId`, `api.micro-predictions`, `/badges`, etc.) et 6 nouvelles tables en DB — périmètre d'attaque élargi.
- **003faca** : correction importante — les badges sont maintenant évalués directement dans `feed.server.ts` et `match-detail.server.ts` après chaque action, ce qui peut exposer de la logique côté serveur à des appels d'action non vérifiés.
- **aed5841** : commit de sécurité positif — suppression de credentials du repo et renforcement du `.gitignore`.

---

## Analyse de Sécurité par Criticité

---

## CRITIQUE

### C1 — Path Traversal dans le serveur de fichiers uploadés

**Fichier** : `app/routes/uploads-files.ts:5`  
**Vecteur** : Accès non authentifié à la route `/uploads/*`

```typescript
// Vulnérable
const filePath = path.join(process.cwd(), "uploads", params["*"]);
```

Un attaquant peut accéder à des fichiers arbitraires du serveur avec une URL comme :
`/uploads/../../.env` → expose `DATABASE_URL`, `AUTH_SECRET`, `API_FOOTBALL_KEY`

**Correction requise** :
```typescript
const uploadsDir = path.resolve(process.cwd(), "uploads");
const filePath = path.resolve(uploadsDir, params["*"]);
if (!filePath.startsWith(uploadsDir + path.sep)) {
  return new Response("Not found", { status: 404 });
}
```

**Risque** : Exfiltration des secrets d'environnement, compromission complète de la base de données.

---

### C2 — Absence de protection CSRF sur toutes les actions

**Fichiers concernés** : toutes les routes `*.server.ts` avec des `action()`  
**Vecteur** : Un site tiers peut déclencher des requêtes POST au nom d'un utilisateur connecté.

Better Auth gère les sessions via cookies. Sans token CSRF, un attaquant peut :
- Créer/supprimer des posts à la place d'un utilisateur
- Déclencher des actions admin (si cookie de session admin accessible)
- Modifier des pronostics ou clore des micro-pronos

React Router v7 / Better Auth ne fournissent pas de protection CSRF automatique pour les `<Form>` personnalisés.

**Correction recommandée** : Implémenter un double-submit cookie pattern ou utiliser l'en-tête `Origin` comme vérification :
```typescript
// Dans un middleware d'action
const origin = request.headers.get("origin");
const host = request.headers.get("host");
if (origin && !origin.includes(host ?? "")) {
  return Response.json({ error: "Requête invalide" }, { status: 403 });
}
```

**Risque** : Actions malveillantes exécutées à l'insu d'un utilisateur connecté.

---

### C3 — Re-clôture possible d'un micro-pronostic (double attribution de points)

**Fichier** : `app/routes/api.micro-predictions.ts:47-86`

L'action `close` ne vérifie pas si le micro-pronostic est déjà clôturé avant de mettre à jour et d'attribuer les points. Un admin (ou un compte compromis) peut déclencher l'attribution plusieurs fois.

```typescript
// Ligne 56-60 : aucune vérification de micro.closedAt avant l'update
const [micro] = await db
  .update(microPredictions)
  .set({ correctAnswer, closedAt: new Date() })
  .where(eq(microPredictions.id, microId))
  .returning();
```

**Correction** :
```typescript
const [micro] = await db.select().from(microPredictions)
  .where(eq(microPredictions.id, microId));
if (!micro) return Response.json({ error: "Introuvable" }, { status: 404 });
if (micro.closedAt) return Response.json({ error: "Déjà clôturé" }, { status: 400 });
```

**Risque** : Manipulation du classement via attribution multiple de points.

---

## ÉLEVÉ

### H1 — Absence d'en-têtes de sécurité HTTP

**Fichier** : Aucune configuration d'en-têtes dans `vite.config.ts` ni dans le point d'entrée

Les en-têtes suivants sont absents :
- `Content-Security-Policy` → risque XSS
- `X-Frame-Options` → risque clickjacking
- `X-Content-Type-Options` → risque MIME sniffing
- `Referrer-Policy`

**Correction** : Ajouter dans `react-router.config.ts` ou via un middleware Express :
```typescript
// Dans app/root.tsx ou un middleware
headers: {
  "X-Frame-Options": "SAMEORIGIN",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Content-Security-Policy": "default-src 'self'; img-src 'self' data: https://images.fotmob.com; ...",
}
```

---

### H2 — IP "unknown" dans le rate limiting — clé partagée par tous

**Fichier** : `app/routes/api.auth.$.ts:5-11`

Quand les en-têtes `x-forwarded-for` et `x-real-ip` sont absents, toutes les requêtes utilisent la clé `login:unknown` ou `register:unknown`. Un attaquant peut :
1. Épuiser le quota de tous les utilisateurs légitimes (DoS du système d'auth)
2. Contourner le rate limit en falsifiant l'en-tête `x-forwarded-for`

```typescript
// Ligne 8-9 : valeur de repli dangereuse
request.headers.get("x-real-ip") ||
"unknown"  // ← tous les clients sans header partagent ce quota
```

**Correction** :
```typescript
const ip = getClientIp(request);
if (ip === "unknown") {
  return new Response(JSON.stringify({ error: { message: "IP non déterminable" } }), 
    { status: 429, headers: { "Content-Type": "application/json" } });
}
```

---

### H3 — Vérification du rôle depuis la session sans re-validation en base

**Fichier** : `app/lib/server/auth-utils.server.ts:19`

```typescript
// Le rôle est lu depuis le JWT/session sans vérification DB
if (allowedRoles && !allowedRoles.includes(session.user.role as Role)) {
```

Si la session Redis est compromise ou si un token est falsifié, un attaquant pourrait usurper le rôle `admin`. Le rôle n'est jamais re-lu depuis la table `users` au moment de la vérification.

**Correction recommandée** : Pour les routes admin critiques, ré-interroger la DB :
```typescript
const [dbUser] = await db.select({ role: users.role })
  .from(users)
  .where(eq(users.id, session.user.id));
if (!dbUser || !allowedRoles.includes(dbUser.role as Role)) {
  throw new Response("Accès refusé", { status: 403 });
}
```

---

### H4 — Absence de timeout sur les appels à l'API externe

**Fichier** : `app/lib/server/api-football.server.ts:115-120`

```typescript
// Aucun AbortController ni timeout configuré
const response = await fetch(url.toString(), {
  headers: { "x-rapidapi-key": env.API_FOOTBALL_KEY, ... },
});
```

Si l'API RapidAPI ne répond pas, la requête peut bloquer indéfiniment, consommant un worker Node.js entier.

**Correction** :
```typescript
const controller = new AbortController();
const timeoutId = setTimeout(() => controller.abort(), 8000);
try {
  const response = await fetch(url.toString(), {
    signal: controller.signal,
    headers: { ... },
  });
  clearTimeout(timeoutId);
  ...
} catch (e) {
  if ((e as Error).name === "AbortError") throw new Error("API Football timeout");
  throw e;
}
```

---

### H5 — Validation insuffisante à la création d'un micro-pronostic

**Fichier** : `app/routes/api.micro-predictions.ts:18-44`

Les champs suivants sont acceptés sans validation :
- `type` : n'importe quelle chaîne (attendu `"qcm"` ou `"free"`)
- `pointsValue` : défaut `1` mais sans borne supérieure
- `deadlineSeconds` : peut être négatif ou 0
- `question` : chaîne vide potentielle si whitespace

**Correction** : Ajouter un schéma Zod (le projet utilise déjà Zod dans `lib/validation/`) :
```typescript
const createMicroSchema = z.object({
  matchId: z.string().min(1),
  question: z.string().min(3).max(500).trim(),
  type: z.enum(["qcm", "free"]),
  pointsValue: z.coerce.number().int().min(1).max(100).default(1),
  deadlineSeconds: z.coerce.number().int().min(10).max(3600).default(120),
});
```

---

## MOYEN

### M1 — parseInt sans radix explicite sur les scores

**Fichier** : `app/routes/admin.matches.server.ts:120-121`

```typescript
const homeScore = parseInt(formData.get("homeScore") as string);
const awayScore = parseInt(formData.get("awayScore") as string);
```

Même si la vérification `isNaN` et `< 0` est présente (ligne 123), l'absence de radix `10` est une mauvaise pratique, et il n'y a pas de borne supérieure (un score de `99999` est accepté).

**Correction** :
```typescript
const homeScore = parseInt(formData.get("homeScore") as string, 10);
const awayScore = parseInt(formData.get("awayScore") as string, 10);
if (!id || isNaN(homeScore) || isNaN(awayScore) || homeScore < 0 || homeScore > 99 || awayScore < 0 || awayScore > 99) {
  return { error: "Score invalide." };
}
```

---

### M2 — Cache immutable sur des ressources utilisateur modifiables

**Fichier** : `app/routes/uploads-files.ts:21`

```typescript
"Cache-Control": "public, max-age=31536000, immutable",
```

Les avatars sont stockés avec le nom `{userId}.webp`. Si un utilisateur change d'avatar, l'ancien est mis en cache un an chez le navigateur et les CDN intermédiaires.

**Correction** : Utiliser une stratégie avec versionnement ou réduire la durée :
```typescript
"Cache-Control": "public, max-age=86400",  // 24h, ou
// Inclure un hash dans le nom de fichier lors de l'upload
```

---

### M3 — Cast `(session.user as any).role` bypass TypeScript

**Fichier** : `app/routes/feed.server.ts:99,124`

```typescript
isAdmin: (session.user as any).role === "admin",
if (isAnnouncement && (session.user as any).role !== "admin") {
```

L'utilisation de `as any` contourne la sûreté de type. Le type `session.user` de Better Auth devrait exposer `role` directement via les `additionalFields` définis dans `auth.server.ts`.

**Correction** : Déclarer un type étendu ou utiliser l'inférence Better Auth :
```typescript
// Utiliser le type Session exporté depuis auth.server.ts
import type { Session } from "~/lib/server/auth.server";
const user = session.user as Session["user"];
```

---

### M4 — Aucun audit log détaillé pour les actions admin sensibles

**Fichiers** : `admin.members.server.ts`, `admin.matches.server.ts`, `api.micro-predictions.ts`

Les logs existent (`logger.info`) mais ne capturent pas les anciennes valeurs avant modification, l'IP de l'admin, ni un identifiant de session. Impossible de reconstituer un audit trail complet en cas d'incident.

**Amélioration recommandée** :
```typescript
logger.info({
  action: "member-role-changed",
  targetUserId: memberId,
  oldRole: existingUser.role,
  newRole: newRole,
  by: session.user.id,
  ip: getClientIp(request),
  at: new Date().toISOString(),
}, "Changement de rôle membre");
```

---

### M5 — Aucun rate limit sur les endpoints de mutation non-auth

**Fichiers** : `api.micro-predictions.ts`, `feed.server.ts`

Le rate limiting n'est appliqué qu'aux routes d'authentification (`sign-in`, `sign-up`). Les actions utilisateur (poster, commenter, répondre à un micro-prono) ne sont pas limitées en fréquence.

**Correction** : Appliquer `checkRateLimit` sur les mutations :
```typescript
await checkRateLimit({
  key: `post-create:${session.user.id}`,
  maxAttempts: 20,
  windowSeconds: 60,
});
```

---

## FAIBLE

### F1 — `API_FOOTBALL_KEY` optionnelle en production

**Fichier** : `app/config/env.server.ts:14`

```typescript
API_FOOTBALL_KEY: z.string().optional(),
```

La clé est facultative au démarrage mais obligatoire à l'exécution des syncs. Une erreur runtime survient bien après le démarrage si elle manque en production.

**Amélioration** :
```typescript
API_FOOTBALL_KEY: process.env.NODE_ENV === "production"
  ? z.string().min(1)
  : z.string().optional(),
```

---

### F2 — Absence de timeout sur les appels Redis

**Fichier** : `app/lib/server/auth.server.ts:43-58`

Les opérations Redis (`get`, `set`, `del`) n'ont pas de timeout. Si Redis est surchargé ou inaccessible, les requêtes d'authentification bloquent.

---

### F3 — Pas de nettoyage des anciens avatars

**Fichier** : `app/lib/server/upload.ts`

Chaque changement d'avatar écrase le fichier `{userId}.webp` mais les fichiers d'avatars d'anciens comptes supprimés ne sont jamais nettoyés. Sans politique de rétention, le volume du dossier `uploads/` croît indéfiniment.

---

### F4 — `.gitignore` exclut les `.png` globalement

**Fichier** : `.gitignore:19`

```
*.png
```

Cette règle exclut toutes les images PNG du repo, y compris d'éventuels assets statiques dans `public/`. Vérifier qu'aucune ressource PNG utile n'est involontairement ignorée.

---

## Points Positifs

| Aspect | État |
|--------|------|
| Protection SQL injection | Drizzle ORM avec requêtes paramétrées — aucune concaténation SQL brute détectée |
| Validation Zod | Bien utilisée dans `lib/validation/` pour les schémas de formulaires |
| Rate limiting auth | Implémenté sur sign-in (10 tentatives/15 min) et sign-up (5/heure) |
| Credentials hors repo | Commit `aed5841` a nettoyé les secrets, `.env` bien dans `.gitignore` |
| HTTPS en production | Forcé par Nginx reverse-proxy dans la config NAS |
| Logger structuré | Pino avec niveaux configurables, pas d'exposition en production |
| Gestion d'erreurs | `errors.server.ts` centralise les réponses d'erreur |
| Tests unitaires | Présents pour validation, calcul de points, rate limit, upload |
| Better Auth | Bibliothèque éprouvée pour l'authentification, sessions Redis |

---

## Plan d'Action Prioritaire

### Immédiat (avant prochain déploiement)

1. **[C1]** Corriger le path traversal dans `uploads-files.ts` — 5 min
2. **[C3]** Ajouter la vérification `closedAt` dans l'action `close` des micro-pronos — 5 min

### Court terme (sprint suivant)

3. **[C2]** Implémenter la vérification d'origine CSRF (validation `Origin` header)
4. **[H1]** Configurer les en-têtes de sécurité HTTP (CSP, X-Frame-Options, etc.)
5. **[H2]** Bloquer les requêtes avec IP `"unknown"` dans le rate limiter
6. **[H4]** Ajouter des AbortController avec timeout sur les appels API Football
7. **[H5]** Ajouter un schéma Zod pour la création de micro-pronos

### Moyen terme

8. **[H3]** Re-valider les rôles en DB sur les routes admin critiques
9. **[M4]** Enrichir les audit logs des actions admin
10. **[M5]** Étendre le rate limiting aux mutations utilisateur

---

*Document généré suite à l'analyse statique du code source. Aucune exploitation active n'a été réalisée.*
