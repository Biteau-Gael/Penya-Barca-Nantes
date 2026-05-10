# Audit de Sécurité — Penya Blaugrana Nantes
**Date :** 10 mai 2026  
**Branche analysée :** `main`  
**Dernier commit :** `003faca` — *fix: évaluer les badges immédiatement après chaque action*

---

## 1. Résumé des derniers commits

| Commit | Date | Auteur | Description |
|--------|------|--------|-------------|
| `003faca` | 13/04/2026 | Biteau Gaël | **fix:** évaluation des badges immédiatement après chaque action (`feed.server.ts`, `match-detail.server.ts`) |
| `b1c88f6` | 13/04/2026 | Biteau Gaël | **feat:** Phase 2 — soirée match live, micro-pronos, badges, séries, saisons (20+ fichiers touchés) |
| `68e22d2` | 13/04/2026 | Biteau Gaël | **feat:** menu burger mobile pour la navigation (`header.tsx`) |
| `d461ee5` | 12/04/2026 | Claude | Merge `claude/deploy-synology-nas-cLkOL` → `main` |
| `554b873` | 12/04/2026 | Claude | Ajout du guide de mise à jour du déploiement NAS (`DEPLOY.md`) |
| `6aebaf7` | 12/04/2026 | Claude | Fix Better Auth trusted origins pour domaine custom |
| `9823bc5` | 12/04/2026 | Claude | Ajout service `migrate` dans `docker-compose.prod.yml` |
| `8d6e5e9` | 12/04/2026 | Claude | Docker Compose prod + script backup pour Synology NAS |
| `aed5841` | antérieur | Biteau Gaël | **security:** suppression des credentials du repo + renforcement `.gitignore` |

**Scope de la Phase 2 (commit `b1c88f6`) :** ajout de la soirée match live avec score en temps réel, micro-pronostics pendant les matchs, système de badges/achievements, séries de victoires, gestion des saisons, et migration DB `0007`.

---

## 2. Résultats de l'audit de sécurité

### Synthèse par sévérité

| Sévérité | Nb | Statut |
|----------|----|--------|
| CRITIQUE | 1 | A corriger en priorité absolue |
| ÉLEVÉ    | 4 | A corriger dans la semaine |
| MOYEN    | 5 | A planifier |
| FAIBLE   | 3 | Amélioration recommandée |

---

## 3. Vulnérabilités par ordre de criticité

---

### [CRITIQUE] — Path Traversal sur le serveur de fichiers

**Fichier :** `app/routes/uploads-files.ts` — ligne 5  
**Commit introduisant le problème :** Phase 1 (`fec3e63`)

```typescript
const filePath = path.join(process.cwd(), "uploads", params["*"]);
```

Le paramètre wildcard `params["*"]` n'est pas sanitisé. Un attaquant peut injecter `../../.env` ou `../../app/config/env.server.ts` pour lire des fichiers arbitraires du serveur.

**Exemple d'exploitation :**
```
GET /uploads-files/../../.env
→ retourne les secrets de production (DATABASE_URL, AUTH_SECRET, API_FOOTBALL_KEY)
```

**Correction :**
```typescript
const requestedPath = path.normalize(params["*"]);
// Bloquer toute tentative de sortie du répertoire
if (requestedPath.startsWith("..") || path.isAbsolute(requestedPath)) {
  return new Response("Forbidden", { status: 403 });
}
const filePath = path.join(process.cwd(), "uploads", requestedPath);
// Double vérification que le chemin résolu est bien dans uploads/
if (!filePath.startsWith(path.join(process.cwd(), "uploads"))) {
  return new Response("Forbidden", { status: 403 });
}
```

---

### [ÉLEVÉ] — Absence de validation Zod sur les entrées des API

**Fichiers :** `app/routes/api.micro-predictions.ts` (lignes 19–30), `app/routes/admin.events.server.ts`, `app/routes/admin.matches.server.ts`

Les champs reçus depuis `formData` sont castés en `string` sans validation :

```typescript
const question = formData.get("question") as string;  // taille ? caractères ?
const pointsValue = parseInt(formData.get("pointsValue") as string) || 1;  // NaN silencieux
const deadlineSeconds = parseInt(formData.get("deadlineSeconds") as string) || 120;  // valeur arbitraire
const optionsRaw = formData.get("options") as string;  // injection de contenu ?
```

`parseInt()` sans validation : une valeur négative, 0, ou très grande est acceptée silencieusement.

**Correction :** Ajouter un schéma Zod systématique avant traitement :
```typescript
const schema = z.object({
  matchId: z.string().min(1).max(100),
  question: z.string().min(3).max(500),
  pointsValue: z.coerce.number().int().min(1).max(100),
  deadlineSeconds: z.coerce.number().int().min(30).max(3600),
});
const parsed = schema.safeParse(Object.fromEntries(formData));
if (!parsed.success) return Response.json({ error: "Données invalides" }, { status: 400 });
```

---

### [ÉLEVÉ] — IP Spoofing sur le rate limiting auth

