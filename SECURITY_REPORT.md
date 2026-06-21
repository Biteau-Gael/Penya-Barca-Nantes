# Rapport de sécurité — Penya Blaugrana Nantes

**Date :** 21 juin 2026  
**Branche analysée :** `main` (dernier commit : `003faca`)  
**Scope :** Application React Router / Node.js + infrastructure Docker/NAS

---

## 1. Résumé des derniers commits

| Commit | Date | Auteur | Description |
|--------|------|--------|-------------|
| `003faca` | 13 avr. 2026 | Biteau Gaël | **fix:** Évaluation des badges immédiatement après chaque action (pronostic, post, commentaire, réaction) |
| `b1c88f6` | 13 avr. 2026 | Biteau Gaël | **feat:** Phase 2 — soirée match live, micro-pronos, badges, séries, saisons (Sprint 2/3/5) |
| `68e22d2` | 13 avr. 2026 | Biteau Gaël | **feat:** Menu burger mobile pour la navigation |
| `d461ee5` | 12 avr. 2026 | Claude | **merge:** Merge branch `claude/deploy-synology-nas-cLkOL` (PR #2) |
| `554b873` | 12 avr. 2026 | Claude | **docs:** Guide de déploiement pour les mises à jour sur NAS Synology |
| `6aebaf7` | 12 avr. 2026 | Claude | **fix:** Better Auth — trusted origins pour le support du domaine custom (`APP_URL`) |
| `9823bc5` | 12 avr. 2026 | Claude | **fix:** Ajout du service `migrate` dans `docker-compose.prod.yml` pour les migrations DB |
| `8d6e5e9` | 12 avr. 2026 | Claude | **feat:** Docker Compose production + script backup pour NAS Synology |

### Phase 2 — Périmètre des fonctionnalités ajoutées

- **Soirée match live** : route `/soiree/:matchId`, score en temps réel (polling 60s), fil de match (buts, cartons, remplacements), pronos révélés au coup d'envoi
- **Micro-pronostics** : création/clôture/suppression admin, vote joueur, attribution automatique de points
- **Séries** : `currentStreak` / `bestStreak`, récompenses automatiques aux paliers 3/5/10
- **Badges** : 10 badges, évaluation automatique, page `/badges`, affichage sur le profil
- **Saisons** : table `seasons`, classement filtré, archives par saison
- **Schéma DB** : migration `0007` (6 nouvelles tables/colonnes)

---

## 2. Analyse de sécurité — Résultats par criticité

### Synthèse

| Criticité | Nombre | Statut recommandé |
|-----------|--------|-------------------|
| 🔴 Critique | 2 | À corriger immédiatement |
| 🟠 Élevé | 4 | À corriger avant la prochaine mise en production |
| 🟡 Moyen | 6 | À planifier dans le prochain sprint |
| 🟢 Faible | 4 | À traiter selon les priorités |

---

### 🔴 Critique

#### C1 — Path Traversal dans le serveur de fichiers uploadés

**Fichier :** `app/routes/uploads-files.ts`  
**Risque :** Lecture de fichiers arbitraires sur le serveur (ex. `/etc/passwd`, `.env`)

```typescript
// ACTUEL — VULNÉRABLE
const filePath = path.join(process.cwd(), "uploads", params["*"]);
// Un paramètre "../../../etc/passwd" résout vers /etc/passwd
```

**Correction :**
```typescript
const uploadDir = path.resolve(process.cwd(), "uploads");
const filePath = path.resolve(uploadDir, params["*"]);
// Bloquer si le chemin résolu sort du répertoire autorisé
if (!filePath.startsWith(uploadDir + path.sep) && filePath !== uploadDir) {
  return new Response("Forbidden", { status: 403 });
}
```

---

#### C2 — Contournement du rate-limiting par usurpation d'IP

**Fichier :** `app/routes/api.auth.$.ts` (lignes 5–11)  
**Risque :** Un attaquant peut bypass le rate-limit de connexion (10 tentatives/15 min) en falsifiant l'en-tête `X-Forwarded-For`

```typescript
// ACTUEL — VULNÉRABLE
function getClientIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||  // Spoofable !
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}
```

**Correction :** Configurer nginx comme proxy de confiance et ne lire l'IP que depuis la connexion TCP (ou configurer nginx pour écrire l'IP dans un en-tête non-spoofable) :
```nginx
# nginx.conf — utiliser $remote_addr, pas l'en-tête client
proxy_set_header X-Real-IP $remote_addr;
```

