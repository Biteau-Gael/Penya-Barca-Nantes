# Rapport d'audit de sécurité — Penya Blaugrana Nantes

**Date :** 2026-06-12  
**Branche analysée :** `main` (dernier commit : `003faca`)  
**Auteur de l'analyse :** Claude Code

---

## 1. Résumé des derniers commits

| Hash | Date | Auteur | Description |
|------|------|--------|-------------|
| `003faca` | 13/04/2026 | Biteau Gaël | fix: évaluer les badges immédiatement après chaque action |
| `b1c88f6` | 13/04/2026 | Biteau Gaël | feat: Phase 2 — soirée match live, micro-pronos, badges, séries, saisons |
| `68e22d2` | 13/04/2026 | Biteau Gaël | feat: menu burger mobile pour la navigation |
| `554b873` | 12/04/2026 | Claude | Add deployment guide for Synology NAS updates |
| `d461ee5` | 12/04/2026 | Claude | Merge branch 'claude/deploy-synology-nas-cLkOL' |
| `6aebaf7` | 12/04/2026 | Claude | Fix Better Auth trusted origins for custom domain support |
| `9823bc5` | 12/04/2026 | Claude | Add migrate service to docker-compose.prod.yml |
| `8d6e5e9` | 12/04/2026 | Claude | Add production Docker Compose and backup script for Synology NAS |
| `3d80133` | 12/04/2026 | Biteau Gaël | docs: roadmap Phase 2 — 8 priorités documentées |
| `aed5841` | 12/04/2026 | Biteau Gaël | **security:** supprimer credentials du repo et renforcer .gitignore |
| `ab7fc5d` | 12/04/2026 | Biteau Gaël | feat: intégration API Football + stats enrichies + classement Liga |

### Points positifs des commits récents

- `aed5841` a correctement retiré les credentials codés en dur du repo et renforcé le `.gitignore`
- La Phase 2 (`b1c88f6`) inclut des contrôles de rôle pour les micro-pronos et l'accès admin
- Better Auth est utilisé pour la gestion des sessions avec stockage Redis
- La validation Zod est appliquée sur toutes les entrées utilisateur exposées

---

## 2. Analyse de sécurité — Remarques par ordre de criticité

---

### CRITIQUE (P0) — Correction immédiate requise

---

#### [SEC-01] Path Traversal dans le serveur de fichiers statiques

**Fichier :** `app/routes/uploads-files.ts`  
**Risque :** Lecture arbitraire de fichiers système (LFI — Local File Inclusion)

**Problème :**  
Le paramètre wildcard `params["*"]` est concaténé directement dans le chemin sans vérification que le chemin résolu reste dans le dossier `uploads/`. `path.join` normalise les segments `../` ce qui permet à un attaquant de remonter l'arborescence.

```ts
// CODE ACTUEL — VULNÉRABLE
const filePath = path.join(process.cwd(), "uploads", params["*"]);
// Exemple d'attaque :
// GET /uploads/../../etc/passwd
// → filePath = "/app/etc/passwd" → lecture du fichier
// GET /uploads/../../../etc/passwd
// → filePath = "/etc/passwd" → lecture du fichier
```

**Correction recommandée :**
```ts
const UPLOAD_DIR = path.join(process.cwd(), "uploads");
const filePath = path.resolve(UPLOAD_DIR, params["*"]);

// Bloquer toute sortie du répertoire
if (!filePath.startsWith(UPLOAD_DIR + path.sep)) {
  return new Response("Not found", { status: 404 });
}
```

---

### HAUTE (P1) — Correction dans la prochaine itération

---

#### [SEC-02] Mots de passe par défaut "changeme" en production

**Fichiers :** `docker-compose.prod.yml` (lignes 20, 28), `docker-compose.yml`  
**Risque :** Compromission de la base de données si la variable d'environnement n'est pas définie

