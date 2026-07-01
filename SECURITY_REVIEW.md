# Revue de sécurité — Penya Blaugrana Nantes

**Date :** 2026-07-01  
**Branche analysée :** `main` (commits jusqu'au `003faca`)  
**Scope :** Application React Router / Node.js + infrastructure Docker (Synology NAS)

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
| `9823bc5` | 2026-04-12 | Claude | Add migrate service to docker-compose.prod.yml for database migrations |
| `8d6e5e9` | 2026-04-12 | Claude | Add production Docker Compose and backup script for Synology NAS deployment |
| `3d80133` | avant | Biteau Gaël | docs: roadmap Phase 2 documentée |
| `aed5841` | avant | Biteau Gaël | security: supprimer credentials du repo et renforcer .gitignore |

---

## Analyse de sécurité par ordre de criticité

---

### 🔴 CRITIQUE

#### 1. Path Traversal dans le loader de fichiers uploadés

**Fichier :** `app/routes/uploads-files.ts` — ligne 5  
**Impact :** Lecture arbitraire de fichiers sur le serveur (`.env`, `/etc/passwd`, clés SSH, etc.)

```ts
// Code actuel — VULNÉRABLE
const filePath = path.join(process.cwd(), "uploads", params["*"]);
```

`params["*"]` contient directement le chemin fourni par l'URL. Aucune vérification n'est effectuée pour s'assurer que le chemin résultant reste dans le dossier `uploads/`. Un attaquant peut envoyer une requête vers :

```
GET /uploads/../.env
GET /uploads/../../etc/passwd
```

`path.join` normalise les `..`, ce qui permet de sortir du répertoire `uploads`.

**Correction recommandée :**

```ts
import path from "node:path";
import { readFile } from "node:fs/promises";

const UPLOADS_ROOT = path.join(process.cwd(), "uploads");

export async function loader({ params }: { params: { "*": string } }) {
  const requestedPath = path.join(UPLOADS_ROOT, params["*"]);

  // Vérifier que le chemin résolu reste dans UPLOADS_ROOT
  if (!requestedPath.startsWith(UPLOADS_ROOT + path.sep)) {
    return new Response("Forbidden", { status: 403 });
  }

  try {
    const file = await readFile(requestedPath);
    // ... reste inchangé
  }
}
```

---

### 🟠 HAUTE

#### 2. IDOR — Exposition non contrôlée des pronostics d'autres membres

**Fichier :** `app/routes/member-profile.server.ts` — lignes 7-18  
**Impact :** Tout utilisateur authentifié peut consulter l'historique complet de pronostics de n'importe quel autre membre via `/membres/{memberId}`.

```ts
export async function memberProfileLoader({ request, params }) {
  await requireAuth(request);  // Seule vérification : être connecté
  // → Aucune vérification que l'utilisateur peut voir ce profil
  const [member] = await db.select().from(user).where(eq(user.id, params.memberId));
```

L'attaquant peut énumérer des `memberId` pour récupérer les statistiques et pronostics de tous les membres (attaque IDOR).

**Correction recommandée :**  
Soit implémenter un contrôle d'accès (seul l'utilisateur voit son propre profil complet), soit ajouter un paramètre de confidentialité opt-in pour rendre le profil public. À minima, vérifier que le `memberId` est un ID valide et non une tentative d'énumération.

---

#### 3. Absence de rate limiting sur les actions du feed et des pronostics

**Fichiers :** `app/routes/feed.server.ts`, `app/routes/match-detail.server.ts`  
**Impact :** Un attaquant peut spammer le feed avec des centaines de posts/commentaires ou soumettre des milliers de pronostics, saturant la base de données (DoS applicatif).

```ts
// feed.server.ts — aucune vérification de débit sur create-post, comment, react
if (intent === "create-post") {
  await db.insert(feedPosts).values({ ... });
```

