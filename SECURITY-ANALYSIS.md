# Analyse de sécurité — Penya Blaugrana Nantes

**Date d'analyse :** 2026-06-10  
**Périmètre :** commits `003faca` (fix badges), `b1c88f6` (Phase 2), et code existant  
**Branche :** `claude/sharp-fermi-nx0irs`

---

## Résumé des derniers commits

| Hash | Date | Description |
|------|------|-------------|
| `003faca` | 2026-04-13 | fix: évaluer les badges immédiatement après chaque action (pronos, posts, commentaires, réactions) |
| `b1c88f6` | 2026-04-13 | feat: Phase 2 — soirée match live, micro-pronos, badges, séries, saisons (2 965 lignes ajoutées) |
| `d461ee5` | 2026-04-12 | Merge branche déploiement Synology NAS |
| `554b873` | 2026-04-12 | Guide de mise à jour du déploiement NAS |
| `68e22d2` | 2026-04-13 | feat: menu burger mobile pour la navigation |
| `6aebaf7` | 2026-04-12 | Fix Better Auth trusted origins pour domaine personnalisé |
| `9823bc5` | 2026-04-12 | Ajout service migrate dans docker-compose.prod.yml |

---

## Remarques de sécurité par ordre de criticité

---

### 🔴 CRITIQUE — Path Traversal dans le service de fichiers uploadés

**Fichier :** `app/routes/uploads-files.ts:5`

```ts
const filePath = path.join(process.cwd(), "uploads", params["*"]);
```

**Problème :** Le paramètre de route `params["*"]` est utilisé directement dans `path.join()` sans aucune validation ni sanitisation. Un attaquant peut envoyer une requête avec des séquences `../` pour remonter dans l'arborescence et accéder à des fichiers sensibles hors du répertoire `uploads/`.

**Exemple d'attaque :**
```
GET /uploads-files/../../.env
→ lit le fichier .env contenant DATABASE_URL, AUTH_SECRET, API_FOOTBALL_KEY
```

**Correction recommandée :**

```ts
export async function loader({ params }: { params: { "*": string } }) {
  const requested = params["*"];
  const uploadsDir = path.join(process.cwd(), "uploads");
  const filePath = path.resolve(uploadsDir, requested);

  // Bloquer toute sortie du répertoire uploads/
  if (!filePath.startsWith(uploadsDir + path.sep)) {
    return new Response("Forbidden", { status: 403 });
  }
  // ... reste inchangé
}
```

---

### 🔴 HAUTE — Mots de passe par défaut en production

**Fichier :** `docker-compose.prod.yml:20,24,28`

```yaml
POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-changeme}
redis-server --requirepass ${REDIS_PASSWORD:-changeme}
redis-cli -a "${REDIS_PASSWORD:-changeme}" ping
```

**Problème :** Si les variables d'environnement `POSTGRES_PASSWORD` et `REDIS_PASSWORD` ne sont pas définies dans le fichier `.env` de production, les mots de passe par défaut `changeme` sont utilisés. Un attaquant ayant accès au réseau Docker (ou NAS) peut compromettre la base de données et le cache Redis.

**Correction recommandée :** Retirer les valeurs par défaut pour forcer une configuration explicite :

```yaml
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
redis-server --requirepass ${REDIS_PASSWORD}
```

Et valider au démarrage de l'application que ces variables sont bien définies dans `env.server.ts`.

---

### 🟠 MOYENNE — Absence de headers HTTP de sécurité

**Périmètre :** toute l'application

**Problème :** Aucun middleware ne positionne les headers de sécurité suivants :
- `Content-Security-Policy` — protection XSS
- `X-Frame-Options: DENY` — protection clickjacking
- `X-Content-Type-Options: nosniff` — protection MIME sniffing
- `Strict-Transport-Security` — forcer HTTPS
- `Referrer-Policy: strict-origin-when-cross-origin`

**Correction recommandée :** Ajouter un middleware dans `app/root.tsx` ou via un `entry.server.ts` :

```ts
// Dans le loader de root ou via un header plugin Vite
headers.set("X-Frame-Options", "DENY");
headers.set("X-Content-Type-Options", "nosniff");
headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
```

---

### 🟠 MOYENNE — Validation MIME basée uniquement sur `file.type` (spoofable)

**Fichier :** `app/lib/server/upload.ts:13`

```ts
if (!ALLOWED_TYPES.includes(file.type)) {
  throw new Error("Format non supporté...");
}
```

**Problème :** `file.type` est fourni par le client HTTP et peut être falsifié. Un attaquant peut envoyer un fichier arbitraire (ex. SVG avec JavaScript embarqué) en déclarant `Content-Type: image/jpeg`.

**Atténuation existante :** `sharp` retraite le binaire en WebP, ce qui neutralise la plupart des vecteurs d'attaque sur le contenu. Le risque résiduel est faible mais réel (ex. DoS via image "bombe").

**Correction recommandée :** Compléter par une vérification magic bytes via un outil comme `file-type` :

```ts
import { fileTypeFromBuffer } from "file-type";
const type = await fileTypeFromBuffer(buffer);
if (!type || !["image/jpeg", "image/png", "image/webp"].includes(type.mime)) {
  throw new Error("Contenu du fichier invalide.");
}
```

