# Audit de Sécurité — Penya Blaugrana Nantes
**Date :** 04/06/2026  
**Analysé par :** Claude Code (claude-sonnet-4-6)  
**Branche :** `main`  
**Dernier commit analysé :** `003faca`  
**Fichiers examinés :** 25+ fichiers (routes, lib/server, db/schema, config, docker)

---

## Résumé des derniers commits

| Hash | Date | Type | Description |
|------|------|------|-------------|
| `003faca` | 13/04/2026 | fix | Évaluer les badges immédiatement après chaque action (prono, post, commentaire, réaction) |
| `b1c88f6` | 13/04/2026 | feat | **Phase 2** — Soirée match live, micro-pronos, badges, séries, saisons (+2 965 lignes) |
| `d461ee5` | 12/04/2026 | merge | Branche `deploy-synology-nas-cLkOL` |
| `554b873` | 12/04/2026 | docs | Guide de déploiement NAS Synology |
| `68e22d2` | 12/04/2026 | feat | Menu burger mobile |
| `6aebaf7` | 12/04/2026 | fix | Better Auth — trusted origins pour domaine custom |
| `9823bc5` | 12/04/2026 | feat | Service `migrate` dans `docker-compose.prod.yml` |

Le commit `b1c88f6` est le plus impactant : il introduit 8 nouveaux fichiers de routes/logique métier et 6 nouvelles tables en base de données, d'où la majorité des remarques ci-dessous.

---

## Tableau de bord

| Niveau | Nb | Description |
|--------|----|-------------|
| **CRITIQUE** | 2 | À corriger avant toute mise en production |
| **ÉLEVÉ** | 3 | À traiter dans les 48h |
| **MOYEN** | 4 | À planifier dans le sprint suivant |
| **FAIBLE** | 3 | Améliorations recommandées |
| **INFO** | 6 | Points de conformité positifs |

---

## Détail des vulnérabilités

---

### CRITIQUE

---

#### [SEC-01] Path Traversal — Accès fichiers sans validation
**Fichier :** `app/routes/uploads-files.ts:5`

**Code actuel :**
```typescript
const filePath = path.join(process.cwd(), "uploads", params["*"]);
```

**Problème :**  
Le paramètre wildcard `params["*"]` n'est pas validé ni normalisé avant son usage dans `path.join()`. `path.join` résout les séquences `../` : un attaquant peut construire des URLs comme :
```
GET /uploads/../../.env            → lit le fichier .env
GET /uploads/../../app/db/client.ts → lit le code source
```

**Impact :** Divulgation de credentials, code source, clés API. Criticité maximale en cas d'exploitation réelle.

**Correction :**
```typescript
export async function loader({ params }: { params: { "*": string } }) {
  const uploadsDir = path.resolve(process.cwd(), "uploads");
  const filePath = path.resolve(uploadsDir, params["*"] ?? "");

  // Refuser tout chemin qui sort du répertoire uploads
  if (!filePath.startsWith(uploadsDir + path.sep)) {
    return new Response("Not found", { status: 404 });
  }

  // Valider l'extension
  const ext = path.extname(filePath).toLowerCase();
  const allowed = new Set([".webp", ".jpg", ".jpeg", ".png"]);
  if (!allowed.has(ext)) {
    return new Response("Not found", { status: 404 });
  }

  // ... reste inchangé
}
```

---

#### [SEC-02] Mots de passe par défaut en production
**Fichier :** `docker-compose.prod.yml:22,32`

**Code actuel :**
```yaml
POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-changeme}
redis-server --requirepass ${REDIS_PASSWORD:-changeme}
```

**Problème :**  
Si les variables `POSTGRES_PASSWORD` et `REDIS_PASSWORD` ne sont pas définies dans le `.env` au moment du déploiement, Docker utilise `changeme` comme mot de passe. Cela expose la base de données complète (sessions, tokens OAuth, hachés de mots de passe, données de jeu).

**Impact :** Compromission totale de la base de données et du cache si déployé sans `.env` correctement renseigné.

**Correction :**
```yaml
# Option 1 : Supprimer les valeurs par défaut (le conteneur échoue au démarrage si la var manque)
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
# Option 2 : Ajouter une validation au script d'entrée
# Option 3 : Utiliser Docker Secrets (Swarm) ou un gestionnaire de secrets
```
Documenter explicitement dans `DEPLOY.md` que ces deux variables sont obligatoires.

