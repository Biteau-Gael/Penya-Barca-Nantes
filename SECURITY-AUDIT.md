# Audit de Sécurité — Penya Blaugrana Nantes

**Date :** 24 avril 2026  
**Branche analysée :** `main` (dernier commit : `003faca`)  
**Périmètre :** Codebase React Router v7 / Drizzle ORM / Better Auth / Docker

---

## Résumé des derniers commits

| Commit | Message | Fichiers modifiés |
|--------|---------|-------------------|
| `003faca` | fix: évaluer les badges immédiatement après chaque action | `feed.server.ts`, `match-detail.server.ts` |
| `b1c88f6` | feat: Phase 2 — soirée match live, micro-pronos, badges, séries, saisons | 26 fichiers (+2965 lignes) |
| `d461ee5` | Merge: guide déploiement Synology NAS | `DEPLOY.md` |
| `554b873` | docs: guide de mise à jour déploiement NAS | `DEPLOY.md` |
| `68e22d2` | feat: menu burger mobile pour la navigation | `header.tsx` |

---

## Analyse de Sécurité par Ordre de Criticité

---

### 🔴 CRITIQUE

#### C-1 — Path Traversal sur le serveur de fichiers uploads
**Fichier :** `app/routes/uploads-files.ts` — ligne 5  
**Commit introduisant le problème :** `fec3e63` (MVP Phase 1)

```typescript
// VULNÉRABLE
const filePath = path.join(process.cwd(), "uploads", params["*"]);
```

`path.join` normalise les séquences `../` sans restreindre le chemin résultant au répertoire `uploads`. Une requête vers `/uploads/../../etc/passwd` aboutit à la lecture de `/etc/passwd` sur le serveur.

**Correction recommandée :**
```typescript
const uploadsDir = path.join(process.cwd(), "uploads");
const filePath = path.resolve(uploadsDir, params["*"]);

// Bloquer tout chemin qui sort du répertoire uploads
if (!filePath.startsWith(uploadsDir + path.sep)) {
  return new Response("Forbidden", { status: 403 });
}
```

---

### 🟠 ÉLEVÉ

#### H-1 — Conteneur Docker exécuté en root
**Fichier :** `Dockerfile` — image finale (ligne 17)

Aucune directive `USER` n'est présente dans l'image de production. L'application s'exécute en tant que `root` dans le conteneur, amplifiant considérablement l'impact d'une compromission.

**Correction recommandée :** Ajouter avant `CMD` :
```dockerfile
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser
```

---

#### H-2 — Mots de passe par défaut en production
**Fichier :** `docker-compose.prod.yml` — lignes 22 et 32

```yaml
POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-changeme}
# redis-server --requirepass ${REDIS_PASSWORD:-changeme}
```

Si le fichier `.env` est absent ou incomplet au déploiement, PostgreSQL et Redis démarrent avec le mot de passe `changeme`. Ce risque est silencieux : aucune alerte au démarrage.

**Correction recommandée :** Supprimer les valeurs par défaut pour forcer l'échec explicite :
```yaml
POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?POSTGRES_PASSWORD doit être défini}
```

---

#### H-3 — Endpoint `/api/health` public sans authentification
**Fichier :** `app/routes/api.health.ts` — ligne 11

L'endpoint expose le statut interne de l'infrastructure (PostgreSQL, Redis) à tout visiteur non authentifié, fournissant des informations utiles à un attaquant en phase de reconnaissance.

**Correction recommandée :** Restreindre l'accès par IP (ex. réseau local NAS uniquement) ou ajouter un token secret dans l'en-tête de la requête.

---

#### H-4 — `trustedOrigins` vide si `APP_URL` non défini
**Fichier :** `app/lib/server/auth.server.ts` — ligne 12

```typescript
trustedOrigins: env.APP_URL ? [env.APP_URL] : [],
```

`APP_URL` est marqué `optional()` dans le schéma d'environnement. Si absent, `trustedOrigins` est un tableau vide. Selon le comportement de Better Auth avec une liste vide, cela pourrait accepter toutes les origines ou lever des erreurs silencieuses sur les requêtes cross-origin.

**Correction recommandée :** Rendre `APP_URL` obligatoire dans `env.server.ts` :
```typescript
APP_URL: z.string().url(),
```

---

### 🟡 MOYEN

#### M-0 — Absence de protection CSRF explicite
**Périmètre :** Toutes les routes d'action (`feed.server.ts`, `admin.*.server.ts`, etc.)

React Router v7 ne fournit pas de protection CSRF par défaut. Les actions de formulaire (POST) ne valident aucun token CSRF. Un site tiers peut déclencher des actions au nom d'un utilisateur connecté.

