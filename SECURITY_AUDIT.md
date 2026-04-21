# Rapport d'audit de sécurité — Penya Blaugrana Nantes

**Date** : 21 avril 2026  
**Branche analysée** : `main`  
**Dernier commit** : `003faca` — 13 avril 2026

---

## 1. Résumé des derniers commits

| Hash | Date | Auteur | Description |
|------|------|--------|-------------|
| `003faca` | 13 avr. 2026 | Biteau Gaël | **fix** : évaluation immédiate des badges après chaque action (soumission prono, post, commentaire, réaction) |
| `b1c88f6` | 13 avr. 2026 | Biteau Gaël | **feat** : Phase 2 — soirée match live, micro-pronos, badges, séries, saisons (26 fichiers, +2 965 lignes) |
| `d461ee5` | 12 avr. 2026 | Claude | **merge** : intégration de la branche `deploy-synology-nas-cLkOL` dans main |
| `554b873` | 12 avr. 2026 | Claude | **docs** : guide de déploiement NAS Synology (DEPLOY.md) |
| `68e22d2` | 13 avr. 2026 | Biteau Gaël | **feat** : menu burger mobile pour la navigation |
| `6aebaf7` | 12 avr. 2026 | Claude | **fix** : correction des `trustedOrigins` de Better Auth pour le domaine personnalisé |
| `9823bc5` | 12 avr. 2026 | Claude | **feat** : ajout du service `migrate` dans `docker-compose.prod.yml` |
| `8d6e5e9` | 12 avr. 2026 | Claude | **feat** : Docker Compose production + script de sauvegarde pour Synology NAS |

### Périmètre fonctionnel de la Phase 2 (commit `b1c88f6`)

- **Soirée match live** : route `/soiree/:matchId`, score en temps réel via polling API toutes les 60 s, fil d'événements (buts, cartons, remplacements), pronos communauté révélés au coup d'envoi
- **Micro-pronostics** : création/clôture/suppression par l'admin, vote joueur, attribution automatique de points
- **Système de badges** : 10 badges évalués automatiquement, page `/badges`, affichage sur le profil
- **Séries** : `currentStreak`/`bestStreak` sur le user, récompenses aux paliers 3/5/10 (posts auto)
- **Saisons** : table `seasons`, filtre saison sur le classement, archives
- **BDD** : migration `0007` — nouvelles tables `seasons`, `badges`, `user_badges`, `rewards`, `micro_predictions`, `micro_prediction_answers`

---

## 2. Analyse de sécurité — Findings par ordre de criticité

### CRITIQUE

#### C1 — Absence de protection CSRF explicite sur les actions sensibles
**Fichiers** : tous les fichiers `*.server.ts` de `app/routes/` (actions POST)  
**Description** : Aucun token CSRF n'est généré ni validé dans les handlers d'action. Better Auth ne garantit pas une protection CSRF par défaut sur toutes les routes de l'application (uniquement ses propres endpoints `/api/auth/*`). Les opérations critiques — changement de rôle, suppression de membre, mise à jour de profil, soumission de pronostic — sont potentiellement vulnérables si un attaquant peut amener un utilisateur connecté à déclencher une requête cross-origin.  
**Correction recommandée** : Vérifier que Better Auth applique bien `SameSite=Lax` (ou `Strict`) sur le cookie de session, et ajouter un token CSRF sur les opérations destructives. Le header `Origin` peut aussi être validé côté serveur pour les actions critiques (admin).

---

### HAUTE

#### H1 — Path Traversal sur le serveur de fichiers statiques
**Fichier** : `app/routes/uploads-files.ts:5`  
**Description** : La route `/uploads/*` construit le chemin du fichier avec `path.join(process.cwd(), "uploads", params["*"])` sans vérifier que le chemin résultant reste bien dans le répertoire `uploads/`. Un attaquant peut injecter `../../etc/passwd` ou tout autre chemin relatif pour lire des fichiers arbitraires sur le serveur.  
**Exemple d'exploitation** : `GET /uploads/../../app/config/env.server.ts`  
**Correction recommandée** :