---

### 🟠 MOYENNE — Contournement de contrôle de rôle via `as any`

**Fichier :** `app/routes/feed.server.ts:99,124,184,200`

```ts
isAdmin: (session.user as any).role === "admin",
if (isAnnouncement && (session.user as any).role !== "admin") {
const isAdmin = (session.user as any).role === "admin";
```

**Problème :** L'utilisation de `as any` contourne le typage TypeScript. Si le type de `session.user` change (mise à jour de `better-auth`, refactoring), ces contrôles de rôle peuvent silencieusement retourner `false` sans erreur de compilation, laissant des fonctionnalités admin accessibles à tous.

**Correction recommandée :** Utiliser le type `Role` déjà défini dans `auth-utils.server.ts` et l'accès typé :

```ts
import type { Role } from "~/lib/server/auth-utils.server";
const role = session.user.role as Role;
const isAdmin = role === "admin";
```

---

### 🟡 FAIBLE — Absence de rate limiting sur les endpoints de mutation

**Périmètre :** `feed.server.ts`, `api.micro-predictions.ts`, `profile.server.ts`

**Problème :** Le rate limiting n'est appliqué qu'aux routes d'authentification (`/api/auth/sign-in`, `/api/auth/sign-up`). Les endpoints suivants sont sans limite :
- Création de posts / commentaires / réactions (feed)
- Soumission de micro-pronostics
- Upload d'avatar

**Impact :** Un utilisateur authentifié peut spammer le fil communautaire ou effectuer des uploads massifs.

**Correction recommandée :** Appliquer `checkRateLimit` sur les actions mutatives sensibles, ex. :

```ts
await checkRateLimit({ key: `post:${session.user.id}`, maxAttempts: 10, windowSeconds: 60 });
```

---

### 🟡 FAIBLE — Réponse libre aux micro-pronostics QCM sans validation des options

**Fichier :** `app/routes/api.micro-predictions.ts:88-107`

```ts
if (intent === "answer") {
  const answer = formData.get("answer") as string;
  // Pas de vérification que `answer` appartient aux options du QCM
  await db.insert(microPredictionAnswers).values({ ... answer ... });
}
```

**Problème :** Pour les micro-pronostics de type `qcm`, la réponse soumise n'est pas validée contre la liste des options autorisées. Un utilisateur peut soumettre une réponse arbitraire. Lors de la clôture, la comparaison `toLowerCase().trim()` peut réussir sur une réponse "truquée" si l'admin ferme avec la même valeur.

**Correction recommandée :**

```ts
if (micro.type === "qcm" && micro.options) {
  const options = JSON.parse(micro.options) as string[];
  if (!options.map(o => o.toLowerCase()).includes(answer.toLowerCase())) {
    return Response.json({ error: "Réponse invalide" }, { status: 400 });
  }
}
```

---

### 🟡 FAIBLE — Dockerfile s'exécute en tant que root

**Fichier :** `Dockerfile`

**Problème :** Aucune directive `USER` n'est présente. Le processus Node.js s'exécute en tant que `root` dans le conteneur, ce qui aggrave l'impact d'une éventuelle RCE.

**Correction recommandée :** Ajouter avant `CMD` :

```dockerfile
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser
```

---

## Tableau récapitulatif

| # | Sévérité | Fichier | Description |
|---|----------|---------|-------------|
| 1 | 🔴 Critique | `uploads-files.ts:5` | Path traversal — lecture arbitraire de fichiers |
| 2 | 🔴 Haute | `docker-compose.prod.yml:20,24` | Mots de passe par défaut `changeme` en prod |
| 3 | 🟠 Moyenne | Global | Absence de headers HTTP sécurité (CSP, X-Frame, HSTS) |
| 4 | 🟠 Moyenne | `upload.ts:13` | Validation MIME spoofable côté client |
| 5 | 🟠 Moyenne | `feed.server.ts:99,124,184,200` | Contrôle de rôle admin via `as any` fragile |
| 6 | 🟡 Faible | `feed.server.ts`, `api.micro-predictions.ts` | Pas de rate limiting sur les mutations |
| 7 | 🟡 Faible | `api.micro-predictions.ts:88` | Réponse QCM non validée contre les options |
| 8 | 🟡 Faible | `Dockerfile` | Processus Node en root dans le conteneur |

---

## Points positifs constatés

- **Authentification** : `requireAuth` systématiquement appliqué sur toutes les routes protégées
- **Validation des entrées** : utilisation de Zod sur tous les formulaires (pronos, pseudo, posts, commentaires)
- **ORM paramétré** : Drizzle ORM utilisé partout — pas de SQL brut injectable
- **Rate limiting auth** : login/register correctement protégés (10 req/15min login, 5 req/h register)
- **Secrets externalisés** : aucun secret hardcodé dans le code source, `.env` correctement ignoré par git
- **Upload sécurisé** : sharp retraite les images en WebP 256×256, éliminant la plupart des payloads malveillants
- **Contrôle d'autorisation** : vérification propriétaire + admin sur delete post/comment/micro-prediction

---

*Document généré lors de l'analyse de sécurité du sprint Phase 2.*
