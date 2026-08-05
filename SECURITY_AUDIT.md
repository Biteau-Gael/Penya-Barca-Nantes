# Rapport d'Audit Sécurité — Penya Blaugrana Nantes

**Date d'analyse :** 2026-08-05  
**Branche analysée :** `main` (dernier commit : `003faca`)  
**Portée :** Revue des 5 derniers commits + analyse de la posture de sécurité globale

---

## 1. Résumé des derniers commits

| Hash | Date | Type | Description |
|------|------|------|-------------|
| `003faca` | 13/04/2026 | fix | Évaluation des badges déclenchée immédiatement après chaque action utilisateur |
| `b1c88f6` | 13/04/2026 | feat | Phase 2 — Soirée match live, micro-pronostics, badges, séries, saisons (2 965 lignes) |
| `68e22d2` | 13/04/2026 | feat | Menu burger mobile pour la navigation |
| `554b873` | 12/04/2026 | docs | Guide de déploiement NAS Synology |
| `6aebaf7` | 12/04/2026 | fix | Correction des trusted origins Better Auth pour domaine personnalisé |

> **Note :** Des commits antérieurs (`aed5841`) avaient déjà procédé à un nettoyage de credentials et un renforcement du `.gitignore` — bonne pratique confirmée.

---

## 2. Analyse de Sécurité — Par ordre de criticité

---

### 🔴 CRITIQUE

#### C-01 — Path Traversal dans le service de fichiers uploadés

**Fichier :** `app/routes/uploads-files.ts:5`

```typescript
const filePath = path.join(process.cwd(), "uploads", params["*"]);
const file = await readFile(filePath);
```

**Problème :** Le paramètre wildcard `params["*"]` n'est pas sanitisé. Un attaquant peut forger une URL du type `/uploads-files/../../.env` ou `/uploads-files/../../app/config/env.server.ts` pour lire des fichiers arbitraires sur le serveur.

**Impact :** Lecture de fichiers sensibles (`.env`, code source, configurations), exposition des secrets (clés API, `AUTH_SECRET`, `DATABASE_URL`).

**Correction recommandée :**
```typescript
const UPLOAD_DIR = path.resolve(process.cwd(), "uploads");
const filePath = path.resolve(UPLOAD_DIR, params["*"]);

// Vérifier que le chemin résolu reste dans le répertoire uploads
if (!filePath.startsWith(UPLOAD_DIR + path.sep) && filePath !== UPLOAD_DIR) {
  return new Response("Accès refusé", { status: 403 });
}
```

---

### 🟠 HAUTE

#### H-01 — Absence de validation des entrées dans l'API micro-pronostics

**Fichier :** `app/routes/api.micro-predictions.ts`

**Problème :** Aucune validation Zod ou équivalente sur les champs entrants (`question`, `answer`, `matchId`, `type`, `options`). La chaîne `optionsRaw` (liste CSV) n'a aucune limite de longueur ou de contenu.

```typescript
const question = formData.get("question") as string;
const optionsRaw = formData.get("options") as string;
// Aucune validation avant insertion en DB
```

**Impact :** Données malformées ou trop longues en base de données, potentiel de déni de service par insertion massive, comportement imprévisible de l'application.

**Correction recommandée :** Ajouter un schéma Zod similaire aux autres routes :
```typescript
const createMicroSchema = z.object({
  matchId: z.string().min(1).max(50),
  question: z.string().min(1).max(500),
  type: z.enum(["qcm", "boolean", "number"]),
  options: z.string().max(1000).optional(),
  pointsValue: z.number().int().min(1).max(10),
  deadlineSeconds: z.number().int().min(30).max(3600),
});
```

#### H-02 — Rate limiting absent sur les actions utilisateur critiques

**Fichier :** `app/routes/api.auth.$.ts` (existant), routes manquantes

**Problème :** Le rate limiting n'est appliqué qu'aux routes `/sign-in` et `/sign-up`. Les actions suivantes ne sont pas protégées :
- Soumission de pronostic (`match-detail.server.ts`)
- Création de post et commentaire (`feed.server.ts`)
- Réponse aux micro-pronostics (`api.micro-predictions.ts`)
- Réactions sur le fil (`feed.server.ts`)

**Impact :** Abus, spam, tentatives de bourrage de scores, énumération d'IDs.

**Correction recommandée :** Appliquer `checkRateLimit` sur chaque action, en limitant par `userId` :
```typescript
await checkRateLimit({ key: `prediction:${session.user.id}`, maxAttempts: 20, windowSeconds: 3600 });
```

---

### 🟡 MOYENNE

#### M-01 — Mots de passe par défaut faibles en production Docker

**Fichier :** `docker-compose.prod.yml:20,26`

```yaml
POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-changeme}
command: redis-server --requirepass ${REDIS_PASSWORD:-changeme}
```

**Problème :** Si les variables d'environnement `POSTGRES_PASSWORD` et `REDIS_PASSWORD` ne sont pas définies au déploiement, les valeurs de fallback `changeme` s'appliquent silencieusement en production.

**Impact :** Base de données et cache Redis accessibles avec un mot de passe trivial sur le NAS.

**Correction recommandée :** Supprimer le fallback `:-changeme` pour forcer une erreur de démarrage explicite si le mot de passe n'est pas défini, ou utiliser Docker secrets.

#### M-02 — Absence d'en-têtes HTTP de sécurité