---

### ÉLEVÉ

---

#### [SEC-03] IP Header Spoofable — Rate limiting contournable
**Fichier :** `app/routes/api.auth.$.ts:6-10`

**Code actuel :**
```typescript
function getClientIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}
```

**Problème :**  
`X-Forwarded-For` et `X-Real-IP` sont des headers HTTP librement modifiables par le client. Un attaquant peut envoyer `X-Forwarded-For: 1.2.3.4` pour usurper une IP différente à chaque requête, contournant le rate limiting sur le login (10 tentatives/15 min) et le register (5 tentatives/heure).

**Impact :** Bruteforce de mots de passe sans limite effective.

**Correction :**  
Si l'application est derrière un reverse proxy Nginx configuré sur le NAS Synology, ne faire confiance qu'à l'IP de la connexion directe TCP (non accessible via headers client). À défaut, ajouter un identifiant de session ou de fingerprint au rate limit key :
```typescript
// Combiner IP + User-Agent pour limiter le spoofing facile
const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
const ua = request.headers.get("user-agent") || "";
const key = isSignIn ? `login:${ip}:${hashShort(ua)}` : `register:${ip}:${hashShort(ua)}`;
```
Ou configurer Nginx pour transmettre l'IP réelle via un header de confiance unique.

---

#### [SEC-04] Message d'erreur API exposé en production
**Fichier :** `app/routes/api.sync-matches.ts:21`

**Code actuel :**
```typescript
const message = error instanceof Error ? error.message : "Erreur inconnue";
return Response.json({ error: message }, { status: 500 });
```

**Problème :**  
Les erreurs provenant de l'API RapidAPI peuvent inclure dans leur message : l'URL appelée, le status HTTP, parfois des tokens ou des détails d'authentification. Ce message est retourné directement au navigateur de l'admin.

**Impact :** Divulgation d'informations internes (clé API, architecture).

**Correction :**
```typescript
catch (error) {
  logger.error({ error, action: "sync-matches-failed" }, "Sync API-Football échouée");
  return Response.json(
    { error: "Synchronisation échouée. Consultez les logs serveur." },
    { status: 500 }
  );
}
```

---

#### [SEC-05] Validation insuffisante des champs numériques
**Fichier :** `app/routes/api.micro-predictions.ts:23-24`

**Code actuel :**
```typescript
const pointsValue = parseInt(formData.get("pointsValue") as string) || 1;
const deadlineSeconds = parseInt(formData.get("deadlineSeconds") as string) || 120;
```

**Problème :**  
`parseInt()` sans bornes accepte des valeurs arbitraires (`pointsValue = 999999`, `deadlineSeconds = 86400000`). Un admin (ou un compte admin compromis) peut créer des micro-pronostics avec des points absurdes qui corrompent le classement.

**Impact :** Intégrité des données de jeu compromise.

**Correction :**
```typescript
import { z } from "zod";

const createMicroSchema = z.object({
  matchId: z.string().min(1).max(100),
  question: z.string().min(3).max(500),
  type: z.enum(["qcm", "libre"]).default("qcm"),
  pointsValue: z.coerce.number().int().min(1).max(100).default(1),
  deadlineSeconds: z.coerce.number().int().min(30).max(3600).default(120),
  options: z.string().max(1000).optional(),
});
```

---

### MOYEN

---

#### [SEC-06] MIME type d'upload vérifié côté client uniquement
**Fichier :** `app/lib/server/upload.ts:13`

**Code actuel :**
```typescript
if (!ALLOWED_TYPES.includes(file.type)) {
  throw new Error("Format non supporté...");
}
```

**Problème :**  
`file.type` est le `Content-Type` fourni par le client — librement modifiable. Un fichier exécutable déclaré `image/jpeg` passerait le filtre. La bibliothèque `sharp` traite ensuite le buffer, ce qui peut provoquer un crash (DoS) sur un fichier spécialement conçu.

**Impact :** Upload de fichiers non-images ; risque de crash serveur via fichier malformé.

**Correction :**
```typescript
import { fileTypeFromBuffer } from "file-type"; // npm install file-type

const buffer = Buffer.from(await file.arrayBuffer());
const detected = await fileTypeFromBuffer(buffer);
if (!detected || !ALLOWED_TYPES.includes(detected.mime)) {
  throw new Error("Format non supporté. Utilisez JPEG, PNG ou WebP.");
}
try {
  const webpBuffer = await sharp(buffer).resize(256, 256, { fit: "cover" }).webp({ quality: 80 }).toBuffer();
  // ...
} catch {
  throw new Error("Le fichier image est invalide ou corrompu.");
}
```

