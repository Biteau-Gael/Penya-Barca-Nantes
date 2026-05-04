# Audit de Sécurité — Penya Blaugrana Nantes

**Date** : 2026-05-04  
**Branche analysée** : `main` (dernier commit : `003faca`)  
**Périmètre** : code applicatif, configuration Docker, gestion des sessions, API, uploads

---

## Résumé des derniers commits

| Hash | Date | Auteur | Description |
|------|------|--------|-------------|
| `003faca` | 2026-04-13 | Biteau Gaël | fix: évaluer les badges immédiatement après chaque action |
| `b1c88f6` | 2026-04-13 | Biteau Gaël | feat: Phase 2 — soirée match live, micro-pronos, badges, séries, saisons |
| `d461ee5` | 2026-04-12 | Claude | Merge branch deploy-synology-nas |
| `554b873` | 2026-04-12 | Claude | Add deployment guide for Synology NAS updates |
| `68e22d2` | 2026-04-13 | Biteau Gaël | feat: menu burger mobile pour la navigation |
| `6aebaf7` | 2026-04-12 | Claude | Fix Better Auth trusted origins for custom domain support |
| `9823bc5` | 2026-04-12 | Claude | Add migrate service to docker-compose.prod.yml |
| `8d6e5e9` | 2026-04-12 | Claude | Add production Docker Compose and backup script |
| `aed5841` | 2026-04-12 | Biteau Gaël | **security: supprimer credentials du repo et renforcer .gitignore** |
| `6583da3` | 2026-04-12 | Biteau Gaël | docs: README complet avec guide de déploiement NAS Synology |
| `ab7fc5d` | 2026-04-12 | Biteau Gaël | feat: intégration API Football + stats enrichies + classement Liga |
| `16c43e6` | 2026-04-11 | Biteau Gaël | feat: MVP Phase 1 — Penya Blaugrana Nantes |

---

## Constatations de sécurité par ordre de criticité

---

### 🔴 CRITIQUE — Path Traversal sur le service d'uploads

**Fichier** : `app/routes/uploads-files.ts`

**Description** :  
Le paramètre wildcard `params["*"]` est concaténé directement avec `path.join()` sans aucune vérification de chemin. La fonction `path.join` normalise les segments `..` mais ne les confine pas dans le répertoire cible. Un attaquant peut sortir du dossier `uploads/` et lire n'importe quel fichier accessible au processus Node.

**Preuve** :
```ts
// Requête : GET /uploads/../../etc/passwd
const filePath = path.join(process.cwd(), "uploads", params["*"]);
// Résultat : /etc/passwd  ← fichier système lisible
```

**Impact** : Lecture arbitraire de fichiers sur le serveur (secrets, `.env`, code source compilé, clés privées).

**Correction recommandée** :
```ts
export async function loader({ params }: { params: { "*": string } }) {
  const safeName = path.basename(params["*"]);           // supprime tout chemin
  const uploadsDir = path.join(process.cwd(), "uploads");
  const filePath = path.join(uploadsDir, safeName);

  // Vérification canonique
  if (!filePath.startsWith(uploadsDir + path.sep)) {
    return new Response("Forbidden", { status: 403 });
  }
  // ... reste inchangé
}
```

---

### 🔴 CRITIQUE — Absence totale de headers de sécurité HTTP

**Fichier** : `app/root.tsx`, aucun middleware identifié

**Description** :  
Aucun header de sécurité HTTP n'est positionné dans l'application ni dans la configuration Docker. Les headers suivants sont absents :

| Header | Risque |
|--------|--------|
| `Content-Security-Policy` | XSS, injection de scripts tiers |
| `X-Frame-Options` / `frame-ancestors` | Clickjacking |
| `X-Content-Type-Options: nosniff` | MIME sniffing |
| `Referrer-Policy` | Fuite d'URL vers des tiers |
| `Permissions-Policy` | Accès aux APIs sensibles (caméra, géoloc) |
| `Strict-Transport-Security` | Forçage HTTPS (HSTS) |

**Impact** : Exposition aux attaques XSS, clickjacking et fuite de données de navigation.

**Correction recommandée** : Ajouter un middleware React Router dans `entry.server.tsx` ou configurer Nginx en reverse proxy avec ces headers.

---

### 🟠 HAUTE — Mots de passe Docker par défaut en production

**Fichier** : `docker-compose.prod.yml`

**Description** :
```yaml
POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-changeme}
REDIS_PASSWORD:  redis-server --requirepass ${REDIS_PASSWORD:-changeme}
```
Si les variables d'environnement ne sont pas définies au déploiement, les bases de données utilisent le mot de passe `changeme`, exposant potentiellement les données en production.

**Impact** : Accès complet à la base de données PostgreSQL et Redis si le port est accessible.

