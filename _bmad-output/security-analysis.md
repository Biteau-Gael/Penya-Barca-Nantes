# Analyse de Sécurité — Penya Blaugrana Nantes
**Date** : 27 avril 2026  
**Branche analysée** : `claude/sharp-fermi-jPFFG`  
**Derniers commits couverts** :
- `003faca` — fix: évaluer les badges immédiatement après chaque action (13 avr. 2026)
- `b1c88f6` — feat: Phase 2 — soirée match live, micro-pronos, badges, séries, saisons (13 avr. 2026)

---

## Résumé des derniers commits

### `003faca` — Fix badges en temps réel
Correction du déclenchement des badges après chaque action utilisateur :
- Soumission de pronostic → badges "Premier pas", "Régulier", "Fidèle"
- Publication de post → badge "Auteur"
- Publication de commentaire → badge "Commentateur"
- Réaction à un post → badge "Réactif"

Fichiers modifiés : `feed.server.ts`, `match-detail.server.ts` (+6 lignes)

### `b1c88f6` — Phase 2 complète (Sprint 2, 3, 5)
Ajout de 26 fichiers, 2965 lignes. Périmètre :

| Sprint | Fonctionnalité | Détail |
|--------|----------------|--------|
| Sprint 2 | Soirée match live | Route `/soiree/:matchId`, score live (polling 60s), fil du match temps réel, pronos révélés au coup d'envoi |
| Sprint 3 | Micro-pronostics | Création admin, vote joueur, clôture avec points automatiques, suppression admin |
| Sprint 3 | Séries | `currentStreak` / `bestStreak` sur l'utilisateur, récompenses aux paliers 3/5/10 |
| Sprint 5 | Badges | 10 badges avec évaluation automatique, page `/badges`, affichage sur le profil |
| Sprint 5 | Saisons | Table `seasons`, classement filtré par saison, support archives |

Schéma DB : migration `0007` — nouvelles tables `seasons`, `badges`, `user_badges`, `rewards`, `micro_predictions`, `micro_prediction_answers`.

---

## Analyse de Sécurité

### Points forts constatés

- ORM Drizzle utilisé partout → pas d'injection SQL
- `requireAuth` appliqué sur toutes les routes protégées
- Validation Zod sur tous les formulaires (inscription, connexion, posts, commentaires, matchs, pronostics)
- Rate limiting Redis sur login (10/15 min) et inscription (5/h)
- Protection anti-auto-modification du rôle admin
- Variables d'environnement validées par schéma Zod au démarrage
- Aucun secret hardcodé dans le code source
- Consentement GDPR requis à l'inscription
- Logs structurés (pino) sans données sensibles dans les champs loggés

---

## Vulnérabilités par ordre de criticité

---

### CRITIQUE — C1 : Path Traversal dans le service de fichiers uploadés

**Fichier** : `app/routes/uploads-files.ts:5`  
**Risque** : Lecture arbitraire de fichiers sur le serveur (`.env`, clés, base de données)

**Description** : Le paramètre wildcard `params["*"]` est concaténé directement dans `path.join()` sans vérification que le chemin résultant reste dans le répertoire `uploads/`. Un attaquant peut envoyer une requête vers `/uploads/../../.env` pour lire le fichier `.env` contenant `DATABASE_URL`, `AUTH_SECRET` et `API_FOOTBALL_KEY`.

```ts
// Actuel — vulnérable
const filePath = path.join(process.cwd(), "uploads", params["*"]);
// path.join("/app", "uploads", "../../.env") → "/app/.env"
```

**Correction** :
```ts
const filePath = path.join(process.cwd(), "uploads", params["*"]);
const uploadsRoot = path.join(process.cwd(), "uploads");
if (!filePath.startsWith(uploadsRoot + path.sep)) {
  return new Response("Forbidden", { status: 403 });
}
```

---

### HAUTE — H1 : Absence de headers de sécurité HTTP

**Fichier** : `app/root.tsx` (aucun header configuré)  
**Risque** : Clickjacking, MIME sniffing, XSS via absence de CSP

