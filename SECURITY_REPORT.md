# Rapport d'analyse — Penya Barca Nantes

> Généré le 2026-07-02 | Branche analysée : `main`

---

## Résumé des derniers commits

| # | Hash | Date | Auteur | Description |
|---|------|------|--------|-------------|
| 1 | `003faca` | 2026-04-13 | Biteau Gaël | **fix:** évaluer les badges immédiatement après chaque action |
| 2 | `b1c88f6` | 2026-04-13 | Biteau Gaël | **feat:** Phase 2 — soirée match live, micro-pronos, badges, séries, saisons |
| 3 | `68e22d2` | 2026-04-13 | Biteau Gaël | **feat:** menu burger mobile pour la navigation |
| 4 | `d461ee5` | 2026-04-12 | Claude | **merge:** intégration de la branche `deploy-synology-nas` |
| 5 | `554b873` | 2026-04-12 | Claude | **docs:** guide de déploiement pour les mises à jour NAS Synology |
| 6 | `6aebaf7` | 2026-04-12 | Claude | **fix:** correction des trusted origins Better Auth (domaine custom) |
| 7 | `9823bc5` | 2026-04-12 | Claude | **feat:** service `migrate` ajouté dans docker-compose.prod.yml |
| 8 | `8d6e5e9` | 2026-04-12 | Claude | **feat:** Docker Compose production + script backup NAS Synology |
| 9 | `3d80133` | — | Biteau Gaël | **docs:** roadmap Phase 2 (8 priorités) |
| 10 | `aed5841` | — | — | **security:** suppression credentials du repo + renforcement .gitignore |

### Détail des commits significatifs

**`003faca` — fix badges** (2 fichiers, +6 lignes)  
Correction du timing d'évaluation des badges : `evaluateBadges()` est maintenant appelé juste après chaque action dans `feed.server.ts` et `match-detail.server.ts`, garantissant l'attribution immédiate des récompenses.

**`b1c88f6` — Phase 2 Soirée match** (26 fichiers, +2 965 lignes)  
Ajout du module "Soirée match live" complet : score en temps réel via API Football, micro-pronostics (QCM/libre), système de badges, séries de victoires (streak), historique par saison. Nouvelles routes : `soiree.server.ts` / `soiree.tsx`.

**`68e22d2` — Menu burger mobile** (1 fichier, +121 lignes)  
Refonte du header pour la navigation mobile : menu hamburger animé, overlay, fermeture automatique au clic ou à l'extérieur.

**`8d6e5e9` à `554b873` — Infrastructure NAS Synology**  
Configuration production complète : `docker-compose.prod.yml` avec healthchecks, service `migrate` Drizzle, script `backup.sh` automatisé, `DEPLOY.md` détaillant la procédure de mise à jour.

---

## Analyse de sécurité

### Méthodologie
Revue statique du code source des routes API, des middlewares d'authentification, de la gestion des fichiers et de la configuration d'infrastructure.

---

## 🔴 CRITIQUE

### [C-1] Path Traversal dans le serveur de fichiers statiques