**Problème :**  
Les deux services utilisent un fallback `:-changeme` si la variable d'environnement n'est pas positionnée. En cas d'oubli lors du déploiement, Postgres et Redis démarrent avec des credentials triviaux.

```yaml
# RISQUÉ
POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-changeme}
command: redis-server --requirepass ${REDIS_PASSWORD:-changeme}
```

**Correction recommandée :**  
Supprimer les valeurs par défaut pour forcer une erreur explicite si la variable est manquante :
```yaml
POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?La variable POSTGRES_PASSWORD est requise}
```

---

#### [SEC-03] Absence de headers de sécurité HTTP

**Fichier :** `docker/nginx/nginx.conf`  
**Risque :** Clickjacking, MIME-sniffing, XSS via iframes, exposition d'informations

**Problème :**  
La configuration Nginx ne définit aucun header de sécurité HTTP standard.

**Correction recommandée — Ajouter dans le bloc `server` :**
```nginx
add_header X-Frame-Options "SAMEORIGIN" always;
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Content-Security-Policy "default-src 'self'; img-src 'self' data: https://images.fotmob.com https://fonts.gstatic.com; font-src 'self' https://fonts.gstatic.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; script-src 'self'" always;
add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;
# Activer uniquement quand HTTPS est configuré :
# add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
```

---

#### [SEC-04] HTTPS non configuré sur Nginx

**Fichier :** `docker/nginx/nginx.conf`  
**Risque :** Interception des sessions et credentials en clair sur le réseau local

**Problème :**  
Nginx écoute uniquement sur le port 80 (HTTP). Les cookies de session Better Auth transitent en clair sur le réseau, ce qui expose les sessions à une interception (man-in-the-middle) sur le réseau local ou Wi-Fi.

**Correction recommandée :**  
Configurer TLS via Let's Encrypt (Certbot) ou les certificats du Synology DSM, puis ajouter une redirection HTTP → HTTPS :
```nginx
server {
    listen 80;
    return 301 https://$host$request_uri;
}
server {
    listen 443 ssl;
    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;
    ...
}
```

---

#### [SEC-05] `db/client.ts` et `redis.server.ts` contournent la validation des variables d'environnement

**Fichiers :** `app/db/client.ts`, `app/lib/server/redis.server.ts`  
**Risque :** Démarrage silencieux de l'application sans connexion fonctionnelle

**Problème :**  
Ces deux fichiers accèdent à `process.env` directement, sans passer par `getEnv()` qui applique la validation Zod. Si `DATABASE_URL` ou `REDIS_URL` est absent, l'application démarre sans erreur au chargement du module mais échoue à la première requête.

```ts
// app/db/client.ts — contourne getEnv()
connectionString: process.env.DATABASE_URL,

// app/lib/server/redis.server.ts — contourne getEnv()
new Redis(process.env.REDIS_URL || "redis://localhost:6379", ...)
```

**Correction recommandée :**
```ts
// app/db/client.ts
import { getEnv } from "~/config/env.server";
const pool = new pg.Pool({ connectionString: getEnv().DATABASE_URL });

// app/lib/server/redis.server.ts
import { getEnv } from "~/config/env.server";
export const redis = new Redis(getEnv().REDIS_URL, { ... });
```

---

### MOYENNE (P2) — À planifier dans le backlog

---

#### [SEC-06] Utilisation de `as any` pour accéder au rôle utilisateur

**Fichier :** `app/routes/feed.server.ts` (lignes 99, 124, 184, 200)  
**Risque :** Contournement des vérifications de type TypeScript, bugs silencieux si la structure change

**Problème :**  
Le rôle utilisateur est accédé via `(session.user as any).role`, contournant la sécurité de type TypeScript.

```ts
// Risqué — 4 occurrences dans feed.server.ts
const isAdmin = (session.user as any).role === "admin";
if (isAnnouncement && (session.user as any).role !== "admin") { ... }
```