**Fichier :** Niveau application / reverse proxy

**Problème :** Aucun des en-têtes de sécurité standards n'est configuré :
- `Content-Security-Policy` (CSP)
- `X-Frame-Options` ou `frame-ancestors`
- `X-Content-Type-Options: nosniff`
- `Strict-Transport-Security` (HSTS)
- `Referrer-Policy`

**Impact :** Exposition à des attaques XSS, clickjacking, MIME-sniffing.

**Correction recommandée :** Configurer un middleware dans l'app React Router ou dans le reverse proxy Nginx/Synology :
```typescript
// vite.config.ts ou entry.server.tsx
headers: {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
}
```

#### M-03 — Risque de spoofing IP sur le rate limiting

**Fichier :** `app/routes/api.auth.$.ts:6-10`

```typescript
function getClientIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}
```

**Problème :** Si le reverse proxy (Nginx, Synology) n'est pas configuré pour rejeter les en-têtes `X-Forwarded-For` entrants des clients, un attaquant peut forger cet en-tête et contourner le rate limiting par IP.

**Impact :** Contournement du rate limiting sur les routes de connexion.

**Correction recommandée :** S'assurer que Nginx/reverse proxy écrase toujours `X-Forwarded-For` avec la vraie IP client, et que l'app n'accepte cet en-tête qu'en provenance de proxies de confiance.

---

### 🟢 FAIBLE / AMÉLIORATION

#### L-01 — Erreurs de badges silencieusement ignorées

**Fichiers :** `app/routes/feed.server.ts`, `app/routes/match-detail.server.ts`

```typescript
evaluateBadges(session.user.id).catch(() => {}); // erreur silencieuse
```

**Problème :** Le bloc `.catch(() => {})` supprime toute trace d'erreur. En cas de défaillance de la fonction `evaluateBadges`, aucun log ne sera émis, rendant le débogage impossible.

**Correction recommandée :**
```typescript
evaluateBadges(session.user.id).catch((err) => {
  logger.error({ err, userId: session.user.id }, "Erreur évaluation badges");
});
```

#### L-02 — Route de fichiers sans authentification

**Fichier :** `app/routes/uploads-files.ts`

**Problème :** La route `/uploads-files/*` est publique et ne vérifie aucune session. Si de nouvelles catégories d'uploads sont ajoutées (pièces jointes privées, documents), elles seraient exposées sans protection.

**Recommandation :** Prévoir une vérification d'authentification conditionnelle selon le chemin, ou limiter le répertoire `uploads/` aux seuls avatars publics par convention documentée.

#### L-03 — Utilisation de `any` dans le parsing de données externes API

**Fichier :** `app/routes/soiree.server.ts` (fonction `parseLineupEvents`)

```typescript
return res.value.json().then((data: any) => {
```

**Problème :** L'utilisation de `any` pour typer les réponses d'API externes désactive les vérifications TypeScript et peut introduire des erreurs runtime si la structure de la réponse change.

**Recommandation :** Définir une interface explicite ou utiliser Zod pour valider la structure des réponses API avant de les utiliser.

---

## 3. Points positifs confirmés

- **Credentials absents du dépôt** : `.gitignore` couvre `.env`, le commit `aed5841` a nettoyé des credentials précédemment exposés. ✅
- **Authentification centralisée** : `requireAuth` est utilisé de manière cohérente sur toutes les routes protégées. ✅
- **Validation des entrées utilisateur** : Zod est utilisé pour les formulaires principaux (post, commentaire, pronostic, profil). ✅
- **Contrôle de rôle admin** : Double vérification cohérente pour les actions admin dans `api.micro-predictions.ts` et `admin.members.server.ts`. ✅
- **Rate limiting sur l'authentification** : Limites en place sur `/sign-in` (10 req/15 min) et `/sign-up` (5 req/heure). ✅
- **Validation des uploads** : Type MIME et taille vérifiés avant traitement dans `upload.ts`. ✅
- **Sessions Redis** : Le stockage secondaire des sessions dans Redis est correctement configuré via Better Auth. ✅
- **Validation de l'environnement au démarrage** : `env.server.ts` utilise Zod pour valider toutes les variables d'environnement requises au boot. ✅

---

## 4. Plan d'action priorisé

| Priorité | Ref | Action | Effort |
|----------|-----|--------|--------|
| 🔴 Critique | C-01 | Ajouter la vérification du chemin de fichier dans `uploads-files.ts` | 15 min |
| 🟠 Haute | H-01 | Ajouter validation Zod dans `api.micro-predictions.ts` | 30 min |
| 🟠 Haute | H-02 | Appliquer rate limiting sur actions utilisateur | 1h |
| 🟡 Moyenne | M-01 | Supprimer les fallbacks `:-changeme` dans `docker-compose.prod.yml` | 5 min |
| 🟡 Moyenne | M-02 | Configurer les en-têtes de sécurité HTTP | 30 min |
| 🟡 Moyenne | M-03 | Vérifier config Nginx pour IP forwarding | 30 min |
| 🟢 Faible | L-01 | Ajouter log dans les catch de `evaluateBadges` | 5 min |
| 🟢 Faible | L-02 | Documenter convention uploads publics | 10 min |
| 🟢 Faible | L-03 | Typer les réponses API dans `soiree.server.ts` | 30 min |

---

*Rapport généré automatiquement — Analyse de code statique et revue manuelle des patterns de sécurité.*