```typescript
const UPLOADS_BASE = path.resolve(process.cwd(), "uploads");
const filePath = path.resolve(UPLOADS_BASE, params["*"]);

if (!filePath.startsWith(UPLOADS_BASE + path.sep)) {
  return new Response("Forbidden", { status: 403 });
}
```

---

#### H2 — Mot de passe par défaut `changeme` en production
**Fichier** : `docker-compose.prod.yml:22,32`  
**Description** : Les secrets PostgreSQL et Redis utilisent `${POSTGRES_PASSWORD:-changeme}` et `${REDIS_PASSWORD:-changeme}` comme valeurs de repli. Si le fichier `.env` n'est pas présent ou si ces variables ne sont pas définies, la base de données et le cache tournent avec le mot de passe `changeme`, lisible publiquement dans le fichier versionné.  
**Correction recommandée** : Supprimer la valeur de repli pour forcer un échec explicite en cas de variable manquante :

```yaml
- POSTGRES_PASSWORD=${POSTGRES_PASSWORD:?La variable POSTGRES_PASSWORD doit être définie}
```

Ou utiliser les Docker Secrets (mode Swarm).

---

#### H3 — En-têtes de sécurité HTTP absents
**Fichier** : Aucun middleware global détecté  
**Description** : L'application ne définit aucun en-tête de sécurité HTTP (`Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Options`, `Strict-Transport-Security`, `Referrer-Policy`). Sans CSP, une faille XSS (même mineure) permet l'exfiltration de sessions. Sans `X-Frame-Options`, l'application est vulnérable au clickjacking.  
**Correction recommandée** : Ajouter un middleware dans `entry.server.tsx` (ou via un reverse proxy Nginx) :

```typescript
// Dans entry.server.tsx — handleRequest
response.headers.set("X-Frame-Options", "DENY");
response.headers.set("X-Content-Type-Options", "nosniff");
response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
response.headers.set(
  "Content-Security-Policy",
  "default-src 'self'; img-src 'self' https://images.fotmob.com data:; connect-src 'self'"
);
```

---

### MOYENNE

#### M1 — IP client non vérifiée dans le rate limiting (IP spoofing)
**Fichier** : `app/routes/api.auth.$.ts:7-8`  
**Description** : La fonction `getClientIp` fait confiance aveuglément aux en-têtes `X-Forwarded-For` et `X-Real-IP`, qui peuvent être forgés par un attaquant. Sans proxy de confiance configuré en amont, un attaquant peut contourner la limite de tentatives de connexion en changeant simplement cet en-tête.  
**Impact** : Le rate limiting sur `/api/auth/sign-in` et `/api/auth/sign-up` peut être contourné.  
**Correction recommandée** : Valider que la requête provient bien du reverse proxy de confiance avant d'utiliser ces en-têtes, ou utiliser l'IP de connexion directe dans un environnement sans proxy.

---

#### M2 — `APP_URL` absente du `.env.example` et des docker-compose
**Fichier** : `app/lib/server/auth.server.ts:12`, `.env.example`  
**Description** : La variable `APP_URL` est marquée `optional()` dans le schéma Zod et absente du `.env.example`. Si elle n'est pas définie, `trustedOrigins` est un tableau vide, ce qui désactive la validation d'origine CSRF de Better Auth. En production sans `APP_URL`, les requêtes cross-origin ne sont pas rejetées.  
**Correction recommandée** : Rendre `APP_URL` obligatoire en production, ou au minimum l'ajouter au `.env.example` et à la documentation de déploiement avec une note d'avertissement.

---

#### M3 — Dockerfile exécute l'application en tant que `root`
**Fichier** : `Dockerfile:17-22`  
**Description** : Aucun utilisateur non-privilégié n'est créé dans le Dockerfile. L'application Node.js s'exécute en tant que `root` dans le conteneur, ce qui aggrave considérablement l'impact en cas de compromission.  
**Correction recommandée** :

