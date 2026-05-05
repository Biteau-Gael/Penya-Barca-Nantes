# Rapport de Revue de Sécurité — Penya Blaugrana Nantes

**Date** : 05 mai 2026  
**Branche** : `claude/sharp-fermi-eSRE0`  
**Périmètre** : Codebase complète (Phase 1 + Phase 2)

---

## Résumé des derniers commits

| Commit | Description |
|--------|-------------|
| `003faca` | fix: évaluer les badges immédiatement après chaque action (post, commentaire, réaction, pronostic) |
| `b1c88f6` | feat: Phase 2 — soirée match live, micro-pronos, badges, séries, saisons |
| `d461ee5` | Merge: branche de déploiement Synology NAS |
| `554b873` | Add deployment guide for Synology NAS updates |
| `68e22d2` | feat: menu burger mobile pour la navigation |
| `6aebaf7` | Fix Better Auth trusted origins pour support domaine custom |
| `9823bc5` | Add service de migration dans docker-compose.prod.yml |
| `8d6e5e9` | Add production Docker Compose + backup script pour NAS Synology |
| `aed5841` | security: suppression credentials du repo, renforcement .gitignore |
| `6583da3` | docs: README complet avec guide de déploiement NAS Synology |

---

## Résumé exécutif

La revue de sécurité a identifié **10 observations** réparties sur 4 niveaux de criticité. La posture générale est bonne : authentification robuste via Better-Auth, ORM typé, validation Zod sur la majorité des routes. Une vulnérabilité critique de path traversal requiert une correction immédiate avant tout déploiement en production.

| Criticité | Nb | Statut recommandé |
|-----------|----|--------------------|
| CRITIQUE  |  1 | Corriger avant mise en prod |
| HAUTE     |  3 | Corriger dans la semaine |
| MOYENNE   |  3 | Corriger dans le sprint suivant |
| FAIBLE    |  3 | À planifier |

---

## Vulnérabilités par ordre de criticité

---

### 🔴 CRITIQUE

#### SEC-01 — Path Traversal sur le service de fichiers uploadés

- **Fichier** : `app/routes/uploads-files.ts:5`
- **Code concerné** :
  ```typescript
  const filePath = path.join(process.cwd(), "uploads", params["*"]);
  ```
- **Problème** : `path.join()` ne neutralise pas les séquences `../`. Un attaquant peut forger une URL `/uploads/../../app/config/env.server.ts` ou `/uploads/../../.env` pour lire n'importe quel fichier du système de fichiers accessible au processus Node.js (clés d'API, secrets, code source, données DB).
- **Impact** : Divulgation complète de la configuration (clé API Football, `AUTH_SECRET`, `DATABASE_URL`).
- **Correction** :
  ```typescript
  const uploadsDir = path.resolve(process.cwd(), "uploads");
  const filePath = path.resolve(uploadsDir, params["*"]);

  // Bloquer toute sortie du répertoire uploads
  if (!filePath.startsWith(uploadsDir + path.sep)) {
    return new Response("Forbidden", { status: 403 });
  }
  ```

---

### 🟠 HAUTE

#### SEC-02 — Exposition de messages d'erreur internes vers le client

- **Fichier** : `app/routes/api.sync-matches.ts:21`
- **Code concerné** :
  ```typescript
  const message = error instanceof Error ? error.message : "Erreur inconnue";
  return Response.json({ error: message }, { status: 500 });
  ```
- **Problème** : Le message d'exception natif Node.js (potentiellement contenant une URL de base de données, un chemin système, ou une clé API) est retourné directement en JSON au client.
- **Impact** : Fuite d'informations d'infrastructure (chemins, credentials, stack traces).
- **Correction** : Logger l'erreur complète côté serveur et ne renvoyer qu'un message générique :
  ```typescript
  logger.error({ error }, "Erreur sync API-Football");
  return Response.json({ error: "Erreur de synchronisation. Contactez un administrateur." }, { status: 500 });
  ```

---

#### SEC-03 — `trustedOrigins` vide si `APP_URL` absent

- **Fichier** : `app/lib/server/auth.server.ts:12`
- **Code concerné** :
  ```typescript
  trustedOrigins: env.APP_URL ? [env.APP_URL] : [],
  ```