**Correction recommandée** : Supprimer les valeurs fallback (`:-changeme`) pour que le démarrage échoue explicitement si les variables sont manquantes. Documenter l'obligation dans `DEPLOY.md`.

---

### 🟠 HAUTE — Absence de rate limiting sur les API sensibles

**Fichier** : `app/routes/api.micro-predictions.ts`, `app/routes/soiree.server.ts`

**Description** :  
Le rate limiting est correctement implémenté sur `/api/auth` (login 10 req/15min, register 5 req/h). Cependant, les routes suivantes ne sont pas protégées :
- `POST /api/micro-predictions` (réponses aux pronos en direct)
- `GET /soiree` (appels API-Football potentiellement quotés)
- Actions admin (création/suppression de données)

**Impact** : Spam de réponses aux micro-pronos, épuisement du quota API-Football (coût financier), abus des actions admin.

**Correction recommandée** : Appliquer `checkRateLimit` sur les endpoints d'action, en particulier le dépôt de réponses (`intent === "answer"`).

---

### 🟠 HAUTE — Réponse aux micro-pronos non validée contre les options QCM

**Fichier** : `app/routes/api.micro-predictions.ts`, lignes 87–115

**Description** :  
Lors d'une réponse (intent `answer`), le champ `answer` est stocké sans être validé contre les `options` définies dans le micro-pronostic (type QCM). N'importe quelle valeur textuelle est acceptée.

```ts
// Aucune vérification que `answer` fait partie des options autorisées
await db.insert(microPredictionAnswers).values({
  id: createId(),
  microPredictionId: microId,
  userId: session.user.id,
  answer,   // ← valeur libre, non contrainte
});
```

**Impact** : Possible manipulation des scores si la comparaison lors de la clôture (`answer.toLowerCase().trim() === correctAnswer.toLowerCase().trim()`) peut être influencée. Intégrité des données compromise.

**Correction recommandée** : Charger les `options` du micro-pronostic et vérifier que `answer` est dans la liste avant insertion.

---

### 🟠 HAUTE — Délai de fermeture des micro-pronos non appliqué côté serveur

**Fichier** : `app/routes/api.micro-predictions.ts`, lignes 80–115

