# Rapport d'analyse de sécurité — Penya Blaugrana Nantes

**Date :** 2026-07-30  
**Branche analysée :** `main`  
**Dernier commit analysé :** `003faca` — fix: évaluer les badges immédiatement après chaque action

---

## Résumé des derniers commits

| Hash | Date | Description |
|------|------|-------------|
| `003faca` | 2026-04-13 | fix: évaluer les badges immédiatement après chaque action |
| `b1c88f6` | 2026-04-13 | feat: Phase 2 — soirée match live, micro-pronos, badges, séries, saisons |
| `d461ee5` | 2026-04-12 | Merge branch deploy Synology NAS |
| `68e22d2` | 2026-04-13 | feat: menu burger mobile pour la navigation |
| `6aebaf7` | 2026-04-12 | Fix Better Auth trusted origins for custom domain support |
| `9823bc5` | 2026-04-12 | Add migrate service to docker-compose.prod.yml |
| `8d6e5e9` | 2026-04-12 | Add production Docker Compose and backup script for Synology NAS |
| `aed5841` | 2026-04-12 | security: supprimer credentials du repo et renforcer .gitignore |
| `ab7fc5d` | 2026-04-12 | feat: intégration API Football + stats enrichies + classement Liga |
| `16c43e6` | 2026-04-11 | feat: MVP Phase 1 — Penya Blaugrana Nantes |

---

## Résultats de l'analyse de sécurité

### Critères évalués
- Gestion des secrets et variables d'environnement
- Authentification et autorisation
- Rate limiting
- Validation des entrées utilisateur
- Sécurité des uploads
- Configuration Docker/infrastructure
- Injection et traversée de chemins

---

## CRITIQUE — Traversée de chemin (Path Traversal)

**Fichier :** `app/routes/uploads-files.ts` — ligne 5  
**Risque :** Un attaquant peut lire n'importe quel fichier du serveur, y compris `.env`.

```ts
// Actuel — DANGEREUX
const filePath = path.join(process.cwd(), "uploads", params["*"]);
```

Le paramètre `params["*"]` n'est pas sanitisé. Une requête vers `/uploads/../.env` ou `/uploads/../../etc/passwd` contourne le répertoire `uploads/` et expose des fichiers arbitraires du système.

**Correction requise :** Valider que le chemin résolu reste dans `uploads/` :

```ts
const UPLOAD_DIR = path.resolve(process.cwd(), "uploads");
const filePath = path.resolve(UPLOAD_DIR, params["*"]);

// Vérifier que le chemin ne sort pas du répertoire uploads
if (!filePath.startsWith(UPLOAD_DIR + path.sep)) {
  return new Response("Forbidden", { status: 403 });
}
```

---

## HAUTE — Absence de rate limiting sur les routes API critiques

**Fichier :** `app/routes/api.micro-predictions.ts` (aucun rate limiting)  
**Fichier :** `app/routes/profile.server.ts` (upload avatar sans rate limiting)  
**Risque :** Flooding de la base de données, abus des micro-pronos, spam de réponses.

Seule la route `api.auth.$.ts` implémente du rate limiting (login : 10 req/15min, register : 5 req/1h). Les autres routes API critiques n'en ont aucun.

**Correction requise :** Ajouter `checkRateLimit` sur les mutations sensibles :

```ts
// Exemple pour api.micro-predictions.ts
await checkRateLimit({
  key: `micro-answer:${session.user.id}`,
  maxAttempts: 30,
  windowSeconds: 60,
});
```

---

## HAUTE — Mots de passe par défaut en production Docker

**Fichier :** `docker-compose.prod.yml` — lignes 18 et 24  
**Risque :** Si les variables d'environnement ne sont pas définies, les services démarrent avec le mot de passe `changeme`.

```yaml
# Actuel — DANGEREUX si .env absent
POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-changeme}
command: redis-server --requirepass ${REDIS_PASSWORD:-changeme}
```

**Correction requise :** Supprimer la valeur de repli (fallback) pour forcer la définition explicite en production :

```yaml
POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?POSTGRES_PASSWORD must be set}
command: redis-server --requirepass ${REDIS_PASSWORD:?REDIS_PASSWORD must be set}
```

---

## MOYENNE — Absence de validation de longueur sur les réponses aux micro-pronos