**Fichier :** `app/routes/uploads-files.ts:5`  
**Impact :** Lecture arbitraire de fichiers sur le serveur (variables d'environnement, clés, base de données)

**Code vulnérable :**
```ts
const filePath = path.join(process.cwd(), "uploads", params["*"]);
// Aucune vérification que filePath reste dans /uploads
const file = await readFile(filePath);
```

**Exploitation :** Une requête vers `/uploads-files/../../.env` ou `/uploads-files/../../app/lib/server/auth.server.ts` résoudrait en un chemin en dehors du répertoire `uploads/` car `path.join` normalise les séquences `../` sans vérifier la limite du répertoire parent.

**Correction :**
```ts
const uploadsDir = path.resolve(process.cwd(), "uploads");
const filePath = path.resolve(uploadsDir, params["*"]);

// Vérification obligatoire que le chemin reste dans uploads/
if (!filePath.startsWith(uploadsDir + path.sep)) {
  return new Response("Not found", { status: 404 });
}
```

---

## 🟠 ÉLEVÉ

### [H-1] Absence totale d'en-têtes de sécurité HTTP

**Fichier :** `app/root.tsx` (aucune fonction `headers()` exportée)  
**Impact :** Exposition à clickjacking, MIME sniffing, vol de session via iframes, downgrade HTTP

**En-têtes manquants :**
- `Content-Security-Policy` — prévient les injections de scripts
- `X-Frame-Options: DENY` — prévient le clickjacking
- `X-Content-Type-Options: nosniff` — prévient le MIME sniffing
- `Strict-Transport-Security` — force HTTPS en production
- `Referrer-Policy: strict-origin-when-cross-origin`

**Correction :** Exporter une fonction `headers()` dans `root.tsx` ou via un middleware React Router :
```ts
export function headers() {
  return {
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
    "Content-Security-Policy": "default-src 'self'; img-src 'self' data:; script-src 'self'",
  };
}
```

### [H-2] Credentials par défaut faibles dans la configuration de production

**Fichier :** `docker-compose.prod.yml:22,28`  
**Impact :** Compromission de la base de données et du cache Redis si déployé sans surcharge des variables

**Code vulnérable :**
```yaml
POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-changeme}
command: redis-server --requirepass ${REDIS_PASSWORD:-changeme}
```

Le fallback `changeme` sera utilisé si `.env` ne définit pas ces variables. En production sur NAS Synology, cela constitue un risque réel si le fichier `.env` est incomplet.

**Correction :** Supprimer les valeurs par défaut pour forcer une erreur au démarrage si les variables ne sont pas définies :
```yaml
POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?Variable POSTGRES_PASSWORD non définie}
```

---

## 🟡 MODÉRÉ

### [M-1] Contournement possible du rate limiting via le loader `/api/auth`

**Fichier :** `app/routes/api.auth.$.ts:36-41`  
**Impact :** Absence de rate limiting sur les requêtes GET au loader d'auth

**Observation :** Le rate limiting est appliqué uniquement dans la fonction `action()`, mais le `loader()` propage directement `auth.handler(request)` sans limitation. Selon la configuration de Better Auth, certaines vérifications (vérification de session, email, token) peuvent transiter par GET.

**Recommandation :** Appliquer `applyRateLimit()` aussi dans le `loader()`, ou vérifier que Better Auth ne route aucune opération sensible via GET.

### [M-2] Absence de Content-Type validation sur l'upload de fichiers

**Fichier :** `app/lib/server/upload.ts:10-12`  
**Impact :** Possibilité d'upload de fichiers malveillants en falsifiant le header Content-Type

**Observation :** La validation repose uniquement sur `file.type` qui est contrôlé côté client :
```ts
if (!ALLOWED_TYPES.includes(file.type)) { // file.type vient du navigateur
  throw new Error("Format non supporté.");
}
```

**Correction :** Vérifier la signature "magic bytes" du fichier en complément (ex : `0xFF 0xD8` pour JPEG, `0x89 PNG` pour PNG). La bibliothèque `sharp` lit déjà le buffer, une vérification de son type détecté peut suffire :
```ts
const metadata = await sharp(buffer).metadata();
if (!["jpeg", "png", "webp"].includes(metadata.format ?? "")) {
  throw new Error("Format non supporté.");
}
```

### [M-3] Cast `as any` sur les vérifications de rôle

**Fichiers :** `app/routes/feed.server.ts`, `app/routes/soiree.server.ts`  
**Impact :** Contournement potentiel du système de types, masquage de régressions futures

**Code concerné :**
```ts
const isAdmin = (session.user as any).role === "admin";
```

Better Auth expose `role` dans `additionalFields` mais le cast `as any` indique un manque d'intégration des types. Si le champ `role` est renommé ou restructuré, le cast `as any` empêchera TypeScript de détecter la casse.

**Recommandation :** Typer correctement le champ ou utiliser la fonction `requireAuth(request, ["admin"])` déjà disponible.

---

## 🟢 FAIBLE / INFORMATIF

### [L-1] Rate limiting non appliqué sur les routes métier sensibles

**Fichier :** `app/routes/api.micro-predictions.ts`, `app/routes/feed.server.ts`  
**Observation :** Le rate limiting est en place uniquement pour l'authentification. Des opérations comme la création de posts, les réponses aux micro-pronos ou les réactions ne sont pas limitées. Un utilisateur authentifié pourrait saturer la base de données.  
**Recommandation :** Appliquer un rate limit par utilisateur (ex : 50 posts/heure) sur les actions de création.

### [L-2] `Cache-Control: immutable` sur les avatars utilisateurs

**Fichier :** `app/routes/uploads-files.ts:18-20`  
**Observation :** Les avatars sont servis avec `max-age=31536000, immutable`. Le nom de fichier étant `{userId}.webp`, si un utilisateur change d'avatar, l'ancien restera en cache navigateur pendant 1 an.  
**Recommandation :** Ajouter un paramètre de cache-busting (ex : `?v={timestamp}`) à l'URL avatar lors de la mise à jour.

### [L-3] Pas de timeout sur les appels API Football externes

**Fichier :** `app/routes/soiree.server.ts` (fonctions `fetchLiveScore`, `fetchMatchEvents`)  
**Observation :** Les appels `fetch()` vers l'API RapidAPI n'ont pas de timeout configuré. Une réponse lente peut bloquer le rendu des pages "Soirée match" indéfiniment.  
**Recommandation :**
```ts
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 5000);
const response = await fetch(url, { signal: controller.signal, headers: {...} });
clearTimeout(timeout);
```

---

## Synthèse

| ID | Sévérité | Titre | Fichier | Statut |
|----|----------|-------|---------|--------|
| C-1 | 🔴 Critique | Path Traversal dans le serveur de fichiers | `uploads-files.ts:5` | À corriger immédiatement |
| H-1 | 🟠 Élevé | Absence d'en-têtes de sécurité HTTP | `root.tsx` | À corriger |
| H-2 | 🟠 Élevé | Credentials par défaut en production | `docker-compose.prod.yml:22,28` | À corriger |
| M-1 | 🟡 Modéré | Rate limiting absent sur le loader auth | `api.auth.$.ts:36` | À vérifier |
| M-2 | 🟡 Modéré | Validation MIME côté client uniquement | `upload.ts:10` | Recommandé |
| M-3 | 🟡 Modéré | Cast `as any` sur les vérifications de rôle | `feed.server.ts`, `soiree.server.ts` | Recommandé |
| L-1 | 🟢 Faible | Pas de rate limiting sur les routes métier | Multiples routes | Optionnel |
| L-2 | 🟢 Faible | Cache immutable sur les avatars | `uploads-files.ts:18` | Optionnel |
| L-3 | 🟢 Faible | Pas de timeout sur les appels API externes | `soiree.server.ts` | Optionnel |

---

## Points positifs identifiés

- **Authentification solide :** Better Auth avec session Redis, `requireAuth()` utilisé systématiquement sur toutes les routes protégées et les routes admin
- **Autorisation en profondeur :** Les routes admin vérifient `["admin"]` via `requireAuth`, la logique métier revérifie le rôle inline pour les opérations critiques
- **Validation des entrées :** Zod utilisé sur tous les formulaires (création de posts, commentaires, profil, matchs, événements)
- **Injections SQL prévenues :** Drizzle ORM utilisé partout, aucune concaténation SQL directe détectée
- **Pas de XSS via `dangerouslySetInnerHTML`** : Aucune occurrence détectée dans le code
- **Secrets hors dépôt :** `.gitignore` inclut `.env`, commit `aed5841` confirme l'assainissement des credentials
- **Validation des variables d'environnement :** Zod parse `process.env` au démarrage (`env.server.ts`), échoue rapidement si une variable obligatoire est manquante
- **Mot de passe avec contraintes fortes :** regex imposant majuscule + minuscule + chiffre + 8 caractères minimum
- **Protection self-role :** Un admin ne peut pas modifier son propre rôle (`admin.members.server.ts`)
- **Logs structurés :** Pino utilisé avec niveaux adaptés, sans exposition de données sensibles
