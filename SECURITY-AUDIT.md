# Rapport d'analyse sécurité — Penya Blaugrana Nantes
**Date :** 03 juin 2026  
**Branche analysée :** `claude/sharp-fermi-LSIY3` (HEAD: `003faca`)  
**Périmètre :** Audit complet du code source + configuration de déploiement

---

## 1. Résumé des derniers commits

| Hash | Date | Auteur | Description |
|------|------|--------|-------------|
| `003faca` | 13 avr. 2026 | Biteau Gaël | **fix:** évaluer les badges immédiatement après chaque action (soumission pronostic, post, commentaire, réaction) |
| `b1c88f6` | 13 avr. 2026 | Biteau Gaël | **feat:** Phase 2 — soirée match live, micro-pronos, badges, séries, saisons |
| `d461ee5` | 12 avr. 2026 | Claude | **merge:** intégration branche `deploy-synology-nas-cLkOL` |
| `554b873` | 12 avr. 2026 | Claude | **docs:** guide de déploiement NAS Synology (DEPLOY.md) |
| `68e22d2` | 13 avr. 2026 | Biteau Gaël | **feat:** menu burger mobile pour la navigation |
| `6aebaf7` | antérieur | Claude | **fix:** Better Auth trusted origins pour support domaine custom |
| `9823bc5` | antérieur | Claude | **fix:** service de migration dans docker-compose.prod.yml |
| `aed5841` | antérieur | Biteau Gaël | **security:** suppression des credentials du repo + renforcement .gitignore |

### Périmètre Phase 2 (commit `b1c88f6`)
Fichiers introduits (2 965 lignes) :
- `app/db/schema/` → 3 nouveaux schémas (micro-predictions, rewards, seasons)
- `app/lib/server/` → badges, streaks, seasons
- `app/routes/` → soiree, badges, api.micro-predictions
- Enrichissement profil, classements, calendrier

---

## 2. Analyse de sécurité

### 🔴 CRITIQUE

#### C1 — Path traversal dans le serveur de fichiers statiques
**Fichier :** `app/routes/uploads-files.ts:5`  
**Risque :** Lecture arbitraire de fichiers sur le serveur

```typescript
// CODE ACTUEL — VULNÉRABLE
const filePath = path.join(process.cwd(), "uploads", params["*"]);
```

`path.join` normalise les séquences `..` mais ne valide pas que le chemin résultant reste dans le répertoire `uploads`. Une requête vers `/uploads/../../.env` résout en `<cwd>/.env`, permettant à un attaquant de lire :
- `.env` (DATABASE_URL, AUTH_SECRET, API_FOOTBALL_KEY)
- Tous fichiers accessibles par le processus Node.js

**Correction à appliquer :**
```typescript
const UPLOADS_BASE = path.join(process.cwd(), "uploads");

export async function loader({ params }: { params: { "*": string } }) {
  const requested = path.normalize(params["*"] ?? "");
  const filePath = path.join(UPLOADS_BASE, requested);

  // Bloquer toute sortie du répertoire uploads
  if (!filePath.startsWith(UPLOADS_BASE + path.sep) && filePath !== UPLOADS_BASE) {
    return new Response("Not found", { status: 404 });
  }
  // ... suite inchangée
}
```

---

### 🟠 ÉLEVÉ

#### H1 — Contournement du rate limiting par usurpation d'IP
**Fichier :** `app/routes/api.auth.$.ts:6-10`

```typescript
request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
request.headers.get("x-real-ip") ||
"unknown"
```

Ces headers sont fournis par le client et peuvent être falsifiés. Un attaquant peut contourner le rate limit de connexion en changeant la valeur de `X-Forwarded-For` à chaque tentative.

**Correction :** N'utiliser ces headers que si la requête provient d'un reverse proxy de confiance (IP fixe connue). Configurer une variable `TRUSTED_PROXY_IP` ou rejeter les headers si l'IP source n'est pas le proxy déclaré.

#### H2 — Rate limiting absent sur les endpoints de mutation authentifiés
**Fichiers concernés :**
- `app/routes/api.micro-predictions.ts` (réponses aux micro-pronos)
- `app/routes/feed.server.ts` (création de posts/commentaires)
- `app/routes/match-detail.server.ts` (soumission de pronostics)