Le rate limiting existant ne couvre que l'authentification (`api.auth.$.ts`). Toutes les autres mutations sont illimitées.

**Correction recommandée :**

```ts
await checkRateLimit({ key: `post:${session.user.id}`, maxAttempts: 3, windowSeconds: 60 });
await checkRateLimit({ key: `comment:${session.user.id}`, maxAttempts: 10, windowSeconds: 60 });
```

---

#### 4. Escalade de privilèges admin sans hiérarchie

**Fichier :** `app/routes/admin.members.server.ts` — lignes 55-64  
**Impact :** Tout admin peut promouvoir n'importe quel utilisateur en admin sans validation ni audit. En cas de compromission d'un compte admin, l'attaquant peut créer d'autres comptes admin.

```ts
if (intent === "change-role") {
  const newRole = formData.get("role") as string;
  if (!["member", "admin", "partner"].includes(newRole)) {
    return { error: "Rôle invalide." };
  }
  await db.update(user).set({ role: newRole }).where(eq(user.id, memberId));
```

**Correction recommandée :**  
Introduire un rôle `super-admin` qui seul peut créer/modifier des admins. Ou à minima, loguer l'événement de promotion admin dans une table d'audit dédiée avec le contexte complet.

---

#### 5. Contournement du rate limiting par usurpation d'IP (IP spoofing)

**Fichier :** `app/routes/api.auth.$.ts` — lignes 5-10  
**Impact :** Brute force sur les mots de passe sans limitation effective

```ts
function getClientIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}
```

Le rate limiting se base sur `x-forwarded-for`, un en-tête HTTP que **n'importe quel client peut falsifier**. Sans un reverse proxy qui remplace ou valide cet en-tête (Nginx avec `set_real_ip_from`), un attaquant peut contourner le blocage à 10 tentatives en changeant sa valeur à chaque requête.

**Correction recommandée :**  
Configurer Nginx pour fixer l'IP réelle (`$remote_addr`) avant de transmettre au container, et ignorer `x-forwarded-for` venant de l'extérieur. Côté app : ne jamais faire confiance à cet en-tête non validé pour les décisions de sécurité.

---

#### 6. Mots de passe par défaut Docker (fallback "changeme")

**Fichier :** `docker-compose.prod.yml` — lignes 23, 32

```yaml
POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-changeme}
redis-server --requirepass ${REDIS_PASSWORD:-changeme}
```

Si le fichier `.env` n'est pas présent ou ne définit pas ces variables, les services démarrent avec le mot de passe `changeme`. Les services PostgreSQL et Redis exposés sur le réseau Docker seraient compromis immédiatement.

**Correction recommandée :**  
Supprimer les valeurs par défaut (`:-changeme`) pour forcer une erreur explicite si la variable n'est pas définie. Documenter l'obligation de configurer `.env` avant tout déploiement.

```yaml
POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?POSTGRES_PASSWORD must be set}
```

---

#### 7. Absence de headers de sécurité HTTP

**Fichier :** Aucune configuration de headers dans `app/root.tsx`, `Dockerfile` ou configuration Nginx.  
**Impact :** Expositions multiples (clickjacking, MIME sniffing, injection de contenu, etc.)

Les headers suivants sont absents :

| Header | Protection |
|--------|-----------|
| `Content-Security-Policy` | XSS, injection de ressources |
| `X-Frame-Options: DENY` | Clickjacking |
| `X-Content-Type-Options: nosniff` | MIME sniffing |
| `Strict-Transport-Security` | Downgrade HTTPS → HTTP |
| `Referrer-Policy` | Fuite d'URL via Referer |
| `Permissions-Policy` | Accès webcam/micro/géoloc |

**Correction recommandée :**  
Ajouter ces headers dans la configuration Nginx en production, ou via un middleware React Router dans `root.tsx` :

```ts
// Dans root.tsx loader ou via Nginx
headers: {
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Content-Security-Policy": "default-src 'self'; font-src 'self' https://fonts.gstatic.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
}
```

