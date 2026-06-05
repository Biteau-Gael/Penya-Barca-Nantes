# Rapport d'analyse de sécurité — Penya Blaugrana Nantes

**Date :** 05/06/2026  
**Branche analysée :** `main` (HEAD `003faca`)  
**Périmètre :** Audit de sécurité post-Phase 2 + résumé des derniers commits

---

## 1. Résumé des derniers commits

### `003faca` — 13/04/2026 — *fix: évaluer les badges immédiatement après chaque action*
Correction du timing d'évaluation des badges : ils sont désormais attribués en temps réel au lieu d'attendre un calcul différé.
- Fichiers modifiés : `app/routes/feed.server.ts`, `app/routes/match-detail.server.ts`
- Badges déclenchés : Premier pas, Régulier, Fidèle, Auteur, Commentateur, Réactif

### `b1c88f6` — 13/04/2026 — *feat: Phase 2 — soirée match live, micro-pronos, badges, séries, saisons*
Livraison majeure de la Phase 2 en un seul commit (28 fichiers, +2 971 lignes).
- **Soirée match** : route `/soiree/:matchId`, score live en polling 60 s, fil d'événements temps réel
- **Micro-pronostics** : création admin, vote joueur, clôture avec points auto, suppression admin
- **Séries** : `currentStreak` / `bestStreak`, récompenses automatiques aux paliers 3/5/10
- **Badges** : 10 badges, page `/badges`, affichage profil, évaluation auto post-calcul de points
- **Saisons** : table `seasons`, filtre sur le classement, support archives
- Migration DB : `0007_slimy_maria_hill.sql` — 6 nouvelles tables

### `68e22d2` — 13/04/2026 — *feat: menu burger mobile pour la navigation*
Ajout du menu hamburger responsive dans le header (`app/components/layout/header.tsx`).

### `554b873` — 12/04/2026 — *Add deployment guide for Synology NAS updates*
Documentation de la procédure de mise à jour sur le NAS Synology (pull + rebuild Docker).

### `d461ee5` — 12/04/2026 — *Merge branch 'claude/deploy-synology-nas-cLkOL'*
Merge du branch de déploiement NAS.

---

## 2. Analyse de sécurité

---

### 🔴 CRITIQUE

#### C-1 — Path Traversal dans la route uploads
**Fichier :** `app/routes/uploads-files.ts:5`  
**Risque :** Un attaquant peut lire n'importe quel fichier du serveur en injectant `../../etc/passwd` ou `../../.env`.

```typescript
// VULNÉRABLE — aucune protection contre les séquences ../
const filePath = path.join(process.cwd(), "uploads", params["*"]);
const file = await readFile(filePath);
```

**Correction recommandée :**
```typescript
const uploadsDir = path.resolve(process.cwd(), "uploads");
const filePath = path.resolve(uploadsDir, params["*"]);
// Vérifier que le chemin résolu reste dans uploads/
if (!filePath.startsWith(uploadsDir + path.sep)) {
  return new Response("Forbidden", { status: 403 });
}
```

---

#### C-2 — Mots de passe par défaut dans Docker Compose
**Fichiers :** `docker-compose.yml:22`, `docker-compose.prod.yml:22,32,34`  
**Risque :** Si les variables d'environnement ne sont pas définies, PostgreSQL et Redis démarrent avec le mot de passe `changeme`, accessible depuis n'importe quel conteneur du réseau Docker.

```yaml
# DANGEREUX — fallback en clair
POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-changeme}
command: redis-server --requirepass ${REDIS_PASSWORD:-changeme}
```

**Correction recommandée :** Supprimer le fallback `:-changeme` pour forcer l'erreur au démarrage si les variables ne sont pas définies. Documenter l'obligation dans le README.

---

### 🟠 ÉLEVÉ

#### H-1 — Absence totale de security headers dans Nginx
**Fichier :** `docker/nginx/nginx.conf`  
**Risque :** Sans headers de sécurité, l'application est exposée aux attaques clickjacking, MIME-sniffing, et downgrade HTTP.

**Headers manquants :**

| Header | Risque si absent |
|--------|-----------------|
| `X-Frame-Options: DENY` | Clickjacking |
| `X-Content-Type-Options: nosniff` | MIME sniffing |
| `Strict-Transport-Security` | Downgrade HTTPS→HTTP |
| `Referrer-Policy` | Fuite de données dans les referers |
| `Content-Security-Policy` | XSS, injection de ressources |

**Correction recommandée :** Ajouter dans `nginx.conf` :
```nginx
add_header X-Frame-Options "DENY" always;
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
```

---

#### H-2 — Endpoint `/api/health` public avec informations d'infrastructure
**Fichier :** `app/routes/api.health.ts`  
**Risque :** L'état de PostgreSQL et Redis est exposé sans authentification, facilitant la reconnaissance avant une attaque ciblée.

