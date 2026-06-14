# Audit de sécurité — Penya Blaugrana Nantes

**Date :** 2026-06-14  
**Branche analysée :** `claude/sharp-fermi-ajs4lp`  
**Dernier commit :** `003faca` — fix: évaluer les badges immédiatement après chaque action

---

## Résumé des derniers commits

| Commit | Date | Description |
|--------|------|-------------|
| `003faca` | 13 avr. 2026 | **fix:** Évaluation des badges déclenchée après chaque action (pronostic, post, commentaire, réaction) |
| `b1c88f6` | 13 avr. 2026 | **feat:** Phase 2 — soirée match live, micro-pronos, badges, séries, saisons (26 fichiers modifiés, +2965 lignes) |
| `d461ee5` | 12 avr. 2026 | Merge de la branche de déploiement Synology NAS |
| `554b873` | 12 avr. 2026 | **docs:** Guide de déploiement NAS Synology avec commandes de mise à jour |
| `68e22d2` | 12 avr. 2026 | **feat:** Menu burger mobile pour la navigation |

La Phase 2 constitue le cœur des modifications récentes : elle introduit des routes critiques (`/soiree/:matchId`, `/badges`, micro-pronostics via `/api/micro-predictions`) ainsi que de nouveaux schémas de base de données (6 nouvelles tables).

---

## Analyse de sécurité — Résultats par ordre de criticité

---

### 🔴 HAUTE — Path Traversal (Lecture de fichiers arbitraires)

**Fichier :** `app/routes/uploads-files.ts:5`

```ts
const filePath = path.join(process.cwd(), "uploads", params["*"]);
```

