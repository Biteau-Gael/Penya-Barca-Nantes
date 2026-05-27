# Audit de Sécurité — Penya Barca Nantes

> **Date :** 27 mai 2026  
> **Branche analysée :** `main` (HEAD : `003faca`)  
> **Périmètre :** Code source, configuration Docker, infrastructure

---

## 1. Résumé des derniers commits

| Hash | Date | Type | Description |
|------|------|------|-------------|
| `003faca` | 13 avr. 2026 | `fix` | Évaluation immédiate des badges après chaque action (pronostic, post, commentaire, réaction) |
| `b1c88f6` | 13 avr. 2026 | `feat` | **Phase 2 complète** — soirée match live, micro-pronos, badges, séries, saisons |
| `d461ee5` | 12 avr. 2026 | `merge` | Fusion branche `deploy-synology-nas-cLkOL` |
| `68e22d2` | 13 avr. 2026 | `feat` | Menu burger mobile pour la navigation |
| `4a65a7b` | 13 avr. 2026 | `merge` | PR #2 — déploiement Synology NAS |
| `6aebaf7` | 12 avr. 2026 | `fix` | Correction Better Auth : trusted origins pour domaine custom |
| `9823bc5` | 12 avr. 2026 | `fix` | Service `migrate` ajouté dans `docker-compose.prod.yml` |
| `554b873` | 12 avr. 2026 | `docs` | Guide de mise à jour déploiement NAS Synology |
| `8d6e5e9` | 12 avr. 2026 | `feat` | Docker Compose production + script backup pour Synology NAS |
| `3d80133` | 12 avr. 2026 | `docs` | Roadmap Phase 2 — 8 priorités documentées |
| `aed5841` | 12 avr. 2026 | `security` | Suppression credentials du repo + renforcement `.gitignore` |
| `6583da3` | 12 avr. 2026 | `docs` | README complet avec guide déploiement NAS |
| `ab7fc5d` | 12 avr. 2026 | `feat` | Intégration API Football + stats enrichies + classement Liga |
| `16c43e6` | 11 avr. 2026 | `feat` | **MVP Phase 1** — Penya Blaugrana Nantes |

### Faits marquants récents
- **Phase 2** livrée intégralement en un seul commit (`b1c88f6`) : nouvelles tables DB (badges, saisons, rewards, micro-prédictions), page soirée match live avec polling 60 s, système de séries (streak), classement par saison.
- **Fix correctif** immédiat (`003faca`) sur l'évaluation des badges, corrigeant un bug de timing (badges non attribués en temps réel).
- **Infrastructure production** désormais documentée et scriptée pour Synology NAS avec sauvegarde automatique.

---

## 2. Analyse de Sécurité — Résultats par Criticité

### 🔴 CRITIQUE

#### C1 — Traversée de chemin (Path Traversal) sur le service de fichiers
- **Fichier :** `app/routes/uploads-files.ts:5-6`
- **Sévérité :** CRITIQUE
- **Description :** Le paramètre `params["*"]` est concaténé directement avec le répertoire `uploads/` sans aucune validation. Un attaquant peut utiliser des séquences de type `../../etc/passwd` pour lire n'importe quel fichier accessible au processus Node.js.
- **Preuve :**
  ```ts
  // Vulnérable — aucune vérification du chemin résolu
  const filePath = path.join(process.cwd(), "uploads", params["*"]);
  ```
- **Correction recommandée :**
  ```ts
  const UPLOAD_DIR = path.resolve(process.cwd(), "uploads");
  const filePath = path.resolve(UPLOAD_DIR, params["*"]);
  if (!filePath.startsWith(UPLOAD_DIR + path.sep)) {
    return new Response("Not found", { status: 404 });
  }
  ```

#### C2 — Mot de passe par défaut faible dans Docker Compose
- **Fichiers :** `docker-compose.yml:22`, `docker-compose.prod.yml:22`
- **Sévérité :** CRITIQUE
- **Description :** Le fallback `${POSTGRES_PASSWORD:-changeme}` et `${REDIS_PASSWORD:-changeme}` permet à l'application de démarrer en production avec des credentials triviaux si les variables d'environnement ne sont pas définies. C'est une cause fréquente de compromission de bases de données.
- **Correction recommandée :** Supprimer les valeurs par défaut pour forcer un échec explicite si la variable est absente :
  ```yaml
  POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?Variable POSTGRES_PASSWORD requise}
  ```

---

### 🟠 ÉLEVÉ