**Fichier :** `app/routes/api.auth.$.ts` — lignes 5–11

```typescript
function getClientIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}
```

Le header `X-Forwarded-For` est accepté sans vérification que la requête provient d'un proxy de confiance. Un attaquant peut envoyer `X-Forwarded-For: 1.2.3.4` pour contourner le rate limiting et tenter des brute-force illimités.

**Correction :** Configurer nginx (déjà présent dans `docker-compose.yml`) pour écraser le header et ne faire confiance qu'au proxy interne. Côté app, si le projet tourne derrière nginx, utiliser uniquement `x-real-ip` qui est injecté par nginx et non spoofable par le client.

---

### [ÉLEVÉ] — Sessions Redis sans TTL par défaut

**Fichier :** `app/lib/server/auth.server.ts` — lignes 48–53

```typescript
set: async (key, value, ttl) => {
  if (ttl) {
    await redis.set(key, value, "EX", ttl);
  } else {
    await redis.set(key, value);  // Persist indéfiniment !
  }
},
```

Si `better-auth` ne fournit pas de TTL pour certains types de clés (tokens de vérification, sessions de longue durée), elles persistent en Redis sans expiration. Cela crée une accumulation et un risque si un token révoqué reste valide.

**Correction :**
```typescript
set: async (key, value, ttl) => {
  const DEFAULT_TTL = 60 * 60 * 24 * 7; // 7 jours
  await redis.set(key, value, "EX", ttl ?? DEFAULT_TTL);
},
```

---

### [ÉLEVÉ] — Health check exposé sans authentification

**Fichier :** `app/routes/api.health.ts` — ligne 11

L'endpoint `/api/health` est accessible sans aucune authentification et révèle l'état de PostgreSQL et Redis :

```json
{ "status": "degraded", "services": { "db": "error", "redis": "ok" } }
```

Cette information aide un attaquant à confirmer que la DB est down avant de lancer une attaque ciblée.

**Correction :** Protéger par un token secret en header ou restreindre à localhost via nginx :
```typescript
const token = request.headers.get("x-health-token");
if (token !== env.HEALTH_CHECK_TOKEN) {
  return new Response("Unauthorized", { status: 401 });
}
```

---

### [MOYEN] — Validation du type MIME basée sur le header client

**Fichier :** `app/lib/server/upload.ts` — lignes 13–15

```typescript
if (!ALLOWED_TYPES.includes(file.type)) {
  throw new Error("Format non supporté. Utilisez JPEG, PNG ou WebP.");
}
```

`file.type` provient du navigateur et peut être falsifié. Un fichier `.php` renommé `.jpg` passe cette vérification.

**Atténuation existante :** `sharp` est utilisé pour le re-encodage (ligne 23–26), ce qui neutralise les payloads embarqués dans l'image. Le risque est donc limité mais non nul (ex: déni de service via fichier malformé crashant `sharp`).

**Correction recommandée :** Ajouter une lecture des magic bytes pour confirmation :
```typescript
// Vérifier les 4 premiers octets (JPEG: FF D8 FF, PNG: 89 50 4E 47, WEBP: 52 49 46 46)
const header = new Uint8Array(buffer.slice(0, 4));
const isJpeg = header[0] === 0xFF && header[1] === 0xD8;
const isPng = header[0] === 0x89 && header[1] === 0x50;
// ...
```

---

### [MOYEN] — Mots de passe par défaut en production (`changeme`)

**Fichier :** `docker-compose.prod.yml` — lignes 22, 32 ; `docker-compose.yml` — lignes 22, 32

```yaml
POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-changeme}
redis-server --requirepass ${REDIS_PASSWORD:-changeme}
```

Si le fichier `.env` n'est pas présent lors du déploiement, PostgreSQL et Redis démarrent avec `changeme` comme mot de passe. Ce fallback est dangereux car le conteneur démarre sans erreur visible.

**Correction :** Supprimer les valeurs par défaut pour forcer l'échec explicite si la variable n'est pas définie :
```yaml
POSTGRES_PASSWORD=${POSTGRES_PASSWORD:?POSTGRES_PASSWORD doit être défini}
```

---

### [MOYEN] — Backups non chiffrés

**Fichier :** `backup.sh` — lignes 11–13

```bash
docker compose ... exec -T postgres pg_dump -U penya penya_barca_nantes \
  > "$BACKUP_DIR/penya_$DATE.sql"
```

Les dumps SQL contiennent tous les hashs de mots de passe, emails, tokens et données personnelles en clair. Les fichiers `.sql` ne sont pas chiffrés et n'ont pas de permissions restrictives.

**Correction :**
```bash
# Chiffrement GPG + format compressé
pg_dump -Fc penya_barca_nantes | gpg --encrypt --recipient admin@penya.fr \
  > "$BACKUP_DIR/penya_$DATE.dump.gpg"
chmod 600 "$BACKUP_DIR/penya_$DATE.dump.gpg"
```

---

### [MOYEN] — Absence de headers de sécurité HTTP

**Périmètre :** aucun middleware global détecté dans `app/root.tsx` ou `react-router.config.ts`

