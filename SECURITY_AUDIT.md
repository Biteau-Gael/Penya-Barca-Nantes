# Audit de sécurité — Penya Barca Nantes

**Date :** 29 juin 2026  
**Périmètre :** Commits du 11 avril 2026 au 13 avril 2026 (Phase 2 + déploiement NAS)  
**Analysé par :** Claude Code — revue statique automatisée

---

## Résumé des derniers commits

| Commit | Date | Type | Description |
|--------|------|------|-------------|
| `003faca` | 13 avr. 2026 | fix | Évaluation immédiate des badges après chaque action |
| `b1c88f6` | 13 avr. 2026 | feat | Phase 2 : soirée match live, micro-pronos, badges, séries, saisons (+2965 lignes) |
| `d461ee5` | 12 avr. 2026 | merge | Fusion branche déploiement Synology NAS |
| `554b873` | 12 avr. 2026 | docs | Guide de déploiement NAS Synology |
| `68e22d2` | 13 avr. 2026 | feat | Menu burger mobile pour la navigation |
| `6aebaf7` | 12 avr. 2026 | fix | Better Auth trusted origins pour domaine personnalisé |
| `9823bc5` | 12 avr. 2026 | feat | Service `migrate` dans docker-compose.prod.yml |
| `aed5841` | 12 avr. 2026 | security | Suppression des credentials du repo + renforcement .gitignore |

---

## Bilan des vulnérabilités

| Criticité | Nombre |
|-----------|--------|
| 🔴 Critique | 1 |
| 🟠 Élevée | 5 |
| 🟡 Moyenne | 6 |
| 🟢 Faible | 4 |
| **Total** | **16** |

---

## 🔴 CRITIQUE

### SEC-01 — Path Traversal dans le service de fichiers

**Fichier :** `app/routes/uploads-files.ts:5`  
**CVSS estimé :** 9.1 (AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N)

Le wildcard de route est injecté directement dans `path.join()` sans aucune validation :

```typescript
const filePath = path.join(process.cwd(), "uploads", params["*"]);
const file = await readFile(filePath);
```

Une requête vers `/uploads/../../.env` expose le fichier `.env` contenant `AUTH_SECRET`, `DATABASE_URL`, et `API_FOOTBALL_KEY`. Aucune authentification n'est requise pour accéder à cette route.

**Correction recommandée :**
```typescript
export async function loader({ params }: { params: { "*": string } }) {
  const UPLOAD_DIR = path.join(process.cwd(), "uploads");
  const requested = path.normalize(params["*"] ?? "");

  // Rejeter toute tentative de traversée ou chemin absolu
  if (requested.startsWith("..") || path.isAbsolute(requested)) {
    return new Response("Forbidden", { status: 403 });
  }

  const filePath = path.join(UPLOAD_DIR, requested);

  // Vérification finale : le chemin résolu reste dans UPLOAD_DIR
  if (!filePath.startsWith(UPLOAD_DIR + path.sep)) {
    return new Response("Forbidden", { status: 403 });
  }
  // ... suite inchangée
}
```

---

## 🟠 ÉLEVÉE

### SEC-02 — Contournement du rate limiting par usurpation d'IP

**Fichier :** `app/routes/api.auth.$.ts:5-11`

```typescript
function getClientIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}
```

L'en-tête `X-Forwarded-For` est contrôlé par le client. Sans reverse proxy de confiance en amont, n'importe qui peut envoyer `X-Forwarded-For: 1.2.3.4` pour usurper une IP différente à chaque tentative et contourner le rate limiting sur la connexion et l'inscription.

**Correction recommandée :** Documenter l'exigence d'un reverse proxy Nginx/Traefik de confiance. Si l'app peut fonctionner sans proxy, filtrer les IPs de confiance :
```typescript
const TRUSTED_PROXIES = (process.env.TRUSTED_PROXIES || "").split(",").filter(Boolean);
function getClientIp(request: Request): string {
  if (TRUSTED_PROXIES.length > 0) {
    return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  }
  return "unknown"; // Sans proxy de confiance, ne pas utiliser l'en-tête
}
```

