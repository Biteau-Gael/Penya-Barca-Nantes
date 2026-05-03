# Rapport d'audit de sécurité — Penya Blaugrana Nantes

**Date** : 2026-05-03
**Portée** : Commits analysés — `fec3e63` → `003faca` (Phase 1 + Phase 2 complètes)
**Branche** : `claude/sharp-fermi-KAt0Y`

---

## Résumé des derniers commits

| Hash | Date | Description |
|------|------|-------------|
| `003faca` | 2026-04-13 | fix: évaluer les badges immédiatement après chaque action |
| `b1c88f6` | 2026-04-13 | feat: Phase 2 — soirée match live, micro-pronos, badges, séries, saisons |
| `68e22d2` | 2026-04-13 | feat: menu burger mobile pour la navigation |
| `554b873` | 2026-04-12 | Add deployment guide for Synology NAS updates |
| `d461ee5` | 2026-04-12 | Merge branch 'claude/deploy-synology-nas-cLkOL' |
| `6aebaf7` | 2026-04-12 | Fix Better Auth trusted origins for custom domain support |
| `9823bc5` | 2026-04-12 | Add migrate service to docker-compose.prod.yml |
| `aed5841` | antérieur | security: supprimer credentials du repo et renforcer .gitignore |

---

## Résultats par ordre de criticité

---

### CRITIQUE

#### SEC-01 — Path Traversal dans le serveur de fichiers statiques

**Fichier** : `app/routes/uploads-files.ts:5`
**CWE** : CWE-22 (Improper Limitation of a Pathname to a Restricted Directory)

**Description** : Le chemin du fichier est construit directement à partir du paramètre wildcard de la route sans aucune validation de sortie du répertoire autorisé :

```typescript
const filePath = path.join(process.cwd(), "uploads", params["*"]);
```

Une requête vers `/uploads/../../etc/passwd` ou `/uploads/../.env` résout en dehors du dossier `uploads/` et expose des fichiers système ou des secrets d'environnement.

**Correction recommandée** :
```typescript
const uploadsDir = path.resolve(process.cwd(), "uploads");
const filePath = path.resolve(uploadsDir, params["*"]);

if (!filePath.startsWith(uploadsDir + path.sep)) {
  return new Response("Not found", { status: 404 });
}
```

---

### HAUTE

#### SEC-02 — Absence de rate limiting sur les routes fonctionnelles critiques

**Fichiers** : `app/routes/api.micro-predictions.ts`, `app/routes/match-detail.server.ts`, `app/routes/profile.server.ts`

**Description** : Le rate limiting (`checkRateLimit`) n'est appliqué qu'aux routes d'authentification (`api.auth.$.ts`). Les routes suivantes sont exposées à des abus en masse :

- `POST /api/micro-predictions` (réponses aux micro-pronos) : un utilisateur pourrait automatiser des soumissions répétées.
- `POST /match/:matchId` (soumission de pronostics) : spam de pronostics juste avant la deadline.
- `POST /profil` (upload avatar) : abus de la fonction d'upload et du traitement `sharp`.

**Correction recommandée** : Appliquer `checkRateLimit` par userId sur ces routes, par exemple :
```typescript
await checkRateLimit({ key: `micro-answer:${session.user.id}`, maxAttempts: 20, windowSeconds: 60 });
```

---

#### SEC-03 — Session non révoquée côté serveur lors de la suppression de compte

**Fichier** : `app/routes/profile.server.ts:127`

**Description** : Lors de la suppression de compte, seule la ligne DB est supprimée. La déconnexion de session (`signOut`) est déclenchée côté client uniquement, dans le composant React (`profile.tsx:80`). Si la requête client échoue ou si l'utilisateur dispose d'une autre session active (autre onglet, autre appareil), ces sessions restent valides dans Redis jusqu'à leur expiration naturelle.

```typescript
// Seulement ça côté serveur :
await db.delete(user).where(eq(user.id, session.user.id));
// Pas d'invalidation serveur de la session
```

**Correction recommandée** : Appeler `auth.api.revokeAllSessions` (Better Auth) côté serveur avant la suppression :
```typescript
await auth.api.revokeAllSessions({ headers: request.headers });
await db.delete(user).where(eq(user.id, session.user.id));
```

---

### MOYENNE

#### SEC-04 — Aucun en-tête de sécurité HTTP

**Fichier** : Configuration globale manquante (Dockerfile, `react-router.config.ts`, middleware)

**Description** : Aucun des en-têtes de sécurité HTTP standard n'est configuré. Absence constatée de :
- `Content-Security-Policy` (XSS)
- `X-Frame-Options` (clickjacking)
- `X-Content-Type-Options: nosniff`
- `Strict-Transport-Security` (HSTS)
- `Referrer-Policy`