Le rate limiting est correctement implémenté sur `api.auth.$.ts` (connexion : 10/15 min, inscription : 5/heure) mais **absent** sur les endpoints de mutation authentifiés. Un compte compromis pourrait spammer le fil d'actualité ou soumettre des milliers de micro-pronos.

**Correction suggérée :** Appliquer `checkRateLimit` avec la clé `userId` pour les actions utilisateur sur ces routes :
```typescript
await checkRateLimit({ key: `micro-answer:${session.user.id}`, maxAttempts: 30, windowSeconds: 60 });
```

#### H2 — Mots de passe Docker par défaut en production
**Fichier :** `docker-compose.prod.yml:20,25`

```yaml
POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-changeme}
redis-server --requirepass ${REDIS_PASSWORD:-changeme}
```

Si le fichier `.env` est absent lors du déploiement, les mots de passe `changeme` sont utilisés. PostgreSQL est exposé sur le réseau Docker interne (risque limité), mais Redis écoute potentiellement sur un port mappé. Une vérification au démarrage s'impose.

**Correction :** Supprimer les valeurs par défaut pour forcer l'erreur de démarrage plutôt que d'utiliser un mot de passe faible :
```yaml
POSTGRES_PASSWORD=${POSTGRES_PASSWORD:?Variable POSTGRES_PASSWORD requise}
```

---

### 🟡 MOYEN

#### M1 — trusted origins vide si APP_URL non définie
**Fichier :** `app/lib/server/auth.server.ts:12`

```typescript
trustedOrigins: env.APP_URL ? [env.APP_URL] : [],
```

Avec `APP_URL` optionnel (`env.server.ts:11`), Better Auth peut se retrouver sans origine de confiance explicite. Selon la version de Better Auth, cela peut affecter la protection CSRF sur les appels cross-origin.

**Correction :** Passer `APP_URL` en variable obligatoire en production, ou utiliser l'URL courante de la requête comme fallback documenté.

#### M2 — En-têtes de sécurité HTTP absents
Aucun en-tête de sécurité n'est configuré (ni dans Vite, ni dans React Router, ni dans Nginx/reverse proxy) :

| En-tête | Risque si absent |
|---------|-----------------|
| `Content-Security-Policy` | XSS via injection de script |
| `X-Content-Type-Options: nosniff` | MIME-type sniffing |
| `X-Frame-Options: DENY` | Clickjacking |
| `Referrer-Policy` | Fuite d'URL interne |

**Correction :** Ajouter un middleware dans l'entry server de React Router ou configurer le reverse proxy Nginx.

#### M3 — Paramètre de saison non validé contre les valeurs existantes
**Fichier :** `app/routes/rankings.server.ts:26`

