# Rapport d'analyse de sécurité — Penya Blaugrana Nantes

**Date d'analyse :** 10 juillet 2026  
**Branche analysée :** `main` (HEAD `003faca`)  
**Périmètre :** Revue des commits récents + audit des conventions de sécurité

---

## Résumé des derniers commits

| Hash | Date | Description |
|------|------|-------------|
| `003faca` | 13 avr. 2026 | **fix:** évaluer les badges immédiatement après chaque action (pronostic, post, commentaire, réaction) |
| `b1c88f6` | 13 avr. 2026 | **feat:** Phase 2 — soirée match live, micro-pronos, badges, séries, saisons (+2 965 lignes) |
| `d461ee5` | 12 avr. 2026 | **merge:** intégration branche `deploy-synology-nas-cLkOL` |
| `68e22d2` | 13 avr. 2026 | **feat:** menu burger mobile pour la navigation |
| `6aebaf7` | 12 avr. 2026 | **fix:** Better Auth trusted origins pour support domaine custom |
| `9823bc5` | 12 avr. 2026 | **feat:** ajout service `migrate` dans `docker-compose.prod.yml` |
| `8d6e5e9` | 12 avr. 2026 | **feat:** Docker Compose production + script de backup Synology NAS |
| `aed5841` | antérieur | **security:** suppression des credentials du repo et renforcement `.gitignore` |

La Phase 2 (`b1c88f6`) représente le gros du travail récent : 26 fichiers modifiés couvrant les micro-pronostics en temps réel, le système de badges, les séries de scores et la page soirée de match.

---

## Analyse de sécurité — Résultats par ordre de criticité

---

### 🔴 CRITIQUE — Path Traversal sur le serveur de fichiers uploadés

**Fichier :** `app/routes/uploads-files.ts` — ligne 5  
**Commit concerné :** Présent depuis le MVP Phase 1

**Description :**  
Le paramètre wildcard de l'URL (`params["*"]`) est concaténé directement dans un chemin fichier sans vérification de sortie du répertoire autorisé.

```typescript
// Code actuel — vulnérable
const filePath = path.join(process.cwd(), "uploads", params["*"]);
```

`path.join` normalise les segments `..`, ce qui permet à un attaquant d'accéder à n'importe quel fichier lisible par le processus Node.js :

```
GET /uploads/../../.env         → lit le fichier .env (DATABASE_URL, AUTH_SECRET…)
GET /uploads/../../etc/passwd   → lit les utilisateurs système
```