- **Problème** : `APP_URL` est optionnel dans le schéma Zod (`env.server.ts:15`). S'il n'est pas défini, `trustedOrigins` est un tableau vide. Selon la version de Better-Auth, cela peut désactiver la protection CSRF ou au contraire bloquer toutes les requêtes cross-origin en production, rendant l'application inutilisable ou non protégée.
- **Impact** : Risque de CSRF ou panne de fonctionnalité en production sans `APP_URL`.
- **Correction** : Rendre `APP_URL` obligatoire en production dans `env.server.ts` :
  ```typescript
  APP_URL: z.string().url().optional().refine(
    (url) => process.env.NODE_ENV !== "production" || !!url,
    { message: "APP_URL est requis en production" }
  ),
  ```

---

#### SEC-04 — Usurpation d'IP possible dans le rate limiting

- **Fichier** : `app/routes/api.auth.$.ts:6-9`
- **Code concerné** :
  ```typescript
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
  ```
- **Problème** : Si l'application est accessible directement (sans reverse proxy de confiance configuré), un attaquant peut forger l'en-tête `X-Forwarded-For` pour contourner le rate limiting en changeant son IP apparente à chaque requête.
- **Impact** : Contournement du rate limiting sur login/register → attaque par force brute sans restriction.
- **Correction** : En production derrière Nginx/Caddy, configurer le proxy pour écraser cet en-tête. En développement, documenter clairement que ce mécanisme n'est fiable qu'en présence d'un proxy de confiance.

---

### 🟡 MOYENNE

#### SEC-05 — Absence de validation du type et des options de micro-pronostic

- **Fichier** : `app/routes/api.micro-predictions.ts:21-30`
- **Code concerné** :
  ```typescript
  const type = (formData.get("type") as string) || "qcm";
  const optionsRaw = formData.get("options") as string;
  ```
- **Problème** : Le champ `type` n'est pas validé contre un enum (`"qcm" | "libre"`). Les options ne sont pas bornées en nombre ni en longueur. Un admin malveillant (ou un compte compromis) peut insérer des valeurs arbitrairement longues ou des types invalides.
- **Impact** : Données incohérentes en base, comportement indéfini lors du rendu côté client, risque XSS si les options sont réaffichées sans sanitisation.
- **Correction** : Ajouter un schéma Zod :
  ```typescript
  const createMicroSchema = z.object({
    type: z.enum(["qcm", "libre"]),
    question: z.string().min(5).max(300),
    options: z.array(z.string().max(100)).max(6).optional(),
    pointsValue: z.number().int().min(1).max(10),
    deadlineSeconds: z.number().int().min(30).max(3600),
  });
  ```

---

#### SEC-06 — Secret d'authentification minimal insuffisant

- **Fichier** : `app/config/env.server.ts:10`
- **Code concerné** :
  ```typescript
  AUTH_SECRET: z.string().min(16),
  ```
- **Problème** : Le minimum de 16 caractères est inférieur aux recommandations de sécurité actuelles (NIST SP 800-132 préconise une entropie équivalente à 32 octets / 256 bits pour les secrets de session).
- **Impact** : Secret faible → signature JWT ou session falsifiable par attaque par force brute si un secret court est utilisé.
- **Correction** :
  ```typescript
  AUTH_SECRET: z.string().min(32),
  ```

---

#### SEC-07 — Race condition dans le rate limiter Redis

- **Fichier** : `app/lib/server/rate-limit.server.ts:16-20`
- **Code concerné** :
  ```typescript
  const current = await redis.incr(redisKey);
  if (current === 1) {
    await redis.expire(redisKey, windowSeconds);
  }
  ```
- **Problème** : `INCR` et `EXPIRE` sont deux commandes Redis non atomiques. Si le process Node.js crash ou est tué entre les deux instructions, la clé reste sans TTL et le compteur ne se réinitialise jamais → blocage permanent de l'utilisateur ou du service.
- **Impact** : Blocage légitime d'utilisateurs (DoS involontaire).
- **Correction** : Utiliser une pipeline atomique :
  ```typescript
  const pipeline = redis.pipeline();
  pipeline.incr(redisKey);
  pipeline.expire(redisKey, windowSeconds, "NX"); // NX = ne poser l'expiry que si absente
  const [[, current]] = await pipeline.exec();
  ```

---

### 🔵 FAIBLE

#### SEC-08 — Adresse IP loggée en clair (données PII)

- **Fichier** : `app/routes/api.auth.$.ts:27`
- **Code concerné** :
  ```typescript
  logger.warn({ ip, action: ... }, "Rate limit exceeded");
  ```
