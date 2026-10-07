# Rapport d'Audit de Sécurité — Penya Blaugrana Nantes

**Date :** 2026-10-07  
**Branche analysée :** `main`  
**Dernier commit :** `003faca` — *fix: évaluer les badges immédiatement après chaque action*

---

## Résumé des derniers commits

| Commit | Message | Impact sécurité |
|--------|---------|----------------|
| `003faca` | fix: évaluer les badges après chaque action | Aucun |
| `b1c88f6` | feat: Phase 2 — soirée match live, micro-pronos, badges, séries, saisons | Nouveau périmètre audité |
| `d461ee5` | Merge branch deploy Synology NAS | Déploiement production |
| `554b873` | Add deployment guide | Documentation |
| `68e22d2` | feat: menu burger mobile | Frontend seulement |
| `6aebaf7` | Fix Better Auth trusted origins | Sécurité auth |
| `9823bc5` | Add migrate service docker-compose | Infrastructure |
| `8d6e5e9` | Add production Docker Compose + backup | Infrastructure production |
| `aed5841` | security: supprimer credentials du repo | Sécurité — historique à vérifier |

---

## Analyse de sécurité — Résultats par criticité

### 🔴 CRITIQUE

*Aucun problème critique détecté.*

---

### 🟠 ÉLEVÉ

#### H-01 — Path Traversal dans le serveur de fichiers statiques

**Fichier :** `app/routes/uploads-files.ts` (ligne 5)  
**Description :** Le chemin du fichier est construit avec `path.join` depuis le paramètre URL sans vérification des limites :
```typescript
const filePath = path.join(process.cwd(), "uploads", params["*"]);
```
`path.join` normalise les segments `..` mais ne bloque pas la traversée. Une requête vers `/uploads-files/../../etc/passwd` résout `filePath` en `/etc/passwd` et retourne le contenu du fichier.  
**Risque :** Lecture arbitraire de fichiers système (credentials, config, clés privées).  
**Correction requise :**
```typescript
const uploadsDir = path.join(process.cwd(), "uploads");
const filePath = path.join(uploadsDir, params["*"]);

// Vérification obligatoire après résolution
if (!filePath.startsWith(uploadsDir + path.sep)) {
  return new Response("Not found", { status: 404 });
}
```

---

#### H-02 — Suppression de compte sans invalidation de session

**Fichier :** `app/routes/profile.server.ts` (intent `delete-account`)  
**Description :** Lorsqu'un utilisateur supprime son compte, seul l'enregistrement en base est supprimé. La session Redis (stockée via `secondaryStorage` dans Better Auth) reste valide jusqu'à son expiration naturelle :
```typescript
await db.delete(user).where(eq(user.id, session.user.id));
// → session Redis toujours active
```
**Risque :** Un compte supprimé peut continuer à effectuer des actions authentifiées (poster, voter, accéder aux données).  
**Correction requise :** Appeler la révocation de session Better Auth avant la redirection :
```typescript
await auth.api.revokeAllSessions({ headers: request.headers });
await db.delete(user).where(eq(user.id, session.user.id));
```

---

#### H-03 — `trustedOrigins` vide si `APP_URL` non configuré

**Fichier :** `app/lib/server/auth.server.ts` (ligne 12)  
**Description :** `APP_URL` est optionnel dans le schéma Zod, ce qui donne :
```typescript
trustedOrigins: env.APP_URL ? [env.APP_URL] : [],
```
Un tableau vide peut désactiver ou affaiblir la vérification CSRF de Better Auth selon la version utilisée.  
**Risque :** Absence de protection CSRF sur les endpoints d'authentification.  
**Correction requise :** Rendre `APP_URL` obligatoire dans `env.server.ts` :
```typescript
APP_URL: z.string().url(), // supprimer .optional()
```

---

#### H-04 — Absence de headers de sécurité HTTP

