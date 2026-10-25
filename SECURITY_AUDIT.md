# Rapport d'audit de sécurité — Penya Barca Nantes

**Date :** 25 octobre 2026  
**Périmètre :** Analyse des derniers commits (Phase 2 — soirée match, micro-pronos, badges, séries, saisons)  
**Branche analysée :** `main` — commits `b1c88f6` et `003faca`

---

## Résumé des derniers commits

| Commit | Auteur | Description |
|--------|--------|-------------|
| `003faca` | Biteau Gaël | fix: évaluer les badges immédiatement après chaque action (feed, match-detail) |
| `b1c88f6` | Biteau Gaël | feat: Phase 2 — soirée match live, micro-pronos, badges, séries, saisons |
| `d461ee5` | Claude | Merge branch deploy Synology NAS |
| `554b873` | Claude | Add deployment guide for Synology NAS updates |
| `68e22d2` | Biteau Gaël | feat: menu burger mobile pour la navigation |
| `6aebaf7` | Claude | Fix Better Auth trusted origins for custom domain support |
| `9823bc5` | Claude | Add migrate service to docker-compose.prod.yml |

---

## Résultats de l'analyse de sécurité

### 🔴 CRITIQUE — Path Traversal sur le serveur de fichiers

**Fichier :** `app/routes/uploads-files.ts`  
**Ligne :** 5

**Description :**  
Le paramètre `params["*"]` issu de l'URL est utilisé directement dans `path.join()` sans validation ni assainissement. Un attaquant peut accéder à des fichiers en dehors du répertoire `uploads/` en utilisant des séquences `../`.

**Preuve :**
```
GET /uploads/../.env
→ path.join(cwd, "uploads", "../.env")
→ /home/user/Penya-Barca-Nantes/.env  ← EXPOSÉ
```

