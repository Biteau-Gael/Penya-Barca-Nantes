# Audit de Sécurité — Penya Blaugrana Nantes
**Date :** 06/05/2026  
**Branche analysée :** `claude/sharp-fermi-4yQUU`  
**Portée :** Commits du 12/04/2026 au 13/04/2026 (Phase 2 + déploiement NAS)

---

## Résumé des derniers commits

| Hash | Date | Description |
|------|------|-------------|
| `003faca` | 13/04/2026 | fix: évaluer les badges immédiatement après chaque action |
| `b1c88f6` | 13/04/2026 | feat: Phase 2 — soirée match live, micro-pronos, badges, séries, saisons |
| `68e22d2` | 13/04/2026 | feat: menu burger mobile pour la navigation |
| `4a65a7b` | 13/04/2026 | Merge PR #2 — deploy Synology NAS |
| `d461ee5` | 12/04/2026 | Merge branch deploy-synology-nas |
| `554b873` | 12/04/2026 | Add deployment guide for Synology NAS updates |
| `6aebaf7` | 12/04/2026 | Fix Better Auth trusted origins for custom domain support |
| `9823bc5` | 12/04/2026 | Add migrate service to docker-compose.prod.yml |
| `8d6e5e9` | 12/04/2026 | Add production Docker Compose and backup script |

**Périmètre fonctionnel Phase 2 :** soirée match en direct, micro-pronostics (création / réponse / clôture / suppression), système de badges (10 types), séries de scores exacts, gestion des saisons, classement enrichi.

---

## Résultats de l'audit par ordre de criticité

---

### 🔴 CRITIQUE — Path Traversal dans le service de fichiers uploadés

**Fichier :** `app/routes/uploads-files.ts`

**Description :**  
Le loader qui sert les avatars construit le chemin fichier directement à partir du paramètre wildcard de l'URL sans aucune validation :

```typescript
const filePath = path.join(process.cwd(), "uploads", params["*"]);
```

`path.join()` normalise les séquences `../` ce qui permet à un attaquant de lire n'importe quel fichier accessible par le processus Node :

```
GET /uploads/../../etc/passwd
→ path.join('/app', 'uploads', '../../etc/passwd') = '/etc/passwd'
```