---

### 🟠 Élevé

#### H1 — Mots de passe par défaut faibles en production

**Fichier :** `docker-compose.prod.yml` (lignes 22 et 32)  
**Risque :** Déploiement avec le mot de passe `changeme` si les variables d'environnement ne sont pas renseignées

```yaml
# ACTUEL — DANGEREUX
POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-changeme}
REDIS_PASSWORD=${REDIS_PASSWORD:-changeme}
```

**Correction :** Supprimer les valeurs par défaut — Docker plantera explicitement si la variable est absente, ce qui est le comportement attendu :
```yaml
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
REDIS_PASSWORD=${REDIS_PASSWORD}
```

---

#### H2 — HTTPS absent dans la configuration production

**Fichier :** `docker-compose.prod.yml` / configuration nginx  
**Risque :** Toutes les communications (sessions, mots de passe, clés API) transitent en clair. Vulnérable aux attaques MITM.

**Correction :** Configurer TLS dans nginx (certificat Let's Encrypt ou certificat NAS Synology) avec redirection HTTP → HTTPS :
```nginx
server {
  listen 80;
  return 301 https://$host$request_uri;
}
server {
  listen 443 ssl http2;
  ssl_certificate /etc/nginx/certs/cert.pem;
  ssl_certificate_key /etc/nginx/certs/key.pem;
}
```

---

#### H3 — `APP_URL` optionnelle — trusted origins vide possible

**Fichier :** `app/lib/server/auth.server.ts` (ligne 12)  
**Risque :** Si `APP_URL` n'est pas définie, le tableau `trustedOrigins` est vide. Selon le comportement par défaut de Better Auth, cela peut autoriser des requêtes cross-origin non souhaitées.

```typescript
// ACTUEL
trustedOrigins: env.APP_URL ? [env.APP_URL] : [],
```

**Correction :** Rendre `APP_URL` obligatoire en production :
```typescript
// Dans env.server.ts
APP_URL: z.string().url().optional(),
// + dans auth.server.ts — logger une alerte si vide
if (!env.APP_URL) logger.warn("APP_URL non défini — trusted origins vide");
```

---

#### H4 — Pas de rate-limiting sur les endpoints admin

**Fichiers :** `app/routes/api.sync-matches.ts`, `app/routes/api.micro-predictions.ts`  
**Risque :** Un administrateur compromis ou une session volée peut déclencher des appels API massifs (sync matches, création de micro-pronos en boucle), provoquant un épuisement des quotas API ou une surcharge DB.

**Correction :** Appliquer le rate-limiter sur les actions admin :
```typescript
await checkRateLimit({
  key: `admin-sync:${session.user.id}`,
  maxAttempts: 5,
  windowSeconds: 3600,
});
```

---

### 🟡 Moyen

#### M1 — Type casting `as any` pour le rôle utilisateur

**Fichiers :** `app/routes/feed.server.ts` (multiple occurrences)  
**Risque :** `(session.user as any).role` contourne le système de types TypeScript. Si le type de session change, la vérification RBAC peut passer silencieusement en `undefined`.

**Correction :** Typer explicitement les champs additionnels de la session Better Auth.

---

#### M2 — Validation manquante sur `description` et `location` des événements

**Fichier :** `app/routes/admin.events.server.ts`  
**Risque :** Pas de limite de taille sur `description` et `location`. Permet d'insérer des données volumineuses en base.

**Correction :**
```typescript
description: z.string().max(2000).optional(),
location: z.string().max(200).optional(),
```

---

#### M3 — Données JSON stockées sans validation de schéma

**Fichiers :** `app/routes/admin.matches.server.ts`, `app/routes/match-detail.server.ts`  
**Risque :** `JSON.stringify(matchDetails)` stocké sans validation. Si l'API externe change de format, le parsing au chargement peut lever une exception non gérée.

**Correction :** Valider avec un schéma Zod avant stockage.

---

#### M4 — Pas de validation du type `pointsScheme` en entrée admin

**Fichier :** `app/routes/admin.matches.server.ts`  
**Risque :** Le champ `pointsScheme` accepte n'importe quelle chaîne, ce qui pourrait casser le calcul des points.

**Correction :**
```typescript
const PointsSchemeSchema = z.enum(["standard", "strict", "souple"]);
const pointsScheme = PointsSchemeSchema.parse(formData.get("pointsScheme") || "standard");
```

---

#### M5 — Pas d'en-têtes de sécurité HTTP (CSP, X-Frame-Options…)

**Fichier :** Configuration nginx  
**Risque :** Absence de protection navigateur contre le clickjacking, le MIME-sniffing et les injections.

**Correction :** Ajouter dans nginx :
```nginx
add_header X-Frame-Options "SAMEORIGIN" always;
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Content-Security-Policy "default-src 'self'" always;
```

---

#### M6 — Absence de limite de taille sur les requêtes

**Fichiers :** Tous les handlers d'actions formulaires  
**Risque :** Un client malveillant peut envoyer un body très large (dans la limite nginx) pour saturer la mémoire Node.js.

**Correction :** Vérifier le `Content-Length` en entrée des actions critiques, ou configurer `client_max_body_size` restrictif dans nginx.

---

### 🟢 Faible

#### L1 — Pas de timeout sur les appels à l'API Football

**Fichier :** `app/lib/server/api-football.server.ts`  
Ajouter `AbortSignal.timeout(10000)` sur tous les `fetch()` externes pour éviter des requêtes qui restent pendantes indéfiniment.

#### L2 — `lazyConnect: true` sur Redis masque les erreurs de démarrage

**Fichier :** `app/lib/server/redis.server.ts`  
Ajouter un handler `redis.on("error", ...)` pour logger les échecs de connexion dès le démarrage.

#### L3 — Pas de journal d'audit centralisé pour les actions admin

**Risque :** Les actions sensibles (changement de rôle, suppression de membre) sont loguées dans les fichiers applicatifs mais non dans une table d'audit en base, ce qui complique les audits a posteriori.

#### L4 — Messages d'erreur API trop verbeux dans les logs

**Fichier :** `app/routes/api.sync-matches.ts` (ligne 16)  
```typescript
const message = error instanceof Error ? error.message : "Erreur inconnue";
return Response.json({ error: message }, { status: 500 });
```
Le message d'erreur interne est renvoyé au client. Préférer un message générique côté client et logger le détail côté serveur uniquement.

---

## 3. Points positifs constatés

- **Authentification** : Better Auth correctement intégré, sessions stockées en Redis
- **Protection des routes admin** : `requireAuth(request, ["admin"])` systématiquement appliqué sur les loaders/actions admin
- **Upload d'avatar** : type MIME vérifié, taille limitée à 2 Mo, retraitement via Sharp (pas de fichier brut conservé)
- **ORM Drizzle** : requêtes paramétrées, pas de concaténation SQL manuelle → pas d'injection SQL
- **Variables d'environnement** : validation Zod au démarrage (`env.server.ts`)
- **Rate-limiting** : appliqué sur `/sign-in` et `/sign-up`
- **Logging structuré** : Pino avec niveaux configurables

---

## 4. Actions prioritaires recommandées

| Priorité | Action | Fichier |
|----------|--------|---------|
| 1 | Corriger la path traversal uploads | `app/routes/uploads-files.ts` |
| 2 | Fixer la détection IP (proxy de confiance nginx) | `app/routes/api.auth.$.ts` + nginx |
| 3 | Supprimer les mots de passe par défaut Docker | `docker-compose.prod.yml` |
| 4 | Activer HTTPS en production | Configuration nginx |
| 5 | Ajouter rate-limiting sur les actions admin | `api.sync-matches.ts`, `api.micro-predictions.ts` |
| 6 | Ajouter les en-têtes de sécurité HTTP | nginx |
| 7 | Typer correctement le rôle utilisateur (supprimer `as any`) | `feed.server.ts` |