**Fichier :** Aucune configuration détectée  
**Description :** Aucun header de sécurité n'est configuré malgré leur mention dans l'architecture (`_bmad-output/planning-artifacts/architecture.md`). L'application rend des URLs d'images externes (Fotmob, RapidAPI) et des liens vidéo issus de l'API tierce.  
**Headers manquants :**
- `Content-Security-Policy` (protection XSS, contrôle des sources externes)
- `X-Frame-Options: DENY` (protection clickjacking)
- `Strict-Transport-Security` (forcer HTTPS)
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy`

**Correction requise :** Ajouter un middleware dans `entry.server.tsx` ou au niveau du reverse proxy Synology.

---

### 🟡 MOYEN

#### M-01 — Mots de passe par défaut dans docker-compose.prod.yml

**Fichier :** `docker-compose.prod.yml` (lignes PostgreSQL et Redis)  
**Description :** Fallback `changeme` si les variables d'env ne sont pas définies :
```yaml
POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-changeme}
redis-server --requirepass ${REDIS_PASSWORD:-changeme}
```
Le `.env.example` montre ces variables commentées — tout déploiement basé sur l'exemple sans décommenter démarre avec des credentials triviaux.  
**Correction requise :** Forcer une erreur au démarrage si absent :
```yaml
POSTGRES_PASSWORD=${POSTGRES_PASSWORD:?POSTGRES_PASSWORD must be set}
```

---

#### M-02 — Client Redis bypass la validation Zod avec fallback non authentifié

**Fichier :** `app/lib/server/redis.server.ts` (ligne 3)  
**Description :** Lecture directe de `process.env` au lieu de `getEnv()` :
```typescript
export const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379", {
```
Si `REDIS_URL` est absent, Redis se connecte sans authentification sur localhost — et le schéma Zod n'est pas appliqué.  
**Correction requise :**
```typescript
import { getEnv } from "~/config/env.server";
export const redis = new Redis(getEnv().REDIS_URL, { ... });
```

---

#### M-03 — `DATABASE_URL` sans validation Zod

**Fichier :** `app/db/client.ts` (ligne 6)  
**Description :**
```typescript
connectionString: process.env.DATABASE_URL, // undefined possible
```
En cas d'absence, le pool pg démarre avec `undefined` et produit des erreurs cryptiques à la première requête plutôt qu'un échec clair au démarrage.  
**Correction requise :**
```typescript
import { getEnv } from "~/config/env.server";
connectionString: getEnv().DATABASE_URL,
```

---

#### M-04 — Absence de validation sur le champ `answer` des micro-pronos

**Fichier :** `app/routes/api.micro-predictions.ts` (lignes 92-93)  
**Description :** Seule une vérification de présence est effectuée — aucune limite de longueur, aucune validation contre les options valides pour les QCM :
```typescript
const answer = formData.get("answer") as string;
if (!microId || !answer) { ... }
// Stocké directement en base sans autre validation
```
**Correction requise :** Valider que la réponse appartient aux options du micro-pronostic (pour le type `qcm`) et limiter la longueur.

---

#### M-05 — `highlightUrl` externe rendu sans validation du schéma

**Fichier :** `app/routes/match-detail.tsx` (ligne 314)  
**Description :**
```tsx
href={matchDetails.highlightUrl}  // valeur venant de l'API externe
```
Aucune vérification que l'URL commence par `https://`. Une réponse API compromise pourrait injecter une URL `javascript:` ou `data:`. React >= 18 bloque partiellement `javascript:`, mais ce n'est pas une protection fiable.  
**Correction requise (côté serveur) :**
```typescript
const safeHighlightUrl = highlightUrl?.startsWith("https://") ? highlightUrl : null;
```

---

#### M-06 — Sauvegardes PostgreSQL non chiffrées

**Fichier :** `backup.sh` (ligne 13)  
**Description :** Les dumps complets (emails, hashs de mots de passe, sessions, données personnelles) sont stockés en texte clair sur le NAS sans permissions restrictives :
```bash
mkdir -p "$BACKUP_DIR"  # permissions par défaut
> "$BACKUP_DIR/penya_$DATE.sql"  # non chiffré
```
**Correction requise :**
```bash
mkdir -p "$BACKUP_DIR" && chmod 700 "$BACKUP_DIR"
# Chiffrer avec GPG ou openssl
```

---

#### M-07 — IP Spoofing possible sur le rate limiting