---

### SEC-03 — Délai des micro-pronos non appliqué côté serveur

**Fichier :** `app/routes/api.micro-predictions.ts:98-106`

Le `deadlineSeconds` est stocké en base mais **jamais vérifié** lors de la soumission d'une réponse. Seul `closedAt` (clôture manuelle) est contrôlé :

```typescript
// Vérifie uniquement la clôture manuelle par l'admin
if (!micro || micro.closedAt) {
  return Response.json({ error: "Micro-pronostic fermé" }, { status: 400 });
}
// ❌ Aucune vérification du délai automatique
```

Un joueur peut ignorer le compte à rebours côté client et soumettre une réponse après expiration via une requête POST directe, obtenant potentiellement la bonne réponse en regardant le live avant de répondre.

**Correction recommandée :**
```typescript
const deadlineAt = new Date(micro.createdAt.getTime() + micro.deadlineSeconds * 1000);
if (!micro.closedAt && new Date() > deadlineAt) {
  return Response.json({ error: "Délai expiré" }, { status: 400 });
}
```

---

### SEC-04 — Absence d'en-têtes de sécurité HTTP

**Fichier :** Configuration globale (aucun middleware détecté)

Aucun en-tête de sécurité n'est défini dans l'application :

| En-tête manquant | Risque |
|-----------------|--------|
| `Content-Security-Policy` | XSS, injection de scripts |
| `X-Frame-Options` | Clickjacking |
| `X-Content-Type-Options` | MIME sniffing |
| `Strict-Transport-Security` | Downgrade HTTP→HTTPS |
| `Referrer-Policy` | Fuite d'URL vers tiers |

**Correction recommandée :** Ajouter un middleware dans `app/root.tsx` :
```typescript
export function headers() {
  return {
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Content-Security-Policy": "default-src 'self'; img-src 'self' data:; script-src 'self'",
  };
}
```

---

### SEC-05 — Mots de passe par défaut `changeme` en production

**Fichier :** `docker-compose.prod.yml:23,32`

```yaml
POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-changeme}
command: redis-server --requirepass ${REDIS_PASSWORD:-changeme}
```

Si `POSTGRES_PASSWORD` ou `REDIS_PASSWORD` ne sont pas définis, les services démarrent avec un mot de passe trivial en production. Un attaquant sur le réseau Docker peut accéder directement à la base de données.

**Correction recommandée :** Forcer l'erreur au démarrage :
```yaml
POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?Erreur : POSTGRES_PASSWORD doit être défini}
```

---

### SEC-06 — Absence de transactions DB pour l'attribution des points

**Fichier :** `app/routes/api.micro-predictions.ts:66-83`

```typescript
for (const answer of answers) {
  await db.update(microPredictionAnswers)
    .set({ points })
    .where(eq(microPredictionAnswers.id, answer.id));
}
```

Les mises à jour de points sont exécutées une par une sans transaction. Si le processus s'interrompt en cours (crash, timeout), certains joueurs reçoivent leurs points, d'autres non — état incohérent irréparable sans intervention manuelle.

**Correction recommandée :**
```typescript
await db.transaction(async (tx) => {
  for (const answer of answers) {
    await tx.update(microPredictionAnswers)
      .set({ points })
      .where(eq(microPredictionAnswers.id, answer.id));
  }
});
```

---

## 🟡 MOYENNE

### SEC-07 — Validation insuffisante des entrées dans api.micro-predictions

**Fichier :** `app/routes/api.micro-predictions.ts:19-24`

Contrairement aux autres routes qui utilisent Zod, ce nouvel endpoint n'applique aucun schéma de validation :
- `question` : aucune longueur max (potentiel DoS avec des chaînes gigantesques)
- `type` : accepte toute chaîne (devrait être `"qcm" | "score" | "player"`)
- `pointsValue` : pas de borne max (ex. : 999 999 points en un clic)
- `deadlineSeconds` : pas de min/max (0 ou 1 000 000 secondes possibles)

