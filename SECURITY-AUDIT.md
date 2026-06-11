# Audit de Sécurité — Penya Blaugrana Nantes

**Date :** 11 juin 2026  
**Branche analysée :** `claude/sharp-fermi-3rawhh`  
**Auteur de l'audit :** Claude Code (claude-sonnet-4-6)

---

## Résumé des derniers commits

| Hash | Date | Auteur | Description |
|------|------|--------|-------------|
| `003faca` | 2026-04-13 | Biteau Gaël | fix: évaluer les badges immédiatement après chaque action |
| `b1c88f6` | 2026-04-13 | Biteau Gaël | feat: Phase 2 — soirée match live, micro-pronos, badges, séries, saisons |
| `d461ee5` | 2026-04-12 | Claude | Merge branch 'claude/deploy-synology-nas-cLkOL' |
| `554b873` | 2026-04-12 | Claude | Add deployment guide for Synology NAS updates |
| `68e22d2` | 2026-04-13 | Biteau Gaël | feat: menu burger mobile pour la navigation |
| `6aebaf7` | 2026-04-12 | Claude | Fix Better Auth trusted origins for custom domain support |
| `9823bc5` | 2026-04-12 | Claude | Add migrate service to docker-compose.prod.yml |
| `8d6e5e9` | 2026-04-12 | Claude | Add production Docker Compose and backup script for Synology NAS |
| `3d80133` | 2026-04-12 | Biteau Gaël | docs: roadmap Phase 2 — 8 priorités documentées |
| `aed5841` | 2026-04-12 | Biteau Gaël | **security: supprimer credentials du repo et renforcer .gitignore** |
| `6583da3` | 2026-04-12 | Biteau Gaël | docs: README complet avec guide de déploiement NAS Synology |
| `ab7fc5d` | 2026-04-12 | Biteau Gaël | feat: intégration API Football + stats enrichies + classement Liga |
| `16c43e6` | 2026-04-11 | Biteau Gaël | feat: MVP Phase 1 — Penya Blaugrana Nantes |

### Points positifs notés dans les commits récents
- `aed5841` — suppression active de credentials du dépôt et renforcement du `.gitignore` : démarche de sécurité proactive.
- Toutes les routes API utilisent `requireAuth` avec vérification de rôle (`admin`) avant chaque action sensible.
- Utilisation de Drizzle ORM pour toutes les requêtes DB → pas d'injection SQL possible.
- `.env` correctement exclu du dépôt, `.env.example` fourni sans valeurs réelles.

---

## Résultats de l'audit de sécurité

---

### 🔴 CRITIQUE

#### C1 — Path Traversal dans le serveur de fichiers uploadés
**Fichier :** `app/routes/uploads-files.ts:5`  
**Vecteur :** Un attaquant peut accéder à des fichiers arbitraires du serveur via l'URL `/uploads/../../../etc/passwd`.

**Code vulnérable :**
```typescript
const filePath = path.join(process.cwd(), "uploads", params["*"]);
```
`path.join` normalise le chemin mais ne bloque pas les séquences `../` qui remontent hors du répertoire `uploads`.

**Correction :**
```typescript
const uploadsDir = path.resolve(process.cwd(), "uploads");
const filePath = path.resolve(uploadsDir, params["*"]);
if (!filePath.startsWith(uploadsDir + path.sep)) {
  return new Response("Forbidden", { status: 403 });
}
```

---

### 🟠 HAUTE

#### H1 — Mots de passe par défaut en production (`changeme`)
**Fichier :** `docker-compose.prod.yml:22,32,34`  
**Description :** Les variables `POSTGRES_PASSWORD` et `REDIS_PASSWORD` utilisent `changeme` comme valeur de repli si la variable d'environnement n'est pas définie. Un déploiement sans fichier `.env` rempli expose la base de données et Redis avec un mot de passe trivial.

**Code vulnérable :**
```yaml
POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-changeme}
redis-server --requirepass ${REDIS_PASSWORD:-changeme}
```

**Correction :** Supprimer les valeurs par défaut pour forcer une configuration explicite. Utiliser `${POSTGRES_PASSWORD:?POSTGRES_PASSWORD must be set}` ou faire échouer explicitement le démarrage si la variable est absente.

---

#### H2 — Fuite de messages d'erreur internes vers le client
**Fichier :** `app/routes/api.sync-matches.ts:21`  
**Description :** Le message d'erreur brut (potentiellement avec des détails de connexion DB, des stack traces, des noms de tables) est renvoyé directement au client HTTP.

**Code vulnérable :**
```typescript
const message = error instanceof Error ? error.message : "Erreur inconnue";
return Response.json({ error: message }, { status: 500 });
```

**Correction :**
```typescript
logger.error({ error }, "Erreur sync API-Football");
return Response.json({ error: "Erreur de synchronisation. Réessayez plus tard." }, { status: 500 });
```

---

#### H3 — Absence de rate limiting sur l'API micro-pronostics
**Fichier :** `app/routes/api.micro-predictions.ts`  
**Description :** Contrairement à `api.auth.$.ts` qui applique `applyRateLimit`, l'endpoint `/api/micro-predictions` ne limite pas le nombre de requêtes. Un utilisateur mal intentionné peut spammer les votes ou tenter de brute-forcer les réponses de micro-pronos.