---

### 🟡 MOYENNE

#### 5. Container Docker tournant en root

**Fichier :** `Dockerfile` (toutes les étapes)  
**Impact :** En cas de compromission de l'application, l'attaquant dispose des droits root dans le container.

Le `Dockerfile` ne crée pas d'utilisateur non-root et ne contient pas d'instruction `USER`.

**Correction recommandée :**

```dockerfile
# Ajouter avant CMD dans l'image finale
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser
```

---

#### 6. `trustedOrigins` potentiellement vide selon configuration

**Fichier :** `app/lib/server/auth.server.ts` — ligne 12  
**Impact :** Protection CSRF de Better Auth dépend d'`APP_URL` qui est optionnelle.

```ts
trustedOrigins: env.APP_URL ? [env.APP_URL] : [],
```

Si `APP_URL` n'est pas défini en production, `trustedOrigins` est un tableau vide. Le comportement de Better Auth avec une liste vide doit être vérifié : selon les versions, cela peut désactiver la vérification d'origine ou bloquer toutes les requêtes cross-origin.

**Correction recommandée :**  
Rendre `APP_URL` obligatoire dans `env.server.ts` en production :

```ts
APP_URL: z.string().url().optional(), // ou .min(1) en production
```

Et documenter dans `.env.example` que cette variable est **requise en production**.

---

#### 7. Endpoint `/api/health` accessible sans authentification

**Fichier :** `app/routes/api.health.ts`  
**Impact :** Divulgation d'informations d'infrastructure (état PostgreSQL, Redis) à des tiers non authentifiés.

Ce comportement est courant pour les load balancers, mais dans le contexte d'un NAS Synology exposé potentiellement sur Internet, cela confirme les technologies utilisées à un attaquant.

**Correction recommandée :**  
Soit protéger l'endpoint par un token secret dans l'en-tête (`Authorization: Bearer <secret>`), soit restreindre l'accès via Nginx à un IP range interne uniquement.

---

#### 8. Suppression de compte sans suppression des données liées (RGPD)

**Fichier :** `app/routes/profile.server.ts` — ligne 128  
**Impact :** Non-conformité potentielle RGPD — droit à l'effacement (Art. 17 RGPD)

```ts
if (intent === "delete-account") {
  await db.delete(user).where(eq(user.id, session.user.id));
  // Les posts, commentaires, pronostics, réactions, badges restent en base
```

La suppression ne purge que la table `user`. Les données liées (posts, commentaires, pronostics, réactions, badges, micro-pronos) restent orphelines en base.

