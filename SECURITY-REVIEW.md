# Rapport d'analyse — Sécurité & Résumé des commits
**Projet :** Penya Blaugrana Nantes  
**Date :** 2026-04-17  
**Branche analysée :** `main` (commits jusqu'au 2026-04-13)

---

## 1. Résumé des derniers commits

### Phase 2 — Sprint complet (11–13 avril 2026)

| Hash | Date | Type | Description |
|------|------|------|-------------|
| `003faca` | 2026-04-13 | fix | Badges évalués immédiatement après chaque action (pronostic, post, commentaire, réaction) |
| `b1c88f6` | 2026-04-13 | feat | **Phase 2 majeure** — Soirée match live, micro-pronostics, badges, séries, saisons (26 fichiers, +2 965 lignes) |
| `68e22d2` | 2026-04-13 | feat | Menu burger mobile pour la navigation |
| `4a65a7b` | 2026-04-13 | merge | Fusion PR #2 — déploiement Synology NAS |
| `6aebaf7` | 2026-04-12 | fix | Better Auth — correction des trusted origins pour domaine personnalisé |
| `9823bc5` | 2026-04-12 | feat | Service `migrate` ajouté dans `docker-compose.prod.yml` |
| `2bafc6c` | 2026-04-12 | merge | Fusion PR #1 — déploiement Synology NAS |
| `8d6e5e9` | 2026-04-12 | feat | Docker Compose production + script de backup Synology |
| `3d80133` | 2026-04-12 | docs | Roadmap Phase 2 — 8 priorités documentées |
| `aed5841` | 2026-04-12 | security | Suppression de credentials du repo + renforcement `.gitignore` |
| `6583da3` | 2026-04-12 | docs | README complet avec guide de déploiement NAS |
| `ab7fc5d` | 2026-04-12 | feat | Intégration API Football + stats enrichies + classement Liga |
| `16c43e6` | 2026-04-11 | feat | MVP Phase 1 — Penya Blaugrana Nantes |
| `fec3e63` | 2026-04-11 | feat | Initial commit |

#### Périmètre fonctionnel du commit `b1c88f6` (Phase 2)
- **Sprint 2 :** Route `/soiree/:matchId` — score live (polling API 60 s), fil du match, pronos communauté révélés au coup d'envoi, indicateur "En direct"
- **Sprint 3 :** Micro-pronostics admin (création, vote, clôture, points auto, suppression) ; séries de scores exacts (`currentStreak` / `bestStreak`) avec récompenses aux paliers 3/5/10
- **Sprint 5 :** 10 badges de base avec évaluation automatique, page `/badges`, table `seasons`, classement filtré par saison
- **DB :** Migration 0007 — tables `seasons`, `badges`, `user_badges`, `rewards`, `micro_predictions`, `micro_prediction_answers`

---

## 2. Analyse de sécurité

### Points positifs constatés

- Authentification centralisée via **Better Auth** avec sessions Redis
- **Rate limiting** actif sur `/api/auth` (login : 10 req/15 min, inscription : 5 req/h)
- Validation des entrées avec **Zod** (schémas `registerSchema`, `createPostSchema`, `createCommentSchema`, `updateProfileSchema`)
- Contrôle d'accès systématique via `requireAuth()` sur toutes les routes protégées
- Vérification propriété avant suppression (posts, commentaires, membres)
- Variables d'environnement validées au démarrage via Zod (`env.server.ts`)
- Traitement des avatars via **Sharp** (redimensionnement, conversion WebP) — pas de stockage direct du fichier brut
- Logs structurés avec **Pino** sans exposition de stack traces au client
- Credentials retirés du dépôt (commit `aed5841`)

---

### Problèmes identifiés — par ordre de criticité

---

#### 🔴 CRITIQUE — Path Traversal sur le service de fichiers

**Fichier :** `app/routes/uploads-files.ts:5`

```typescript
const filePath = path.join(process.cwd(), "uploads", params["*"]);
```

**Risque :** Un attaquant peut lire des fichiers arbitraires sur le serveur en utilisant des séquences `../` dans l'URL (ex. : `/uploads-files/../../.env` ou `/uploads-files/../../../etc/passwd`). `path.join` normalise le chemin mais ne bloque pas la sortie du répertoire `uploads/`.

**Correction recommandée :**
```typescript
const uploadsDir = path.join(process.cwd(), "uploads");
const filePath = path.resolve(uploadsDir, params["*"]);

// Vérifier que le chemin résolu reste dans le répertoire uploads/
if (!filePath.startsWith(uploadsDir + path.sep)) {
  return new Response("Forbidden", { status: 403 });
}
```

---

#### 🟠 HAUTE — Mots de passe par défaut en production

**Fichier :** `docker-compose.prod.yml:22,32`

```yaml
POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-changeme}
redis-server --requirepass ${REDIS_PASSWORD:-changeme}
```

**Risque :** Si les variables `POSTGRES_PASSWORD` et `REDIS_PASSWORD` ne sont pas définies dans le fichier `.env` de production, les services démarrent avec le mot de passe `changeme`. Une erreur de configuration silencieuse suffit à exposer la base de données et Redis.

**Correction recommandée :** Supprimer les valeurs par défaut pour forcer l'erreur au démarrage si les variables sont absentes :
```yaml
POSTGRES_PASSWORD=${POSTGRES_PASSWORD:?POSTGRES_PASSWORD manquant}
redis-server --requirepass ${REDIS_PASSWORD:?REDIS_PASSWORD manquant}
```

---

#### 🟡 MOYENNE — Contournement du rate limiting par spoofing IP

**Fichier :** `app/routes/api.auth.$.ts:6-10`

```typescript
function getClientIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}
```

**Risque :** Le header `X-Forwarded-For` est entièrement contrôlé par le client si l'application n'est pas derrière un reverse proxy de confiance. Un attaquant peut envoyer un header `X-Forwarded-For: 1.2.3.X` à chaque requête pour contourner le rate limiting et effectuer des attaques par force brute sur les comptes.

**Correction recommandée :** En production derrière un proxy Nginx/Traefik, configurer le proxy pour réécrire `X-Forwarded-For` et ne prendre que la dernière IP de confiance, ou utiliser `x-real-ip` exclusivement.

---

#### 🟡 MOYENNE — Endpoint `/api/health` non authentifié

**Fichier :** `app/routes/api.health.ts`

**Risque :** L'endpoint expose publiquement le statut des services internes (PostgreSQL, Redis) sans aucune authentification. Cette information peut être exploitée pour identifier des fenêtres d'indisponibilité ou planifier des attaques.

**Correction recommandée :** Restreindre l'accès à l'IP du réseau local, ou ajouter un token de vérification statique via header :
```typescript
const token = request.headers.get("x-health-token");
if (token !== process.env.HEALTH_TOKEN) {
  return new Response("Unauthorized", { status: 401 });
}
```

---

#### 🟡 MOYENNE — Exposition de messages d'erreur internes

**Fichier :** `app/routes/api.sync-matches.ts:21`

```typescript
const message = error instanceof Error ? error.message : "Erreur inconnue";
return Response.json({ error: message }, { status: 500 });
```

**Risque :** Les messages d'erreur natifs (noms de tables, URLs, timeouts réseau…) peuvent révéler des détails d'architecture ou des chemins d'attaque.

**Correction recommandée :**
```typescript
logger.error({ error }, "Erreur sync API-Football");
return Response.json({ error: "Erreur lors de la synchronisation" }, { status: 500 });
```

---

#### 🔵 FAIBLE — Vérification de rôle non typée (`as any`)

**Fichier :** `app/routes/feed.server.ts:99, 124, 184, 200`

```typescript
isAdmin: (session.user as any).role === "admin",
if (isAnnouncement && (session.user as any).role !== "admin")
```

**Risque :** L'utilisation de `as any` contourne la vérification TypeScript. Si le type de session évolue, les vérifications de rôle peuvent silencieusement renvoyer `false` sans erreur de compilation.

**Correction recommandée :** Utiliser la fonction `requireAuth` avec le paramètre de rôles, ou typer correctement la session :
```typescript
// Remplacer les vérifications dispersées par :
const isAdmin = session.user.role === "admin"; // si role est bien typé
// ou utiliser requireAuth(request, ["admin"]) dans les sections admin
```

---

#### 🔵 FAIBLE — `.gitignore` incomplet

**Fichier :** `.gitignore`

```
.env          # ← seul ce fichier est exclu
```

**Risque :** Les fichiers `.env.local`, `.env.production`, `.env.staging`, `.env.test` ne sont pas exclus et pourraient être commités accidentellement avec des secrets réels.

**Correction recommandée :**
```gitignore
.env
.env.*
!.env.example
```

---

#### 🔵 FAIBLE — Headers de sécurité HTTP manquants

**Périmètre :** global (aucun middleware de headers de sécurité détecté)

**Risque :** Absence de `Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy` et `Strict-Transport-Security`. Ces headers protègent contre le clickjacking, le MIME sniffing et les attaques XSS.

**Correction recommandée :** Ajouter un middleware dans `entry.server.tsx` ou configurer Nginx pour injecter ces headers :
```
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Content-Security-Policy: default-src 'self'; img-src 'self' data:; ...
```

---

#### 🔵 FAIBLE — Absence de rate limiting sur les micro-pronostics

**Fichier :** `app/routes/api.micro-predictions.ts`

**Risque :** L'action `answer` (réponse d'un joueur) effectue des écritures en base sans rate limiting. Des requêtes automatisées pourraient générer une charge anormale ou tenter d'inonder la DB malgré la vérification d'unicité.

