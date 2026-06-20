# Audit de sécurité — Penya Blaugrana Nantes

**Date** : 20 juin 2026  
**Branche analysée** : `main` (HEAD `003faca`)  
**Scope** : Code source, configuration Docker, gestion des fichiers, authentification, APIs

---

## Résumé des derniers commits

| Commit | Auteur | Date | Description |
|--------|--------|------|-------------|
| `003faca` | Biteau Gaël | 13/04/2026 | fix: évaluer les badges immédiatement après chaque action |
| `b1c88f6` | Biteau Gaël | 13/04/2026 | feat: Phase 2 — soirée match live, micro-pronos, badges, séries, saisons |
| `d461ee5` | Claude | 12/04/2026 | Merge branch 'claude/deploy-synology-nas-cLkOL' |
| `554b873` | Claude | 12/04/2026 | Add deployment guide for Synology NAS updates |
| `68e22d2` | Biteau Gaël | 13/04/2026 | feat: menu burger mobile pour la navigation |
| `4a65a7b` | Biteau Gaël | 13/04/2026 | Merge pull request #2 — Fix Better Auth trusted origins + docker-compose prod |
| `6aebaf7` | Claude | 12/04/2026 | Fix Better Auth trusted origins for custom domain support |
| `9823bc5` | Claude | 12/04/2026 | Add migrate service to docker-compose.prod.yml |
| `2bafc6c` | Biteau Gaël | 12/04/2026 | Merge pull request #1 — Déploiement Docker prod + backup Synology |
| `8d6e5e9` | Claude | 12/04/2026 | Add production Docker Compose and backup script for Synology NAS |

### Périmètre de la Phase 2 (commit `b1c88f6`)

Le dernier sprint majeur a ajouté **2 965 lignes** réparties sur 28 fichiers :

- `app/db/schema/` : 5 nouveaux schémas (badges, micro-predictions, rewards, seasons, users étendu)
- `app/lib/server/` : 3 nouveaux services (badges, seasons, streaks)
- `app/routes/soiree.*` : soirée match live avec score en temps réel
- `app/routes/api.micro-predictions.ts` : endpoint de micro-pronostics
- `app/routes/badges.*` : page et loader de badges
- Mise à jour de calendar, profile, rankings

---

## Analyse de sécurité par ordre de criticité

---

### CRITIQUE

#### C1 — Path Traversal dans le serveur de fichiers statiques

**Fichier** : `app/routes/uploads-files.ts` — lignes 4–6  
**Type** : CWE-22 — Path Traversal

```ts
// Vulnérable : params["*"] est utilisé sans validation
const filePath = path.join(process.cwd(), "uploads", params["*"]);
```

`path.join()` ne bloque pas les séquences `../`. Un attaquant peut forger une URL du type `/uploads-files/../../.env` ou `/uploads-files/../../../etc/passwd` pour lire n'importe quel fichier lisible par le processus Node.

**Impact** : Lecture des fichiers `.env` (DATABASE_URL, AUTH_SECRET, API_FOOTBALL_KEY), de la configuration du système, ou de données applicatives.

**Correction requise** :

```ts
export async function loader({ params }: { params: { "*": string } }) {
  const uploadsDir = path.resolve(process.cwd(), "uploads");
  const requested = path.resolve(uploadsDir, params["*"]);

  // Rejeter tout chemin sortant du dossier uploads
  if (!requested.startsWith(uploadsDir + path.sep)) {
    return new Response("Forbidden", { status: 403 });
  }
  // ...suite inchangée
}
```

---

#### C2 — JSON.parse sans validation sur données persistées

**Fichiers** :
- `app/lib/server/badges.server.ts` — ligne 172
- `app/routes/soiree.server.ts` — ligne 250

```ts
// badges.server.ts
const condition = JSON.parse(badge.condition) as { type: string; threshold: number };

// soiree.server.ts
options: m.options ? JSON.parse(m.options) as string[] : [],
```

Les données sont lues depuis la base et castées sans vérification. Si la base est compromise, corrompue, ou si une ancienne migration a stocké des formats inattendus, le cast TypeScript silencieux masque le problème et peut provoquer un crash ou une exécution incorrecte.

**Correction requise** : Utiliser Zod pour valider le résultat du `JSON.parse` avant usage.

```ts
import { z } from "zod";

const conditionSchema = z.object({ type: z.string(), threshold: z.number() });
const condition = conditionSchema.parse(JSON.parse(badge.condition));
```

---

### ÉLEVÉ

#### H1 — Absence de headers de sécurité HTTP

**Périmètre** : Application entière (aucun middleware de headers détecté)

Les headers suivants sont absents de toutes les réponses :