**Correction recommandée :**
```typescript
const createMicroSchema = z.object({
  matchId: z.string().min(1).max(50),
  question: z.string().min(5).max(200),
  type: z.enum(["qcm", "score", "player"]),
  pointsValue: z.number().int().min(1).max(10),
  deadlineSeconds: z.number().int().min(30).max(600),
});
```

---

### SEC-08 — `correctAnswer` journalisé en clair dans les logs

**Fichier :** `app/routes/api.micro-predictions.ts:85`

```typescript
logger.info({ microId, correctAnswer, scored, total: answers.length }, "Micro-pronostic clôturé");
```

La bonne réponse est enregistrée dans les logs applicatifs. Si les logs sont consultables par un utilisateur ou exposés (ex. Synology log viewer), il peut tricher sur les futurs micro-pronos de même type.

**Correction recommandée :** Ne logger que l'identifiant :
```typescript
logger.info({ microId, scored, total: answers.length }, "Micro-pronostic clôturé");
```

---

### SEC-09 — `correctAnswer` exposé à tous les utilisateurs dans le loader

**Fichier :** `app/routes/soiree.server.ts:254`

```typescript
correctAnswer: m.correctAnswer,  // Envoyé à TOUS les clients
```

La réponse correcte est incluse dans la réponse API pour tous les utilisateurs, quelle que soit leur rôle. Dans le flux normal, elle n'est définie qu'à la clôture — mais si jamais elle était définie avant, elle serait visible dans la réponse JSON avant clôture officielle.

**Correction recommandée :**
```typescript
correctAnswer: m.closedAt ? m.correctAnswer : null,
```

---

### SEC-10 — Validation MIME basée sur le type client pour les uploads

**Fichier :** `app/lib/server/upload.ts:13`

```typescript
if (!ALLOWED_TYPES.includes(file.type)) {  // file.type = valeur client, forgeable
  throw new Error("Format non supporté.");
}
```

Une requête forgée peut définir `Content-Type: image/jpeg` tout en envoyant un fichier malveillant. La vérification par `sharp` limite le risque (sharp rejettera un non-image), mais l'erreur surviendra trop tard dans le traitement.

**Correction recommandée :** Valider par magic bytes avant le traitement :
```typescript
const buffer = Buffer.from(await file.arrayBuffer());
// sharp lèvera une exception sur tout format non-image — valide implicitement
// Pour une protection explicite : vérifier les premiers octets (magic bytes)
const magic = buffer.subarray(0, 4);
const isValidImage = 
  (magic[0] === 0xFF && magic[1] === 0xD8) || // JPEG
  (magic[0] === 0x89 && magic[1] === 0x50) || // PNG
  (magic[0] === 0x52 && magic[1] === 0x49);   // WebP (RIFF)
if (!isValidImage) throw new Error("Format non supporté.");
```

---

### SEC-11 — `APP_URL` optionnel entraîne des origines de confiance vides

**Fichier :** `app/lib/server/auth.server.ts:12` & `app/config/env.server.ts:15`

```typescript
trustedOrigins: env.APP_URL ? [env.APP_URL] : [],
```

Si `APP_URL` n'est pas défini (valeur optionnelle), `trustedOrigins` est vide. Selon la configuration interne de Better Auth, cela peut désactiver silencieusement les protections CORS au lieu de rejeter toutes les origines inconnues.

**Correction recommandée :** Rendre `APP_URL` obligatoire en production :
```typescript
APP_URL: z.string().url().optional().refine(
  (val) => process.env.NODE_ENV !== "production" || !!val,
  { message: "APP_URL requis en production" }
),
```

---

### SEC-12 — Absence de rate limiting sur les actions utilisateurs

**Fichier :** `app/routes/api.micro-predictions.ts`, `app/routes/feed.server.ts`

Le rate limiting est uniquement appliqué à l'authentification. Les actions utilisateurs (répondre aux micro-pronos, publier des posts, réagir) ne sont pas limitées. Un script automatisé peut inonder la base de réactions ou de commentaires.