**Correction recommandée :**
```typescript
if (intent === "answer") {
  await checkRateLimit({ key: `micro-answer:${session.user.id}`, maxAttempts: 20, windowSeconds: 60 });
  // ...
}
```

---

#### ⚪ INFO — Type de micro-pronostic non validé côté serveur

**Fichier :** `app/routes/api.micro-predictions.ts:21`

```typescript
const type = (formData.get("type") as string) || "qcm";
```

**Risque :** Le champ `type` est inséré directement en base sans validation. Si de nouveaux types sont ajoutés dans la logique métier, une valeur arbitraire pourrait provoquer des comportements inattendus.

**Correction recommandée :**
```typescript
const ALLOWED_TYPES = ["qcm", "libre"] as const;
const rawType = formData.get("type") as string;
const type = ALLOWED_TYPES.includes(rawType as typeof ALLOWED_TYPES[number]) ? rawType : "qcm";
```

---

#### ⚪ INFO — `APP_URL` optionnelle dans `trustedOrigins`

**Fichier :** `app/lib/server/auth.server.ts:12`

```typescript
trustedOrigins: env.APP_URL ? [env.APP_URL] : [],
```

**Risque :** Si `APP_URL` n'est pas définie, `trustedOrigins` est vide. Better Auth peut alors rejeter des requêtes légitimes ou accepter toutes les origines selon sa configuration par défaut. En production, l'absence de cette variable est silencieuse.