#### H1 — Endpoint `/api/health` non protégé
- **Fichier :** `app/routes/api.health.ts`
- **Sévérité :** ÉLEVÉ
- **Description :** L'endpoint retourne le statut de PostgreSQL et Redis sans aucune authentification. Ces informations facilitent la reconnaissance de l'infrastructure par un attaquant.
- **Correction recommandée :** Restreindre aux administrateurs authentifiés ou limiter les informations retournées en production :
  ```ts
  // Option 1 : accès admin uniquement
  await requireAuth(request, ["admin"]);
  // Option 2 : réponse minimale sans détail des services
  return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
  ```

#### H2 — Absence d'en-têtes de sécurité HTTP
- **Fichier :** `docker/nginx/nginx.conf` (configuration Nginx)
- **Sévérité :** ÉLEVÉ
- **Description :** Aucun en-tête de sécurité n'est configuré : pas de `Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Options`, ni `Strict-Transport-Security`. L'application est exposée au clickjacking, au MIME-sniffing et aux attaques XSS.
- **Correction recommandée :** Ajouter dans la configuration Nginx :
  ```nginx
  add_header X-Content-Type-Options "nosniff" always;
  add_header X-Frame-Options "DENY" always;
  add_header Referrer-Policy "strict-origin-when-cross-origin" always;
  add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
  add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:;" always;
  ```

#### H3 — Seuil de rate limiting trop permissif sur le login
- **Fichier :** `app/routes/api.auth.$.ts:16-24`
- **Sévérité :** ÉLEVÉ
- **Description :** 10 tentatives de connexion par 15 minutes par IP est trop permissif pour prévenir les attaques par force brute ou credential stuffing. Le header `x-forwarded-for` utilisé pour l'IP peut également être forgé.
- **Correction recommandée :**
  - Réduire à 5 tentatives / 15 min pour le login
  - Compléter par un rate limit basé sur l'identifiant utilisateur (en plus de l'IP)
  - Valider que l'IP provient d'un proxy de confiance avant de l'utiliser

---

### 🟡 MOYEN

#### M1 — Validation du type MIME côté serveur insuffisante pour les uploads
- **Fichier :** `app/lib/server/upload.ts`
- **Sévérité :** MOYEN
- **Description :** La validation du type de fichier repose sur `file.type`, une valeur fournie par le client et donc falsifiable. Un fichier malveillant (ex. script PHP renommé `.jpg`) pourrait être accepté.
- **Correction recommandée :** Utiliser une bibliothèque de détection par magic numbers :
  ```ts
  import { fileTypeFromBuffer } from "file-type";
  const detected = await fileTypeFromBuffer(buffer);
  const allowed = ["image/jpeg", "image/png", "image/webp"];
  if (!detected || !allowed.includes(detected.mime)) {
    throw new Error("Type de fichier non autorisé");
  }
  ```

#### M2 — Redis sans authentification en développement
- **Fichier :** `.env.example` (ligne `REDIS_URL`)
- **Sévérité :** MOYEN
- **Description :** L'URL Redis par défaut (`redis://localhost:6379`) n'inclut pas de mot de passe. En environnement partagé ou si le port est exposé, Redis est accessible sans authentification.
- **Correction recommandée :** Documenter explicitement dans `.env.example` l'utilisation d'un mot de passe Redis même en développement :
  ```
  REDIS_URL=redis://:your-dev-password@localhost:6379
  ```

#### M3 — Pas de journal d'audit pour les changements de rôle admin
- **Fichier :** `app/routes/admin.members.server.ts:56-59`
- **Sévérité :** MOYEN
- **Description :** Les modifications de rôle (passage en admin) ne génèrent aucun log d'audit structuré. Il est impossible de retracer qui a promu quel utilisateur et quand.
- **Correction recommandée :** Logger les changements de rôle avec les informations de contexte :
  ```ts
  logger.info({ actingAdmin: session.user.id, targetUser: userId, newRole: role, action: "role-change" }, "Rôle utilisateur modifié");
  ```

#### M4 — Contenu utilisateur stocké sans sanitisation explicite
- **Fichiers :** `app/routes/feed.server.ts`, `app/routes/match-detail.server.ts`
- **Sévérité :** MOYEN
- **Description :** Les posts et commentaires sont stockés et récupérés sans sanitisation HTML. React échappe le contenu par défaut, mais tout changement vers un rendu HTML brut (dangerouslySetInnerHTML) exposerait l'application à du XSS stocké.
- **Correction recommandée :** Sanitiser le contenu à l'insertion avec `sanitize-html` ou DOMPurify (côté serveur).

---

### 🔵 FAIBLE