**Correction recommandée** : Ajouter un middleware dans `app/root.tsx` ou via le reverse proxy (Nginx sur le NAS Synology) :
```nginx
add_header X-Frame-Options "SAMEORIGIN";
add_header X-Content-Type-Options "nosniff";
add_header Referrer-Policy "strict-origin-when-cross-origin";
add_header Content-Security-Policy "default-src 'self'; ...";
```

---

#### SEC-05 — Container Docker exécuté en root

**Fichier** : `Dockerfile`

**Description** : L'image finale ne définit pas d'utilisateur non-root. Le processus Node.js tourne en tant que `root` dans le conteneur, ce qui élargit considérablement le blast radius en cas d'exploitation d'une RCE.

**Correction recommandée** : Ajouter avant `CMD` :
```dockerfile
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser
```

---

#### SEC-06 — Mots de passe par défaut dans docker-compose.prod.yml

**Fichier** : `docker-compose.prod.yml:23,32`

**Description** : Les mots de passe Postgres et Redis ont un fallback sur `changeme` si les variables d'environnement ne sont pas définies :
```yaml
POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-changeme}
redis-server --requirepass ${REDIS_PASSWORD:-changeme}
```
En l'absence du fichier `.env` lors d'un déploiement, la base de données et Redis seraient accessibles avec un mot de passe trivial.

**Correction recommandée** : Supprimer les valeurs par défaut et rendre les variables obligatoires, ou échouer explicitement au démarrage si elles sont absentes.

---

#### SEC-07 — trustedOrigins vide si APP_URL non définie

**Fichier** : `app/lib/server/auth.server.ts:12`

**Description** : Si `APP_URL` n'est pas définie dans l'environnement, `trustedOrigins` est un tableau vide :
```typescript
trustedOrigins: env.APP_URL ? [env.APP_URL] : [],
```
Le comportement de Better Auth avec `trustedOrigins: []` peut autoriser toutes les origines selon la version, ce qui ouvrirait la porte à des attaques CSRF.

**Correction recommandée** : Rendre `APP_URL` obligatoire dans `env.server.ts` en retirant le `optional()` et documenter la variable dans `.env.example`.

---

### FAIBLE

#### SEC-08 — IP spoofable pour le rate limiting de connexion

**Fichier** : `app/routes/api.auth.$.ts:6`

**Description** : L'IP client est extraite du header `x-forwarded-for`, qui peut être forgé par n'importe quel client si aucun proxy de confiance ne normalise ce header :
```typescript
request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
```
Un attaquant peut contourner le rate limiting en changeant la valeur de ce header à chaque requête.

**Correction recommandée** : Ne faire confiance au `x-forwarded-for` que si la requête provient d'un proxy de confiance (adresse IP fixe). Documenter cette dépendance dans le guide de déploiement Nginx/Synology.

---

#### SEC-09 — Type `as any` pour les vérifications de rôle admin

**Fichier** : `app/routes/feed.server.ts:99,124,184,200`

**Description** : Le rôle admin est vérifié en castant la session en `any`, contournant la sécurité de typage TypeScript :
```typescript
(session.user as any).role === "admin"
```
Si le type de `session.user` évolue (mise à jour Better Auth), ces checks pourraient silencieusement ne plus fonctionner sans erreur de compilation.

**Correction recommandée** : Utiliser `requireAuth(request, ["admin"])` ou définir un type `AuthUser` explicite incluant `role`.

---

## Points positifs constatés

- `.gitignore` complet : `.env`, `uploads/`, clés d'API non versionnées.
- Rate limiting actif sur login (10 tentatives / 15 min) et register (5 / heure).
- Validation Zod systématique sur toutes les routes admin et mutations utilisateur.
- Requêtes DB via Drizzle ORM (pas de SQL brut injecté).
- Upload avatar : validation MIME + taille + retraitement via `sharp` (isolation du contenu).
- Vérification d'ownership avant suppression de post/commentaire.
- Protection auto-modification de rôle admin dans `admin.members.server.ts`.
- Secrets d'auth validés avec longueur minimale (`AUTH_SECRET: z.string().min(16)`).

---

## Synthèse

| Criticité | Nb | Résolus | À corriger |
|-----------|-----|---------|------------|
| CRITIQUE  | 1   | 0       | 1 (SEC-01) |
| HAUTE     | 2   | 0       | 2 (SEC-02, SEC-03) |
| MOYENNE   | 4   | 0       | 4 (SEC-04 à SEC-07) |
| FAIBLE    | 2   | 0       | 2 (SEC-08, SEC-09) |
| **Total** | **9** | **0** | **9** |
