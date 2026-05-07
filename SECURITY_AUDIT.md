# Audit de sécurité — Penya Barca Nantes

**Date :** 2026-05-07  
**Branche analysée :** `claude/sharp-fermi-5UaZQ`  
**Commits couverts :** `fec3e63` → `003faca` (13 commits)

---

## Résumé des derniers commits

| Hash | Description |
|------|-------------|
| `003faca` | fix: évaluer les badges immédiatement après chaque action (soumission prono, post, commentaire, réaction) |
| `b1c88f6` | feat: Phase 2 — soirée match live, micro-pronos, badges, séries, saisons |
| `d461ee5` | Merge branch deploy-synology-nas |
| `554b873` | docs: guide de déploiement mises à jour NAS |
| `68e22d2` | feat: menu burger mobile pour la navigation |
| `6aebaf7` | fix: Better Auth trusted origins pour domaine custom |
| `9823bc5` | chore: service migrate dans docker-compose.prod.yml |
| `8d6e5e9` | chore: docker-compose production + script de backup NAS |
| `3d80133` | docs: roadmap Phase 2 |
| `aed5841` | security: suppression credentials du repo + renforcement .gitignore |
| `6583da3` | docs: README complet avec guide déploiement |
| `ab7fc5d` | feat: intégration API Football + stats enrichies + classement Liga |
| `fec3e63` | feat: MVP Phase 1 |

---

## Résultats de l'audit par ordre de criticité

---

### CRITIQUE

#### C-1 — Path Traversal sur le serveur de fichiers statiques

**Fichier :** `app/routes/uploads-files.ts:5`

```typescript
const filePath = path.join(process.cwd(), "uploads", params["*"]);
```

`params["*"]` est directement concaténé au répertoire `uploads/` sans vérification que le chemin résolu reste à l'intérieur de ce répertoire. `path.join` normalise les séquences `..`, donc une requête vers `/uploads/../../.env` ou `/uploads/../../../etc/passwd` permettrait de lire n'importe quel fichier accessible au processus Node.

**Correction recommandée :**

```typescript
const uploadsDir = path.resolve(process.cwd(), "uploads");
const filePath = path.resolve(uploadsDir, params["*"]);

if (!filePath.startsWith(uploadsDir + path.sep)) {
  return new Response("Forbidden", { status: 403 });
}
```

---

### ÉLEVÉ

#### H-1 — Rate limiting absent sur les actions sensibles

**Fichiers :** `app/routes/api.micro-predictions.ts`, `app/routes/feed.server.ts`, `app/routes/profile.server.ts`

`checkRateLimit` n'est appliqué qu'au login (10 req/15 min) et à l'inscription (5 req/1 h) via `api.auth.$.ts`. Les actions suivantes ne sont pas protégées :

- Soumission de micro-pronostics (spam de votes)
- Création de posts et commentaires (flood du fil)
- Upload d'avatar (abus de disque / CPU sharp)

**Correction recommandée :** appliquer `checkRateLimit` avec une clé `${action}:${userId}` sur ces actions. Exemple pour l'upload :

```typescript
const ip = request.headers.get("x-forwarded-for")?.split(",")[0] ?? "unknown";
await checkRateLimit({ key: `avatar-upload:${session.user.id}`, maxAttempts: 5, windowSeconds: 3600 });
```

#### H-2 — Absence de headers de sécurité HTTP

Aucun header de sécurité n'est configuré au niveau applicatif ou au niveau du reverse-proxy (non documenté). Les headers manquants sont :

| Header | Impact |
|--------|--------|
| `Content-Security-Policy` | Prévention XSS |
| `X-Frame-Options: DENY` | Prévention clickjacking |
| `X-Content-Type-Options: nosniff` | Prévention MIME sniffing |
| `Referrer-Policy: strict-origin-when-cross-origin` | Fuite de données via Referer |
| `Strict-Transport-Security` | Downgrade HTTP (production) |

**Correction recommandée :** ajouter ces headers dans un loader racine (`app/root.tsx`) ou dans la configuration Nginx/Traefik du NAS.

```typescript
// app/root.tsx — export headers function
export function headers() {
  return {
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
  };
}
```

---

### MOYEN

#### M-1 — IP spoofing possible pour le rate limit

**Fichier :** `app/routes/api.auth.$.ts:7-9`

```typescript
request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
request.headers.get("x-real-ip") ||
"unknown"
```

Le header `x-forwarded-for` est accepté sans vérification que la requête provient bien d'un proxy de confiance. Un attaquant peut injecter `X-Forwarded-For: 1.2.3.4` pour contourner le rate limit par IP et simuler une adresse différente à chaque tentative.

