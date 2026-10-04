# Rapport d'audit de sécurité — Penya Blaugrana Nantes

**Date** : 2026-10-04  
**Branche analysée** : `main` (HEAD `003faca`)  
**Périmètre** : commits récents + analyse statique du code

---

## Résumé des commits récents

| Hash | Auteur | Date | Description |
|------|--------|------|-------------|
| `003faca` | Biteau Gaël | 13 avr 2026 | fix: évaluer les badges immédiatement après chaque action |
| `b1c88f6` | Biteau Gaël | 13 avr 2026 | feat: Phase 2 — soirée match live, micro-pronos, badges, séries, saisons |
| `d461ee5` | Biteau Gaël | — | Merge branch 'claude/deploy-synology-nas-cLkOL' |
| `554b873` | Biteau Gaël | — | Add deployment guide for Synology NAS updates |
| `68e22d2` | Biteau Gaël | — | feat: menu burger mobile pour la navigation |
| `6aebaf7` | Biteau Gaël | — | Fix Better Auth trusted origins for custom domain support |
| `9823bc5` | Biteau Gaël | — | Add migrate service to docker-compose.prod.yml |
| `8d6e5e9` | Biteau Gaël | — | Add production Docker Compose and backup script |
| `aed5841` | Biteau Gaël | — | security: supprimer credentials du repo et renforcer .gitignore |
| `ab7fc5d` | Biteau Gaël | — | feat: intégration API Football + stats enrichies + classement Liga |

---

## Analyse de sécurité par ordre de criticité

---

### 🔴 CRITIQUE — Mots de passe par défaut en production

**Fichier** : `docker-compose.prod.yml`  
**Lignes concernées** : `POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-changeme}` et `redis-server --requirepass ${REDIS_PASSWORD:-changeme}`

Le fichier de composition Docker de production utilise `changeme` comme mot de passe de repli pour PostgreSQL et Redis si les variables d'environnement ne sont pas définies. Si le fichier `.env` est absent ou incomplet au déploiement, les services démarrent avec des credentials triviaux.

**Risque** : Accès non autorisé à la base de données et au cache si le NAS Synology est exposé sur le réseau ou Internet.

**Recommandation** :
- Supprimer les valeurs par défaut (`:-changeme`) pour forcer une erreur de démarrage explicite plutôt qu'un démarrage non sécurisé.
- Documenter l'obligation de définir ces variables dans `DEPLOY.md`.

```yaml
# Avant (risqué)
POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-changeme}

# Après (sécurisé — échoue proprement si non défini)
POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?POSTGRES_PASSWORD doit être défini}
```

---

### 🔴 CRITIQUE — Contournement du typage TypeScript pour la vérification de rôle

**Fichier** : `app/routes/feed.server.ts`  
**Lignes** : 99, 124, 184, 200

La vérification du rôle administrateur utilise le cast `(session.user as any).role === "admin"` au lieu du type de session correctement typé. Cette approche :

