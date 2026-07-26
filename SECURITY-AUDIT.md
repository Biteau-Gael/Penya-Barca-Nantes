# Rapport d'audit sécurité — Penya Blaugrana Nantes

**Date :** 26 juillet 2026  
**Branche analysée :** `main` (commit `003faca`)  
**Périmètre :** Revue des derniers commits + analyse statique du code applicatif

---

## Résumé des derniers commits

| Hash | Date | Description |
|------|------|-------------|
| `003faca` | 13 avr. 2026 | **fix:** Évaluation immédiate des badges après chaque action (pronostic, post, commentaire, réaction) |
| `b1c88f6` | 13 avr. 2026 | **feat (Phase 2):** Page soirée match live, micro-pronostics, badges (10 de base), séries de scores, gestion des saisons |
| `68e22d2` | 13 avr. 2026 | **feat:** Menu burger mobile pour la navigation |
| `554b873` | 12 avr. 2026 | **docs:** Guide de déploiement pour mises à jour sur NAS Synology |
| `9823bc5` | 12 avr. 2026 | **fix:** Service `migrate` ajouté dans `docker-compose.prod.yml` pour les migrations DB |
| `6aebaf7` | 12 avr. 2026 | **fix:** Correction des `trustedOrigins` de Better Auth pour support domaine personnalisé |
| `8d6e5e9` | 12 avr. 2026 | **feat:** Docker Compose de production + script de sauvegarde PostgreSQL pour NAS Synology |
| `aed5841` | antérieur | **security:** Suppression des credentials du dépôt et renforcement du `.gitignore` |

---

## Analyse de sécurité par ordre de criticité

### 🔴 CRITIQUE

Aucune vulnérabilité critique identifiée.

---

### 🟠 ÉLEVÉ

#### 1. Rate limiting absent sur les mutations applicatives