- **Problème** : Les adresses IP sont des données à caractère personnel (RGPD). Les logger en clair sans durée de rétention définie peut créer une obligation légale de protection des logs.
- **Correction** : Logger un hash ou un token pseudonymisé, ou documenter la politique de rétention des logs.

---

#### SEC-09 — Cache HTTP immuable sur les avatars

- **Fichier** : `app/routes/uploads-files.ts:21`
- **Code concerné** :
  ```typescript
  "Cache-Control": "public, max-age=31536000, immutable",
  ```
- **Problème** : Si un utilisateur change son avatar, les anciens clients (navigateurs, CDN) garderont l'ancien en cache pendant 1 an car `immutable` indique que le contenu ne changera jamais. Le fichier est nommé `{userId}.webp` et écrasé à chaque mise à jour.
- **Correction** : Utiliser un paramètre de version dans l'URL (ex: `?v={timestamp}`) et conserver `immutable`, ou utiliser `must-revalidate` sans `immutable`.

---

#### SEC-10 — Limite de taille de corps de requête non définie au niveau middleware

- **Fichier** : `app/routes/profile.server.ts` (upload avatar)
- **Problème** : La validation de taille (2 Mo) est appliquée après que le fichier entier a été lu en mémoire via `file.arrayBuffer()`. Un attaquant peut envoyer une requête POST de plusieurs gigaoctets avant que le code de validation ne s'exécute.
- **Impact** : Potentielle attaque par épuisement mémoire (DoS).
- **Correction** : Configurer une limite globale dans `vite.config.ts` ou dans le serveur Express/Node.js sous-jacent.

---

## Points positifs confirmés ✅

| Point | Détail |
|-------|--------|
| ORM typé | Drizzle ORM — requêtes paramétrées, pas d'injection SQL possible |
| Validation Zod | Présente sur la majorité des routes et champs de formulaire |
| Authentification | Better-Auth avec sessions Redis — implémentation solide |
| Rate limiting | Protège login (10 req/15 min) et register (5 req/h) |
| Contrôle d'accès admin | `requireAuth(request, ["admin"])` appliqué systématiquement sur toutes les routes admin |
| Séparation server/client | Fichiers `.server.ts` — aucune fuite de code serveur côté client |
| Stack traces absentes en prod | `root.tsx:92` — traces uniquement en `DEV` |
| Variables d'env validées | Schéma Zod au démarrage, fail-fast si config invalide |
| Upload sécurisé | Vérification MIME + taille + reconversion via Sharp |
| Protection CSRF | Better-Auth gère nativement les tokens CSRF |
| Audit trail admin | Toutes les actions admin sont loggées avec `session.user.id` |

---

## Plan d'action priorisé

### Phase 1 — Urgent (avant mise en prod)
- [ ] **SEC-01** : Corriger le path traversal dans `uploads-files.ts`
- [ ] **SEC-02** : Généraliser les messages d'erreur côté client dans `api.sync-matches.ts`

### Phase 2 — Sprint en cours
- [ ] **SEC-03** : Rendre `APP_URL` obligatoire en production
- [ ] **SEC-04** : Documenter/protéger la récupération de l'IP client
- [ ] **SEC-05** : Ajouter validation Zod sur la création de micro-pronostics
- [ ] **SEC-06** : Porter le minimum `AUTH_SECRET` à 32 caractères

### Phase 3 — Sprint suivant
- [ ] **SEC-07** : Rendre le rate limiter Redis atomique
- [ ] **SEC-08** : Pseudonymiser les IPs dans les logs
- [ ] **SEC-09** : Corriger la stratégie de cache des avatars
- [ ] **SEC-10** : Ajouter une limite de corps de requête au niveau middleware

---

## Checklist de déploiement production

- [ ] `NODE_ENV=production` défini
- [ ] `AUTH_SECRET` ≥ 32 caractères aléatoires
- [ ] `APP_URL` défini (domaine de production)
- [ ] `REDIS_URL` avec authentification activée
- [ ] `DATABASE_URL` avec SSL (`?sslmode=require`)
- [ ] HTTPS forcé (Nginx/Caddy en frontal)
- [ ] Logs vers fichier ou service externe (pas stdout brut)
- [ ] `npm audit` sans vulnérabilité critique
- [ ] Sauvegardes DB testées (`backup.sh`)
- [ ] SEC-01 corrigé (path traversal)

---

*Rapport généré le 05/05/2026 — À réviser après chaque sprint majeur.*
