# Audit de sécurité & Résumé des derniers commits

**Date :** 30 juin 2026  
**Branche analysée :** `main` (via `claude/sharp-fermi-gwegcl`)  
**Portée :** Derniers commits de la Phase 2 + vérification des conventions de sécurité

---

## 1. Résumé des derniers commits

| Date | Commit | Auteur | Description |
|------|--------|--------|-------------|
| 13 avr. 2026 | `003faca` | Biteau Gaël | **fix :** évaluation des badges déclenchée immédiatement après chaque action (pronostic, post, commentaire, réaction) |
| 13 avr. 2026 | `b1c88f6` | Biteau Gaël | **feat :** Phase 2 complète — soirée match live, micro-pronostics, badges, séries, saisons (3 050 lignes, 29 fichiers) |
| 12 avr. 2026 | `554b873` | Claude | **docs :** guide de déploiement NAS Synology mis à jour |
| 12 avr. 2026 | `68e22d2` | Biteau Gaël | **feat :** menu burger mobile dans le header |
| 12 avr. 2026 | `6aebaf7` | Claude | **fix :** `trustedOrigins` BetterAuth étendu pour supporter le domaine custom |
| 12 avr. 2026 | `9823bc5` | Claude | **fix :** service `migrate` ajouté dans `docker-compose.prod.yml` |
| 11 avr. 2026 | `8d6e5e9` | Claude | **feat :** Docker Compose production + script de backup Synology |
| 11 avr. 2026 | `3d80133` | Claude | **docs :** roadmap Phase 2 avec 8 priorités documentées |
| 11 avr. 2026 | `aed5841` | Claude | **security :** suppression des credentials du dépôt, renforcement du `.gitignore` |
| 11 avr. 2026 | `6583da3` | Claude | **docs :** README complet avec guide de déploiement |

### Points notables du commit Phase 2 (`b1c88f6`)

- **Soirée match live** (`/soiree/:matchId`) : score en temps réel via polling API toutes les 60s, fil d'événements, pronos communauté révélés au coup d'envoi.
- **Micro-pronostics** : création admin, vote membre, attribution de points automatique à la clôture, suppression d'urgence admin.
- **Badges** (10 badges) : évaluation automatique après chaque action déclenchante, page `/badges` avec grille visuelle.
- **Séries** : `currentStreak`/`bestStreak` sur l'utilisateur, récompenses aux paliers 3/5/10 avec post automatique dans le fil.
- **Saisons** : table `seasons`, classement filtré par saison avec sélecteur, support des archives.
- **Migration DB** `0007` : 6 nouvelles tables, 3 nouvelles colonnes.

---

## 2. Analyse de sécurité — par ordre de criticité

---

### 🔴 CRITIQUE — Path Traversal (lecture de fichiers arbitraires)

**Fichier :** `app/routes/uploads-files.ts`  
**Lignes :** 6–7

```typescript
const filePath = path.join(process.cwd(), "uploads", params["*"]);
const file = await readFile(filePath);
```

**Problème :** `path.join()` ne neutralise pas les séquences `../`. Un attaquant authentifié (ou non, si la route est publique) peut requêter :

```
GET /uploads/avatars/../../../../.env
GET /uploads/../../etc/passwd
```

Ce qui expose tous les fichiers lisibles par le processus Node.js : `.env`, clés SSH, secrets Docker, etc.

**Exploitation :** La clé `AUTH_SECRET`, `DATABASE_URL`, `API_FOOTBALL_KEY` sont directement lisibles via cette vulnérabilité.

**Correction à appliquer :**

```typescript
export async function loader({ params }: { params: { "*": string } }) {
  const uploadsDir = path.resolve(process.cwd(), "uploads");
  const filePath = path.resolve(uploadsDir, params["*"]);

  // Neutralise tout path traversal
  if (!filePath.startsWith(uploadsDir + path.sep)) {
    return new Response("Forbidden", { status: 403 });
  }

  try {
    const file = await readFile(filePath);
    // ... suite inchangée
```

