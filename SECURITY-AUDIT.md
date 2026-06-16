# Audit de Sécurité — Penya Blaugrana Nantes

**Date :** 2026-06-16  
**Branches analysées :** `claude/sharp-fermi-fkecjv` (commits jusqu'à `003faca`)  
**Stack :** React Router v7 · Node.js · PostgreSQL · Redis · Docker · Better Auth · Drizzle ORM

---

## Résumé des derniers commits

| Hash | Type | Description |
|------|------|-------------|
| `003faca` | fix | Évaluation badges immédiatement après chaque action (post, commentaire, réaction, pronostic) |
| `b1c88f6` | feat | Phase 2 — soirée match live, micro-pronos, badges, séries, saisons |
| `d461ee5` | merge | Fusion branche `deploy-synology-nas` |
| `554b873` | docs | Guide de déploiement NAS Synology |
| `68e22d2` | feat | Menu burger mobile pour la navigation |

Les deux derniers commits fonctionnels (`003faca` et `b1c88f6`) touchent principalement :
- `app/routes/feed.server.ts` — évaluation badges après actions sociales
- `app/routes/match-detail.server.ts` — évaluation badges après pronostic
- Nouvelles routes : `/soiree/:matchId`, `/badges`, `/api/micro-predictions`
- Nouvelles tables DB : `seasons`, `badges`, `user_badges`, `rewards`, `micro_predictions`, `micro_prediction_answers`

---

## Analyse de Sécurité — Par Ordre de Criticité

---

### 🔴 CRITIQUE

---

#### C1 — Path Traversal dans le service de fichiers
**Fichier :** `app/routes/uploads-files.ts`  
**OWASP :** A01:2021 — Broken Access Control  
**Statut :** ✅ **CORRIGÉ** (ce commit)

**Problème :** Le paramètre de route `params["*"]` était utilisé directement dans `path.join()` sans validation. Un attaquant pouvait accéder à des fichiers hors du répertoire `uploads/` via `../../` (ex : `/uploads-files/../../.env` exposait les variables d'environnement).

**Correction appliquée :**
```typescript
const filePath = path.resolve(UPLOADS_DIR, requestedPath);
if (!filePath.startsWith(UPLOADS_DIR + path.sep)) {
  return new Response("Not found", { status: 404 });
}
// Vérification de l'extension avant lecture
if (!ALLOWED_EXTENSIONS.has(ext)) {
  return new Response("Not found", { status: 404 });
}
```

---

#### C2 — Mots de passe par défaut "changeme" en production
**Fichiers :** `docker-compose.yml`, `docker-compose.prod.yml`  
**OWASP :** A02:2021 — Cryptographic Failures  
**Statut :** ✅ **CORRIGÉ** (ce commit)

**Problème :** `POSTGRES_PASSWORD:-changeme` et `REDIS_PASSWORD:-changeme` laissaient les services accessibles avec un mot de passe trivial si les variables d'environnement n'étaient pas définies.

**Correction appliquée :** Remplacement des fallbacks par une erreur explicite au démarrage :
```yaml
- POSTGRES_PASSWORD=${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}
- REDIS_PASSWORD=${REDIS_PASSWORD:?REDIS_PASSWORD is required}
```

---

### 🟠 HAUTE

---

#### H1 — Absence de protection CSRF
**Fichiers :** Toutes les routes `action()` (feed, match-detail, micro-predictions, profil…)  
**OWASP :** A01:2021 — Broken Access Control  
**Statut :** ⚠️ À traiter

**Problème :** Aucun token CSRF n'est implémenté. Les formulaires POST sont vulnérables à des attaques Cross-Site Request Forgery depuis un site malveillant.

**Recommandation :** Générer un token CSRF dans les loaders, le stocker en Redis (TTL 1h), et le valider dans chaque action. Better Auth gère partiellement ce risque via SameSite cookies, à vérifier.

---

#### H2 — Validation insuffisante des données JSON de l'API externe
**Fichier :** `app/routes/soiree.server.ts` (ligne ~250)  
**OWASP :** A03:2021 — Injection  
**Statut :** ⚠️ À traiter

**Problème :**
```typescript
options: m.options ? JSON.parse(m.options) as string[] : [],
```
`JSON.parse()` sans `try/catch` fait crasher le serveur si la donnée DB est corrompue. De plus, le cast `as string[]` ne valide rien.

**Recommandation :**
```typescript
let options: string[] = [];
try {
  const parsed = JSON.parse(m.options);
  options = Array.isArray(parsed) ? parsed.filter(x => typeof x === "string") : [];
} catch {}
```

---

#### H3 — Casts TypeScript `any` contournant la sécurité des types
**Fichiers :** `app/routes/feed.server.ts` (lignes 99, 124, 184, 200), `app/routes/soiree.server.ts` (ligne ~93)  
**OWASP :** A03:2021 — Injection  
**Statut :** ⚠️ À traiter

**Problème :**
```typescript
isAdmin: (session.user as any).role === "admin"
```
Le cast `as any` masque des erreurs de typage et peut conduire à des vérifications d'autorisation incorrectes si le type de session change.

**Recommandation :** Étendre correctement le type `Session` de Better Auth ou utiliser un helper typé :
```typescript
function isAdmin(user: Session["user"]): boolean {
  return (user as { role?: string }).role === "admin";
}
```

---

#### H4 — Absence de vérification de la méthode HTTP sur les endpoints API
**Fichier :** `app/routes/api.micro-predictions.ts`  
**OWASP :** A01:2021 — Broken Access Control  
**Statut :** ⚠️ À traiter

**Problème :** L'`action()` ne vérifie pas que la méthode est `POST`. Des requêtes `GET`, `PUT`, `DELETE` aboutissent au même handler.

**Recommandation :**
```typescript
if (request.method !== "POST") {
  return Response.json({ error: "Method not allowed" }, { status: 405 });
}
```

---

#### H5 — Absence de rate limiting sur les réponses aux micro-pronostics
**Fichier :** `app/routes/api.micro-predictions.ts` (intent `answer`)  
**OWASP :** A04:2021 — Insecure Design  
**Statut :** ⚠️ À traiter (l'utilitaire `checkRateLimit` existe déjà dans `app/lib/server/rate-limit.server.ts`)

**Problème :** Un utilisateur peut spammer des appels à `answer` (l'unicité par user+microId est vérifiée en DB, mais cela génère une charge inutile).

**Recommandation :**
```typescript
await checkRateLimit({ key: `micro-answer:${session.user.id}`, maxAttempts: 30, windowSeconds: 60 });
```

---

#### H6 — Modification de rôles non loggée au niveau WARN
**Fichier :** `app/routes/admin.members.server.ts`  
**OWASP :** A09:2021 — Security Logging and Monitoring Failures  
**Statut :** ⚠️ À traiter

**Problème :** Les modifications de rôles (action critique et irréversible) sont loggées avec `logger.info()` au lieu de `logger.warn()`.

**Recommandation :**
```typescript
logger.warn({ action: "role-changed", memberId, newRole, by: session.user.id }, "ADMIN: rôle modifié");
```

---

### 🟡 MOYENNE

---

#### M1 — Endpoint `/api/health` public avec informations d'infrastructure
**Fichier :** `app/routes/api.health.ts`  
**OWASP :** A01:2021 — Information Disclosure  
**Statut :** ⚠️ À évaluer

**Problème :** L'état détaillé de PostgreSQL et Redis est exposé sans authentification, ce qui peut aider à cartographier l'infrastructure.

**Recommandation :** Limiter la réponse publique à `{ status: "ok" | "degraded" }` ou restreindre aux admins.

---

#### M2 — Absence de headers de sécurité HTTP
**Fichier :** Non configuré (nginx ou `entry.server.ts`)  
**OWASP :** A05:2021 — Security Misconfiguration  
**Statut :** ⚠️ À traiter

**Problème :** Aucun header `Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Options` ni `Referrer-Policy` détecté.

**Recommandation :** Ajouter dans `docker/nginx/nginx.conf` :
```nginx
add_header X-Frame-Options "DENY";
add_header X-Content-Type-Options "nosniff";
add_header Referrer-Policy "strict-origin-when-cross-origin";
add_header Content-Security-Policy "default-src 'self'; img-src 'self' data: https:; font-src 'self';";
```

---

#### M3 — Conteneur Docker s'exécutant en root
**Fichier :** `Dockerfile`  
**OWASP :** A04:2021 — Insecure Design  
**Statut :** ⚠️ À traiter

**Problème :** Aucune directive `USER` dans le Dockerfile. L'application tourne en root dans le conteneur.

**Recommandation :**
```dockerfile
RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001
USER nodejs
```

---

#### M4 — Paramètre `?saison=` non validé dans le classement
**Fichier :** `app/routes/rankings.server.ts`  
**OWASP :** A03:2021 — Injection  
**Statut :** ⚠️ À traiter

**Problème :** `url.searchParams.get("saison")` est utilisé directement dans une clause `where` sans vérification que la valeur correspond à une saison existante.

**Recommandation :** Valider contre la liste des saisons chargées depuis la DB avant utilisation.

---

#### M5 — Stockage JSON brut en colonne `text`
**Fichier :** `app/db/schema/matches.ts` (`matchDetails`) et `app/db/schema/micro-predictions.ts` (`options`)  
**OWASP :** A03:2021 — Data Integrity  
**Statut :** ℹ️ À considérer

**Problème :** Les champs JSON sont stockés en `text` sans contrainte de format. Une migration future vers `jsonb` PostgreSQL apporterait validation, indexation et requêtes plus robustes.

---

#### M6 — Chargement en mémoire de fichiers uploadés
**Fichier :** `app/lib/server/upload.ts`  
**OWASP :** A04:2021 — Insecure Design / DoS  
**Statut :** ⚠️ À surveiller

**Problème :** `Buffer.from(await file.arrayBuffer())` charge le fichier entier en mémoire avant traitement. La limite de 2 Mo est vérifiée après chargement. En cas de requêtes parallèles, cela peut saturer la RAM.

**Recommandation :** Vérifier la taille via `Content-Length` en amont, ou configurer une limite au niveau du reverse proxy nginx.

---

#### M7 — `REDIS_URL` avec valeur par défaut `localhost`
**Fichier :** `app/config/env.server.ts`  
**OWASP :** A02:2021 — Misconfiguration  
**Statut :** ⚠️ À évaluer

**Problème :**
```typescript
REDIS_URL: z.string().default("redis://localhost:6379"),
```
En production, si `REDIS_URL` est absent du `.env`, l'application démarre silencieusement avec une connexion Redis locale non sécurisée.

**Recommandation :**
```typescript
REDIS_URL: z.string().min(1, "REDIS_URL is required"),
```

---

### 🟢 FAIBLE

---

#### F1 — Erreurs Better Auth potentiellement exposées
**Fichier :** `app/routes/api.auth.$.ts`  
**OWASP :** A09:2021 — Security Logging  
**Statut :** ℹ️ À vérifier

**Problème :** Les erreurs non catchées de `auth.handler(request)` pourraient exposer des détails techniques dans la réponse.

---

#### F2 — Profils membres sans contrôle d'accès explicite
**Fichier :** `app/routes/member-profile.server.ts`  
**OWASP :** A01:2021 — Broken Access Control  
**Statut :** ℹ️ Acceptable si voulu

**Problème :** Tout utilisateur authentifié peut voir le profil de n'importe quel autre membre. Comportement probablement voulu pour une communauté, mais devrait être documenté.

---

## Tableau de Synthèse

| ID | Sévérité | Statut | Fichier principal | OWASP |
|----|----------|--------|-------------------|-------|
| C1 | 🔴 CRITIQUE | ✅ Corrigé | `uploads-files.ts` | A01 |
| C2 | 🔴 CRITIQUE | ✅ Corrigé | `docker-compose.prod.yml` | A02 |
| H1 | 🟠 HAUTE | ⚠️ À traiter | Toutes les `action()` | A01 |
| H2 | 🟠 HAUTE | ⚠️ À traiter | `soiree.server.ts` | A03 |
| H3 | 🟠 HAUTE | ⚠️ À traiter | `feed.server.ts` | A03 |
| H4 | 🟠 HAUTE | ⚠️ À traiter | `api.micro-predictions.ts` | A01 |
| H5 | 🟠 HAUTE | ⚠️ À traiter | `api.micro-predictions.ts` | A04 |
| H6 | 🟠 HAUTE | ⚠️ À traiter | `admin.members.server.ts` | A09 |
| M1 | 🟡 MOYENNE | ⚠️ À évaluer | `api.health.ts` | A01 |
| M2 | 🟡 MOYENNE | ⚠️ À traiter | `nginx.conf` | A05 |
| M3 | 🟡 MOYENNE | ⚠️ À traiter | `Dockerfile` | A04 |
| M4 | 🟡 MOYENNE | ⚠️ À traiter | `rankings.server.ts` | A03 |
| M5 | 🟡 MOYENNE | ℹ️ À considérer | Schema DB | A03 |
| M6 | 🟡 MOYENNE | ⚠️ À surveiller | `upload.ts` | A04 |
| M7 | 🟡 MOYENNE | ⚠️ À évaluer | `env.server.ts` | A02 |
| F1 | 🟢 FAIBLE | ℹ️ À vérifier | `api.auth.$.ts` | A09 |
| F2 | 🟢 FAIBLE | ℹ️ Acceptable | `member-profile.server.ts` | A01 |

---

## Points Positifs

- **Authentification centralisée** : `requireAuth()` est utilisé systématiquement sur les routes protégées
- **ORM paramétré** : Drizzle ORM avec requêtes préparées — pas d'injection SQL directe
- **Validation Zod** : Schémas de validation présents pour les formulaires critiques (`predictionSchema`, `createPostSchema`)
- **Rate limiting** : Utilitaire `checkRateLimit` Redis disponible et utilisé sur l'authentification
- **Secrets hors dépôt** : `.env` dans `.gitignore`, `.env.example` sans secrets réels
- **Logging structuré** : Pino utilisé avec contexte (userId, action) sur toutes les routes sensibles
- **Vérifications de propriété** : Avant suppression de posts/commentaires, ownership vérifié côté serveur
- **Deadline côté serveur** : La deadline des pronostics est re-vérifiée en DB à chaque soumission