Le paramètre URL `?saison=` est utilisé directement comme filtre Drizzle sans validation préalable contre la liste des saisons existantes. Bien que Drizzle utilise des requêtes paramétrées (pas d'injection SQL), un paramètre arbitraire peut générer des requêtes inutiles ou révéler des informations sur la structure.

**Correction :** Vérifier que `seasonParam` appartient à la liste des saisons avant de l'utiliser.

#### M4 — Logging des erreurs internes exposé au client
**Fichier :** `app/routes/api.sync-matches.ts:17`

```typescript
const message = error instanceof Error ? error.message : "Erreur inconnue";
return Response.json({ error: message }, { status: 500 });
```

Les messages d'erreur internes (stack traces, noms de tables, URLs DB) peuvent fuiter vers le client en cas d'exception non maîtrisée.

**Correction :** Renvoyer un message générique côté client et logger le détail côté serveur uniquement.

---

### 🟢 FAIBLE / INFORMATIF

#### L1 — Connexion base de données sans SSL explicite
**Fichier :** `app/db/client.ts`

La `DATABASE_URL` est passée sans forcer `ssl: { rejectUnauthorized: true }`. Si le NAS est sur un réseau local fermé le risque est faible, mais pour une évolution vers un hébergement cloud, le trafic DB serait non chiffré.

#### L2 — Redis sans TLS en production
**Fichier :** `.env.example` / `docker-compose.prod.yml`

`REDIS_URL=redis://localhost:6379` et `rediss://` (TLS) non utilisé. Dans le contexte Synology NAS (réseau local), le risque est faible, mais les sessions d'authentification transitent par Redis.

#### L3 — `file.type` non vérifié côté serveur pour les uploads
**Fichier :** `app/lib/server/upload.ts:14`

La validation repose sur `file.type` fourni par le navigateur (facilement falsifiable côté client). La protection réelle est assurée par Sharp (rejet si le buffer n'est pas une image valide), mais la validation explicite du contenu via `file-type` serait plus défensive.

#### L4 — Timeout absent sur les appels à l'API Football externe
**Fichier :** `app/lib/server/api-football.server.ts`

Les appels `fetch` vers l'API externe n'ont pas de signal d'annulation. Un serveur tiers lent peut bloquer un thread Node.js indéfiniment.

**Correction :** Ajouter `signal: AbortSignal.timeout(10_000)` aux options fetch.

#### L5 — Logs structurés sans masquage des données sensibles
**Fichier :** `app/lib/server/logger.server.ts`

Les logs pino ne sont pas configurés avec un `redact` pour masquer les champs sensibles (`email`, `password`, tokens). En cas d'erreur, ces données pourraient apparaître dans les logs.

**Correction :** Ajouter `redact: ['email', 'password', 'token', 'authorization']` à la config pino.

---

## 3. Points positifs — Bonnes pratiques respectées

| Domaine | Implémentation |
|---------|---------------|
| **SQL Injection** | ✅ Drizzle ORM — requêtes paramétrées, aucun SQL brut |
| **Authentification** | ✅ Better Auth avec sessions Redis + CSRF intégré |
| **Autorisation** | ✅ `requireAuth(request, ["admin"])` sur toutes les routes admin |
| **Auto-protection admin** | ✅ Admin ne peut pas changer son propre rôle ni supprimer son compte |
| **Validation des entrées** | ✅ Zod sur toutes les entrées (posts, commentaires, matchs, pronos, profil) |
| **Mots de passe** | ✅ Contraintes : 8 car. min, majuscule + minuscule + chiffre |
| **Uploads** | ✅ Validation type + taille (2 Mo) + retraitement via Sharp |
| **Credentials dans le repo** | ✅ Nettoyés (commit `aed5841`) + `.gitignore` renforcé |
| **Secrets d'environnement** | ✅ Validation Zod au démarrage (`env.server.ts`) — plantage immédiat si manquants |
| **Rate limiting** | ✅ Login (10/15 min) et inscription (5/heure) |
| **RGPD** | ✅ Consentement obligatoire à l'inscription |
| **Sécurité du pseudo** | ✅ Regex alphanumérique stricte `[a-zA-Z0-9_-]` |

---

## 4. Plan d'action recommandé

| Priorité | Action | Fichier | Effort |
|----------|--------|---------|--------|
| 🔴 **Immédiat — FAIT** | ~~Corriger le path traversal~~ ✅ corrigé dans ce commit | `uploads-files.ts` | — |
| 🟠 **Court terme** | Valider l'IP source avant d'utiliser `x-forwarded-for` | `api.auth.$.ts` | 30 min |
| 🟠 **Court terme** | Ajouter rate limiting sur les mutations authentifiées | `api.micro-predictions.ts`, `feed.server.ts` | 1h |
| 🟠 **Court terme** | Forcer `POSTGRES_PASSWORD` / `REDIS_PASSWORD` sans valeur par défaut | `docker-compose.prod.yml` | 10 min |
| 🟡 **Moyen terme** | Configurer les en-têtes HTTP de sécurité (Nginx ou middleware RR) | config Nginx | 2h |
| 🟡 **Moyen terme** | Rendre `APP_URL` obligatoire en production | `env.server.ts` | 15 min |
| 🟡 **Moyen terme** | Valider le paramètre `saison` contre les valeurs existantes | `rankings.server.ts` | 30 min |
| 🟢 **Backlog** | Redact des champs sensibles dans Pino | `logger.server.ts` | 30 min |
| 🟢 **Backlog** | Timeout sur les appels `fetch` API Football | `api-football.server.ts` | 15 min |
| 🟢 **Backlog** | Validation content-based des uploads avec `file-type` | `upload.ts` | 1h |
| 🟢 **Backlog** | SSL explicite sur la connexion PostgreSQL | `db/client.ts` | 20 min |