**Impact :** Lecture arbitraire de fichiers système (credentials, config, clés SSH, variables d'environnement).

**Correction recommandée :**

```typescript
const UPLOAD_DIR = path.resolve(process.cwd(), "uploads");

export async function loader({ params }: { params: { "*": string } }) {
  const requestedPath = path.resolve(UPLOAD_DIR, params["*"]);

  // Vérifier que le chemin résolu reste dans le dossier uploads
  if (!requestedPath.startsWith(UPLOAD_DIR + path.sep)) {
    return new Response("Forbidden", { status: 403 });
  }
  // ... suite du loader
}
```

---

### 🟠 ÉLEVÉ — Exposition de la réponse correcte aux micro-pronostics

**Fichier :** `app/routes/soiree.server.ts` (ligne 254)

**Description :**  
Le loader de la page soirée renvoie le champ `correctAnswer` pour **tous** les micro-pronostics, y compris ceux dont le statut est ouvert (`closedAt: null`) :

```typescript
correctAnswer: m.correctAnswer,
```

Bien qu'en pratique ce champ soit `null` tant que l'admin n'a pas clôturé la question, cette donnée est incluse dans la réponse JSON envoyée au client. Dès qu'un admin saisit la bonne réponse (intent `close`), celle-ci devient visible dans la réponse réseau pour tous les utilisateurs connectés, avant même que l'interface l'affiche.

**Impact :** Un utilisateur averti peut lire la réponse correcte via les DevTools et répondre en conséquence si la clôture intervient pendant la fenêtre de réponse.

**Correction recommandée :**  
Ne renvoyer `correctAnswer` que lorsque le micro-pronostic est clôturé :

```typescript
correctAnswer: m.closedAt ? m.correctAnswer : null,
```

---

### 🟡 MOYEN — Absence de rate limiting sur les actions sensibles

**Fichiers concernés :**
- `app/routes/api.micro-predictions.ts` (réponses aux micro-pronos)
- `app/routes/feed.server.ts` (posts, commentaires, réactions)
- `app/routes/match-detail.server.ts` (soumission de pronostics)

**Description :**  
Le rate limiting (`checkRateLimit` via Redis) est uniquement appliqué sur le endpoint d'authentification (`app/routes/api.auth.$.ts`). Toutes les autres actions authentifiées n'ont aucune limitation de fréquence.

**Impact :** Un utilisateur malveillant pourrait :
- Spammer le fil d'actualité avec des posts/commentaires en masse
- Déclencher des milliers d'évaluations de badges (appels DB intensifs)
- Saturer la table `microPredictionAnswers`

**Correction recommandée :**  
Appliquer `checkRateLimit` par `userId` sur les actions de création :

```typescript
await checkRateLimit({
  key: `feed-post:${session.user.id}`,
  maxAttempts: 10,
  windowSeconds: 60,
});
```

---

### 🟡 MOYEN — Absence de validation de longueur sur les réponses aux micro-pronostics

**Fichier :** `app/routes/api.micro-predictions.ts` (intent `answer`)

**Description :**  
Le champ `answer` soumis par l'utilisateur est inséré en base sans validation de longueur :

```typescript
const answer = formData.get("answer") as string;
// Aucune validation avant l'insert
await db.insert(microPredictionAnswers).values({ ..., answer });
```

**Impact :** Insertion de chaînes arbitrairement longues en base de données (charge DB, potentiel DoS doux).

**Correction recommandée :**

```typescript
import { z } from "zod";
const answerSchema = z.string().min(1).max(200);
const parsed = answerSchema.safeParse(answer);
if (!parsed.success) {
  return Response.json({ error: "Réponse invalide" }, { status: 400 });
}
```

---

### 🟡 MOYEN — Contournement possible du typage du rôle utilisateur

**Fichier :** `app/routes/feed.server.ts` (lignes 87, 110, 128)

**Description :**  
Le rôle utilisateur est accédé via un cast `any` qui court-circuite la vérification TypeScript :

```typescript
const isAdmin = (session.user as any).role === "admin";
```

Ce pattern masque une divergence entre le type `Session` de Better Auth et les champs additionnels déclarés. Si la définition du type évolue, TypeScript ne signalera aucune erreur.

**Impact :** Risque de régression silencieuse sur les vérifications d'autorisation.

**Correction recommandée :**  
Étendre le type `Session` ou utiliser `requireAuth(request, ["admin"])` qui effectue déjà la vérification côté serveur de manière typée.

---

### 🔵 FAIBLE — Mots de passe Docker par défaut en production

**Fichier :** `docker-compose.prod.yml`

**Description :**  
Les mots de passe PostgreSQL et Redis ont des valeurs par défaut `changeme` si les variables d'environnement ne sont pas définies :

```yaml
POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-changeme}
redis-server --requirepass ${REDIS_PASSWORD:-changeme}
```

**Impact :** Si `.env` est absent ou incomplet lors du déploiement, les services démarrent avec des credentials triviaux.

**Correction recommandée :**  
Supprimer les valeurs par défaut pour forcer une erreur explicite plutôt qu'un démarrage non sécurisé :

```yaml
POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?POSTGRES_PASSWORD doit être défini}
```

---

### 🔵 FAIBLE — Client Redis et DB contournent la validation d'environnement

**Fichiers :**
- `app/lib/server/redis.server.ts`
- `app/db/client.ts`

**Description :**  
Ces deux fichiers lisent les variables d'environnement directement via `process.env` au lieu de passer par `getEnv()` qui valide le schéma Zod :

```typescript
// redis.server.ts
new Redis(process.env.REDIS_URL || "redis://localhost:6379")

// db/client.ts
connectionString: process.env.DATABASE_URL
```

**Impact :** `DATABASE_URL` manquant ne provoque pas d'erreur au démarrage mais lors du premier accès DB (fail tardif difficile à diagnostiquer).

**Correction recommandée :**

```typescript
import { getEnv } from "~/config/env.server";
const env = getEnv();
new Redis(env.REDIS_URL);
```

---

### 🔵 FAIBLE — Typage `any` dans la récupération des événements match

**Fichier :** `app/routes/soiree.server.ts` (fonction `fetchMatchEvents`)

**Description :**  
La réponse de l'API externe est typée `any`, permettant l'accès à des propriétés non vérifiées :

```typescript
.then((data: any) => {
  if (data.status !== "success" || !data.response?.lineup) return;
  for (const e of perf.events || []) { ... }
```

**Impact :** Si le format de l'API change, les erreurs seront silencieuses (runtime) plutôt que détectées à la compilation.

**Correction recommandée :** Définir une interface pour la réponse API ou utiliser `z.parse()` avec un schéma Zod.

---

## Synthèse

| Criticité | Nombre | Fichiers principaux |
|-----------|--------|---------------------|
| 🔴 Critique | 1 | `uploads-files.ts` |
| 🟠 Élevé | 1 | `soiree.server.ts` |
| 🟡 Moyen | 3 | `api.micro-predictions.ts`, `feed.server.ts` |
| 🔵 Faible | 3 | `docker-compose.prod.yml`, `redis.server.ts`, `db/client.ts` |

## Points positifs constatés

- Authentification centralisée via `requireAuth` appliquée systématiquement sur toutes les routes admin et utilisateur.
- Validation des entrées avec Zod sur les formulaires critiques (inscription, pronostics, matches).
- Rate limiting actif sur l'authentification (protection brute force).
- `.env` correctement listé dans `.gitignore` ; aucune credential détectée dans l'historique git.
- Hash de session stocké dans Redis avec TTL (better-auth + secondaryStorage).
- Les uploads d'avatars sont traités via Sharp (resize + conversion WebP) avant écriture, ce qui neutralise les images malformées.
- Journalisation structurée (pino) sur toutes les actions sensibles.
- Protection admin auto-suppression / auto-modification de rôle dans `admin.members.server.ts`.