**Correction recommandée :** Appliquer `checkRateLimit` par `userId` sur les actions sensibles :
```typescript
await checkRateLimit({ key: `answer:${session.user.id}`, maxAttempts: 20, windowSeconds: 60 });
```

---

## 🟢 FAIBLE

### SEC-13 — Redis utilise `process.env` au lieu de `getEnv()`

**Fichier :** `app/lib/server/redis.server.ts:3`

```typescript
export const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379", {
```

Utilise `process.env` directement sans passer par la validation Zod de `getEnv()`. Si `REDIS_URL` est absent, Redis démarre en local sans mot de passe sans erreur explicite.

**Correction :** Remplacer par `getEnv().REDIS_URL`.

---

### SEC-14 — Cache-Control immutable sur les avatars

**Fichier :** `app/routes/uploads-files.ts:21`

```typescript
"Cache-Control": "public, max-age=31536000, immutable",
```

Un avatar mis à jour n'est pas rechargé par les navigateurs clients pendant 1 an. Le cache busting (changement de l'URL) n'est pas implémenté.

**Correction :** Réduire à `max-age=86400` ou implémenter un cache busting basé sur hash.

---

### SEC-15 — Longueur minimale d'`AUTH_SECRET` insuffisante

**Fichier :** `app/config/env.server.ts:10`

```typescript
AUTH_SECRET: z.string().min(16),
```

16 caractères est le minimum accepté par Better Auth, mais 32+ caractères sont recommandés en 2026 pour une entropie suffisante.

**Correction :** `z.string().min(32)`.

---

### SEC-16 — Encodage corrompu dans un message d'erreur

**Fichier :** `app/routes/api.micro-predictions.ts:105`

```typescript
return Response.json({ error: "Micro-pronostic ferm��" }, { status: 400 });
```

Caractère `é` corrompu dans le message d'erreur (`ferm��` au lieu de `fermé`). Symptôme d'un problème d'encodage isolé mais à corriger.

---

## Points positifs

- **Authentification robuste** : Better Auth avec sessions Redis, cookies SameSite
- **Rate limiting** sur login/inscription (IP-based, fenêtres configurables)
- **Validation Zod** cohérente sur les routes feed, predictions, user
- **ORM Drizzle** : aucune concaténation SQL directe, requêtes paramétrées
- **Séparation des rôles** : `requireAuth(request, ["admin"])` sur toutes les routes admin
- **Vérification d'ownership** avant toute suppression (posts, commentaires)
- **Secrets non commités** : `.env` dans `.gitignore`, commit de nettoyage `aed5841`
- **Healthchecks Docker** configurés pour postgres et redis
- **Uploads traités par sharp** : redimensionnement + conversion WebP, rejet des non-images

---

## Plan de correction prioritaire

| # | Criticité | Action | Fichier cible |
|---|-----------|--------|---------------|
| 1 | 🔴 | Corriger le path traversal | `app/routes/uploads-files.ts` |
| 2 | 🟠 | Vérifier le délai deadline côté serveur | `app/routes/api.micro-predictions.ts` |
| 3 | 🟠 | Supprimer les mots de passe `changeme` | `docker-compose.prod.yml` |
| 4 | 🟠 | Ajouter en-têtes de sécurité HTTP | `app/root.tsx` (headers export) |
| 5 | 🟠 | Wrapper attribution points en transaction DB | `app/routes/api.micro-predictions.ts` |
| 6 | 🟠 | Documenter/corriger le X-Forwarded-For | `app/routes/api.auth.$.ts` |
| 7 | 🟡 | Ajouter schéma Zod sur micro-pronos | `app/routes/api.micro-predictions.ts` |
| 8 | 🟡 | Retirer `correctAnswer` des logs | `app/routes/api.micro-predictions.ts` |
| 9 | 🟡 | Filtrer `correctAnswer` avant clôture | `app/routes/soiree.server.ts` |
| 10 | 🟡 | Valider MIME par magic bytes | `app/lib/server/upload.ts` |