---

### 🟠 ÉLEVÉ — Absence de rate limiting sur l'endpoint micro-pronostics

**Fichier :** `app/routes/api.micro-predictions.ts`  
**Ligne :** 8 (début du `action`)

**Problème :** Le module `checkRateLimit` existe dans `app/lib/server/rate-limit.server.ts` mais n'est pas importé ni appliqué ici. Un utilisateur authentifié peut :
- Bombarder l'endpoint `answer` en boucle (chaque requête déclenche 2 requêtes DB — lecture micro + lecture réponse existante).
- Tenter de contourner la logique de déduplication en exploitant des conditions de concurrence (race condition) entre la vérification `existing` et l'`insert`.

**Correction :**

```typescript
import { checkRateLimit } from "~/lib/server/rate-limit.server";

export async function action({ request }) {
  const session = await requireAuth(request);
  if (!session?.user) { ... }

  await checkRateLimit({
    key: `micro-pred:${session.user.id}`,
    maxAttempts: 30,
    windowSeconds: 60,
  });
  // ...
}
```

---

### 🟠 ÉLEVÉ — Absence de rate limiting sur le fil d'actualité

**Fichier :** `app/routes/feed.server.ts`  
**Ligne :** 75 (début du `feedAction`)

**Problème :** Identique au précédent. Un membre peut publier massivement des posts/commentaires, inonder le fil et surcharger la base de données sans aucun frein applicatif. La vérification de doublon sur les réactions ne protège pas les créations de contenu.

**Correction :** Appliquer `checkRateLimit` par `userId` et par `intent` au début de `feedAction`.

---

### 🟡 MOYEN — Aucune validation de longueur sur le champ `answer` des micro-pronostics

**Fichier :** `app/routes/api.micro-predictions.ts`  
**Ligne :** 95–99

```typescript
const answer = formData.get("answer") as string;
// Aucune vérification de longueur
await db.insert(microPredictionAnswers).values({ ..., answer });
```

**Problème :** Un utilisateur malveillant peut soumettre une réponse de plusieurs mégaoctets. Contrairement aux posts (limités à 2 000 chars via Zod) et aux commentaires (500 chars), le champ `answer` n'est pas contraint. Cela peut entraîner un déni de service par saturation de la base de données.

**Correction :**

```typescript
if (!answer || answer.length > 500) {
  return Response.json({ error: "Réponse invalide" }, { status: 400 });
}
```

---

### 🟡 MOYEN — Mots de passe par défaut "changeme" dans la configuration Docker de production

**Fichier :** `docker-compose.prod.yml`  
**Lignes :** 19, 26

```yaml
POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-changeme}
command: redis-server --requirepass ${REDIS_PASSWORD:-changeme}
```

**Problème :** Si les variables d'environnement `POSTGRES_PASSWORD` et `REDIS_PASSWORD` ne sont pas définies dans `.env` au moment du déploiement, les deux services démarrent avec le mot de passe `changeme`, trivial à deviner.

**Correction :** Forcer l'échec au démarrage si la variable manque :

```yaml
POSTGRES_PASSWORD=${POSTGRES_PASSWORD:?La variable POSTGRES_PASSWORD doit être définie}
```

```yaml
command: redis-server --requirepass ${REDIS_PASSWORD:?La variable REDIS_PASSWORD doit être définie}
```

---

### 🟡 MOYEN — Absence d'en-têtes de sécurité HTTP

**Fichier :** `app/root.tsx` (aucun header de sécurité défini)

**Problème :** Aucun en-tête de sécurité HTTP n'est configuré :

| En-tête | Risque en l'absence |
|---------|---------------------|
| `Content-Security-Policy` | XSS via injection de scripts tiers |
| `X-Frame-Options` | Clickjacking |
| `X-Content-Type-Options` | MIME sniffing |
| `Referrer-Policy` | Fuite de l'URL de référence |
| `Permissions-Policy` | Accès à la caméra/micro/géoloc non restreint |