**Correction recommandée :**  
Étendre le type `Session` de Better Auth ou utiliser `requireAuth` avec le rôle directement :
```ts
// Utiliser requireAuth avec vérification de rôle
await requireAuth(request, ["admin"]);
// ou typer explicitement
const role = session.user.role as Role;
```

---

#### [SEC-07] Pas de timeout sur les appels API Football externes

**Fichier :** `app/lib/server/api-football.server.ts`, `app/routes/soiree.server.ts`  
**Risque :** Blocage des loaders React Router si l'API externe est lente ou indisponible

**Problème :**  
Les appels `fetch()` vers l'API RapidAPI n'ont pas de signal `AbortController` avec timeout. En cas de lenteur de l'API, la page sera bloquée indéfiniment côté serveur.

**Correction recommandée :**
```ts
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 5000); // 5s max
try {
  const response = await fetch(url.toString(), {
    headers: { ... },
    signal: controller.signal,
  });
} finally {
  clearTimeout(timeout);
}
```

---

#### [SEC-08] Suppression de compte sans re-authentification

**Fichier :** `app/routes/profile.server.ts`  
**Risque :** Action irréversible trop facilement déclenchable

**Problème :**  
L'action `delete-account` supprime immédiatement le compte sans demander le mot de passe courant ni confirmation forte. Une requête forgée (CSRF) ou une fausse manipulation UI pourrait déclencher la suppression.

**Correction recommandée :**  
Exiger la saisie du mot de passe courant avant la suppression, validé via Better Auth :
```ts
if (intent === "delete-account") {
  const password = formData.get("password") as string;
  // Vérifier le mot de passe avant suppression
  const valid = await auth.api.verifyPassword({ userId: session.user.id, password });
  if (!valid) return { error: "Mot de passe incorrect." };
  // puis procéder à la suppression
}
```

---

### FAIBLE (P3) — Bonnes pratiques à améliorer

---

#### [SEC-09] Ports Postgres et Redis exposés sans auth dans docker-compose.yml (dev)

**Fichier :** `docker-compose.yml`  
**Risque :** Accès non authentifié à Redis depuis l'hôte en développement

**Problème :**  
En développement, le service Redis n'a pas de mot de passe (`redis-server` sans `--requirepass`) et les ports `5432` et `6379` sont bindés sur `0.0.0.0` de l'hôte. Sur un réseau partagé (Wi-Fi, VPN), n'importe qui peut accéder à ces services.

**Correction recommandée :**  
Restreindre le binding à localhost ou ajouter un mot de passe même en dev :
```yaml
ports:
  - "127.0.0.1:5432:5432"
  - "127.0.0.1:6379:6379"
```

---

#### [SEC-10] Absence de logs d'audit d'authentification

**Fichier :** `app/lib/server/auth.server.ts`  
**Risque :** Impossibilité de détecter des tentatives de brute-force ou d'intrusion a posteriori

**Problème :**  
Les événements d'authentification (connexion réussie, échec de connexion, déconnexion) ne sont pas loggés via `logger`. Better Auth est configuré avec `level: "error"` uniquement.

**Correction recommandée :**  
Utiliser les hooks Better Auth pour logger les événements de sécurité :
```ts
export const auth = betterAuth({
  // ...
  hooks: {
    after: [
      createAuthMiddleware(async (ctx) => {
        if (ctx.path === "/sign-in/email") {
          logger.info({ path: ctx.path }, "Tentative de connexion");
        }
      }),
    ],
  },
});
```

---

#### [SEC-11] Rate limiting non vérifié sur les endpoints d'authentification

**Fichier :** `app/routes/api.auth.$.ts`  
**Risque :** Brute-force des mots de passe si le rate limiting de Better Auth n'est pas activé par défaut

**Problème :**  
Le code `checkRateLimit` est implémenté dans `rate-limit.server.ts` mais n'est pas explicitement appelé sur la route `api/auth`. Better Auth peut avoir un rate limiting intégré, mais ce n'est pas configuré explicitement dans `auth.server.ts`.

