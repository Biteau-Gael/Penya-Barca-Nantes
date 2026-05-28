# Rapport d'audit de sécurité — Penya Blaugrana Nantes

**Date :** 28/05/2026  
**Branche analysée :** `main` / `claude/sharp-fermi-jRdvl`  
**Périmètre :** Application React Router v7 + Better Auth + Drizzle ORM + PostgreSQL + Redis

---

## 1. Résumé des derniers commits

| Hash | Date | Description |
|------|------|-------------|
| `003faca` | 13/04/2026 | **fix:** Évaluation immédiate des badges après soumission de pronostic, publication de post/commentaire, réaction |
| `b1c88f6` | 13/04/2026 | **feat:** Phase 2 — soirée match live, micro-pronos, badges (10), séries de scores exacts, saisons avec archives classement |
| `68e22d2` | 13/04/2026 | **feat:** Menu burger mobile pour la navigation |
| `554b873` | 12/04/2026 | **docs:** Guide de déploiement mises à jour Synology NAS |
| `6aebaf7` | 12/04/2026 | **fix:** Correction trusted origins Better Auth pour domaine personnalisé |
| `9823bc5` | 12/04/2026 | **feat:** Service `migrate` dans docker-compose.prod.yml pour migrations automatiques |
| `8d6e5e9` | 12/04/2026 | **feat:** Docker Compose production + script de sauvegarde pour NAS Synology |
| `aed5841` | antérieur | **security:** Suppression des credentials du repo et renforcement `.gitignore` |

### Synthèse fonctionnelle Phase 2

La Phase 2 est ambitieuse et couvre trois sprints en un seul commit :
- **Sprint 2 — Soirée match :** page `/soiree/:matchId` avec polling API toutes les 60s, fil temps réel, pronos communauté révélés au coup d'envoi.
- **Sprint 3 — Micro-pronostics :** CRUD admin complet, vote joueur, attribution automatique des points, système de séries (currentStreak / bestStreak), récompenses aux paliers 3/5/10.
- **Sprint 5 — Badges & Saisons :** 10 badges évalués automatiquement, page `/badges`, classement par saison avec archives.

---

## 2. Analyse de sécurité par ordre de criticité

---

### 🔴 CRITIQUE

#### C-1 — Path Traversal dans le serveur de fichiers uploadés

**Fichier :** `app/routes/uploads-files.ts`  
**Ligne :** 6  

```ts
const filePath = path.join(process.cwd(), "uploads", params["*"]);
```

`params["*"]` est directement concaténé au chemin sans assainissement. Une requête vers `/uploads/../.env` ou `/uploads/../../app/config/env.server.ts` permet de lire n'importe quel fichier du système, y compris les variables d'environnement contenant les secrets (AUTH_SECRET, clé API, mot de passe DB).

**Correction recommandée :**
```ts
const requested = path.normalize(params["*"]);
if (requested.startsWith("..") || path.isAbsolute(requested)) {
  return new Response("Forbidden", { status: 403 });
}
const filePath = path.join(process.cwd(), "uploads", requested);
// Vérifier que le chemin résolu reste dans uploads/
const uploadDir = path.join(process.cwd(), "uploads");
if (!filePath.startsWith(uploadDir + path.sep)) {
  return new Response("Forbidden", { status: 403 });
}
```

---

### 🟠 ÉLEVÉ

#### H-1 — Absence de headers de sécurité HTTP

**Fichier :** `app/root.tsx`  