```dockerfile
FROM node:20-alpine
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
COPY --chown=appuser:appgroup ...
USER appuser
CMD ["npm", "run", "start"]
```

---

#### M4 — Utilisation de `as any` pour accéder au rôle utilisateur
**Fichier** : `app/routes/feed.server.ts:99,124,184,200`  
**Description** : Le rôle utilisateur est accédé via `(session.user as any).role`, ce qui contourne le typage TypeScript. Le compilateur ne peut pas détecter une éventuelle erreur ou un changement de structure du champ `role`. Bien que Better Auth le gère correctement en pratique, ce pattern est fragile.  
**Correction recommandée** : Utiliser le helper `requireAuth` déjà disponible avec `allowedRoles` plutôt que de ré-implémenter la vérification manuellement, et définir un type `AuthUser` étendant le type Better Auth.

---

#### M5 — Absence de lockout de compte après échecs d'authentification répétés
**Fichier** : `app/routes/api.auth.$.ts:13-35`  
**Description** : Le rate limiting bloque 10 tentatives/15 min, mais il n'y a pas de verrouillage de compte. Un attaquant peut tenter 10 mots de passe toutes les 15 minutes indéfiniment sur un même compte (10 × 96 = 960 essais/jour). Sans notification email, le propriétaire du compte ne sait pas qu'il est ciblé.  
**Correction recommandée** : Implémenter un verrouillage de compte après 5 échecs consécutifs avec notification email et délai de 24 h avant déblocage automatique (ou lien de déblocage).

---

#### M6 — Parsing JSON non validé depuis le cache base de données
**Fichier** : `app/routes/match-detail.server.ts:83`  
**Description** : `JSON.parse(match.matchDetails) as MatchDetails` cast le résultat sans valider le schéma. Si la donnée en base est corrompue ou malformée, l'application peut lancer une exception non gérée ou exploiter des données inattendues.  
**Correction recommandée** : Valider la donnée parsée avec un schéma Zod avant utilisation.

---

#### M7 — Validation du `type` de micro-pronostic sans whitelist stricte côté base
**Fichier** : `app/routes/api.micro-predictions.ts:21`  
**Description** : Le champ `type` d'un micro-pronostic est accepté sans validation (`(formData.get("type") as string) || "qcm"`). N'importe quelle valeur arbitraire peut être insérée en base. Le schéma Drizzle devrait enforcer une contrainte de type.  
**Correction recommandée** : Ajouter une validation Zod sur le champ `type` avec les valeurs autorisées (`"qcm" | "libre"`), similaire au schéma de prédiction existant.

---

### FAIBLE

#### F1 — Erreurs d'API Football propagées en réponse 500
**Fichier** : `app/routes/api.sync-matches.ts:21-22`  
**Description** : Le message d'erreur brut (`error.message`) est renvoyé dans la réponse JSON en cas d'échec de la synchronisation. Ce message peut contenir des informations internes (nom d'hôte, structure d'URL, stack trace partielle).  
**Correction recommandée** : Logger l'erreur complète côté serveur et renvoyer un message générique au client.

---

#### F2 — Script de sauvegarde sans rotation des droits
**Fichier** : `backup.sh`  
**Description** : Le script de backup appelle `pg_dump` via `docker compose exec` sans vérifier que seul l'utilisateur autorisé peut l'exécuter. Si le script est planifié dans DSM sans restriction, tout utilisateur ayant accès au NAS peut déclencher un dump complet de la base.  
**Correction recommandée** : Restreindre les droits d'exécution du script (`chmod 700 backup.sh`) et s'assurer qu'il n'est planifié qu'avec l'utilisateur système dédié.

---