**Description** : Aucun middleware ni loader ne définit les headers de sécurité HTTP standards. Sans ces headers, le navigateur est exposé à plusieurs vecteurs d'attaque.

Headers manquants :

| Header | Impact de l'absence |
|--------|---------------------|
| `Content-Security-Policy` | XSS si une injection HTML se produit |
| `X-Frame-Options: DENY` | Clickjacking (iframe de la page) |
| `X-Content-Type-Options: nosniff` | MIME sniffing sur les uploads |
| `Strict-Transport-Security` | Downgrade HTTP en production |
| `Referrer-Policy` | Fuite d'URL interne dans les headers |

**Correction** : Ajouter un header handler dans `react-router.config.ts` ou un middleware Express.

---

### HAUTE — H2 : Endpoint `/api/health` non authentifié, exposant l'infrastructure

**Fichier** : `app/routes/api.health.ts`  
**Risque** : Reconnaissance de l'infrastructure (PostgreSQL, Redis)

**Description** : L'endpoint répond avec le statut détaillé de chaque service interne sans aucune authentification. Un attaquant peut savoir si la base de données ou le cache sont opérationnels, faciliter la planification d'attaques.

```json
// Réponse publique actuelle
{ "status": "ok", "services": { "db": "ok", "redis": "ok" } }
```

**Correction** : Ajouter une vérification d'un token secret en header (`Authorization: Bearer <HEALTH_TOKEN>`) ou restreindre l'accès réseau à l'internal Docker network.

---

### HAUTE — H3 : Rate limiting contournable par IP spoofing

**Fichier** : `app/routes/api.auth.$.ts:7-11`  
**Risque** : Brute force sur les comptes si le proxy n'est pas maîtrisé

**Description** : La fonction `getClientIp` lit `x-forwarded-for` qui peut être falsifié par un attaquant s'il a accès direct au serveur (sans reverse proxy de confiance). Sans configuration de trusted proxies, le rate limiting par IP devient inefficace.

```ts
// Un attaquant peut envoyer X-Forwarded-For: 1.2.3.4 dans sa requête
const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || ...
```

**Correction** : Configurer le reverse proxy (Nginx/Traefik) pour supprimer tout header `X-Forwarded-For` entrant et n'en injecter qu'un seul de confiance. Documenter cette exigence dans `DEPLOY.md`.

---

### MOYENNE — M1 : Validation MIME insuffisante pour les uploads (magic bytes)

**Fichier** : `app/lib/server/upload.ts:12-14`  
**Risque** : Upload de fichiers malveillants déguisés en images

**Description** : La vérification `file.type` est fournie par le client et peut être falsifiée (ex. un fichier PHP renommé `.jpg` avec `Content-Type: image/jpeg`). La bibliothèque `sharp` rejette les fichiers non-images à l'exécution, mais sans message d'erreur contrôlé.

**Correction** : Lire les premiers octets du buffer pour vérifier la signature (magic bytes) avant de passer à `sharp` :
```ts
// Vérifier magic bytes (JPEG: FF D8 FF, PNG: 89 50 4E 47, WebP: 52 49 46 46)
const magicBytes = buffer.slice(0, 4);
```
Ou utiliser la bibliothèque `file-type`.

---

### MOYENNE — M2 : Absence de rate limiting sur les actions de contenu

**Fichier** : `app/routes/feed.server.ts`  
**Risque** : Spam de posts, commentaires et réactions par un utilisateur authentifié

**Description** : Les actions `create-post`, `comment` et `react` n'ont aucune limitation de débit. Un utilisateur mal intentionné peut inonder le fil d'actualité ou générer des milliers de réactions automatiquement.

**Correction** : Appliquer `checkRateLimit` avec la clé `post:${userId}` (ex. 10 posts/h) et `comment:${userId}` (ex. 30 commentaires/h).

---

### MOYENNE — M3 : Absence de validation sur les champs des micro-pronostics (admin)

**Fichier** : `app/routes/api.micro-predictions.ts:25-33`  
**Risque** : Injection de contenu excessif ou malformé dans la base de données