**Correction :** Appliquer `applyRateLimit` en début d'action, sur le modèle de l'endpoint d'authentification :
```typescript
import { applyRateLimit } from "~/lib/server/rate-limit.server";

export async function action({ request }: { request: Request }) {
  const rateLimitResponse = await applyRateLimit(request, "micro-prediction");
  if (rateLimitResponse) return rateLimitResponse;
  // ...
}
```

---

### 🟡 MOYENNE

#### M1 — Contournement possible du rate limiting par spoofing IP
**Fichier :** `app/routes/api.auth.$.ts:5-10`  
**Description :** Le header `x-forwarded-for` est accepté sans validation. Un attaquant peut forger ce header pour faire croire à une IP différente à chaque requête et contourner le rate limiting.

**Code vulnérable :**
```typescript
request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
request.headers.get("x-real-ip") ||
"unknown"
```

**Correction :** Ne faire confiance à `x-forwarded-for` que si l'application est derrière un reverse proxy connu (Nginx, Traefik). Documenter la configuration attendue et valider le format IP (regex IPv4/IPv6).

---

#### M2 — `JSON.parse` sans gestion d'erreur (crash potentiel)
**Fichier :** `app/routes/soiree.server.ts:250`  
**Description :** Si le champ `options` en base contient une valeur corrompue, `JSON.parse` lèvera une exception non catchée qui peut planter la page soirée match.

**Code vulnérable :**
```typescript
options: m.options ? JSON.parse(m.options) as string[] : [],
```

**Correction :**
```typescript
let options: string[] = [];
if (m.options) {
  try {
    const parsed = JSON.parse(m.options);
    options = Array.isArray(parsed) ? parsed.filter((o): o is string => typeof o === "string") : [];
  } catch {
    logger.warn({ microId: m.id }, "Options JSON corrompues ignorées");
  }
}
```

---

#### M3 — Absence d'en-têtes de sécurité HTTP
**Fichier :** Toute l'application (aucun middleware global)  
**Description :** Aucun des en-têtes de sécurité HTTP recommandés n'est configuré. Cela expose l'application au clickjacking, au sniffing de MIME type et aux attaques XSS via le navigateur.

En-têtes manquants :
- `X-Frame-Options: DENY` (clickjacking)
- `X-Content-Type-Options: nosniff` (MIME sniffing)
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Content-Security-Policy` (XSS)
- `Strict-Transport-Security` (HTTPS forced)

**Correction :** Ajouter un middleware dans `app/root.tsx` ou via Nginx en production pour injecter ces en-têtes sur toutes les réponses.

---

### 🔵 FAIBLE

#### L1 — Conteneur Docker tournant en tant que root
**Fichier :** `Dockerfile`  
**Description :** Le Dockerfile ne définit pas d'instruction `USER`. L'application s'exécute donc en tant que `root` dans le conteneur. Une faille d'exploitation dans l'application donnerait accès root au système de fichiers du conteneur.

**Correction :** Ajouter avant `CMD` :
```dockerfile
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser
```

---

#### L2 — Contournement du typage TypeScript sur le rôle utilisateur
**Fichiers :** `app/routes/feed.server.ts:99,124,184,200`  
**Description :** Le rôle est lu via `(session.user as any).role`, contournant le typage. Si la structure de session évolue, cette vérification silencieuse ne sera pas détectée à la compilation.

**Correction :** Étendre le type `Session` de Better Auth pour inclure `role` :
```typescript
// Dans auth.server.ts
declare module "better-auth" {
  interface User {
    role: "member" | "admin" | "partner";
  }
}
```

---

## Tableau récapitulatif

| ID | Criticité | Fichier | Description courte | Statut |
|----|-----------|---------|-------------------|--------|
| C1 | 🔴 CRITIQUE | `uploads-files.ts:5` | Path traversal — lecture de fichiers arbitraires | À corriger immédiatement |
| H1 | 🟠 HAUTE | `docker-compose.prod.yml:22,32` | Mots de passe par défaut "changeme" en prod | À corriger avant déploiement |
| H2 | 🟠 HAUTE | `api.sync-matches.ts:21` | Fuite de messages d'erreur internes | À corriger |
| H3 | 🟠 HAUTE | `api.micro-predictions.ts` | Absence de rate limiting | À corriger |
| M1 | 🟡 MOYENNE | `api.auth.$.ts:5` | Spoofing IP contourne le rate limiting | À améliorer |
| M2 | 🟡 MOYENNE | `soiree.server.ts:250` | JSON.parse sans try/catch | À corriger |
| M3 | 🟡 MOYENNE | Application globale | En-têtes HTTP de sécurité absents | À planifier |
| L1 | 🔵 FAIBLE | `Dockerfile` | App tourne en root dans le conteneur | À planifier |
| L2 | 🔵 FAIBLE | `feed.server.ts:99,124,184,200` | Cast `as any` sur le rôle utilisateur | À améliorer |

---

## Points positifs confirmés

- **Authentification robuste** : toutes les routes sensibles passent par `requireAuth` avec vérification de rôle.
- **Pas d'injection SQL** : utilisation exclusive de Drizzle ORM avec requêtes paramétrées.
- **Secrets exclus du dépôt** : `.env` dans `.gitignore`, credentials supprimés (commit `aed5841`).
- **Better Auth** : bibliothèque reconnue pour l'authentification, gestion sécurisée des sessions.
- **Logging structuré** : utilisation de `logger` pour tracer les événements sensibles.

---

*Document généré automatiquement — à mettre à jour après chaque sprint.*