**Description** :  
Le champ `deadlineSeconds` est stocké en base mais jamais vérifié lors d'une soumission de réponse. La seule protection est l'existence de `closedAt` (clôture manuelle par l'admin). Un membre peut soumettre une réponse après l'expiration du délai, avant que l'admin ne clôture manuellement.

**Impact** : Triche possible en soumettant une réponse après avoir vu le résultat du match.

**Correction recommandée** : Calculer `createdAt + deadlineSeconds` et rejeter les réponses soumises après ce délai.

---

### 🟡 MODÉRÉE — Validation du consentement GDPR uniquement côté client

**Fichier** : `app/routes/register.tsx`, lignes 44–55

**Description** :  
La vérification GDPR est faite via Zod côté client (`gdprConsent: z.literal(true)`), mais l'appel effectif à `signUp.email` envoie systématiquement `gdprConsent: true` sans relire la valeur réelle de la case.

```ts
// La case peut être décochée, mais gdprConsent est toujours true ici
await signUp.email({
  gdprConsent: true,  // ← valeur hardcodée
});
```

**Impact** : Non-conformité RGPD potentielle. Un utilisateur peut contourner le consentement si le JS est manipulé.

**Correction recommandée** : Lire la valeur réelle depuis `raw.gdprConsent` et la passer à `signUp.email`. Ajouter une validation serveur dans Better Auth si possible.

---

### 🟡 MODÉRÉE — IP client via X-Forwarded-For potentiellement falsifiable

**Fichier** : `app/routes/api.auth.$.ts`, lignes 5–11

**Description** :  
```ts
request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
```
Le header `x-forwarded-for` peut être forgé par un client si le reverse proxy n'est pas configuré pour le réécrire. Sans validation de la source du proxy, un attaquant peut contourner le rate limiting en changeant ce header.

**Impact** : Contournement du rate limiting sur login/inscription.

**Correction recommandée** : S'assurer que le reverse proxy (Nginx/Synology) remplace (et non ajoute) le header `X-Forwarded-For`. Utiliser `X-Real-IP` en priorité avec une allowlist de proxies de confiance.

---

### 🟡 MODÉRÉE — `APP_URL` optionnel et `trustedOrigins` vide

**Fichier** : `app/lib/server/auth.server.ts`, ligne 13

**Description** :
```ts
trustedOrigins: env.APP_URL ? [env.APP_URL] : [],
```
Si `APP_URL` n'est pas définie (valeur optionnelle dans le schéma), `trustedOrigins` est `[]`. Le comportement de Better Auth avec un tableau vide dépend de l'implémentation interne et peut être permissif (toutes origines acceptées) ou bloquant.

**Impact** : Risque de CSRF ou de sessions acceptées depuis des origines non prévues en production si Better Auth traite `[]` comme "aucune restriction".

**Correction recommandée** : Rendre `APP_URL` obligatoire en production (`z.string()` sans `.optional()`), ou définir explicitement l'URL dans le `.env` de production.

---

### 🟡 MODÉRÉE — Validation MIME d'upload basée sur `file.type` (spoofable)

**Fichier** : `app/lib/server/upload.ts`, ligne 12

**Description** :
```ts
if (!ALLOWED_TYPES.includes(file.type)) { ... }
```
La propriété `file.type` provient du client et peut être forgée (un fichier `.php` renommé avec `Content-Type: image/jpeg`). Sharp retraite cependant l'image, ce qui neutralise la plupart des exploits en pratique.

**Impact** : Faible grâce au retraitement Sharp, mais la validation est trompeuse. Des formats malformés peuvent déclencher des vulnérabilités dans Sharp.

**Correction recommandée** : Vérifier les magic bytes (premiers octets du buffer) avant le traitement Sharp pour confirmer le type réel du fichier.

---

### 🟢 FAIBLE — `pointsValue` sans borne supérieure

**Fichier** : `app/routes/api.micro-predictions.ts`, ligne 25

**Description** :  
```ts
const pointsValue = parseInt(formData.get("pointsValue") as string) || 1;
```
Seul le rôle admin est vérifié, mais aucune borne n'est imposée sur la valeur de points. Un admin pourrait (intentionnellement ou par erreur) créer un pronostic valant 1 000 000 points.

**Impact** : Intégrité du classement si un admin est compromis ou commet une erreur.

**Correction recommandée** : Ajouter une validation Zod (`z.number().min(1).max(10)`) sur `pointsValue`.

---

### 🟢 FAIBLE — Image Docker construite en root

**Fichier** : `Dockerfile`

**Description** :  
Le conteneur final tourne sous `root` (aucun `USER` défini). En cas de compromission de l'application, l'attaquant dispose de tous les droits dans le conteneur.

**Impact** : Escalade de privilèges facilitée en cas de fuite de conteneur.

**Correction recommandée** : Ajouter `RUN addgroup -S app && adduser -S app -G app` et `USER app` dans le `Dockerfile`.

---

## Points positifs identifiés

| Domaine | Constat |
|---------|---------|
| Authentification | Better Auth correctement intégré avec sessions Redis |
| Rate limiting auth | Login (10/15min) et register (5/h) protégés |
| Validation des inputs | Zod utilisé systématiquement (pseudo, email, password) |
| Contrôle d'accès | `requireAuth` + vérification de rôle sur toutes les routes admin |
| Protection auto-modification | Un admin ne peut pas changer son propre rôle |
| Secrets hors dépôt | `.gitignore` renforcé, credentials supprimés (commit `aed5841`) |
| Retraitement d'images | Sharp redimensionne et reconvertit les avatars (mitigation upload) |
| Logs structurés | Actions sensibles journalisées avec Pino |
| Variables d'environnement | Validation Zod au démarrage (`env.server.ts`) |
| ORM typé | Drizzle ORM — pas de requêtes SQL brutes (injection SQL inexistante) |

---

## Tableau récapitulatif

| # | Criticité | Titre | Fichier |
|---|-----------|-------|---------|
| 1 | 🔴 CRITIQUE | Path traversal sur les uploads | `app/routes/uploads-files.ts` |
| 2 | 🔴 CRITIQUE | Absence de headers de sécurité HTTP | `app/root.tsx` / infra |
| 3 | 🟠 HAUTE | Mots de passe Docker par défaut | `docker-compose.prod.yml` |
| 4 | 🟠 HAUTE | Pas de rate limiting sur micro-pronos | `app/routes/api.micro-predictions.ts` |
| 5 | 🟠 HAUTE | Réponse QCM non validée contre les options | `app/routes/api.micro-predictions.ts` |
| 6 | 🟠 HAUTE | Délai micro-prono non appliqué serveur | `app/routes/api.micro-predictions.ts` |
| 7 | 🟡 MODÉRÉE | Consentement GDPR uniquement côté client | `app/routes/register.tsx` |
| 8 | 🟡 MODÉRÉE | IP rate-limit falsifiable via X-Forwarded-For | `app/routes/api.auth.$.ts` |
| 9 | 🟡 MODÉRÉE | `APP_URL` optionnel → `trustedOrigins` vide | `app/lib/server/auth.server.ts` |
| 10 | 🟡 MODÉRÉE | Validation MIME côté client pour les uploads | `app/lib/server/upload.ts` |
| 11 | 🟢 FAIBLE | `pointsValue` sans borne supérieure | `app/routes/api.micro-predictions.ts` |
| 12 | 🟢 FAIBLE | Conteneur Docker tourne en root | `Dockerfile` |
