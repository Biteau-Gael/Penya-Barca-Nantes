# Audit de sécurité — Penya Blaugrana Nantes
**Date :** 22 mai 2026  
**Branche analysée :** `main` (HEAD `003faca`)  
**Périmètre :** code source applicatif, configuration Docker, gestion des secrets

---

## 1. Résumé des derniers commits

| Hash | Date | Type | Description |
|------|------|------|-------------|
| `003faca` | 2026-04-13 | fix | Évaluer les badges immédiatement après chaque action (pronostic, post, commentaire, réaction) |
| `b1c88f6` | 2026-04-13 | feat | **Phase 2** — page soirée match live, micro-pronostics, badges, séries, saisons (26 fichiers, +2 965 lignes) |
| `68e22d2` | 2026-04-13 | feat | Menu burger mobile dans la navigation |
| `554b873` | 2026-04-12 | docs | Guide de déploiement NAS Synology (DEPLOY.md) |
| `6aebaf7` | 2026-04-12 | fix | Correction des `trustedOrigins` Better Auth pour le domaine personnalisé |
| `9823bc5` | 2026-04-12 | fix | Ajout du service `migrate` dans `docker-compose.prod.yml` |
| `8d6e5e9` | 2026-04-12 | feat | Docker Compose de production + script de sauvegarde pour Synology NAS |

### Détail des changements majeurs (Phase 2)
- **Page `/soiree/:matchId`** : score live via polling API toutes les 60 s, fil du match temps réel
- **Micro-pronostics** : création admin, vote joueur, clôture avec calcul de points automatique
- **Séries** : `currentStreak` / `bestStreak` sur l'utilisateur, récompenses aux paliers 3/5/10
- **Badges** : 10 badges avec évaluation post-action, page `/badges`, affichage profil
- **Saisons** : table `seasons`, classement filtrable par saison, archives

---

## 2. Analyse de sécurité par niveau de criticité

---

### 🔴 CRITIQUE

#### C1 — Path Traversal dans le serveur de fichiers uploads
**Fichier :** `app/routes/uploads-files.ts:5`  
**Risque :** Lecture arbitraire de fichiers sur le serveur

```typescript
// Code actuel — vulnérable
const filePath = path.join(process.cwd(), "uploads", params["*"]);
```

`params["*"]` est la valeur brute de l'URL. `path.join` résout les segments `..` :

```
GET /uploads/../../../etc/passwd
→ path.join("/app", "uploads", "../../../etc/passwd") = "/etc/passwd"
```

Un attaquant peut lire n'importe quel fichier lisible par le processus Node.js (`/etc/passwd`, clés privées, fichiers `.env` si accessibles, etc.). **Aucune authentification n'est requise** pour cette route.

**Correction recommandée :**

```typescript
export async function loader({ params }: { params: { "*": string } }) {
  const uploadDir = path.resolve(process.cwd(), "uploads");
  const filePath = path.resolve(uploadDir, params["*"]);

  // Vérification anti path-traversal
  if (!filePath.startsWith(uploadDir + path.sep)) {
    return new Response("Forbidden", { status: 403 });
  }
  // ... suite inchangée
}
```

---

### 🟠 HAUTE

#### H1 — Absence d'en-têtes de sécurité HTTP
**Fichier :** `app/root.tsx` (aucun en-tête défini), aucun middleware de sécurité  
**Risque :** XSS réfléchi/stocké, clickjacking, MIME sniffing, fuite de données via Referer

Aucun des en-têtes suivants n'est configuré :

| En-tête | Risque si absent |
|---------|-----------------|
| `Content-Security-Policy` | Exécution de scripts injectés (XSS) |
| `X-Frame-Options` | Clickjacking via iframe |
| `X-Content-Type-Options` | MIME-type sniffing |
| `Referrer-Policy` | Fuite de l'URL dans les requêtes externes (ex. fonts Google) |
| `Strict-Transport-Security` | Downgrade HTTP en production |

**Correction recommandée :** Ajouter un loader dans `root.tsx` qui retourne ces en-têtes, ou configurer un reverse proxy (Nginx) avec une section `add_header`.

---

#### H2 — Mots de passe par défaut `changeme` en production
**Fichier :** `docker-compose.prod.yml:22,32,34`  
**Risque :** Accès non autorisé à PostgreSQL et Redis si les variables d'environnement sont oubliées

```yaml
POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-changeme}
command: redis-server --requirepass ${REDIS_PASSWORD:-changeme}
```

Si le fichier `.env` n'est pas présent ou ne contient pas ces variables lors du déploiement, les deux bases de données démarrent avec le mot de passe `changeme`. Redis est exposé sur le réseau Docker interne, mais une mauvaise configuration réseau suffirait à l'exposer.

**Correction recommandée :** Supprimer les valeurs par défaut pour forcer un échec explicite au démarrage :
```yaml
POSTGRES_PASSWORD=${POSTGRES_PASSWORD:?Variable POSTGRES_PASSWORD non définie}
```

---

### 🟡 MOYENNE

#### M1 — IP Forwarding falsifiable (contournement du rate limiting)
**Fichier :** `app/routes/api.auth.$.ts:6-10`  
**Risque :** Bypass du rate limiting sur les routes `/sign-in` et `/sign-up`

```typescript
function getClientIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}
```

Un attaquant peut envoyer `X-Forwarded-For: 1.2.3.4` dans chaque requête pour simuler une IP différente et contourner la limite de 10 tentatives de connexion. Sans reverse proxy de confiance configuré en amont, cet en-tête est entièrement contrôlé par le client.