```json
// Réponse visible par n'importe qui
{ "status": "ok", "services": { "db": "ok", "redis": "ok" }, "timestamp": "..." }
```

**Correction recommandée :** Restreindre à une IP interne (Nginx), ou ajouter une vérification de token de monitoring (`Authorization: Bearer <HEALTH_TOKEN>`).

---

#### H-3 — CORS : `trustedOrigins` vide si `APP_URL` non défini
**Fichier :** `app/lib/server/auth.server.ts:12`  
**Risque :** Si `APP_URL` n'est pas défini en production, Better Auth peut accepter des requêtes cross-origin depuis n'importe quel domaine, ouvrant la porte aux attaques CSRF sur les endpoints d'authentification.

```typescript
trustedOrigins: env.APP_URL ? [env.APP_URL] : [],  // [] = pas de restriction !
```

**Correction recommandée :** Rendre `APP_URL` obligatoire dans la configuration (`env.server.ts`) pour bloquer le démarrage si absente.

---

#### H-4 — IP spoofing sur le rate limiting
**Fichier :** `app/routes/api.auth.$.ts:6-10`  
**Risque :** Le rate limiting repose sur le header `X-Forwarded-For` fourni par le client. Si le reverse proxy n'est pas correctement configuré, un attaquant peut forger ce header pour contourner les limites de tentatives de connexion.

```typescript
request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
// Un attaquant envoie X-Forwarded-For: 1.2.3.4 pour changer son "IP"
```

**Correction recommandée :** Dans Nginx, écraser explicitement `X-Forwarded-For` avec `$remote_addr` avant de le transmettre à l'application, afin que seule l'IP réelle du client soit utilisée.

---

### 🟡 MOYEN

#### M-1 — Vérification de rôle admin via `as any` (contournement TypeScript)
**Fichier :** `app/routes/feed.server.ts:99,124,184,200`  
**Risque :** L'utilisation de `as any` contourne la vérification de types. Si le schéma de session évolue, la vérification silencieusement incorrecte ne produit pas d'erreur de compilation.

```typescript
const isAdmin = (session.user as any).role === "admin";
```

**Correction recommandée :** Étendre le type `Session` de Better Auth avec le champ `role` typé, ou utiliser un helper `isAdmin(session)` centralisé avec une vérification de type sûre.

---

#### M-2 — Validation MIME du type d'avatar uniquement côté header HTTP
**Fichier :** `app/lib/server/upload.ts:13`  
**Risque :** Le type MIME est fourni par le client. Un attaquant peut envoyer un fichier malveillant avec le header `Content-Type: image/jpeg`. L'utilisation de `sharp` pour la conversion atténue fortement ce risque en pratique, mais la validation sur le header seul reste une faiblesse formelle.

```typescript
if (!ALLOWED_TYPES.includes(file.type)) { // Basé sur le header client
```

**Note atténuante :** La conversion `sharp().webp()` détruit tout contenu non-image valide, ce qui rend l'exploitation très difficile. Risque résiduel faible.

**Correction recommandée :** Ajouter une validation par magic bytes via la bibliothèque `file-type` avant la conversion.

---

#### M-3 — Aucun header de sécurité côté Nginx (HTTP only, pas de HTTPS)
**Fichier :** `docker/nginx/nginx.conf:11`  
**Risque :** Le serveur ne force pas le HTTPS. En l'absence de redirection `80 → 443`, les sessions et tokens d'authentification transitent en clair sur le réseau.

**Correction recommandée :** Configurer un bloc `server` sur le port 443 avec certificat TLS, et rediriger `80 → 443` via un bloc dédié.

---

#### M-4 — Logging des actions admin sans adresse IP
**Fichier :** `app/lib/server/logger.server.ts` (utilisé dans tous les routes admin)  
**Risque :** En cas de compromission d'un compte admin, les logs permettent de savoir *quoi* a été fait mais pas *depuis où*, rendant l'investigation forensique incomplète.

**Correction recommandée :** Enrichir les entrées de log admin avec l'IP cliente (`req.headers.get("x-real-ip")`).

---

#### M-5 — Absence de rate limiting sur les endpoints admin
**Fichiers :** `app/routes/admin.*.ts`  
**Risque :** Les actions admin (changement de rôle, suppression de membre, clôture de pronostic) ne sont pas protégées par un rate limiter. Une attaque par rejeu ou un script automatisé peut effectuer des opérations en masse.

**Correction recommandée :** Appliquer le middleware `checkRateLimit` existant sur les routes admin (ex : max 30 actions / 60 s).

---

### 🟢 FAIBLE