#### F3 — Absence de rate limiting sur la création de posts et commentaires
**Fichier** : `app/routes/feed.server.ts`  
**Description** : Aucun rate limiting sur la soumission de posts ou commentaires. Un utilisateur connecté peut générer du spam en masse.  
**Correction recommandée** : Limiter à 10 posts/h et 20 commentaires/h par utilisateur via Redis (même pattern que le rate limiting d'auth existant).

---

#### F4 — Absence de `rel="noreferrer"` sur certains liens externes
**Fichier** : `app/welcome/welcome.tsx:34`  
**Description** : Le lien vers le dépôt GitHub dans la page welcome utilise uniquement `rel="noreferrer"` sans `noopener`. En pratique, `noreferrer` implique `noopener` dans les navigateurs modernes, mais la combinaison `noopener noreferrer` est la pratique recommandée pour une compatibilité maximale.  
**Note** : Le lien des highlights vidéo dans `match-detail.tsx:316` utilise correctement `noopener noreferrer`.

---

### INFO / BONNES PRATIQUES DÉJÀ EN PLACE

| Point | Statut |
|-------|--------|
| ORM Drizzle avec requêtes paramétrées — protection SQL injection | Conforme |
| Authentification Better Auth avec sessions Redis | Conforme |
| Rate limiting sur `/api/auth/sign-in` (10 req/15 min) et `/api/auth/sign-up` (5 req/h) | Conforme |
| Validation Zod des variables d'environnement au démarrage | Conforme |
| Validation du type MIME et de la taille des avatars uploadés (2 Mo max, JPEG/PNG/WebP) | Conforme |
| Re-encodage des avatars via Sharp avant sauvegarde (neutralise les payloads dans les images) | Conforme |
| Logs structurés via Pino sans exposition de stack traces dans les réponses HTTP | Conforme |
| Protection anti-self-delete/self-role-change pour les admins | Conforme |
| Vérification ownership avant suppression de post/commentaire | Conforme |
| Liens externes avec `target="_blank"` accompagnés de `rel="noopener noreferrer"` (match-detail) | Conforme |
| Secrets absents du dépôt Git (commit `aed5841` — suppression credentials) | Conforme |
| `.gitignore` inclut `.env`, `node_modules`, `uploads/`, `build/` | Conforme |
| Healthchecks Docker sur PostgreSQL et Redis | Conforme |

---

## 3. Tableau récapitulatif

| ID | Criticité | Fichier | Description courte | Corrigé |
|----|-----------|---------|-------------------|---------|
| C1 | **CRITIQUE** | Routes `*.server.ts` | Absence de protection CSRF explicite sur actions sensibles | Non |
| H1 | **HAUTE** | `uploads-files.ts:5` | Path traversal sur le serveur de fichiers | Non |
| H2 | **HAUTE** | `docker-compose.prod.yml:22,32` | Mot de passe `changeme` en fallback de production | Non |
| H3 | **HAUTE** | Global | En-têtes de sécurité HTTP absents (CSP, X-Frame-Options…) | Non |
| M1 | MOYENNE | `api.auth.$.ts:7` | IP spoofing possible sur le rate limiting | Non |
| M2 | MOYENNE | `auth.server.ts:12` | `APP_URL` optionnelle — validation CSRF désactivée si absente | Non |
| M3 | MOYENNE | `Dockerfile:17` | Application exécutée en tant que `root` dans le conteneur | Non |
| M4 | MOYENNE | `feed.server.ts:99` | Cast `as any` pour accès au rôle utilisateur | Non |
| M5 | MOYENNE | `api.auth.$.ts:13` | Pas de lockout de compte après échecs d'auth répétés | Non |
| M6 | MOYENNE | `match-detail.server.ts:83` | JSON.parse depuis BDD sans validation de schéma | Non |
| M7 | MOYENNE | `api.micro-predictions.ts:21` | Pas de validation whitelist sur le champ `type` | Non |
| F1 | FAIBLE | `api.sync-matches.ts:22` | Message d'erreur interne exposé en réponse 500 | Non |
| F2 | FAIBLE | `backup.sh` | Script de backup sans restriction de droits d'exécution | Non |
| F3 | FAIBLE | `feed.server.ts` | Pas de rate limiting sur posts et commentaires | Non |
| F4 | FAIBLE | `welcome.tsx:34` | `rel` incomplet sur lien externe | Non |

---

*Rapport généré automatiquement par analyse statique et revue de code — branche `claude/sharp-fermi-09sFU`*