---

#### [SEC-07] Suppression de compte sans confirmation forte
**Fichier :** `app/routes/profile.server.ts`

**Problème :**  
L'action `delete-account` supprime le compte immédiatement après soumission du formulaire, sans étape de confirmation par email, ré-authentification, ou délai de grâce. La suppression est également définitive (pas de soft-delete).

**Impact :** Suppression accidentelle non récupérable ; risque CSRF si les cookies ne sont pas correctement configurés en `SameSite=Strict`.

**Correction recommandée :**
- Envoyer un email de confirmation avec un token signé (durée de validité 24h)
- Ou : soft-delete avec colonne `deletedAt` et purge planifiée après 30 jours

---

#### [SEC-08] Typage `any` sur données API externe
**Fichier :** `app/routes/soiree.server.ts:93`

**Code actuel :**
```typescript
return res.value.json().then((data: any) => {
```

**Problème :**  
Les données de l'API RapidAPI ne sont pas validées avec un schéma. Si l'API renvoie un format inattendu (champ renommé, valeur null), le code peut propager des données incorrectes dans la page match live, voire provoquer un crash runtime non géré.

**Impact :** Erreur 500 en soirée match si l'API change de format ; données affichées incorrectes.

**Correction :**
```typescript
const lineupSchema = z.object({
  status: z.string(),
  response: z.object({
    lineup: z.object({
      name: z.string().optional(),
      starters: z.array(z.any()).default([]),
      subs: z.array(z.any()).default([]),
    }).optional(),
  }).optional(),
});

const parsed = lineupSchema.safeParse(data);
if (!parsed.success || parsed.data.status !== "success") return;
```

---

#### [SEC-09] Syntaxe SQL littérale dans les badges
**Fichier :** `app/lib/server/badges.server.ts:140-142`

**Code actuel :**
```typescript
const [userRow] = await db
  .select({ bestStreak: sql<number>`coalesce(best_streak, 0)::int` })
  .from(sql`"user"`)
  .where(sql`id = ${userId}`);
```

**Problème :**  
Le nom de table `"user"` est écrit en chaîne littérale dans un template `sql`. Drizzle paramétrise correctement `${userId}` donc il n'y a **pas d'injection SQL**, mais :
- Le type de retour n'est pas vérifié par TypeScript
- Une faute de frappe sur le nom de table n'est pas détectée à la compilation
- Incohérent avec le reste du code qui utilise `from(user)` et `eq()`

**Correction :**
```typescript
import { user } from "~/db/schema";

const [userRow] = await db
  .select({ bestStreak: user.bestStreak })
  .from(user)
  .where(eq(user.id, userId));
```

---

### FAIBLE

---

#### [SEC-10] Race condition sur l'expiration Redis
**Fichier :** `app/lib/server/rate-limit.server.ts:18-19`

**Code actuel :**
```typescript
const current = await redis.incr(redisKey);
if (current === 1) {
  await redis.expire(redisKey, windowSeconds);
}
```

**Problème :**  
L'expiration n'est posée que si `current === 1`. Si deux requêtes simultanées arrivent avec `current === 1` (race condition improbable mais possible), ou si la clé existe déjà sans TTL (suite à un bug), elle ne s'expirera jamais.

**Correction :**
```typescript
const luaScript = `
  local val = redis.call('incr', KEYS[1])
  if val == 1 then redis.call('expire', KEYS[1], ARGV[1]) end
  return val
`;
const current = await redis.eval(luaScript, 1, redisKey, String(windowSeconds)) as number;
```

---

#### [SEC-11] Endpoint health check public
**Fichier :** `app/routes/api.health.ts`

**Problème :**  
L'endpoint est accessible sans authentification et révèle l'état des services (DB, Redis). Un attaquant peut surveiller la disponibilité pour coordonner une attaque pendant une fenêtre de maintenance.

**Correction :**  
Limiter la réponse publique à `{ status: "ok" | "degraded" }` et réserver le détail par service aux admins authentifiés.

---

#### [SEC-12] Couverture `.gitignore` incomplète
**Fichier :** `.gitignore`