**Correction recommandée :** Rendre `APP_URL` obligatoire en production dans `env.server.ts` :
```typescript
APP_URL: z.string().url().optional().refine(
  (val) => process.env.NODE_ENV !== "production" || val !== undefined,
  { message: "APP_URL est requise en production" }
),
```

---

#### ⚪ INFO — Stack traces dans l'ErrorBoundary

**Fichier :** `app/root.tsx:91-93`

```typescript
} else if (import.meta.env.DEV && error && error instanceof Error) {
  details = error.message;
  stack = error.stack;
```

**Risque :** Les stack traces sont protégées par `import.meta.env.DEV`. Ce comportement est correct si le build de production est effectué avec `NODE_ENV=production`. **À vérifier** dans le pipeline de déploiement pour confirmer que la variable est bien positionnée lors du build Docker.

---

## 3. Tableau récapitulatif

| # | Criticité | Localisation | Problème | Action requise |
|---|-----------|-------------|---------|----------------|
| 1 | 🔴 CRITIQUE | `uploads-files.ts:5` | Path Traversal — lecture de fichiers arbitraires | Corriger immédiatement |
| 2 | 🟠 HAUTE | `docker-compose.prod.yml:22,32` | Mots de passe par défaut `changeme` en prod | Corriger avant prochain déploiement |
| 3 | 🟡 MOYENNE | `api.auth.$.ts:6-10` | IP Spoofing contourne le rate limiting | Corriger avec la config proxy |
| 4 | 🟡 MOYENNE | `api.health.ts` | Endpoint health public | Protéger ou restreindre réseau |
| 5 | 🟡 MOYENNE | `api.sync-matches.ts:21` | Messages d'erreur internes exposés | Corriger dans le prochain sprint |
| 6 | 🔵 FAIBLE | `feed.server.ts:99,124,184,200` | Vérification de rôle `as any` non typée | Refactoring recommandé |
| 7 | 🔵 FAIBLE | `.gitignore` | Patterns `.env.*` manquants | Corriger maintenant (1 ligne) |
| 8 | 🔵 FAIBLE | Global | Headers de sécurité HTTP absents | Ajouter via middleware/Nginx |
| 9 | 🔵 FAIBLE | `api.micro-predictions.ts` | Rate limiting absent sur les réponses | Corriger dans le prochain sprint |
| 10 | ⚪ INFO | `api.micro-predictions.ts:21` | Type micro-pronostic non validé | Correction optionnelle |
| 11 | ⚪ INFO | `auth.server.ts:12` | `APP_URL` optionnelle en production | Vérifier la config de déploiement |
| 12 | ⚪ INFO | `root.tsx:91-93` | Stack traces — vérifier la variable `NODE_ENV` au build | Confirmer pipeline Docker |

---

*Rapport généré le 2026-04-17 — analyse manuelle du code source de la branche `main`.*