Les headers suivants sont absents de toutes les réponses :

| Header | Risque |
|--------|--------|
| `Content-Security-Policy` | XSS si injection HTML possible |
| `X-Frame-Options: DENY` | Clickjacking |
| `X-Content-Type-Options: nosniff` | MIME sniffing |
| `Strict-Transport-Security` | Downgrade HTTPS→HTTP |

**Correction :** Ajouter un middleware dans `app/root.tsx` ou configurer nginx :
```nginx
add_header X-Frame-Options "DENY" always;
add_header X-Content-Type-Options "nosniff" always;
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
```

---

### [MOYEN] — Redis sans authentification en mode dev

**Fichier :** `docker-compose.yml` — ligne 31–38

Redis en mode développement (docker-compose.yml de base) n'a pas de `requirepass` contrairement à la prod. Si le port 6379 est accessible sur le réseau local ou via un tunnel, n'importe qui peut lire/écrire les sessions.

**Correction :** Même en dev, lier Redis à localhost uniquement :
```yaml
redis:
  ports:
    - "127.0.0.1:6379:6379"  # Bind local uniquement
```

---

### [FAIBLE] — `console.log` / log de l'IP complète

**Fichier :** `app/routes/api.auth.$.ts` — ligne 27

```typescript
logger.warn({ ip, action: "login-rate-limited" }, "Rate limit exceeded");
```

L'IP complète est loggée. Dans les pays soumis au RGPD (France), les adresses IP sont des données personnelles. Les logs doivent être traités comme tels (rétention limitée, accès restreint).

**Recommandation :** Tronquer l'IP dans les logs (`192.168.1.xxx`) ou la hasher avant stockage.

---

### [FAIBLE] — Absence de vérification que `memberId` existe avant suppression

**Fichier :** `app/routes/admin.members.server.ts` — ligne 71

```typescript
await db.delete(user).where(eq(user.id, memberId));
```

Si `memberId` ne correspond à aucun utilisateur, la requête réussit silencieusement (0 lignes affectées) sans erreur ni log d'anomalie. Un ID erroné ne produit aucun retour d'erreur.

**Recommandation :** Vérifier que l'utilisateur existe avant suppression et retourner une erreur 404 explicite.

---

### [FAIBLE] — Deadline de pronostic non vérifiée dans le passé

**Fichier :** `app/routes/admin.matches.server.ts` — lignes 94–99

La validation vérifie que `deadline < matchDate` mais pas que `deadline > now()`. Un admin peut créer un match avec une deadline déjà passée, fermant immédiatement les pronostics.

**Recommandation :**
```typescript
if (deadline && deadline <= new Date()) {
  return { error: "La deadline ne peut pas être dans le passé." };
}
```

---

## 4. Bonnes pratiques déjà en place

Ces points méritent d'être soulignés positivement :

- **Credentials supprimés du repo** (`aed5841`) — `.gitignore` renforcé, aucun secret dans l'historique récent.
- **Rate limiting sur l'authentification** — login (10/15min) et register (5/h) protégés.
- **`requireAuth` systématique** sur toutes les routes admin et API sensibles.
- **Drizzle ORM** utilisé partout — pas de requêtes SQL brutes, protection native contre l'injection SQL.
- **Stack traces absentes en prod** — `app/root.tsx` n'affiche les erreurs détaillées qu'en `DEV`.
- **Re-encodage `sharp`** des avatars — neutralise les payloads embarqués dans les images.
- **Validation de rôle en liste fermée** (`["member", "admin", "partner"]`) côté serveur.
- **Redis en prod avec mot de passe** (`requirepass` dans `docker-compose.prod.yml`).
- **Healthcheck Docker** configuré sur PostgreSQL et Redis pour éviter les démarrages en état dégradé.

---

## 5. Plan d'action recommandé

### Immédiat (avant prochain déploiement)

1. **Corriger le path traversal** dans `uploads-files.ts` — risque de fuite des secrets de prod.
2. **Supprimer les fallbacks `:-changeme`** dans les docker-compose (prod ET dev).

### Court terme (< 1 semaine)

3. Ajouter la **validation Zod** sur toutes les routes API (`api.micro-predictions.ts`, admin actions).
4. Corriger la **lecture IP** dans `api.auth.$.ts` (confiance exclusive à `x-real-ip` via nginx).
5. Ajouter un **TTL par défaut** dans le `secondaryStorage` Redis de `auth.server.ts`.

### Moyen terme (< 1 mois)

6. Protéger `/api/health` par token ou restriction nginx.
7. Ajouter les **headers de sécurité HTTP** (CSP, HSTS, X-Frame-Options) via nginx ou middleware.
8. Chiffrer les **backups SQL** avec GPG.
9. Restreindre Redis en dev à `127.0.0.1`.

### Amélioration continue

10. Tronquer/hasher les IPs dans les logs (conformité RGPD).
11. Ajouter validation date `deadline > now()`.
12. Vérifier l'existence de `memberId` avant suppression en DB.