**Impact :** Exposition du fichier `.env` en production (clé API Football, secret d'authentification, URL de base de données).

**Correctif recommandé :**
```typescript
const resolved = path.resolve(process.cwd(), "uploads", params["*"]);
const uploadRoot = path.resolve(process.cwd(), "uploads");
if (!resolved.startsWith(uploadRoot + path.sep)) {
  return new Response("Forbidden", { status: 403 });
}
```

---

### 🟠 MOYEN — Rate limiting absent sur les routes API métier

**Fichiers :** `app/routes/api.micro-predictions.ts`, `app/routes/feed.server.ts`

**Description :**  
Le rate limiting est implémenté uniquement sur les routes d'authentification (`/api/auth/*`). Les routes suivantes n'en disposent pas :
- `POST /api/micro-predictions` (vote joueur, création/suppression admin)
- Actions feed : publication de posts, commentaires, réactions

**Impact :** Spam automatisé (flood de posts/commentaires), tentatives de contournement du système de points, déni de service applicatif.

**Correctif recommandé :** Appliquer `checkRateLimit` sur chaque `action()` (ex : 30 réactions/minute/utilisateur, 10 commentaires/minute/utilisateur).

---

### 🟠 MOYEN — Accès direct à `process.env` (bypass validation Zod)

**Fichiers :**
- `app/db/client.ts` — ligne 6 : `process.env.DATABASE_URL` sans validation
- `app/lib/server/redis.server.ts` — ligne 3 : `process.env.REDIS_URL` sans validation

**Description :**  
Ces fichiers accèdent directement à `process.env` au lieu de passer par `getEnv()` qui valide via Zod. Si `DATABASE_URL` n'est pas défini, `pg.Pool` reçoit `connectionString: undefined` et peut se connecter à une base par défaut ou échouer silencieusement.

**Impact :** Mauvaise configuration possible en production, difficulté à détecter les variables manquantes au démarrage.

**Correctif recommandé :**
```typescript
// app/db/client.ts
import { getEnv } from "~/config/env.server";
const pool = new pg.Pool({ connectionString: getEnv().DATABASE_URL });
```

---

### 🟡 FAIBLE — Validation manquante sur les champs numériques (micro-pronos admin)

**Fichier :** `app/routes/api.micro-predictions.ts` — lignes 23–24

**Description :**  
Les champs `pointsValue` et `deadlineSeconds` utilisent `parseInt()` sans validation Zod, contrairement aux autres routes admin (events, matches). Des valeurs comme `0`, négatives ou excessives (ex : `deadlineSeconds = 999999999`) ne sont pas rejetées.

**Impact :** Comportement inattendu (pronostic avec 0 point, deadline impossible), potentielle corruption de données.

**Correctif recommandé :** Utiliser un schéma Zod :
```typescript
const microSchema = z.object({
  pointsValue: z.coerce.number().min(1).max(100),
  deadlineSeconds: z.coerce.number().min(10).max(3600),
  ...
});
```

---

### 🟡 FAIBLE — Réponse libre acceptée pour les QCM (micro-pronos)

**Fichier :** `app/routes/api.micro-predictions.ts` — intent `answer`

**Description :**  
Lorsqu'un joueur répond à un micro-pronostic de type QCM, sa réponse (texte libre) n'est pas validée par rapport à la liste des options définies. Un utilisateur peut soumettre une réponse arbitraire qui ne sera jamais correcte, ou tenter de deviner la clé de comparaison en soumettant des variantes.

**Impact :** Faible — le pire cas est un vote invalide qui n'obtient jamais de points. Mais cela peut aussi causer des incohérences dans les statistiques.

**Correctif recommandé :** Vérifier que `answer` est dans `JSON.parse(micro.options)` si `micro.type === "qcm"`.

---

### 🔵 INFO — MIME type des fichiers uploadés fourni par le client

**Fichier :** `app/lib/server/upload.ts` — ligne 14

**Description :**  
La vérification du type d'image (`file.type`) repose sur la valeur fournie par le client, qui peut être falsifiée. Cependant, le pipeline Sharp convertit systématiquement le fichier en WebP, ce qui neutralise la plupart des vecteurs d'exploitation (SVG malveillant, fichiers polyglots).

**Statut :** Risque **mitigé** par la re-conversion Sharp. Aucune action urgente.

---

## Bilan des bonnes pratiques observées

| Point positif | Détail |
|--------------|--------|
| ✅ Authentification systématique | `requireAuth()` appliqué à toutes les routes protégées |
| ✅ Contrôle des rôles | `requireAuth(request, ["admin"])` sur toutes les routes admin |
| ✅ ORM paramétré (Drizzle) | Pas d'injection SQL possible via les requêtes Drizzle |
| ✅ Validation Zod sur les routes critiques | Feed, matches, events utilisent des schémas Zod |
| ✅ Environnement validé au démarrage | `getEnv()` via Zod pour la plupart des accès |
| ✅ Logs structurés | Pino avec `logger.info/warn/error` cohérent |
| ✅ Rate limiting sur l'auth | Login et inscription protégés contre le brute-force |
| ✅ Secrets hors repo | `.env` dans `.gitignore`, credentials retirés en `aed5841` |
| ✅ Upload avatar sécurisé | Type MIME + taille + re-conversion Sharp en WebP |

---

## Priorités d'action recommandées

| Priorité | Action | Fichier |
|----------|--------|---------|
| 🔴 P0 — Immédiat | Corriger le path traversal | `app/routes/uploads-files.ts` |
| 🟠 P1 — Court terme | Ajouter rate limiting sur les routes API métier | `api.micro-predictions.ts`, `feed.server.ts` |
| 🟠 P1 — Court terme | Utiliser `getEnv()` dans `db/client.ts` et `redis.server.ts` | `app/db/client.ts`, `app/lib/server/redis.server.ts` |
| 🟡 P2 — Prochain sprint | Ajouter validation Zod sur les champs numériques micro-pronos | `app/routes/api.micro-predictions.ts` |
| 🟡 P2 — Prochain sprint | Valider les réponses QCM contre la liste d'options | `app/routes/api.micro-predictions.ts` |