**Problème :**  
`.env.local`, `.env.production`, `*.pem`, `*.key` et `docker-compose.override.yml` ne sont pas listés. Un `.env.local` créé localement ou un certificat TLS pourraient être committés accidentellement.

**Correction :**
```gitignore
.env
.env*.local
.env.production
*.pem
*.key
docker-compose.override.yml
*.log
```

---

## Points de conformité positifs

| # | Fichier | Point positif |
|---|---------|---------------|
| 1 | `app/config/env.server.ts` | Validation Zod de toutes les variables d'environnement au démarrage (fail-fast si manquante) |
| 2 | `app/lib/server/auth-utils.server.ts` | `requireAuth()` correctement implémentée avec contrôle de rôles typé (`Role[]`) |
| 3 | `docker-compose.prod.yml` | Utilisation de `env_file: .env` — aucun secret hardcodé |
| 4 | `.gitignore` | `.env` exclu ; commit `aed5841` avait déjà nettoyé des credentials commités |
| 5 | `app/routes/api.sync-matches.ts` | Route de sync protégée par `requireAuth(request, ["admin"])` |
| 6 | `app/routes/api.micro-predictions.ts` | Vérification anti-doublon de réponse (`userId` + `microPredictionId`) |
| 7 | `app/lib/server/badges.server.ts:160-164` | Vérification des badges déjà obtenus avant insertion (`ownedBadgeIds`) |

---

## Plan d'action par priorité

### Phase 1 — Avant la prochaine mise en production

| # | Action | Fichier | Effort |
|---|--------|---------|--------|
| 1 | Fixer le path traversal avec `path.resolve` + contrôle `startsWith` | `uploads-files.ts` | ~30 min |
| 2 | Supprimer les fallbacks `:-changeme` et documenter les vars obligatoires | `docker-compose.prod.yml` + `DEPLOY.md` | ~15 min |
| 3 | Masquer les messages d'erreur API en production | `api.sync-matches.ts` | ~10 min |
| 4 | Ajouter bornes min/max via Zod sur les micro-pronos | `api.micro-predictions.ts` | ~45 min |

### Phase 2 — Sprint suivant

| # | Action | Fichier | Effort |
|---|--------|---------|--------|
| 5 | Valider les uploads avec magic bytes (`file-type`) | `upload.ts` | ~2h |
| 6 | Évaluer la config proxy Nginx pour le rate limiting | `api.auth.$.ts` | ~1h |
| 7 | Script Lua atomique pour Redis rate limit | `rate-limit.server.ts` | ~30 min |
| 8 | Valider les réponses API externe avec Zod | `soiree.server.ts` | ~2h |

### Phase 3 — Backlog

| # | Action | Fichier | Effort |
|---|--------|---------|--------|
| 9 | Confirmation email avant suppression de compte | `profile.server.ts` | ~3h |
| 10 | Remplacer `sql\`"user"\`` par `from(user)` + `eq()` | `badges.server.ts` | ~15 min |
| 11 | Ajouter `redact` dans la config Pino | `logger.server.ts` | ~20 min |
| 12 | Compléter `.gitignore` | `.gitignore` | ~5 min |
| 13 | Restreindre les infos de l'endpoint health | `api.health.ts` | ~30 min |

---

## Fichiers vérifiés sans remarque

- `app/lib/server/auth.server.ts` — Configuration Better Auth correcte
- `app/lib/server/auth-utils.server.ts` — `requireAuth` + gestion des rôles robuste
- `app/lib/server/streaks.server.ts` — Calcul de séries géré côté serveur, `isExactScore` calculé par `calculatePoints()` (non injectable)
- `app/lib/server/seasons.server.ts` — Requêtes Drizzle typées, pas de données utilisateur
- `app/routes/admin.dashboard.server.ts` — Protégé par `requireAuth`
- `app/routes/admin.members.server.ts` — Protégé par `requireAuth`
- `app/routes/badges.server.ts` — Lecture seule, authentification requise
- `app/db/schema/badges.ts`, `micro-predictions.ts`, `seasons.ts`, `rewards.ts` — Contraintes correctes
- `app/lib/validation/prediction.ts`, `match.ts`, `user.ts` — Schémas Zod corrects
- `app/db/client.ts` — Pool PostgreSQL standard, pas de secrets exposés

---

*Audit généré le 04/06/2026. À réviser à chaque merge significatif ou avant chaque mise en production.*