**Fichiers concernés :**  
- `app/routes/feed.server.ts` (création de posts, commentaires, réactions)  
- `app/routes/match-detail.server.ts` (soumission de pronostics)  
- `app/routes/api.micro-predictions.ts` (réponses aux micro-pronostics)  
- `app/routes/profile.server.ts` (upload d'avatar, mise à jour du pseudo)

**Constat :** `checkRateLimit` n'est appliqué qu'aux endpoints de connexion et d'inscription (`api.auth.$.ts`). Toutes les autres actions POST ne sont pas limitées en fréquence.

**Risque :** Un utilisateur authentifié peut envoyer des milliers de posts/commentaires/réactions en quelques secondes. Cela peut engendrer un épuisement des ressources serveur (DDOS applicatif) ou du spam massif dans le fil d'activité.

**Recommandation :**
```typescript
// Dans chaque action, ajouter avant le traitement :
const ip = getClientIp(request);
await checkRateLimit({
  key: `feed-post:${session.user.id}`,
  maxAttempts: 10,
  windowSeconds: 60,
});
```

Limites suggérées :
- Posts : 10/minute par utilisateur
- Commentaires : 20/minute par utilisateur
- Pronostics : 5/minute par utilisateur
- Upload avatar : 3/heure par utilisateur

---

#### 2. `X-Forwarded-For` potentiellement falsifiable

**Fichier :** `app/routes/api.auth.$.ts:12-16`

```typescript
function getClientIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}
```

**Constat :** Le header `X-Forwarded-For` est contrôlé par le client si le reverse proxy ne le force pas. Un attaquant peut envoyer `X-Forwarded-For: 1.2.3.4` pour contourner le rate limiting de connexion.

**Risque :** Contournement du rate limiting des tentatives de connexion (brute force de mots de passe).

**Recommandation :** S'assurer que le reverse proxy (Nginx/Traefik sur le NAS) est configuré pour supprimer et réécrire ce header :
```nginx
# Dans la config Nginx
proxy_set_header X-Forwarded-For $remote_addr;
# OU, si derrière un proxy de confiance :
set_real_ip_from 10.0.0.0/8;
real_ip_header X-Forwarded-For;
```

---

### 🟡 MOYEN

#### 3. Vérification du type MIME pour les uploads basée sur le client

**Fichier :** `app/lib/server/upload.ts:9`

```typescript
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];

export async function processAvatar(file: File, userId: string): Promise<string> {
  if (!ALLOWED_TYPES.includes(file.type)) {  // ← file.type est fourni par le navigateur
    throw new Error("Format non supporté.");
  }
```

**Constat :** `file.type` est le MIME type déclaré par le navigateur/client, qui peut être forgé. Un attaquant pourrait envoyer un fichier malveillant avec `Content-Type: image/jpeg`.

**Atténuation existante :** La conversion via `sharp` (WebP) mitigue la majorité du risque — un script non-image fera planter `sharp` avant d'être écrit sur disque. Toutefois, certains formats polyglotes (JPEG+JS) pourraient passer.

**Recommandation :** Valider les magic bytes du fichier avec la bibliothèque `file-type` avant de passer à `sharp` :
```typescript
import { fileTypeFromBuffer } from "file-type";

const buffer = Buffer.from(await file.arrayBuffer());
const detected = await fileTypeFromBuffer(buffer);
if (!detected || !["image/jpeg", "image/png", "image/webp"].includes(detected.mime)) {
  throw new Error("Format non supporté.");
}
```

---

#### 4. Endpoint `/api/health` public exposant des informations d'infrastructure

**Fichier :** `app/routes/api.health.ts`

**Constat :** L'endpoint de santé est accessible sans authentification et expose l'état de PostgreSQL et Redis (statut `ok`/`error`).

**Risque :** Fuite d'informations sur l'architecture interne. Un attaquant peut surveiller la disponibilité des services.

**Recommandation :** Limiter l'accès par IP (réseau local uniquement) au niveau du reverse proxy :
```nginx
location /api/health {
    allow 127.0.0.1;
    allow 192.168.1.0/24;  # réseau local NAS
    deny all;
    proxy_pass http://app:3000;
}
```

---

#### 5. Mot de passe par défaut dans Docker Compose production

**Fichier :** `docker-compose.prod.yml:16,21`

```yaml
POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-changeme}
redis-server --requirepass ${REDIS_PASSWORD:-changeme}
```

**Constat :** Si les variables d'environnement `POSTGRES_PASSWORD` et `REDIS_PASSWORD` ne sont pas définies dans le fichier `.env`, les services démarrent avec le mot de passe `changeme`.

**Risque :** Exposition de la base de données si le fichier `.env` est absent lors du déploiement.

**Recommandation :** Supprimer les valeurs de repli (`:-changeme`) pour forcer un échec explicite si les variables ne sont pas définies :
```yaml
POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?Variable POSTGRES_PASSWORD manquante}
```

---

### 🔵 FAIBLE

#### 6. Image Docker exécutée en tant que root

**Fichier :** `Dockerfile`

**Constat :** Le stage final ne définit pas d'utilisateur non-root. L'application Node.js tourne avec les droits `root` dans le container.

**Risque :** En cas de compromission de l'application, l'attaquant dispose des droits root dans le container.

**Recommandation :** Ajouter avant `CMD` :
```dockerfile
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser
CMD ["npm", "run", "start"]
```

---

#### 7. Cast `as any` pour accéder au rôle utilisateur

**Fichiers :** `app/routes/feed.server.ts:91`, `app/lib/server/auth-utils.server.ts`

```typescript
isAdmin: (session.user as any).role === "admin"
```

**Constat :** Le type de session de Better Auth ne type pas le champ `role` par défaut, forçant l'utilisation de `as any`.

**Risque :** Faible en pratique (code serveur), mais pourrait masquer des régressions si la structure de session change.

**Recommandation :** Étendre le type Better Auth dans `types/auth.d.ts` :
```typescript
declare module "better-auth" {
  interface Session {
    user: {
      role: "member" | "admin" | "partner";
    };
  }
}
```

---

#### 8. Pas de Content-Security-Policy (CSP)

**Constat :** Aucun header CSP n'est configuré au niveau applicatif ou du reverse proxy.

**Risque :** En cas de faille XSS (injection dans du contenu utilisateur), un attaquant pourrait exécuter des scripts arbitraires. React échappe automatiquement les valeurs JSX, ce qui réduit le risque, mais une revue de tous les `dangerouslySetInnerHTML` est recommandée.

**Recommandation :** Ajouter les headers de sécurité dans le reverse proxy Nginx :
```nginx
add_header Content-Security-Policy "default-src 'self'; img-src 'self' data:; script-src 'self';" always;
add_header X-Content-Type-Options nosniff always;
add_header X-Frame-Options DENY always;
add_header Referrer-Policy strict-origin-when-cross-origin always;
```

---

## Bonnes pratiques constatées ✅

- **Authentification centralisée :** `requireAuth()` utilisé systématiquement sur toutes les routes protégées.
- **Contrôles d'autorisation :** Vérification du rôle `admin` avant chaque action sensible (ex: suppression membres, clôture micro-pronos).
- **Validation des entrées avec Zod :** Schémas de validation appliqués sur les formulaires (`createPostSchema`, `updateProfileSchema`).
- **ORM paramétré (Drizzle) :** Aucune concaténation SQL directe — protection contre les injections SQL.
- **Rate limiting sur auth :** Connexion limitée à 10 tentatives/15 min, inscription à 5/heure.
- **Suppression des credentials :** Les secrets ont été retirés du dépôt (`aed5841`) et le `.gitignore` est configuré.
- **Logging structuré :** Pino logger avec contexte (userId, action) pour la traçabilité.
- **Validation des variables d'environnement :** `getEnv()` avec Zod valide la configuration au démarrage.
- **Upload sécurisé :** Taille limitée à 2 Mo, conversion WebP via Sharp, nom de fichier basé sur l'userId (pas de path traversal).
- **Protection suppression propre soi-même :** Un admin ne peut pas modifier son propre rôle ni supprimer son propre compte.

---

## Plan d'action recommandé

| Priorité | Action | Effort |
|----------|--------|--------|
| 1 | Ajouter rate limiting sur les actions POST sensibles (feed, pronos, profil) | Moyen |
| 2 | Configurer Nginx pour forcer `X-Forwarded-For` depuis l'IP réelle | Faible |
| 3 | Ajouter validation magic bytes sur les uploads (`file-type`) | Faible |
| 4 | Restreindre `/api/health` au réseau local dans Nginx | Faible |
| 5 | Supprimer les mots de passe par défaut dans Docker Compose | Faible |
| 6 | Exécuter l'app en tant qu'utilisateur non-root dans Docker | Faible |
| 7 | Ajouter les headers de sécurité HTTP (CSP, HSTS, etc.) dans Nginx | Moyen |