**Fichier :** `app/routes/api.micro-predictions.ts` — ligne ~90 (intent "answer")  
**Risque :** Un utilisateur peut envoyer une réponse de taille arbitraire (mégaoctets), saturant la base de données.

```ts
// Actuel — pas de limite sur la taille de la réponse
const answer = formData.get("answer") as string;
```

**Correction requise :**

```ts
const answer = formData.get("answer") as string;
if (!answer || answer.length > 200) {
  return Response.json({ error: "Réponse invalide" }, { status: 400 });
}
```

---

## MOYENNE — Cast `any` pour les vérifications de rôle

**Fichiers :** `app/routes/feed.server.ts` — lignes 81, 98, 107, 134  
**Risque :** L'utilisation de `(session.user as any).role` pour des vérifications de sécurité peut masquer des erreurs de typage et des régressions silencieuses si le modèle de session évolue.

```ts
// Actuel — anti-pattern pour du code de sécurité
const isAdmin = (session.user as any).role === "admin";
```

**Correction requise :** Définir un type strict pour le rôle et l'utiliser partout :

```ts
// Déjà défini dans auth-utils.server.ts — l'utiliser directement
import type { Role } from "~/lib/server/auth-utils.server";
const role = session.user.role as Role;
const isAdmin = role === "admin";
```

---

## FAIBLE — Absence d'en-têtes de sécurité HTTP

**Fichier :** Aucune configuration de headers trouvée (ni dans `vite.config.ts`, ni dans le Dockerfile)  
**Risque :** Sans CSP, X-Frame-Options, X-Content-Type-Options, le navigateur est moins protégé contre le clickjacking et les injections de contenu.

**Correction recommandée :** Ajouter des en-têtes de sécurité dans le middleware ou via un reverse proxy (Nginx) :

```
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Content-Security-Policy: default-src 'self'; img-src 'self' data:; script-src 'self'
```

---

## FAIBLE — Route uploads sans authentification

**Fichier :** `app/routes/uploads-files.ts`  
**Risque :** Les fichiers uploadés (avatars) sont accessibles sans authentification. Actuellement acceptable pour des avatars, mais la route est générique (`uploads/*`).

**Note :** Acceptable si les avatars sont destinés à être publics. À surveiller si d'autres types de fichiers sont ajoutés.

---

## Ce qui fonctionne bien

| Point positif | Détail |
|---|---|
| **Secrets hors du repo** | `.env` dans `.gitignore`, `.env.example` sans valeurs réelles, commit `aed5841` qui nettoyait les credentials |
| **Validation des entrées** | Zod sur tous les formulaires (inscription, connexion, posts, commentaires, pronostics) |
| **ORM paramétré** | Drizzle ORM utilisé partout — aucune concaténation SQL directe |
| **Auth centralisée** | `requireAuth()` et `getSession()` cohérents dans toutes les routes protégées |
| **Contrôle des rôles admin** | Routes admin vérifient `requireAuth(request, ["admin"])` |
| **Rate limiting auth** | Login (10/15min) et register (5/1h) protégés par IP |
| **Upload sécurisé** | Vérification MIME type, taille max 2 Mo, recodage WebP via Sharp |
| **Sessions Redis** | Sessions stockées côté serveur avec Better Auth + Redis |
| **Variables d'environnement validées** | `env.server.ts` utilise Zod avec `AUTH_SECRET min(16)` |

---

## Récapitulatif par priorité

| Priorité | Problème | Fichier | Action |
|---|---|---|---|
| 🔴 Critique | Path traversal uploads | `uploads-files.ts:5` | Corriger immédiatement |
| 🟠 Haute | Pas de rate limiting API micro-pronos | `api.micro-predictions.ts` | Ajouter avant mise en prod |
| 🟠 Haute | Mots de passe Docker fallback "changeme" | `docker-compose.prod.yml` | Corriger avant mise en prod |
| 🟡 Moyenne | Pas de limite taille réponse micro-prono | `api.micro-predictions.ts:90` | Corriger rapidement |
| 🟡 Moyenne | Cast `any` pour rôles | `feed.server.ts` | Refactorer |
| 🔵 Faible | Absence d'en-têtes HTTP sécurité | Config globale | Ajouter via Nginx |
| 🔵 Faible | Uploads sans auth | `uploads-files.ts` | Acceptable si avatars publics |
