# Rapport d'Audit de Sécurité — Penya Blaugrana Nantes
**Date :** 24 septembre 2026  
**Périmètre :** Analyse statique du code source + configuration infrastructure  
**Branche analysée :** `main` (dernier commit : `003faca`)

---

## Résumé des derniers commits

| Commit | Date | Description |
|--------|------|-------------|
| `003faca` | 13 avr. 2026 | fix: évaluer les badges immédiatement après chaque action |
| `b1c88f6` | 13 avr. 2026 | feat: Phase 2 — soirée match live, micro-pronos, badges, séries, saisons |
| `d461ee5` | 12 avr. 2026 | Merge branch deploy-synology-nas |
| `554b873` | 12 avr. 2026 | Add deployment guide for Synology NAS updates |
| `68e22d2` | 13 avr. 2026 | feat: menu burger mobile pour la navigation |
| `6aebaf7` | 12 avr. 2026 | Fix Better Auth trusted origins for custom domain support |
| `9823bc5` | 12 avr. 2026 | Add migrate service to docker-compose.prod.yml |
| `8d6e5e9` | 12 avr. 2026 | Add production Docker Compose and backup script |
| `3d80133` | (antérieur) | docs: roadmap Phase 2 |
| `aed5841` | (antérieur) | security: supprimer credentials du repo et renforcer .gitignore |

**Périmètre fonctionnel Phase 2 :** page soirée match live (polling 60s), micro-pronostics, système de badges (10 badges), séries de scores, saisons archivées, classement filtré par saison.

---

## Résultats de l'analyse de sécurité

### CRITIQUE

#### [C-01] Path Traversal sur le service de fichiers uploadés
- **Fichier :** `app/routes/uploads-files.ts` — lignes 5-6
- **Description :** Le chemin de fichier est construit sans vérification que le résultat reste dans le répertoire `uploads/`. Un utilisateur malveillant peut injecter des séquences `../` dans l'URL pour lire des fichiers arbitraires sur le serveur.
- **Exemple d'exploit :**
  ```
  GET /uploads/../.env          → lit le fichier .env (base de données, secrets)
  GET /uploads/../../etc/passwd → lit /etc/passwd
  ```
- **Code vulnérable :**
  ```ts
  const filePath = path.join(process.cwd(), "uploads", params["*"]);
  // params["*"] = "../../.env" → filePath = "/app/.env"
  ```
- **Correction recommandée :**
  ```ts
  const UPLOAD_BASE = path.resolve(process.cwd(), "uploads");
  const filePath = path.resolve(UPLOAD_BASE, params["*"]);
  if (!filePath.startsWith(UPLOAD_BASE + path.sep)) {
    return new Response("Forbidden", { status: 403 });
  }
  ```

---

### ÉLEVÉ

#### [H-01] Mots de passe par défaut dans docker-compose.prod.yml
- **Fichier :** `docker-compose.prod.yml` — lignes 18, 26
- **Description :** Les mots de passe PostgreSQL et Redis ont `changeme` comme valeur de repli si les variables d'environnement ne sont pas définies. En cas d'oubli de configuration, les bases de données sont accessibles avec un mot de passe trivial.
- **Code vulnérable :**
  ```yaml
  POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-changeme}
  command: redis-server --requirepass ${REDIS_PASSWORD:-changeme}
  ```
- **Correction recommandée :** Supprimer les valeurs par défaut pour forcer une erreur explicite au démarrage si les secrets ne sont pas fournis :
  ```yaml
  POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?Variable POSTGRES_PASSWORD requise}
  command: redis-server --requirepass ${REDIS_PASSWORD:?Variable REDIS_PASSWORD requise}
  ```

#### [H-02] En-têtes de sécurité HTTP absents
- **Fichier :** Aucune configuration de headers sécurité trouvée dans `vite.config.ts`, `react-router.config.ts` ou le middleware applicatif
- **Description :** Les en-têtes suivants sont absents, exposant l'application à plusieurs classes d'attaques :
  - `Content-Security-Policy` (XSS)
  - `X-Frame-Options` (clickjacking)
  - `X-Content-Type-Options: nosniff` (MIME sniffing)
  - `Referrer-Policy`
  - `Permissions-Policy`
- **Correction recommandée :** Ajouter un middleware dans l'entrée applicative (ex. `entry.server.tsx`) ou via Nginx en front :
  ```ts
  // Dans la réponse HTTP
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("Content-Security-Policy", "default-src 'self'; ...");
  ```

---

### MOYEN