**Correction recommandée :** Si un reverse proxy Nginx est en place (ce qui est le cas avec le NAS Synology), ne lire l'IP que depuis `x-real-ip` (configuré par Nginx uniquement) ou valider que `x-forwarded-for` ne peut être surchargé côté client dans la config Nginx (`proxy_set_header X-Forwarded-For $remote_addr`).

---

#### M2 — Validation du type MIME basée sur la déclaration client uniquement
**Fichier :** `app/lib/server/upload.ts:13`  
**Risque :** Upload de fichiers avec un type déclaré valide mais un contenu malveillant

```typescript
if (!ALLOWED_TYPES.includes(file.type)) {
  throw new Error("Format non supporté. Utilisez JPEG, PNG ou WebP.");
}
```

`file.type` provient du formulaire et peut être forgé (`image/jpeg` sur un fichier `.php` ou `.html`). La recompression via `sharp` réduit fortement ce risque en pratique (un script PHP devient une image invalide), mais la validation d'entrée reste insuffisante selon les bonnes pratiques OWASP.

**Correction recommandée :** Vérifier les magic bytes avant le traitement Sharp :
```typescript
const buffer = Buffer.from(await file.arrayBuffer());
const magic = buffer.subarray(0, 4);
const isValidImage = 
  (magic[0] === 0xFF && magic[1] === 0xD8) || // JPEG
  (magic[0] === 0x89 && magic[1] === 0x50 && magic[2] === 0x4E && magic[3] === 0x47) || // PNG
  (magic[0] === 0x52 && magic[1] === 0x49 && magic[2] === 0x46 && magic[3] === 0x46); // WebP (RIFF)
if (!isValidImage) throw new Error("Fichier image invalide.");
```

---

#### M3 — `DATABASE_URL` utilisé hors du schéma de validation centralisé
**Fichier :** `app/db/client.ts:6`  
**Risque :** Démarrage silencieux sans variable critique, erreur tardive à l'exécution

```typescript
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL, // pas de validation Zod
});
```

Le fichier `env.server.ts` valide `DATABASE_URL` via Zod au démarrage, mais `db/client.ts` accède directement à `process.env`. Si le module DB est chargé avant `getEnv()`, l'absence de `DATABASE_URL` provoquera une erreur non explicite lors de la première requête SQL, et non au démarrage.

**Correction recommandée :**
```typescript
import { getEnv } from "~/config/env.server";
const env = getEnv();
const pool = new pg.Pool({ connectionString: env.DATABASE_URL });
```

---

### 🟢 FAIBLE

#### F1 — Cache `immutable` sur les avatars à nom de fichier constant
**Fichier :** `app/routes/uploads-files.ts:21-23`  
**Risque :** Les clients ne voient pas les mises à jour d'avatar pendant 1 an

```typescript
"Cache-Control": "public, max-age=31536000, immutable",
```

Les avatars sont stockés sous `uploads/avatars/{userId}.webp`. Le nom ne change pas lors d'une mise à jour. Avec `immutable`, les navigateurs ne re-téléchargeront jamais le fichier une fois en cache, même si l'utilisateur change son avatar.

**Correction recommandée :** Exclure les avatars du cache immutable ou ajouter un paramètre de version dans l'URL (ex. stocker un `avatarVersion` incrémenté en DB et l'inclure dans l'URL).

---

#### F2 — Endpoint `/api/health` exposé sans authentification
**Fichier :** `app/routes/api.health.ts`  
**Risque :** Divulgation d'informations sur l'état de l'infrastructure

L'endpoint expose l'état de PostgreSQL et Redis en clair (`{"status":"ok","services":{"db":"ok","redis":"ok"}}`). Un attaquant peut utiliser ces informations pour identifier les fenêtres de maintenance ou des états dégradés.

**Correction recommandée :** Restreindre l'accès par IP (Nginx) ou ajouter un token statique dans l'en-tête de la requête pour les outils de monitoring.

---

## 3. Synthèse

| ID | Criticité | Fichier | Corrigé ? |
|----|-----------|---------|-----------|
| C1 | 🔴 Critique | `app/routes/uploads-files.ts:5` | Non |
| H1 | 🟠 Haute | `app/root.tsx` (manquant) | Non |
| H2 | 🟠 Haute | `docker-compose.prod.yml:22,32,34` | Non |
| M1 | 🟡 Moyenne | `app/routes/api.auth.$.ts:6-10` | Non |
| M2 | 🟡 Moyenne | `app/lib/server/upload.ts:13` | Non |
| M3 | 🟡 Moyenne | `app/db/client.ts:6` | Non |
| F1 | 🟢 Faible | `app/routes/uploads-files.ts:21` | Non |
| F2 | 🟢 Faible | `app/routes/api.health.ts` | Non |

### Points positifs constatés
- Validation Zod systématique sur toutes les entrées utilisateur (inscription, profil, matchs, événements)
- `requireAuth` + vérification de rôle cohérente sur toutes les routes admin
- Rate limiting Redis sur login (10 req / 15 min) et inscription (5 req / heure)
- Protection auto-suppression de compte admin (un admin ne peut pas modifier/supprimer son propre rôle)
- Recompression des images via Sharp (mitige partiellement M2)
- Schéma de validation centralisé `env.server.ts` avec Zod
- Journalisation structurée avec pino sur toutes les actions sensibles
- Commit dédié `aed5841` : suppression des credentials du repo + renforcement `.gitignore`