**Correction recommandée :** Intégrer une librairie comme `csrf-csrf` et valider un token dans chaque action serveur, ou s'assurer que Better Auth's `trustedOrigins` couvre ce cas.

---

#### M-1 — IP Spoofing possible sur le rate limiting
**Fichier :** `app/routes/api.auth.$.ts` — lignes 6–11

```typescript
request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
```

L'en-tête `X-Forwarded-For` est fourni par le client et peut être falsifié si le reverse proxy n'est pas configuré pour le remplacer (et non l'ajouter). Un attaquant peut contourner le rate limiting en changeant la valeur de cet en-tête à chaque requête.

**Correction recommandée :** Configurer le reverse proxy (nginx/Synology) pour écraser l'en-tête au lieu de le chaîner, et documenter cette dépendance.

---

#### M-2 — Validation du `pointsScheme` absente
**Fichier :** `app/routes/admin.matches.server.ts` — lignes 59 et 95

```typescript
const pointsScheme = (formData.get("pointsScheme") as string) || "standard";
```

La valeur est insérée en base sans valider qu'elle appartient à un ensemble de valeurs autorisées. Tout administrateur malveillant (ou session compromise) pourrait injecter une valeur arbitraire.

**Correction recommandée :**
```typescript
const VALID_SCHEMES = ["standard", "double", "triple"] as const;
const pointsScheme = VALID_SCHEMES.includes(raw as any) ? raw : "standard";
```

---

#### M-3 — Type cast `as any` sur le rôle utilisateur
**Fichier :** `app/routes/feed.server.ts` — lignes 99, 124, 184

```typescript
isAdmin: (session.user as any).role === "admin",
if (isAnnouncement && (session.user as any).role !== "admin") {
```

L'utilisation de `as any` contourne le typage TypeScript et masque d'éventuelles erreurs si la structure de session évolue. Le type `Session` de Better Auth ne semble pas exposer les champs additionnels (`role`) dans le type de base.

**Correction recommandée :** Étendre le type session pour inclure les champs additionnels :
```typescript
type AppUser = Session["user"] & { role: "member" | "admin" | "partner" };
const isAdmin = (session.user as AppUser).role === "admin";
```

---

#### M-4 — Absence de Content Security Policy (CSP)
**Périmètre :** Toute l'application

Aucun en-tête de sécurité HTTP (CSP, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`) n'est configuré. Cela expose l'application aux attaques XSS, clickjacking, et MIME sniffing.

**Correction recommandée :** Ajouter un middleware dans `entry.server.tsx` ou configurer nginx :
```nginx
add_header Content-Security-Policy "default-src 'self'; img-src 'self' data:; script-src 'self'" always;
add_header X-Frame-Options "DENY" always;
add_header X-Content-Type-Options "nosniff" always;
```

---

#### M-5 — Script `backup.sh` sans vérification d'erreurs
**Fichier :** `backup.sh` — ligne 11

Le script n'utilise pas `set -e` et ne vérifie pas le code de retour de `pg_dump`. En cas d'échec (Docker arrêté, base inaccessible), un fichier vide est créé sans alerte, donnant une fausse impression de sauvegarde réussie.

**Correction recommandée :**
```bash
set -euo pipefail

DUMP_FILE="$BACKUP_DIR/penya_$DATE.sql"
if ! docker compose -f ... exec -T postgres pg_dump -U penya penya_barca_nantes > "$DUMP_FILE"; then
  rm -f "$DUMP_FILE"
  echo "ERREUR : backup échoué" >&2
  exit 1
fi
```

---

### 🟢 FAIBLE

#### F-1 — Vérification du type MIME côté client (avatar upload)
**Fichier :** `app/lib/server/upload.ts` — ligne 13

```typescript
if (!ALLOWED_TYPES.includes(file.type)) {
```

`file.type` provient du navigateur (header `Content-Type` du multipart), non de l'analyse réelle du contenu binaire. Un attaquant peut envoyer un fichier malveillant en déclarant `image/jpeg`. En pratique, Sharp rejettera les fichiers non-images lors du traitement, ce qui limite le risque, mais la défense est implicite plutôt qu'explicite.

**Recommandation :** Utiliser une bibliothèque de détection de type par magic bytes (ex. `file-type`) en complément.

---

#### F-2 — `.gitignore` incomplet pour les fichiers sensibles
**Fichier :** `.gitignore`

Les extensions suivantes ne sont pas exclues : `*.log`, `*.pem`, `*.key`, `*.crt`, `.env.*` (variants de production). Un commit accidentel de ces fichiers exposerait des secrets.

**Correction recommandée :** Ajouter :
```
*.log
*.pem
*.key
*.crt
.env.*
!.env.example
```

---

#### F-0 — `JSON.parse` sans validation de schéma
**Fichiers :** `app/routes/soiree.server.ts` L.250 / `app/routes/match-detail.server.ts` L.83

```typescript
options: m.options ? JSON.parse(m.options) as string[] : [],
matchDetails = JSON.parse(match.matchDetails) as MatchDetails;
```

Le `as string[]` est une assertion de type TypeScript, pas une validation d'exécution. Si la colonne contient du JSON malformé ou une structure inattendue, le crash n'est pas intercepté et les données malformées peuvent se propager.

**Correction recommandée :** Wrapprer dans try-catch et valider avec Zod après parsing.

---

#### F-1b — Race condition sur les pronostics
**Fichier :** `app/routes/match-detail.server.ts`

Le pattern select-then-insert/update laisse une fenêtre de concurrence : deux requêtes simultanées peuvent toutes deux passer le check `existing === null` et créer un doublon.

**Correction recommandée :** Utiliser `INSERT ... ON CONFLICT DO UPDATE` (Upsert PostgreSQL natif via Drizzle).

---

#### F-1c — Suppression de compte sans soft delete ni période de grâce
**Fichier :** `app/routes/profile.server.ts` L.127–130

La suppression est immédiate et irréversible, sans confirmation par email, OTP ou période de grâce. Un clic accidentel ou une session volée suffit.

**Correction recommandée :** Implémenter un soft delete (`deletedAt`) avec une période de grâce de 7 à 30 jours et une confirmation par email.

---

#### F-3 — N+1 queries dans le feed loader
**Fichier :** `app/routes/feed.server.ts` — lignes 38–94

Pour chaque post récupéré (jusqu'à 50), 3 requêtes SQL supplémentaires sont exécutées (réactions, commentaires, réaction utilisateur). Avec 50 posts, cela génère potentiellement 151 requêtes par chargement de page — risque de déni de service non intentionnel sous charge.

**Recommandation :** Regrouper les requêtes avec des `GROUP BY` ou des sous-requêtes.

---

## Points Positifs Constatés

- **Authentification** : Better Auth correctement configuré avec sessions Redis, CSRF géré par le framework.
- **Rate limiting** : Implémenté et appliqué sur les routes login/register (`api.auth.$.ts`).
- **Validation des entrées** : Zod utilisé systématiquement pour les formulaires admin (matches, profil, posts).
- **ORM paramétré** : Drizzle ORM utilisé exclusivement — pas de requêtes SQL brutes, protection SQL injection native.
- **Contrôle d'accès** : `requireAuth(request, ["admin"])` utilisé sur toutes les routes admin.
- **Variables d'environnement** : Schéma Zod strict avec `AUTH_SECRET` min 16 chars (`env.server.ts`).
- **Suppression de credentials** : Commit `aed5841` documente la suppression de credentials du repo.
- **Protection auto-modification** : Un admin ne peut pas modifier son propre rôle (`admin.members.server.ts` L.51).

---

## Récapitulatif des Actions Prioritaires

| Priorité | ID | Action | Effort |
|----------|----|--------|--------|
| 🔴 1 | C-1 | Corriger le path traversal sur `uploads-files.ts` | 30 min |
| 🟠 2 | H-1 | Ajouter `USER appuser` dans le Dockerfile | 15 min |
| 🟠 3 | H-2 | Supprimer les valeurs par défaut `changeme` en prod | 10 min |
| 🟠 4 | H-4 | Rendre `APP_URL` obligatoire | 10 min |
| 🟠 5 | H-3 | Protéger `/api/health` | 1h |
| 🟡 6 | M-0 | Évaluer la protection CSRF (Better Auth + formulaires) | 2h |
| 🟡 7 | M-4 | Ajouter les en-têtes HTTP de sécurité (CSP, HSTS, X-Frame) | 2h |
| 🟡 8 | M-5 | Robustifier `backup.sh` avec `set -e` et gestion d'erreur | 30 min |
| 🟡 9 | M-1 | Documenter la dépendance reverse proxy pour rate limiting | 1h |
| 🟡 10 | M-2 | Valider `pointsScheme` contre un enum | 15 min |
| 🟢 11 | F-0 | Wrapper `JSON.parse` avec try-catch + validation Zod | 1h |
| 🟢 12 | F-1b | Upsert PostgreSQL pour éliminer la race condition | 1h |
| 🟢 13 | F-1c | Soft delete + confirmation par email sur suppression de compte | 3h |
| 🟢 14 | F-2 | Compléter `.gitignore` (logs, certs, env variants) | 10 min |
| 🟢 15 | F-1 | Ajouter détection magic bytes sur l'upload avatar | 2h |