#### [M-01] IP de rate-limiting spoofable via X-Forwarded-For
- **Fichier :** `app/routes/api.auth.$.ts` — lignes 5-10
- **Description :** La fonction `getClientIp` fait confiance au premier header `x-forwarded-for` sans validation. Un attaquant peut envoyer un header forgé (`X-Forwarded-For: 1.2.3.4`) pour contourner le rate-limiting et effectuer des attaques brute-force sur les comptes.
- **Code vulnérable :**
  ```ts
  request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
  ```
- **Correction recommandée :** Configurer le nombre de proxies de confiance et ne lire que la N-ième IP de la liste (CIDR de confiance), ou utiliser un middleware proxy qui réécrit l'IP réelle. Dans un contexte Synology/Nginx, s'assurer que seul Nginx écrit ce header.

#### [M-02] `trustedOrigins` vide si APP_URL non défini
- **Fichier :** `app/lib/server/auth.server.ts` — ligne 13
- **Description :** Si `APP_URL` n'est pas défini dans les variables d'environnement, `trustedOrigins` est un tableau vide. Selon la configuration de Better Auth, cela peut désactiver la protection CSRF ou accepter toutes les origines.
- **Code :**
  ```ts
  trustedOrigins: env.APP_URL ? [env.APP_URL] : [],
  ```
- **Correction recommandée :** Rendre `APP_URL` obligatoire dans le schema Zod :
  ```ts
  APP_URL: z.string().url(),
  ```

---

### FAIBLE

#### [L-01] Endpoint /api/health non authentifié révèle l'état de l'infrastructure
- **Fichier :** `app/routes/api.health.ts`
- **Description :** L'endpoint de santé expose la disponibilité de PostgreSQL et Redis sans authentification. Cette information peut faciliter la reconnaissance d'un attaquant.
- **Correction recommandée :** Restricter l'accès à une IP de monitoring connue (Nginx), ou ajouter un token d'authentification simple par header. Acceptable tel quel si l'application est sur un réseau privé.

#### [L-02] Absence de validation de longueur sur `answer` dans les micro-pronos
- **Fichier :** `app/routes/api.micro-predictions.ts` — ligne 92
- **Description :** Le champ `answer` soumis par les utilisateurs n'est pas validé en longueur côté serveur, permettant l'envoi de données excessivement longues.
- **Correction recommandée :**
  ```ts
  if (!answer || answer.length > 500) {
    return Response.json({ error: "Réponse invalide" }, { status: 400 });
  }
  ```

#### [L-03] Cast `as any` du rôle utilisateur dans plusieurs routes
- **Fichiers :** `app/routes/feed.server.ts`, `app/routes/profile.server.ts`
- **Description :** Le rôle est obtenu via `(session.user as any).role`. Si Better Auth change la structure de session, cette vérification silencieuse pourrait retourner `undefined` et contourner un contrôle d'accès.
- **Correction recommandée :** Typer correctement la session ou utiliser `requireAuth(request, ["admin"])` systématiquement.

---

## Points positifs constatés

- ✅ **Aucun credential commis en clair** dans le dépôt (commit `aed5841` a nettoyé l'historique)
- ✅ **Rate-limiting implémenté** sur les routes `/sign-in` (10/15min) et `/sign-up` (5/h)
- ✅ **Validation Zod** des variables d'environnement au démarrage
- ✅ **Contrôle d'autorisation admin** systématique via `requireAuth(request, ["admin"])`
- ✅ **ORM Drizzle utilisé** pour toutes les requêtes BDD (pas de SQL brut → pas d'injection SQL)
- ✅ **Upload d'avatars sécurisé** : validation MIME, taille max 2 Mo, conversion WebP via Sharp
- ✅ **Protection GDPR** : consentement obligatoire à l'inscription
- ✅ **.gitignore** couvre `.env`, `node_modules`, `uploads/`, `build/`

---

## Tableau récapitulatif

| ID | Criticité | Composant | Statut |
|----|-----------|-----------|--------|
| C-01 | 🔴 CRITIQUE | `uploads-files.ts` | À corriger |
| H-01 | 🟠 ÉLEVÉ | `docker-compose.prod.yml` | À corriger |
| H-02 | 🟠 ÉLEVÉ | Headers HTTP | À implémenter |
| M-01 | 🟡 MOYEN | `api.auth.$.ts` | À corriger |
| M-02 | 🟡 MOYEN | `auth.server.ts` | À corriger |
| L-01 | 🔵 FAIBLE | `api.health.ts` | Acceptable (réseau privé) |
| L-02 | 🔵 FAIBLE | `api.micro-predictions.ts` | À corriger |
| L-03 | 🔵 FAIBLE | `feed.server.ts` / `profile.server.ts` | À corriger |

---

*Rapport généré automatiquement le 24/09/2026 — analyse statique du code.*