#### L-1 — Stack trace exposée en mode développement
**Fichier :** `app/root.tsx:92-95`  
**Risque :** La stack trace complète est rendue côté client si l'application est déployée avec `NODE_ENV=development`. Correctement gardé par `import.meta.env.DEV`, le risque est nul en production standard.  
**Recommandation :** Vérifier que les builds de production utilisent bien `NODE_ENV=production` dans le `Dockerfile`.

---

#### L-2 — Rate limiting login : 10 tentatives / 15 min
**Fichier :** `app/routes/api.auth.$.ts:21-22`  
**Risque :** La fenêtre autorise une attaque dictionnaire lente (1 tentative / 1,5 min). Acceptable pour la plupart des cas mais perfectible.  
**Recommandation :** Réduire à 5 tentatives / 15 min ou implémenter un backoff exponentiel.

---

#### L-3 — Message d'erreur révélant l'absence de clé API Football
**Fichier :** `app/lib/server/api-football.server.ts`  
**Risque :** L'erreur `"API_FOOTBALL_KEY non configurée"` révèle l'architecture interne si elle remonte à l'utilisateur. Risque minimal car les erreurs serveur ne sont pas exposées en production.  
**Recommandation :** Aucune action requise en priorité.

---

## 3. Tableau récapitulatif

| ID | Sévérité | Fichier(s) | Problème | Action recommandée |
|----|----------|-----------|---------|-------------------|
| C-1 | 🔴 CRITIQUE | `uploads-files.ts:5` | Path Traversal — lecture de fichiers arbitraires | Ajouter boundary check avec `path.resolve()` |
| C-2 | 🔴 CRITIQUE | `docker-compose.yml:22`, `docker-compose.prod.yml:22,32,34` | Mots de passe `changeme` par défaut | Supprimer les fallbacks, rendre les variables obligatoires |
| H-1 | 🟠 ÉLEVÉ | `docker/nginx/nginx.conf` | Aucun security header HTTP | Ajouter X-Frame-Options, HSTS, nosniff, CSP |
| H-2 | 🟠 ÉLEVÉ | `api.health.ts` | Endpoint de santé public exposant l'état DB/Redis | Restreindre par IP ou token |
| H-3 | 🟠 ÉLEVÉ | `auth.server.ts:12` | `trustedOrigins: []` si APP_URL absent | Rendre APP_URL obligatoire au démarrage |
| H-4 | 🟠 ÉLEVÉ | `api.auth.$.ts:7` | Rate limiting contournable par spoofing X-Forwarded-For | Forcer l'IP réelle via Nginx |
| M-1 | 🟡 MOYEN | `feed.server.ts:99,124,184,200` | Rôle admin vérifié avec `as any` | Helper `isAdmin()` typé |
| M-2 | 🟡 MOYEN | `upload.ts:13` | Validation MIME basée sur header client | Ajouter vérification magic bytes (atténué par sharp) |
| M-3 | 🟡 MOYEN | `nginx.conf:11` | Pas de HTTPS / redirection HTTP→HTTPS | Configurer TLS + redirection 80→443 |
| M-4 | 🟡 MOYEN | Routes admin | IP absente des logs d'actions admin | Logger l'IP dans les actions sensibles |
| M-5 | 🟡 MOYEN | `admin.*.ts` | Pas de rate limiting sur les endpoints admin | Appliquer `checkRateLimit` existant |
| L-1 | 🟢 FAIBLE | `root.tsx:92` | Stack trace en mode DEV | Vérifier NODE_ENV en production |
| L-2 | 🟢 FAIBLE | `api.auth.$.ts:21` | 10 tentatives login / 15 min | Réduire à 5 tentatives |
| L-3 | 🟢 FAIBLE | `api-football.server.ts` | Message d'erreur révèle l'archi | Aucune action prioritaire |

---

## 4. Plan d'action prioritaire

### Immédiat (avant prochain déploiement)
1. **C-1** — Corriger le path traversal dans `uploads-files.ts`
2. **C-2** — Supprimer les fallbacks `:-changeme` dans les Docker Compose

### Court terme (sprint suivant)
3. **H-1** — Ajouter les security headers dans Nginx
4. **H-3** — Rendre `APP_URL` obligatoire dans `env.server.ts`
5. **H-4** — Forcer `X-Forwarded-For` à `$remote_addr` dans Nginx
6. **H-2** — Restreindre l'endpoint `/api/health` (IP ou token)

### Moyen terme
7. **M-1** — Créer un helper `isAdmin()` typé centralisé
8. **M-3** — Configurer HTTPS (Let's Encrypt via Nginx Proxy Manager sur Synology)
9. **M-4/M-5** — Enrichir les logs admin + rate limiting admin

---

*Rapport généré le 05/06/2026 — Analyse statique du code source, branche `main`.*