**Description** : Les champs `question`, `options`, `pointsValue` et `deadlineSeconds` ne sont soumis à aucune validation de longueur ou de type côté serveur pour les actions admin `create` et `close`.

```ts
const question = formData.get("question") as string; // pas de longueur max
const pointsValue = parseInt(formData.get("pointsValue") as string) || 1; // pas de min/max
```

**Correction** : Ajouter un schéma Zod similaire aux autres routes.

---

### FAIBLE — F1 : Mot de passe Docker par défaut en production

**Fichier** : `docker-compose.prod.yml:21`  
**Risque** : Accès non autorisé à la base de données si `.env` non configuré

**Description** : `POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-changeme}` utilise `changeme` comme fallback. Si le fichier `.env` de production est absent ou incomplet, PostgreSQL démarrera avec ce mot de passe trivial.

**Correction** : Supprimer le fallback pour forcer une erreur explicite au démarrage :
```yaml
POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?POSTGRES_PASSWORD must be set}
```

---

### FAIBLE — F2 : Backup SQL non chiffré

**Fichier** : `backup.sh`  
**Risque** : Exposition des données si le volume NAS est compromis

**Description** : Les dumps PostgreSQL sont écrits en clair sur le volume Synology. Toute compromission du NAS expose la totalité des données utilisateurs et de l'application.

**Correction** : Chiffrer les dumps avec `gpg` ou `openssl` avant écriture :
```bash
pg_dump ... | gzip | openssl enc -aes-256-cbc -pass env:BACKUP_PASSPHRASE > "$BACKUP_DIR/penya_$DATE.sql.gz.enc"
```

---

### FAIBLE — F3 : Cast `(session.user as any).role` dans plusieurs fichiers

**Fichiers** : `app/routes/feed.server.ts:97`, `feed.server.ts:138`  
**Risque** : Contournement silencieux de la vérification de rôle si le type change

**Description** : L'utilisation de `(session.user as any).role` contourne le système de types TypeScript. Si le champ `role` est renommé ou restructuré dans Better Auth, la vérification d'autorisation silencieusement échouera.

**Correction** : Utiliser `requireAuth(request, ["admin"])` qui lève une erreur 403 plutôt que tester le rôle manuellement après coup.

---

## Tableau récapitulatif

| ID | Criticité | Fichier | Impact | Effort correction |
|----|-----------|---------|--------|-------------------|
| C1 | CRITIQUE | `uploads-files.ts:5` | Lecture de fichiers arbitraires (`.env`, secrets) | Faible (2 lignes) |
| H1 | HAUTE | `root.tsx` / config | Clickjacking, XSS, MIME sniffing | Moyen (middleware) |
| H2 | HAUTE | `api.health.ts` | Reconnaissance infrastructure | Faible (1 check) |
| H3 | HAUTE | `api.auth.$.ts:7` | Bypass rate limiting par IP spoofing | Moyen (infra + doc) |
| M1 | MOYENNE | `upload.ts:12` | Upload fichier malveillant | Faible (magic bytes) |
| M2 | MOYENNE | `feed.server.ts` | Spam de contenu | Faible (rate limit) |
| M3 | MOYENNE | `api.micro-predictions.ts:25` | Données malformées en DB | Faible (schéma Zod) |
| F1 | FAIBLE | `docker-compose.prod.yml:21` | Mot de passe trivial si `.env` absent | Trivial (1 ligne) |
| F2 | FAIBLE | `backup.sh` | Données en clair sur NAS | Moyen (script gpg) |
| F3 | FAIBLE | `feed.server.ts:97,138` | Contournement de typage | Trivial (refactor) |

---

## Priorités d'action recommandées

1. **Immédiat** : Corriger C1 (path traversal) — risque critique, correctif trivial
2. **Court terme** : F1 (docker default password), H2 (health endpoint sans auth), M3 (validation micro-pronos)
3. **Moyen terme** : H1 (security headers), H3 (IP trust chain), M1 (magic bytes), M2 (rate limit contenu)
4. **Planifié** : F2 (chiffrement backups), F3 (cast any.role)