**Correction recommandée :** lire l'IP depuis la socket (via `x-real-ip` positionné uniquement par le reverse-proxy de confiance), ou valider que l'adresse source est bien le proxy déclaré avant de faire confiance à `x-forwarded-for`.

#### M-2 — `correctAnswer` exposé dans la réponse soirée

**Fichier :** `app/routes/soiree.server.ts:253`

```typescript
correctAnswer: m.correctAnswer,
```

Le champ `correctAnswer` est envoyé au client pour tous les micro-pronostics. Bien qu'il soit positionné en même temps que `closedAt`, le payload expose la réponse correcte dans le DOM/bundle JS une fois le match terminé. Si un micro-prono est clôturé mais que l'interface ne l'affiche pas encore clairement, un utilisateur averti peut lire la réponse avant la révélation officielle.

**Correction recommandée :** ne transmettre `correctAnswer` que si `closedAt !== null` :

```typescript
correctAnswer: m.closedAt ? m.correctAnswer : null,
```

#### M-3 — Mot de passe par défaut "changeme" en production

**Fichier :** `docker-compose.prod.yml:22, 32`

```yaml
POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-changeme}
redis-server --requirepass ${REDIS_PASSWORD:-changeme}
```

Si les variables d'environnement `POSTGRES_PASSWORD` et `REDIS_PASSWORD` ne sont pas définies dans le `.env`, les services démarrent avec le mot de passe `changeme`. Une mauvaise manipulation lors du déploiement pourrait laisser les bases de données exposées.

**Correction recommandée :** remplacer les valeurs par défaut par un échec explicite ou documenter explicitement qu'elles sont obligatoires. Dans le `.env.example`, décommenter et marquer ces variables comme requises.

---

### FAIBLE

#### F-1 — Cast `as any` pour accéder au rôle utilisateur

**Fichier :** `app/routes/feed.server.ts:99, 124, 184`

```typescript
isAdmin: (session.user as any).role === "admin"
```

Le cast `as any` masque une incohérence de typage entre le type inféré de `session.user` par Better Auth et le champ `role` réel. Si le schéma change, cette vérification silencieuse ne produira pas d'erreur de compilation.

**Correction recommandée :** étendre le type `Session` de Better Auth ou utiliser `auth-utils.server.ts` qui expose déjà le type `Role`.

#### F-2 — Glob `*.png` trop large dans `.gitignore`

**Fichier :** `.gitignore:20`

```
*.png
```

Cette règle ignore tous les fichiers `.png` dans tout le dépôt, indépendamment du répertoire. Des fixtures de test, des icônes statiques ou des assets publics pourraient être accidentellement exclus du suivi.

**Correction recommandée :**

```gitignore
# Screenshots (spécifique à un dossier)
screenshots/*.png
```

#### F-3 — `APP_URL` optionnel peut vider les trusted origins

**Fichier :** `app/lib/server/auth.server.ts:12`

```typescript
trustedOrigins: env.APP_URL ? [env.APP_URL] : [],
```

Si `APP_URL` n'est pas défini en production, `trustedOrigins` est vide. Le comportement de Better Auth avec un tableau vide de trusted origins (accepter tout ou rejeter tout) doit être vérifié pour s'assurer que les requêtes cross-origin sont bien bloquées.

**Correction recommandée :** rendre `APP_URL` obligatoire en production dans `env.server.ts` ou ajouter un commentaire expliquant le comportement attendu.

---

## Bilan

| Criticité | Nombre | Statut recommandé |
|-----------|--------|-------------------|
| CRITIQUE  | 1      | Corriger immédiatement |
| ÉLEVÉ     | 2      | Corriger avant mise en production |
| MOYEN     | 3      | Planifier dans le prochain sprint |
| FAIBLE    | 3      | Traiter lors d'un refactoring |

### Points positifs

- Variables d'environnement validées par Zod à la startup (`env.server.ts`)
- `AUTH_SECRET` avec contrainte `min(16)` enforced
- Fichier `.env` exclu du dépôt, credentials supprimés (commit `aed5841`)
- Rate limiting Redis fonctionnel sur login/register avec tests unitaires
- Toutes les requêtes DB utilisent Drizzle ORM (pas de SQL brut, pas d'injection)
- Upload d'avatar : validation MIME type + taille + retraitement par Sharp
- Contrôle de rôle admin vérifié côté serveur pour toutes les actions sensibles
- Protection auto-modification de rôle admin (`adminMembersAction`)
- Logs structurés sur toutes les actions sensibles