| Header | Risque sans lui |
|--------|----------------|
| `Content-Security-Policy` | XSS, injection de scripts tiers |
| `X-Frame-Options` | Clickjacking |
| `X-Content-Type-Options` | MIME sniffing |
| `Strict-Transport-Security` | Downgrade HTTPS → HTTP |
| `Referrer-Policy` | Fuite de l'URL dans les requêtes externes |

**Correction** : Ajouter un middleware dans `app/root.tsx` ou via la configuration du reverse proxy (Nginx) :

```nginx
add_header Content-Security-Policy "default-src 'self'; img-src 'self' data:; script-src 'self'";
add_header X-Frame-Options "SAMEORIGIN";
add_header X-Content-Type-Options "nosniff";
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains";
add_header Referrer-Policy "strict-origin-when-cross-origin";
```

---

#### H2 — Mots de passe par défaut en production (Docker)

**Fichier** : `docker-compose.prod.yml` — lignes 22, 32

```yaml
POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-changeme}
command: redis-server --requirepass ${REDIS_PASSWORD:-changeme}
```

Si les variables d'environnement ne sont pas définies dans le fichier `.env`, les services démarrent avec le mot de passe `changeme`, exposant PostgreSQL et Redis à toute personne ayant accès au réseau Docker ou au NAS.

**Correction** : Supprimer les valeurs par défaut pour forcer une configuration explicite, ou utiliser Docker Secrets.

```yaml
POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?POSTGRES_PASSWORD must be set}
command: redis-server --requirepass ${REDIS_PASSWORD:?REDIS_PASSWORD must be set}
```

---

#### H3 — Absence de rate limiting sur l'API micro-pronostics

**Fichier** : `app/routes/api.micro-predictions.ts`

L'endpoint `/api/micro-predictions` accepte quatre actions (`create`, `close`, `answer`, `delete`) sans aucun mécanisme de limitation de débit, contrairement à `/api/auth/$` qui dispose déjà de `checkRateLimit`.

Un utilisateur authentifié pourrait spammer des réponses (intent `answer`) ou un admin pourrait déclencher des milliers de calculs de points.

**Correction** : Réutiliser le `checkRateLimit` existant :

```ts
import { checkRateLimit } from "~/lib/server/rate-limit.server";

await checkRateLimit({
  key: `micro-prediction:${session.user.id}`,
  maxAttempts: 30,
  windowSeconds: 60,
});
```

---

#### H4 — Falsification de l'IP via x-forwarded-for

**Fichier** : `app/routes/api.auth.$.ts` — ligne 7

```ts
request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
```

Si le reverse proxy (Nginx sur le NAS) ne **surécrit pas** ce header, un client peut l'injecter lui-même et contourner le rate limiting login/register en changeant d'IP à chaque tentative.

**Correction** : Configurer Nginx pour écraser ce header avec la vraie IP du client :

```nginx
proxy_set_header X-Forwarded-For $remote_addr;
# ou
proxy_set_header X-Real-IP $remote_addr;
```

---

#### H5 — Absence de validation Zod sur les champs des formulaires API

**Fichier** : `app/routes/api.micro-predictions.ts` — lignes 19–24, 48–49

Les champs `matchId`, `question`, `type`, `optionsRaw`, `pointsValue`, `deadlineSeconds`, `correctAnswer` sont récupérés via `formData.get()` et castés directement sans validation de schéma. Bien que Drizzle protège contre l'injection SQL, des valeurs malformées peuvent produire des comportements inattendus (ex : `pointsValue: NaN`, `type` arbitraire).

**Correction** :

```ts
const createSchema = z.object({
  matchId: z.string().min(1),
  question: z.string().min(1).max(500),
  type: z.enum(["qcm", "open"]),
  options: z.string().optional(),
  pointsValue: z.coerce.number().int().min(1).max(100),
  deadlineSeconds: z.coerce.number().int().min(10).max(600),
});
```

---

### MOYEN

#### M1 — Cache immutable trop agressif sur les avatars

**Fichier** : `app/routes/uploads-files.ts` — ligne 21

```ts
"Cache-Control": "public, max-age=31536000, immutable",
```

Les avatars sont cachés 1 an avec le flag `immutable`. Si un utilisateur met à jour ou supprime son avatar, les navigateurs et CDN serviront l'ancien fichier pendant un an.

**Correction** : Utiliser un versioning par hash dans le nom du fichier, ou réduire le TTL :

```ts
"Cache-Control": "public, max-age=604800", // 7 jours, sans immutable
```

---

#### M2 — Fichiers d'avatars orphelins lors de la suppression de compte

**Fichier** : `app/routes/profile.server.ts`

Quand un compte est supprimé, le fichier avatar sur disque (`uploads/avatars/{userId}.webp`) n'est pas supprimé, créant des données orphelines.

**Correction** : Ajouter la suppression du fichier lors de la suppression du compte.

---

#### M3 — Exposition d'IP dans les logs