Aucun header de sécurité HTTP n'est défini dans l'application. Les headers manquants sont :
- `Content-Security-Policy` — protection XSS
- `X-Frame-Options: DENY` — protection clickjacking
- `X-Content-Type-Options: nosniff` — protection MIME sniffing
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Strict-Transport-Security` (HSTS) — en production

**Correction recommandée :** Ajouter une fonction `headers` dans `root.tsx` ou un middleware :
```ts
export function headers() {
  return {
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Content-Security-Policy": "default-src 'self'; ...",
  };
}
```

#### H-2 — Validation MIME côté client uniquement pour les uploads

**Fichier :** `app/lib/server/upload.ts`  
**Ligne :** 13  

```ts
if (!ALLOWED_TYPES.includes(file.type)) { ... }
```

`file.type` est fourni par le client (navigateur) et peut être falsifié. Un attaquant peut envoyer un fichier PHP/shell avec `Content-Type: image/jpeg`. Bien que `sharp` reprocess l'image ce qui réduit le risque d'exécution, il convient de valider les magic bytes réels.

**Correction recommandée :** Valider les magic bytes avec une librairie comme `file-type` :
```ts
import { fileTypeFromBuffer } from "file-type";
const type = await fileTypeFromBuffer(buffer);
if (!type || !["image/jpeg","image/png","image/webp"].includes(type.mime)) {
  throw new Error("Format de fichier invalide.");
}
```

#### H-3 — Contournement du rate-limiting par falsification de l'IP

**Fichier :** `app/routes/api.auth.$.ts`  
**Ligne :** 5-10  

```ts
request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
```

Si l'application n'est pas derrière un reverse proxy de confiance, ce header peut être forgé par un client, permettant de contourner le rate-limiting en changeant l'IP déclarée.

**Correction recommandée :** En production (derrière Nginx/Synology), configurer le proxy pour écraser ce header et documenter que le rate-limiting n'est fiable que derrière un reverse proxy configuré. Ajouter un avertissement dans la configuration.

---

### 🟡 MOYEN

#### M-1 — Connexion DB bypass de la validation d'environnement

**Fichier :** `app/db/client.ts`  
**Ligne :** 6  

```ts
connectionString: process.env.DATABASE_URL,
```

Le client DB lit `process.env.DATABASE_URL` directement au lieu d'utiliser `getEnv()`. Si `DATABASE_URL` est absent, `pg.Pool` reçoit `undefined` et échoue silencieusement ou avec un message d'erreur peu clair, sans bénéficier de la validation Zod.

**Correction recommandée :**
```ts
import { getEnv } from "~/config/env.server";
const pool = new pg.Pool({ connectionString: getEnv().DATABASE_URL });
```

#### M-2 — Absence de rate-limiting sur les routes de mutation authentifiées

**Périmètre :** `feed.server.ts`, `api.micro-predictions.ts`, profil  

Les routes de publication (posts, commentaires, réactions, pronostics) ne sont pas protégées par rate-limiting. Un compte compromis peut spammer massivement le fil d'actualités ou soumettre des milliers de pronostics.

**Correction recommandée :** Appliquer `checkRateLimit` avec des clés par `userId` sur ces routes (ex. 10 posts/heure, 60 commentaires/heure).

#### M-3 — Champ `answer` des micro-pronos non validé en longueur

**Fichier :** `app/routes/api.micro-predictions.ts`  
**Ligne :** 78  

```ts
const answer = formData.get("answer") as string;
```

Aucune limite de longueur n'est imposée sur la valeur `answer`. Un attaquant peut soumettre une chaîne arbitrairement longue (MB) en base de données.

**Correction recommandée :**
```ts
if (!answer || answer.length > 200) {
  return Response.json({ error: "Réponse invalide" }, { status: 400 });
}
```

#### M-4 — Mots de passe Docker par défaut trop permissifs

**Fichier :** `docker-compose.prod.yml`  
**Lignes :** 26, 35  

```yaml
POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-changeme}
redis-server --requirepass ${REDIS_PASSWORD:-changeme}
```

Si l'opérateur oublie de définir ces variables, les mots de passe `changeme` sont appliqués en production. Le démarrage devrait échouer plutôt que d'utiliser un fallback dangereux.

**Correction recommandée :** Supprimer les valeurs par défaut ou les remplacer par une chaîne vide qui force une erreur de démarrage :
```yaml
POSTGRES_PASSWORD=${POSTGRES_PASSWORD:?La variable POSTGRES_PASSWORD doit être définie}
```

#### M-5 — Dockerfile exécute l'application en tant que root

**Fichier :** `Dockerfile`  

Le conteneur final n'a pas de directive `USER`. L'application tourne donc en tant que `root` dans le conteneur, ce qui amplifie l'impact d'une éventuelle compromission.

**Correction recommandée :** Ajouter avant `CMD` :
```dockerfile
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser
```

---

### 🔵 FAIBLE

#### F-1 — `trustedOrigins` vide en l'absence de APP_URL

**Fichier :** `app/lib/server/auth.server.ts`  
**Ligne :** 12  

```ts
trustedOrigins: env.APP_URL ? [env.APP_URL] : [],
```

En développement (sans `APP_URL`), la liste est vide. Better Auth peut accepter des requêtes cross-origin selon sa configuration interne par défaut. Documenter explicitement le comportement attendu.

#### F-2 — Pool de connexions DB sans limites configurées

**Fichier :** `app/db/client.ts`  

Aucun `max`, `connectionTimeoutMillis` ou `idleTimeoutMillis` n'est configuré sur le pool PostgreSQL. En cas de pic de trafic, le pool peut épuiser les connexions disponibles et provoquer des erreurs en cascade.

**Correction recommandée :**
```ts
const pool = new pg.Pool({
  connectionString: getEnv().DATABASE_URL,
  max: 10,
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000,
});
```

#### F-3 — Logs potentiellement verbeux en production

**Fichier :** `app/lib/server/auth.server.ts`  
**Ligne :** 50  

```ts
logger: { disabled: false, level: "error" },
```

Le niveau `error` pour Better Auth est correct. Vérifier que `LOG_LEVEL` en production est bien `warn` ou `error` et non `debug` pour éviter de logger des données sensibles (tokens, IPs).

---

## 3. Tableau récapitulatif

| ID | Criticité | Fichier | Description |
|----|-----------|---------|-------------|
| C-1 | 🔴 CRITIQUE | `uploads-files.ts` | Path traversal — lecture de fichiers arbitraires |
| H-1 | 🟠 ÉLEVÉ | `root.tsx` | Absence de headers de sécurité HTTP |
| H-2 | 🟠 ÉLEVÉ | `upload.ts` | Validation MIME côté client contournable |
| H-3 | 🟠 ÉLEVÉ | `api.auth.$.ts` | Rate-limit IP falsifiable (X-Forwarded-For) |
| M-1 | 🟡 MOYEN | `db/client.ts` | Bypass de la validation d'environnement |
| M-2 | 🟡 MOYEN | Plusieurs routes | Pas de rate-limiting sur les mutations authentifiées |
| M-3 | 🟡 MOYEN | `api.micro-predictions.ts` | Champ `answer` sans limite de longueur |
| M-4 | 🟡 MOYEN | `docker-compose.prod.yml` | Mots de passe par défaut dangereux |
| M-5 | 🟡 MOYEN | `Dockerfile` | Application tournant en root dans le conteneur |
| F-1 | 🔵 FAIBLE | `auth.server.ts` | `trustedOrigins` vide sans APP_URL |
| F-2 | 🔵 FAIBLE | `db/client.ts` | Pool DB sans limites configurées |
| F-3 | 🔵 FAIBLE | `auth.server.ts` | Niveau de log à vérifier en production |

---

## 4. Points positifs identifiés

- **Validation Zod** systématique à la frontière (env, formulaires, prédictions, matchs, utilisateurs) avec tests unitaires associés.
- **Rate-limiting sur l'authentification** (Better Auth) avec Redis : 10 tentatives/15 min (login), 5/heure (inscription), par IP.
- **`requireAuth`** protège toutes les routes sensibles avec gestion des rôles (`member`, `admin`, `partner`).
- **ORM paramétré (Drizzle)** : aucune requête SQL brute concaténée → pas d'injection SQL.
- **`AUTH_SECRET` validé** (`min(16)`) via Zod dans `env.server.ts`.
- **Reprocessing d'image avec sharp** : même sans validation magic bytes, la recompression via `sharp` neutralise la plupart des payloads embarqués dans les images.
- **Suppression des credentials du repo** actée dans le commit `aed5841`.
- **GDPR consent** requis à l'inscription (`z.literal(true)`).
- **Protection self-role** : un admin ne peut pas modifier son propre rôle ni se supprimer.

---

*Document généré le 28/05/2026 — à mettre à jour à chaque sprint.*