**Fichier :** `app/routes/api.auth.$.ts` (ligne 7)  
**Description :** L'IP est lue depuis `X-Forwarded-For` sans valider que la requête vient d'un proxy de confiance. Un attaquant sans proxy peut forger ce header.  
**Risque :** Contournement du brute-force protection sur le login.  
**Action :** Vérifier que le port 3000 est inaccessible directement depuis l'extérieur (Synology DSM reverse proxy comme unique point d'entrée).

---

### 🔵 FAIBLE

#### F-01 — Script de backup sans vérification d'erreur

**Fichier :** `backup.sh`  
**Description :** Aucune vérification du code retour de `pg_dump`. Un fichier vide ou corrompu est conservé silencieusement.  
**Correction :** Ajouter `set -e` ou vérifier explicitement le code retour.

---

#### F-02 — Conteneur Docker s'exécute en root

**Fichier :** `Dockerfile`  
**Description :** Aucun utilisateur non-root défini dans l'image finale. Le processus Node.js tourne en `root` dans le conteneur.  
**Correction :**
```dockerfile
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser
```

---

#### F-03 — Absence de rate limiting sur les endpoints de mutation

**Fichier :** Plusieurs routes  
**Description :** Seul `/api/auth` a un rate limiting. Les endpoints suivants n'ont aucune protection :
- `/api/micro-predictions`
- `/api/welcome-dismiss`
- `/api/sync-matches`
- `soiree.server.ts` loader (appels API externes répétés)

**Correction :** Appliquer `checkRateLimit` (existant) sur les endpoints de mutation authentifiés.

---

#### F-04 — Cache standings en mémoire sans expiration

**Fichier :** `app/routes/liga-standings.server.ts`  
**Description :** Variable module-level sans TTL — en cas de réponse API corrompue, les données erronées sont cachées indéfiniment.  
**Correction :** Déplacer vers Redis avec un TTL de 5-10 minutes.

---

## Résumé des bonnes pratiques confirmées

| Point | Détail |
|-------|--------|
| Validation des variables d'env (partielle) | Schéma Zod dans `env.server.ts` avec `AUTH_SECRET` min 16 chars |
| Pas de secrets hardcodés | `.env` exclu du dépôt, `.env.example` sans vraies valeurs |
| ORM Drizzle partout | Pas de SQL brut — pas d'injection SQL possible |
| Authentification sur toutes les routes | `requireAuth()` systématiquement utilisé |
| Contrôle des rôles admin | Vérification `session.user.role === "admin"` avant actions privilégiées |
| Rate limiting sur l'auth | Login : 10/15 min, inscription : 5/heure |
| Validation inputs utilisateur | Schémas Zod dans `app/lib/validation/feed.ts` |
| Autorisation propriétaire sur suppression | Vérification `authorId === userId` avant delete |
| Sessions Redis (secondaryStorage) | Pas de sessions JWT côté client |
| `rel="noopener noreferrer"` sur liens externes | Présent sur `highlightUrl` |

---

## Priorité des actions correctives

| Priorité | ID | Action | Effort |
|----------|-----|--------|--------|
| 1 | **H-01** | Fixer path traversal dans `uploads-files.ts` | Faible |
| 2 | **H-02** | Invalider session à la suppression de compte | Faible |
| 3 | **H-03** | Rendre `APP_URL` obligatoire dans Zod | Faible |
| 4 | **M-01** | Supprimer fallback `changeme` dans docker-compose | Faible |
| 5 | **M-02** | Redis client via `getEnv()` | Faible |
| 6 | **M-03** | Database client via `getEnv()` | Faible |
| 7 | **H-04** | Ajouter security headers HTTP | Moyen |
| 8 | **M-05** | Valider schéma `highlightUrl` côté serveur | Faible |
| 9 | **M-04** | Valider longueur/options sur `answer` | Faible |
| 10 | **F-01** | Vérification d'erreur dans `backup.sh` | Faible |
| 11 | **F-02** | Utilisateur non-root dans Dockerfile | Faible |
| 12 | **M-06** | Chiffrement des backups PostgreSQL | Moyen |
| 13 | **F-03** | Rate limiting sur endpoints de mutation | Moyen |

---

*Rapport généré le 2026-10-07 — Analyse combinée automatisée sur branche `main`*