**Impact :** Exposition de secrets applicatifs (clé API, secret d'authentification, URL de base de données).

**Correction appliquée :**
```typescript
const uploadsDir = path.resolve(process.cwd(), "uploads");
const filePath = path.resolve(uploadsDir, params["*"]);
if (!filePath.startsWith(uploadsDir + path.sep)) {
  return new Response("Forbidden", { status: 403 });
}
```

---

### 🔴 CRITIQUE — Délai des micro-pronostics non appliqué côté serveur

**Fichiers :** `app/routes/api.micro-predictions.ts` (ligne 74), `app/db/schema/micro-predictions.ts`  
**Commit concerné :** `b1c88f6`

**Description :**  
Le timer de réponse (`deadlineSeconds`) n'est affiché que côté client (countdown UI). Côté serveur, la vérification ne porte que sur `closedAt` (clôture manuelle par un admin) :

```typescript
// Seule vérification serveur — insuffisante
if (!micro || micro.closedAt) {
  return Response.json({ error: "Micro-pronostic fermé" }, { status: 400 });
}
```

Un utilisateur qui ignore le décompte peut soumettre une réponse après expiration du délai, tant que l'admin n'a pas manuellement clôturé le micro-pronostic.

**Impact :** Contournement des règles du jeu, avantage déloyal sur les autres participants.

**Correction recommandée :**
```typescript
const now = new Date();
const expiresAt = new Date(micro.createdAt.getTime() + micro.deadline * 1000);
if (now > expiresAt) {
  return Response.json({ error: "Délai de réponse dépassé" }, { status: 400 });
}
```

---

### 🟠 HAUTE — Bug de nommage du champ `deadline` (valeur jamais sauvegardée)

**Fichiers :** `app/routes/api.micro-predictions.ts` (ligne 39), `app/routes/soiree.server.ts` (ligne 252)  
**Commit concerné :** `b1c88f6`

**Description :**  
Double incohérence entre le nom du champ ORM et les usages :

1. **Création** — la variable locale `deadlineSeconds` est passée à Drizzle avec le mauvais nom de champ :
   ```typescript
   // ❌ deadlineSeconds n'existe pas dans le schéma
   await db.insert(microPredictions).values({ ..., deadlineSeconds });
   // ✅ Correct : deadline: deadlineSeconds
   ```
   Résultat : Drizzle ignore silencieusement la valeur et applique le défaut de 120 secondes, quelle que soit la valeur saisie par l'admin.

2. **Lecture** dans `soiree.server.ts` :
   ```typescript
   // ❌ m.deadlineSeconds est undefined, le champ s'appelle m.deadline
   deadlineSeconds: m.deadlineSeconds,
   ```
   Résultat : le timer côté client reçoit toujours `undefined` et ne s'affiche pas correctement.

**Impact :** Le délai configurable ne fonctionne pas du tout ; la valeur est systématiquement 120 s.

---

### 🟡 MOYENNE — Mots de passe par défaut dans la configuration Docker de production

**Fichier :** `docker-compose.prod.yml`

**Description :**  
Les variables d'environnement utilisent `changeme` comme valeur de repli si le fichier `.env` est absent :

```yaml
POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-changeme}
command: redis-server --requirepass ${REDIS_PASSWORD:-changeme}
```

Si le déploiement sur NAS est effectué sans fichier `.env` correctement renseigné, la base de données et Redis démarrent avec des mots de passe connus publiquement.

**Impact :** Accès non autorisé aux données si les ports 5432/6379 sont exposés (même localement sur le NAS).

**Correction recommandée :** Supprimer les valeurs de repli pour forcer une erreur explicite au démarrage :
```yaml
POSTGRES_PASSWORD=${POSTGRES_PASSWORD:?Variable POSTGRES_PASSWORD requise}
```

---

### 🟡 MOYENNE — Absence de rate limiting sur les endpoints d'action métier

**Fichier :** `app/routes/api.micro-predictions.ts`, `app/routes/feed.server.ts`

**Description :**  
Le rate limiting est correctement implémenté sur les endpoints d'authentification (`/api/auth/sign-in` : 10 req/15 min, `/api/auth/sign-up` : 5 req/h). En revanche, les endpoints d'action métier n'ont aucune protection :

- `POST /api/micro-predictions` : soumission de réponses sans limite
- Actions du fil (posts, commentaires, réactions) : sans limite

**Impact :** Possibilité de spammer le fil d'actualité ou de soumettre des réponses en masse, perturbant l'expérience des autres membres.

**Correction recommandée :** Appliquer un rate limit par userId sur les actions de création (ex. : 20 req/min pour les réponses micro-pronostic).

---

### 🟢 FAIBLE — Accès direct à `process.env` contournant la validation Zod

**Fichiers :** `app/lib/server/logger.server.ts`, `app/lib/server/redis.server.ts`, `app/db/client.ts`

**Description :**  
Trois modules accèdent à `process.env` directement au lieu d'utiliser `getEnv()` qui valide et type les variables via Zod :

```typescript
// logger.server.ts
level: process.env.LOG_LEVEL || "info"

// redis.server.ts
new Redis(process.env.REDIS_URL || "redis://localhost:6379")

// db/client.ts
connectionString: process.env.DATABASE_URL
```

**Impact :** Une variable mal configurée ou absente n'est détectée qu'au runtime lors de la première utilisation, pas au démarrage de l'application.

---

### 🟢 FAIBLE — Absence d'en-têtes HTTP de sécurité

**Périmètre :** Application entière

**Description :**  
Aucun en-tête de sécurité HTTP n'est configuré : pas de `Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Options`, ni `Strict-Transport-Security`.

**Impact :** Exposition à des attaques XSS (via CSP), clickjacking (via X-Frame-Options), MIME sniffing. Risque limité si l'application est strictement interne au NAS, plus significatif si exposée sur Internet.

**Correction recommandée :** Ajouter un middleware dans `entry.server.tsx` ou configurer un reverse-proxy (nginx) avec les en-têtes appropriés.

---

## Ce qui est bien fait

- **`.gitignore`** : `.env` correctement exclu depuis `aed5841`
- **`.env.example`** : fourni avec des placeholders explicites, aucun secret réel
- **Validation des variables d'environnement** : schéma Zod dans `env.server.ts` avec `AUTH_SECRET` minimum 16 caractères
- **Rate limiting sur l'authentification** : implémenté via Redis, avec des fenêtres adaptées (login/register)
- **RBAC cohérent** : `requireAuth(request, ["admin"])` utilisé systématiquement sur toutes les routes admin
- **Protection self-modification** : un admin ne peut pas modifier son propre rôle ni se supprimer
- **Validation des inputs** : schémas Zod pour posts, commentaires et profil
- **Upload d'avatars sécurisé** : limitation à 2 Mo, types MIME restreints, retraitement par `sharp` qui neutralise les métadonnées et force la conversion WebP
- **ORM Drizzle** : requêtes paramétrées, pas d'injection SQL possible
- **Logs structurés** : `pino` avec niveaux, sans données sensibles visibles dans les logs

---

## Priorité de traitement

| Priorité | Problème | Effort estimé |
|----------|----------|---------------|
| 🔴 Immédiat | Path Traversal (`uploads-files.ts`) | 10 min — **corrigé dans ce commit** |
| 🔴 Court terme | Délai micro-pronostic non vérifié serveur | 30 min |
| 🟠 Court terme | Bug champ `deadline` / `deadlineSeconds` | 15 min |
| 🟡 Moyen terme | Mots de passe par défaut Docker prod | 5 min |
| 🟡 Moyen terme | Rate limiting endpoints métier | 1h |
| 🟢 Long terme | En-têtes HTTP sécurité | 1h |
| 🟢 Long terme | Centraliser accès `process.env` | 30 min |