1. Contourne les garanties du compilateur TypeScript sur la propriété `role`.
2. Rend les refactoring futurs dangereux (renommage du champ non détecté).
3. Est incohérente avec le reste du code (`requireAuth(request, ["admin"])` dans d'autres routes).

**Risque** : Erreur silencieuse si le champ `role` change de nom ou de type ; pas d'erreur à la compilation.

**Recommandation** : Utiliser le helper `requireAuth` ou typer correctement la session.

```typescript
// Avant (dangereux)
isAdmin: (session.user as any).role === "admin",

// Après (sécurisé)
isAdmin: session.user.role === "admin",
// ou centraliser dans auth-utils.server.ts :
// export function isAdmin(session: Session) { return session.user.role === "admin"; }
```

---

### 🟠 IMPORTANT — Endpoint de santé public exposant l'état des services internes

**Fichier** : `app/routes/api.health.ts`

L'endpoint `/api/health` est accessible sans authentification et retourne l'état de PostgreSQL et Redis, ainsi qu'un timestamp ISO. Ces informations constituent de la reconnaissance (reconnaissance) pour un attaquant.

**Risque** : Un attaquant peut détecter les périodes de maintenance, les pannes et l'architecture interne.

**Recommandation** :
- Restreindre l'accès à un réseau interne (règle Docker/NAS).
- Ou ajouter un token d'accès partagé vérifié par en-tête (`Authorization: Bearer <HEALTH_TOKEN>`).
- À minima, ne pas exposer le détail des services en production (`status: "degraded"` suffit publiquement).

---

### 🟠 IMPORTANT — Absence d'en-têtes de sécurité HTTP

**Fichier** : `vite.config.ts`, `react-router.config.ts`

Aucun en-tête de sécurité HTTP n'est configuré :
- `Content-Security-Policy` (CSP) — protection XSS
- `X-Frame-Options` — protection clickjacking
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy`
- `Permissions-Policy`

**Risque** : Exposition aux attaques XSS (vol de session), clickjacking, et MIME sniffing.

**Recommandation** : Configurer les en-têtes dans le middleware ou via un reverse proxy (nginx/Caddy). Exemple dans React Router :

```typescript
// app/entry.server.tsx — ajouter sur chaque réponse
headers.set("X-Frame-Options", "DENY");
headers.set("X-Content-Type-Options", "nosniff");
headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
```

---

### 🟠 IMPORTANT — Absence de protection CSRF explicite

**Périmètre** : Toutes les routes `action`

Les actions de formulaire (création de post, pronostic, micro-pronostic, modification de rôle) ne montrent pas de protection CSRF explicite. Better Auth gère les sessions via cookies, ce qui les rend vulnérables aux requêtes cross-site si `SameSite` n'est pas correctement configuré.

**Risque** : Un site malveillant peut déclencher des actions au nom d'un utilisateur connecté.

**Recommandation** : Vérifier la configuration des cookies dans Better Auth (`sameSite: "lax"` au minimum, `"strict"` si possible) et envisager des tokens CSRF pour les actions sensibles (changement de rôle, suppression).

---

### 🟡 MODÉRÉ — Absence de validation Zod sur les routes de micro-pronostics

**Fichier** : `app/routes/api.micro-predictions.ts`

Les routes utilisent `formData.get("...") as string` sans validation de schéma. Contrairement aux routes `feed.server.ts` qui utilisent `createPostSchema.safeParse(...)`, les micro-pronos acceptent les données sans validation stricte de type ni de longueur.

**Risque** : Injection de données malformées, dépassement de longueur en base, ou comportement inattendu.

**Recommandation** : Ajouter des schémas Zod pour les paramètres `question`, `options`, `answer`, `pointsValue`.

```typescript
const createMicroSchema = z.object({
  matchId: z.string().cuid(),
  question: z.string().min(5).max(255),
  type: z.enum(["qcm", "boolean"]),
  pointsValue: z.number().int().min(1).max(10),
});
```

---

### 🟡 MODÉRÉ — Utilisation de `any` TypeScript pour les réponses d'API externe

**Fichier** : `app/routes/soiree.server.ts` (ligne 93)

La fonction `parseLineupEvents` utilise `(data: any)` pour l'objet retourné par l'API Football externe. Cela désactive toute vérification de type sur des données non fiables provenant d'un tiers.

**Risque** : Plantage silencieux ou injection de données inattendues en cas de changement de l'API.

**Recommandation** : Typer la réponse attendue avec une interface ou utiliser `zod.parse` pour valider les données de l'API externe.

---

### 🟢 CONFORME — Points positifs identifiés

Les pratiques suivantes sont **conformes aux bonnes pratiques de sécurité** :

| Élément | Statut |
|---------|--------|
| Credentials hors du dépôt (`.env` dans `.gitignore`) | ✅ Conforme |
| Commit `aed5841` : suppression des credentials du repo | ✅ Conforme |
| `requireAuth()` avec vérification de rôle sur toutes les routes admin | ✅ Conforme |
| Rate limiting via Redis (`rate-limit.server.ts`) | ✅ Conforme |
| Upload d'avatar : validation MIME type + taille max 2 Mo + redimensionnement | ✅ Conforme |
| Protection "admin ne peut pas modifier son propre rôle" | ✅ Conforme |
| Utilisation de Drizzle ORM (pas de SQL brut — protection injection SQL) | ✅ Conforme |
| Authentification via Better Auth avec session secondaire Redis | ✅ Conforme |
| `.env.example` sans vraies valeurs sensibles | ✅ Conforme |
| Gestion des erreurs centralisée (`errors.server.ts`) | ✅ Conforme |

---

## Plan d'action recommandé

| Priorité | Action | Fichier | Effort |
|----------|--------|---------|--------|
| 🔴 P1 | Supprimer les mots de passe par défaut `changeme` | `docker-compose.prod.yml` | 15 min |
| 🔴 P2 | Remplacer les casts `(session.user as any).role` | `feed.server.ts` | 30 min |
| 🟠 P3 | Protéger `/api/health` ou limiter son exposition | `api.health.ts` | 1h |
| 🟠 P4 | Ajouter les en-têtes de sécurité HTTP | `entry.server.tsx` / nginx | 1h |
| 🟠 P5 | Vérifier la configuration `SameSite` des cookies Better Auth | `auth.server.ts` | 30 min |
| 🟡 P6 | Ajouter validation Zod sur micro-pronostics | `api.micro-predictions.ts` | 1h |
| 🟡 P7 | Typer les réponses de l'API Football externe | `soiree.server.ts` | 1h |

---

*Rapport généré automatiquement — session Claude Code du 2026-10-04*