**Fichier** : `app/routes/api.auth.$.ts` — ligne 27

```ts
logger.warn({ ip, action: "login-rate-limited" }, "Rate limit exceeded");
```

Les adresses IP des utilisateurs bloqués sont écrites dans les logs. Selon le RGPD, les IP sont des données à caractère personnel et leur rétention doit être documentée et limitée dans le temps.

**Correction** : Anonymiser l'IP (masquer le dernier octet) ou définir une politique de rétention des logs.

---

#### M4 — Absence de validation du type MIME réel des uploads

**Fichier** : `app/lib/server/upload.ts` — ligne 13

```ts
if (!ALLOWED_TYPES.includes(file.type)) {
```

La vérification repose sur `file.type`, qui est fourni par le client via le header `Content-Type` et peut être falsifié. Sharp processerait tout fichier valide mais une attaque par polyglotte (ex : JPEG+SVG) pourrait passer.

**Correction** : Lire les magic bytes du buffer pour vérifier le type réel :

```ts
import { fileTypeFromBuffer } from "file-type";
const detected = await fileTypeFromBuffer(buffer);
if (!detected || !ALLOWED_TYPES.includes(detected.mime)) {
  throw new Error("Type de fichier invalide.");
}
```

---

### FAIBLE

#### F1 — Absence de rotation des logs

Les logs utilisent Pino mais aucune rotation ou compression n'est configurée. En production sur le NAS Synology, les fichiers de log pourraient croître indéfiniment et saturer le disque.

**Correction** : Ajouter `pino-rotating-file-stream` ou configurer logrotate sur le NAS.

---

#### F2 — Doublon de vérification de session

**Fichier** : `app/routes/api.micro-predictions.ts` — lignes 9–11

```ts
const session = await requireAuth(request); // lève une exception si non authentifié
if (!session?.user) { return Response.json({ error: "Non authentifié" }, { status: 401 }); }
```

`requireAuth` lève déjà une exception/redirection en cas d'absence de session. La vérification `if (!session?.user)` est redondante. Ce n'est pas un risque de sécurité mais produit du code mort.

---

## Tableau récapitulatif

| ID | Criticité | Fichier principal | Problème | Statut |
|----|-----------|-------------------|----------|--------|
| C1 | **CRITIQUE** | `uploads-files.ts:5` | Path traversal | A corriger |
| C2 | **CRITIQUE** | `badges.server.ts:172` / `soiree.server.ts:250` | JSON.parse sans validation | A corriger |
| H1 | **ÉLEVÉ** | Application entière | Headers de sécurité absents | A corriger |
| H2 | **ÉLEVÉ** | `docker-compose.prod.yml:22,32` | Mots de passe par défaut | A corriger |
| H3 | **ÉLEVÉ** | `api.micro-predictions.ts` | Absence de rate limiting | A corriger |
| H4 | **ÉLEVÉ** | `api.auth.$.ts:7` | IP falsifiable via proxy | A vérifier |
| H5 | **ÉLEVÉ** | `api.micro-predictions.ts:19-24` | Validation Zod manquante | A corriger |
| M1 | **MOYEN** | `uploads-files.ts:21` | Cache immutable trop long | Amélioration |
| M2 | **MOYEN** | `profile.server.ts` | Fichiers orphelins à la suppression | Amélioration |
| M3 | **MOYEN** | `api.auth.$.ts:27` | IP loggée (RGPD) | A évaluer |
| M4 | **MOYEN** | `upload.ts:13` | Validation MIME client-side | Amélioration |
| F1 | **FAIBLE** | Logs globaux | Pas de rotation des logs | Amélioration |
| F2 | **FAIBLE** | `api.micro-predictions.ts:9-11` | Check de session redondant | Nettoyage |

---

## Points positifs identifiés

- **Validation des variables d'environnement** : `env.server.ts` utilise Zod avec des contraintes strictes (`AUTH_SECRET.min(16)`)
- **ORM paramétré** : Drizzle ORM est utilisé systématiquement — pas de SQL brut, pas d'injection SQL possible
- **Authentification centralisée** : `requireAuth` est appelé en tête de chaque route protégée
- **Rate limiting auth** : Login et inscription sont protégés par un rate limiting Redis
- **Séparation serveur/client** : Les fichiers `.server.ts` garantissent que la logique sensible reste côté serveur
- **Secrets exclus du repo** : Commit `aed5841` a correctement nettoyé les credentials et renforcé le `.gitignore`
- **Validation du rôle admin** : Double vérification du rôle en admin (loader + action) dans `admin.members.server.ts`
- **Traitement des images** : Sharp retraite les images uploadées (resize + conversion webp), réduisant le risque de métadonnées sensibles

---

*Rapport généré automatiquement le 20 juin 2026 — analyse statique du code source*