#### L1 — Container Docker exécuté en tant que root
- **Fichier :** `Dockerfile`
- **Sévérité :** FAIBLE
- **Description :** L'image finale utilise `node:20-alpine` sans changer d'utilisateur. L'application tourne en root dans le container, ce qui augmente la surface d'attaque en cas de faille d'évasion de container.
- **Correction recommandée :**
  ```dockerfile
  RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001
  USER nodejs
  ```

#### L2 — Ports de base de données exposés sur l'hôte en développement
- **Fichier :** `docker-compose.yml:24` (PostgreSQL port 5432), ligne 35 (Redis port 6379)
- **Sévérité :** FAIBLE
- **Description :** Les ports de PostgreSQL et Redis sont mappés sur l'hôte. En développement sur une machine partagée ou connectée à un réseau non sécurisé, cela expose les bases de données.
- **Correction recommandée :** Supprimer les mappings de ports en production (`docker-compose.prod.yml` — déjà absent pour Redis, à vérifier pour Postgres).

#### L3 — Connexion PostgreSQL sans SSL/TLS forcé
- **Fichier :** `app/db/client.ts`
- **Sévérité :** FAIBLE
- **Description :** La chaîne de connexion à PostgreSQL ne spécifie pas `sslmode=require` en production. Les communications DB peuvent transiter en clair.
- **Correction recommandée :**
  ```ts
  if (process.env.NODE_ENV === "production") {
    url.searchParams.set("sslmode", "require");
  }
  ```

#### L4 — Traces d'erreur potentiellement exposées
- **Fichier :** `app/root.tsx:92-104`
- **Sévérité :** FAIBLE
- **Description :** Les stack traces sont affichées en mode `DEV`. Il convient de vérifier que la condition `import.meta.env.DEV` est toujours correctement évaluée en production.
- **Correction recommandée :** Double-vérifier que le build de production ne passe jamais `DEV=true`, et que les erreurs non gérées ne remontent pas des détails techniques à l'utilisateur.

---

### ℹ️ INFORMATION

| # | Observation |
|---|-------------|
| I1 | Les dépendances `package.json` sont à des versions récentes sans vulnérabilité CVE critique détectée. Une revue périodique avec `npm audit` est recommandée. |
| I2 | Le commit `aed5841` (suppression credentials) est une bonne pratique — le `.gitignore` inclut correctement `.env`. |
| I3 | Pas d'endpoint visible pour l'export de données RGPD (droit à la portabilité). À prévoir si l'application est ouverte au public. |
| I4 | Better Auth est correctement configuré avec trusted origins explicites (`6aebaf7`). |

---

## 3. Tableau récapitulatif

| Priorité | ID | Fichier principal | Impact |
|----------|----|-------------------|--------|
| 🔴 CRITIQUE | C1 | `uploads-files.ts` | Lecture arbitraire de fichiers serveur |
| 🔴 CRITIQUE | C2 | `docker-compose*.yml` | Base de données compromise avec mot de passe `changeme` |
| 🟠 ÉLEVÉ | H1 | `api.health.ts` | Fuite d'informations infrastructure |
| 🟠 ÉLEVÉ | H2 | `nginx.conf` | XSS, clickjacking, MIME sniffing |
| 🟠 ÉLEVÉ | H3 | `api.auth.$.ts` | Brute force / credential stuffing |
| 🟡 MOYEN | M1 | `upload.ts` | Upload de fichier malveillant |
| 🟡 MOYEN | M2 | `.env.example` | Redis sans authentification |
| 🟡 MOYEN | M3 | `admin.members.server.ts` | Absence d'audit trail |
| 🟡 MOYEN | M4 | `feed.server.ts` | XSS stocké potentiel |
| 🔵 FAIBLE | L1 | `Dockerfile` | Container en root |
| 🔵 FAIBLE | L2 | `docker-compose.yml` | Ports DB exposés |
| 🔵 FAIBLE | L3 | `db/client.ts` | Connexion DB sans SSL |
| 🔵 FAIBLE | L4 | `root.tsx` | Stack traces en production |

---

## 4. Plan d'action recommandé

### Immédiat (avant mise en production)
1. **C1** — Corriger la traversée de chemin dans `uploads-files.ts`
2. **C2** — Supprimer les valeurs par défaut `changeme` dans les docker-compose
3. **H2** — Ajouter les en-têtes de sécurité dans Nginx

### Court terme (sprint suivant)
4. **H1** — Protéger ou réduire l'endpoint `/api/health`
5. **H3** — Durcir le rate limiting sur l'authentification
6. **M1** — Validation MIME côté serveur pour les uploads

### Moyen terme
7. **M2** à **M4** — Authentification Redis, audit trail admin, sanitisation contenu
8. **L1** à **L4** — Hardening Docker et connexions DB