**Problème :** Le paramètre wildcard `params["*"]` (extrait directement de l'URL) est concaténé dans le chemin fichier sans validation. `path.join` résout les séquences `../`, ce qui permet à un attaquant de remonter l'arborescence :

```
GET /uploads/../../etc/passwd
```

Il n'existe aucune vérification que le chemin résolu reste dans le répertoire `uploads/`.

**Correction recommandée :**

```ts
const filePath = path.resolve(process.cwd(), "uploads", params["*"]);
const uploadsDir = path.resolve(process.cwd(), "uploads");
if (!filePath.startsWith(uploadsDir + path.sep)) {
  return new Response("Forbidden", { status: 403 });
}
```

---

### 🔴 HAUTE — `trustedOrigins` vide si `APP_URL` non défini

**Fichier :** `app/lib/server/auth.server.ts:12`

```ts
trustedOrigins: env.APP_URL ? [env.APP_URL] : [],
```

**Problème :** Si la variable d'environnement `APP_URL` n'est pas définie (ce qui n'est pas obligatoire selon `env.server.ts`), `trustedOrigins` vaut `[]`. Selon le comportement de Better Auth avec un tableau vide, cela peut désactiver la protection CORS/CSRF et autoriser des requêtes cross-origin arbitraires. Le `.env.example` ne documente pas `APP_URL`.

**Correction recommandée :** Rendre `APP_URL` obligatoire en production, ou définir une valeur par défaut sécurisée :

```ts
// app/config/env.server.ts
APP_URL: z.string().url().optional(),
```

Et ajouter dans `.env.example` :
```
APP_URL=https://votre-domaine.fr
```

---

### 🟠 MOYENNE — Contournement du délai des micro-pronostics

**Fichier :** `app/routes/api.micro-predictions.ts:90-131`

**Problème :** Lors d'une réponse à un micro-pronostic (`intent === "answer"`), le serveur vérifie uniquement si `micro.closedAt` est défini (clôture manuelle par un admin). Il ne vérifie **pas** que le délai (`deadlineSeconds` depuis `createdAt`) est encore actif. Un utilisateur peut contourner le compte à rebours côté client et soumettre une réponse après expiration.

```ts
// Vérification actuelle (insuffisante)
if (!micro || micro.closedAt) {
  return Response.json({ error: "Micro-pronostic fermé" }, { status: 400 });
}
```

**Correction recommandée :**

```ts
const deadline = new Date(micro.createdAt.getTime() + micro.deadlineSeconds * 1000);
if (new Date() > deadline) {
  return Response.json({ error: "Délai expiré" }, { status: 400 });
}
```

---

### 🟠 MOYENNE — Spoofing d'IP possible dans le rate limiting

**Fichier :** `app/routes/api.auth.$.ts:5-10`

```ts
function getClientIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}
```

**Problème :** Si le serveur n'est pas derrière un reverse proxy de confiance, un attaquant peut envoyer un header `X-Forwarded-For: 1.2.3.4` arbitraire pour contourner le rate limiting par IP (10 tentatives de connexion / 15 min).

**Correction recommandée :** Documenter explicitement que ce code suppose un reverse proxy (Nginx/Traefik) configuré pour écraser `X-Forwarded-For`. Si le déploiement Synology NAS n'utilise pas de proxy, retomber sur la socket IP réelle. Ajouter une vérification de l'environnement de production.

---

### 🟠 MOYENNE — Champ `answer` des micro-pronos non validé

**Fichier :** `app/routes/api.micro-predictions.ts:91-93`

```ts
const answer = formData.get("answer") as string;
if (!microId || !answer) { ... }
```

**Problème :** La réponse soumise par l'utilisateur n'est soumise à aucune validation de longueur ou de contenu. Un utilisateur peut soumettre une chaîne arbitrairement longue, ce qui peut causer des problèmes de stockage ou de performance (notamment dans les comparaisons de clôture).

**Correction recommandée :** Limiter la longueur de la réponse (ex. 200 caractères) et, pour les micro-pronos de type `qcm`, vérifier que `answer` fait partie des options valides stockées dans `micro.options`.

---

### 🟡 FAIBLE — Mots de passe par défaut dans docker-compose.prod.yml

**Fichier :** `docker-compose.prod.yml:22,32`

```yaml
POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-changeme}
command: redis-server --requirepass ${REDIS_PASSWORD:-changeme}
```

**Problème :** Si `POSTGRES_PASSWORD` ou `REDIS_PASSWORD` ne sont pas définies dans `.env`, les services démarrent avec le mot de passe `changeme`. Le `.env.example` documente ces variables mais les laisse commentées.

**Correction recommandée :** Supprimer les valeurs par défaut (`:-changeme`) pour forcer l'obligation de définir ces variables, ou faire échouer le démarrage si elles sont absentes.

---

### 🟡 FAIBLE — Conteneur Docker s'exécute en root

**Fichier :** `Dockerfile:17-20`

```dockerfile
FROM node:20-alpine
COPY ./package.json package-lock.json /app/
...
CMD ["npm", "run", "start"]
```

**Problème :** L'image finale n'a pas de directive `USER`, le processus Node s'exécute donc en tant que `root` dans le conteneur. En cas d'exploitation d'une vulnérabilité applicative, l'attaquant dispose des droits root dans le conteneur.

**Correction recommandée :**

```dockerfile
FROM node:20-alpine
...
USER node
CMD ["npm", "run", "start"]
```

---

### 🟡 FAIBLE — Absence d'en-têtes de sécurité HTTP (Nginx)

**Fichier :** `docker/nginx/nginx.conf`

**Problème :** Le fichier Nginx ne configure aucun en-tête de sécurité HTTP. La configuration actuelle est minimale et n'inclut pas :
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY` (protection clickjacking)
- `Strict-Transport-Security` (HSTS)
- `Referrer-Policy`
- `Content-Security-Policy`

**Correction recommandée :** Ajouter dans le bloc `server` de nginx.conf :

```nginx
add_header X-Content-Type-Options "nosniff" always;
add_header X-Frame-Options "DENY" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
```

---

### 🟡 FAIBLE — Incohérence taille d'upload Nginx vs application

**Fichier :** `docker/nginx/nginx.conf:14` vs `app/lib/server/upload.ts:6`

```nginx
client_max_body_size 10M;  # Nginx autorise jusqu'à 10 Mo
```
```ts
const MAX_SIZE = 2 * 1024 * 1024; // Application limite à 2 Mo
```

**Problème :** La limite Nginx (10 Mo) est 5× supérieure à la limite applicative (2 Mo). Des fichiers entre 2 et 10 Mo passent le filtre Nginx mais sont rejetés par l'application, consommant inutilement de la bande passante.

**Correction recommandée :** Aligner `client_max_body_size 3M;` dans nginx.conf (légère marge au-dessus de 2 Mo pour les métadonnées HTTP).

---

### 🟡 FAIBLE — Rate limiting absent sur `/api/micro-predictions`

**Fichier :** `app/routes/api.micro-predictions.ts`

**Problème :** Contrairement à `/api/auth`, l'endpoint des micro-pronostics n'est soumis à aucun rate limiting. Un utilisateur authentifié peut soumettre des centaines de requêtes en rafale pour tester des réponses ou saturer les opérations DB.

**Correction recommandée :** Appliquer `checkRateLimit` sur l'intent `answer` (ex. 20 requêtes / 60 secondes par utilisateur).

---

### 🔵 INFO — IP spoofing toujours possible malgré Nginx

**Fichier :** `docker/nginx/nginx.conf:23` + `app/routes/api.auth.$.ts:7`

```nginx
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
```
```ts
request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
```

**Observation :** `$proxy_add_x_forwarded_for` **ajoute** l'IP client à la liste existante (n'écrase pas). Si un attaquant envoie `X-Forwarded-For: 1.2.3.4`, Nginx produit `X-Forwarded-For: 1.2.3.4, real_ip`. L'application lit le premier élément (`split(",")[0]`), soit l'IP spoofée. Cela reste exploitable pour contourner le rate limiting.

**Correction recommandée :** Remplacer dans nginx.conf :
```nginx
proxy_set_header X-Forwarded-For $remote_addr;
```
Cela force l'IP réelle et ignore tout header forgé par le client.

---

### 🔵 INFO — Endpoint de santé public et révélateur

**Fichier :** `app/routes/api.health.ts:11`

```ts
export async function loader() { // pas d'authentification
```

**Observation :** L'endpoint `/api/health` révèle sans authentification l'état des services internes (PostgreSQL, Redis). C'est une pratique courante pour la supervision, mais cela expose des informations d'infrastructure à des tiers non authentifiés.

**Recommandation :** Acceptable si le NAS est derrière un pare-feu. En accès public, envisager de restreindre aux IP de monitoring ou d'ajouter un token de santé.

---

### 🔵 INFO — Cast de type `(session.user as any).role`

**Fichiers :** `app/routes/feed.server.ts:84,99`, `app/routes/soiree.server.ts:261`

```ts
const isAdmin = (session.user as any).role === "admin";
```

**Observation :** L'utilisation de `as any` contourne la vérification de type TypeScript. Ce n'est pas une vulnérabilité en soi (la vérification reste au runtime), mais c'est une dette technique qui masque des erreurs potentielles. Le type `Role` est déjà défini dans `auth-utils.server.ts`.

**Recommandation :** Utiliser `requireAuth` avec `allowedRoles` ou typer correctement la session.

---

## Points positifs identifiés

| Aspect | Statut |
|--------|--------|
| Authentification via Better Auth | ✅ Bien intégré |
| Rate limiting login/inscription (Redis) | ✅ Implémenté |
| Validation des routes admin (`requireAuth(["admin"])`) | ✅ Systématique |
| Validation Zod sur les inputs critiques | ✅ Posts et commentaires validés |
| Requêtes DB via Drizzle ORM (pas de SQL brut) | ✅ Protégé contre l'injection SQL |
| Upload d'avatars : type MIME et taille vérifiés | ✅ Bon contrôle |
| Retraitement Sharp des images (conversion WebP) | ✅ Élimine les métadonnées |
| Secrets exclus du repo (`.gitignore`) | ✅ `.env` ignoré |
| Gestion des erreurs avec logger structuré | ✅ Pino/logger en place |
| Vérification d'unicité des réponses micro-pronos | ✅ Double réponse bloquée |
| Protection auto-modification de rôle admin | ✅ Vérifiée dans `admin.members.server.ts` |

---

## Récapitulatif des actions prioritaires

| Priorité | Fichier | Action |
|----------|---------|--------|
| 🔴 1 | `uploads-files.ts:5` | Valider que le chemin reste dans `uploads/` |
| 🔴 2 | `auth.server.ts:12` | Rendre `APP_URL` obligatoire ou documenter le risque |
| 🟠 3 | `api.micro-predictions.ts:99-106` | Ajouter vérification serveur du délai |
| 🟠 4 | `api.micro-predictions.ts:91` | Valider longueur et contenu du champ `answer` |
| 🟡 5 | `docker-compose.prod.yml` | Supprimer les mots de passe par défaut `changeme` |
| 🟡 6 | `Dockerfile` | Ajouter `USER node` dans l'image finale |
| 🟡 7 | `nginx.conf` | Ajouter les en-têtes de sécurité HTTP |
| 🟡 8 | `nginx.conf:14` | Aligner `client_max_body_size` sur la limite app (2 Mo) |
| 🟡 9 | `api.micro-predictions.ts` | Ajouter rate limiting sur les réponses |
| 🔵 10 | `nginx.conf:23` | Remplacer `$proxy_add_x_forwarded_for` par `$remote_addr` |