**Correction recommandée :**  
Vérifier et configurer le rate limiting de Better Auth explicitement :
```ts
export const auth = betterAuth({
  rateLimit: {
    enabled: true,
    window: 60,        // 60 secondes
    max: 10,           // 10 tentatives max
    storage: "memory", // ou "redis" avec secondaryStorage
  },
  // ...
});
```

---

#### [SEC-12] Vérification MIME basée sur le Content-Type fourni par le client

**Fichier :** `app/lib/server/upload.ts`  
**Risque :** Upload de fichiers malveillants si sharp échoue silencieusement (mitigé)

**Problème :**  
La validation `ALLOWED_TYPES.includes(file.type)` se base sur `file.type` qui est fourni par le client et peut être falsifié (`image/jpeg` avec un contenu malveillant).

**Mitigant existant :** `sharp` re-encode systématiquement le fichier en WebP, ce qui neutralise les payloads dans les métadonnées et les exploits d'image. Le risque est donc faible mais présent si sharp rencontre un bug de parsing.

**Correction recommandée (optionnelle) :**  
Vérifier les magic bytes du fichier en complément :
```ts
import { fileTypeFromBuffer } from "file-type";
const detected = await fileTypeFromBuffer(buffer);
if (!detected || !["image/jpeg", "image/png", "image/webp"].includes(detected.mime)) {
  throw new Error("Fichier invalide (magic bytes).");
}
```

---

## 3. Tableau de synthèse

| ID | Criticité | Fichier concerné | Statut |
|----|-----------|-----------------|--------|
| SEC-01 | **CRITIQUE** | `app/routes/uploads-files.ts` | À corriger immédiatement |
| SEC-02 | **HAUTE** | `docker-compose.prod.yml` | À corriger |
| SEC-03 | **HAUTE** | `docker/nginx/nginx.conf` | À corriger |
| SEC-04 | **HAUTE** | `docker/nginx/nginx.conf` | À planifier (infra) |
| SEC-05 | **HAUTE** | `app/db/client.ts`, `app/lib/server/redis.server.ts` | À corriger |
| SEC-06 | MOYENNE | `app/routes/feed.server.ts` | Backlog |
| SEC-07 | MOYENNE | `app/lib/server/api-football.server.ts` | Backlog |
| SEC-08 | MOYENNE | `app/routes/profile.server.ts` | Backlog |
| SEC-09 | FAIBLE | `docker-compose.yml` | Recommandé |
| SEC-10 | FAIBLE | `app/lib/server/auth.server.ts` | Recommandé |
| SEC-11 | FAIBLE | `app/routes/api.auth.$.ts` | À vérifier |
| SEC-12 | FAIBLE | `app/lib/server/upload.ts` | Mitigé par sharp |

---

## 4. Points de sécurité conformes (bonnes pratiques respectées)

- Validation Zod sur toutes les entrées utilisateur (user, prediction, feed, match)
- Utilisation de `requireAuth` cohérente sur toutes les routes protégées
- Rôles admin vérifiés côté serveur (pas uniquement côté client)
- `AUTH_SECRET` forcé à minimum 16 caractères par le schéma Zod
- Pas de secrets dans le code source (nettoyé dans `aed5841`)
- Utilisation de l'ORM Drizzle (requêtes paramétrées, pas de SQL dynamique)
- Pas de `dangerouslySetInnerHTML` ni d'`eval()` dans le code frontend
- Sessions stockées en Redis avec TTL (pas de JWT stateless exposé)
- Protection contre la modification de son propre rôle admin
- Validation des pseudos via regex strict (`/^[a-zA-Z0-9_-]+$/`)
- Mot de passe renforcé (majuscule + minuscule + chiffre, minimum 8 chars)
- GDPR consent enregistré en base de données