L'application charge des ressources Google Fonts depuis un CDN externe, ce qui renforce la nécessité d'une CSP claire.

**Correction :** Ajouter un loader ou un middleware dans React Router qui retourne ces en-têtes sur toutes les réponses :

```typescript
// app/entry.server.tsx ou via un middleware React Router v7
headers["Content-Security-Policy"] = "default-src 'self'; font-src 'self' https://fonts.gstatic.com; style-src 'self' https://fonts.googleapis.com 'unsafe-inline'";
headers["X-Frame-Options"] = "DENY";
headers["X-Content-Type-Options"] = "nosniff";
headers["Referrer-Policy"] = "strict-origin-when-cross-origin";
```

---

### 🔵 FAIBLE — Casts `as any` pour les vérifications de rôle

**Fichier :** `app/routes/feed.server.ts`  
**Lignes :** 107, 148, 154, 165

```typescript
const isAdmin = (session.user as any).role === "admin";
```

**Problème :** L'usage de `as any` contourne la vérification de type TypeScript. Si le typage de la session évolue ou si un refactoring introduit une faute de frappe, TypeScript ne signale rien. Ce n'est pas un risque d'exécution direct (la comparaison de chaîne reste fonctionnelle), mais cela fragilise la base de code.

**Correction :** Utiliser `requireAuth` avec le paramètre `allowedRoles` qui est déjà typé, ou déclarer une interface étendue pour la session.

---

### 🔵 FAIBLE — `APP_URL` optionnel peut vider `trustedOrigins` en production

**Fichier :** `app/lib/server/auth.server.ts`  
**Ligne :** 12

```typescript
trustedOrigins: env.APP_URL ? [env.APP_URL] : [],
```

**Problème :** Si `APP_URL` n'est pas défini dans `.env`, `trustedOrigins` devient `[]`. Le comportement de BetterAuth avec une liste vide (bloquer tout ou accepter tout) n'est pas documenté explicitement et peut varier selon les versions.

**Correction :** Rendre `APP_URL` obligatoire en production dans `env.server.ts` :

```typescript
APP_URL: z.string().url().optional(), // ou required en prod via une validation conditionnelle
```

Et logger un avertissement au démarrage si la variable manque.

---

## 3. Récapitulatif

| Criticité | Nb | Fichiers concernés |
|-----------|----|--------------------|
| 🔴 Critique | 1 | `uploads-files.ts` |
| 🟠 Élevé | 2 | `api.micro-predictions.ts`, `feed.server.ts` |
| 🟡 Moyen | 3 | `api.micro-predictions.ts`, `docker-compose.prod.yml`, `root.tsx` |
| 🔵 Faible | 2 | `feed.server.ts`, `auth.server.ts` |

### Priorité d'action recommandée

1. **Immédiat** — Corriger le path traversal dans `uploads-files.ts` (exploitation sans compétence particulière).
2. **Avant la prochaine mise en production** — Ajouter le rate limiting sur les endpoints d'action.
3. **Sprint suivant** — Valider `answer`, forcer les mots de passe Docker, ajouter les en-têtes HTTP.
4. **Refactoring progressif** — Typage strict des rôles, `APP_URL` obligatoire.

---

### Points positifs constatés

- Validation des entrées avec Zod sur l'inscription, les posts, les commentaires et les matchs.
- ORM Drizzle utilisé systématiquement → pas d'injection SQL raw.
- `requireAuth` appliqué de façon cohérente sur toutes les routes protégées.
- Séparation admin/membre vérifiée côté serveur (pas seulement côté client).
- `.env` exclu du dépôt, `.env.example` sans credentials réels.
- Clé API Football en variable d'environnement optionnelle, jamais codée en dur.
- Upload d'avatar : type MIME vérifié, taille limitée à 2 Mo, conversion WebP systématique via Sharp.
- Redis utilisé pour la gestion des sessions (pas de stockage en mémoire).
- Logs structurés avec Pino, niveau configurable par environnement.