**Correction recommandée :**  
Implémenter une suppression en cascade (soit via contraintes FK `ON DELETE CASCADE`, soit en supprimant explicitement toutes les tables liées avant de supprimer l'utilisateur).

---

### 🟢 FAIBLE

#### 9. `.gitignore` incomplet pour les variantes de fichiers `.env`

**Fichier :** `.gitignore` — ligne 2

```
.env        ← seul pattern présent
```

Les variantes suivantes ne sont pas couvertes et pourraient être committées accidentellement :

- `.env.local`
- `.env.production`
- `.env.development.local`
- `.env.production.local`

**Correction recommandée :**

```gitignore
.env
.env.*
!.env.example
```

---

#### 10. Validation du type MIME basée sur le Content-Type client

**Fichier :** `app/lib/server/upload.ts` — ligne 13  
**Impact :** Faible — `sharp` valide réellement les données image en aval

```ts
if (!ALLOWED_TYPES.includes(file.type)) {  // file.type = Content-Type déclaré par le client
```

`file.type` provient du navigateur (non fiable). Cependant, le traitement par `sharp` constitue une validation technique forte car `sharp` échouera si les octets ne correspondent pas à une image valide. Le risque résiduel est limité.

**Correction recommandée (optionnel) :**  
Utiliser un package comme `file-type` pour détecter le type MIME par magic bytes après lecture du buffer, avant de passer à sharp.

---

### ℹ️ INFO

#### 11. Logging structuré bien configuré

`pino` est correctement utilisé avec niveaux configurables (`LOG_LEVEL`). Les logs ne contiennent pas de données sensibles excessives (pas de mots de passe, pas de tokens). Le transport `pino-pretty` est correctement limité au développement.

#### 12. Validation des entrées cohérente avec Zod

Les schémas de validation (pseudo, email, mot de passe, contenu) sont centralisés dans `app/lib/validation/` et appliqués côté serveur. La politique de mot de passe (min 8 chars, majuscule + minuscule + chiffre) est correcte.

#### 13. Contrôles d'autorisation corrects sur les routes admin

Toutes les routes admin vérifient `requireAuth(request, ["admin"])`. La protection contre l'auto-modification de rôle est présente (`admin.members.server.ts` ligne 51). Les vérifications d'appartenance sont faites avant toute suppression de post/commentaire.

---

## Tableau récapitulatif

| # | Criticité | Fichier | Description | Effort correction |
|---|-----------|---------|-------------|------------------|
| 1 | 🔴 CRITIQUE | `uploads-files.ts:5` | Path traversal — lecture de fichiers arbitraires | Faible (5 lignes) |
| 2 | 🟠 HAUTE | `member-profile.server.ts:7` | IDOR — pronostics de tous les membres accessibles | Moyen |
| 3 | 🟠 HAUTE | `feed.server.ts`, `match-detail.server.ts` | Absence de rate limiting sur feed et pronostics | Moyen |
| 4 | 🟠 HAUTE | `admin.members.server.ts:55` | Escalade de privilèges admin sans hiérarchie | Moyen |
| 5 | 🟠 HAUTE | `api.auth.$.ts:5-10` | IP spoofing contourne le rate limiting login | Moyen (config Nginx) |
| 6 | 🟠 HAUTE | `docker-compose.prod.yml:23,32` | Mots de passe par défaut "changeme" | Faible (1 ligne) |
| 7 | 🟠 HAUTE | Aucun fichier | Absence totale de headers de sécurité HTTP | Moyen |
| 8 | 🟡 MOYENNE | `Dockerfile` | Container tournant en root | Faible (2 lignes) |
| 9 | 🟡 MOYENNE | `auth.server.ts:12` | trustedOrigins vide si APP_URL absent | Faible |
| 10 | 🟡 MOYENNE | `api.health.ts` | Health endpoint public expose l'infra | Faible |
| 11 | 🟡 MOYENNE | `profile.server.ts:128` | Delete account sans purge des données liées (RGPD) | Moyen |
| 12 | 🟢 FAIBLE | `.gitignore:2` | Variantes `.env.*` non ignorées | Trivial |
| 13 | 🟢 FAIBLE | `upload.ts:13` | Validation MIME côté client (atténuée par sharp) | Faible |

---

## Priorités de correction recommandées

1. **Immédiat (avant prochain déploiement) :**
   - Corriger le path traversal (#1) — 5 lignes, risque critique
   - Supprimer les mots de passe par défaut Docker (#6) — 1 ligne

2. **Court terme :**
   - Ajouter du rate limiting sur le feed et les pronostics (#3)
   - Ajouter les headers de sécurité HTTP (#7) via Nginx ou middleware
   - Corriger l'IDOR sur les profils membres (#2)

3. **Moyen terme :**
   - Configurer l'IP réelle au niveau Nginx pour le rate limiting (#5)
   - Introduire une hiérarchie admin / super-admin (#4)
   - Passer le container Docker en non-root (#8)
   - Implémenter la purge RGPD à la suppression de compte (#11)

4. **Maintenance :**
   - Compléter `.gitignore` (#12)
   - Rendre `APP_URL` obligatoire en production (#9)
   - Protéger `/api/health` (#10)
