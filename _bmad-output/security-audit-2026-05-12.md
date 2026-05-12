# Audit de Sécurité — Penya Barca Nantes
**Date :** 12 mai 2026  
**Branche analysée :** `main` (HEAD : `003faca`)  
**Scope :** Analyse statique du code source + configuration d'infrastructure

---

## 1. Résumé des derniers commits

| Commit | Date | Auteur | Description |
|--------|------|--------|-------------|
| `003faca` | 13/04/2026 | Biteau Gaël | fix: évaluer les badges immédiatement après chaque action |
| `b1c88f6` | 13/04/2026 | Biteau Gaël | feat: Phase 2 — soirée match live, micro-pronos, badges, séries, saisons |
| `d461ee5` | 12/04/2026 | Claude | Merge branch 'claude/deploy-synology-nas-cLkOL' |
| `554b873` | 12/04/2026 | Claude | Add deployment guide for Synology NAS updates |
| `68e22d2` | 13/04/2026 | Biteau Gaël | feat: menu burger mobile pour la navigation |
| `6aebaf7` | 12/04/2026 | Claude | Fix Better Auth trusted origins for custom domain support |
| `9823bc5` | 12/04/2026 | Claude | Add migrate service to docker-compose.prod.yml |
| `8d6e5e9` | 12/04/2026 | Claude | Add production Docker Compose and backup script for Synology NAS |
| `aed5841` | 12/04/2026 | Biteau Gaël | security: supprimer credentials du repo et renforcer .gitignore |
| `6583da3` | 12/04/2026 | Biteau Gaël | docs: README complet avec guide de déploiement NAS Synology |

### Points notables de la Phase 2 (`b1c88f6`)

Le commit le plus structurant est la **Phase 2** qui introduit 2 965 lignes de code sur 26 fichiers :
- Soirée match live (`app/routes/soiree.tsx` / `soiree.server.ts`)
- Micro-pronostics en temps réel (`app/routes/api.micro-predictions.ts`)
- Système de badges et récompenses (`app/lib/server/badges.server.ts`)
- Séries de présence (streaks) et saisons (`app/lib/server/streaks.server.ts`, `seasons.server.ts`)
- Mise à jour du profil, classement et calendrier

---

## 2. Analyse de sécurité — Résultats par ordre de criticité

### Légende

| Niveau | Signification |
|--------|--------------|
| 🔴 CRITIQUE | Exploitation directe possible, impact maximal |
| 🟠 ÉLEVÉ | Risque significatif, correctif prioritaire |
| 🟡 MOYEN | Risque modéré, à traiter dans le sprint |
| 🟢 FAIBLE | Bonne pratique, impact limité |
| ✅ CONFORME | Pratique correcte observée |

---

### 🔴 CRITIQUE — Path Traversal sur le service de fichiers uploadés

**Fichier :** `app/routes/uploads-files.ts:5`

```typescript
const filePath = path.join(process.cwd(), "uploads", params["*"]);
```

**Problème :** Le paramètre wildcard `params["*"]` issu de l'URL est utilisé directement dans `path.join()` sans assainissement. Une requête vers `/uploads/../.env` ou `/uploads/../../app/lib/server/auth.server.ts` permet de lire n'importe quel fichier accessible au processus Node.js.

**Impact :** Lecture de fichiers arbitraires (`.env`, code source, clés privées).

**Correctif :**
```typescript
const safeName = path.basename(params["*"]);
const filePath = path.join(process.cwd(), "uploads", safeName);
// Vérification supplémentaire recommandée :
if (!filePath.startsWith(path.join(process.cwd(), "uploads"))) {
  return new Response("Forbidden", { status: 403 });
}
```

---

### 🟠 ÉLEVÉ — Mot de passe par défaut `changeme` en production

**Fichier :** `docker-compose.prod.yml:22,32`

```yaml
- POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-changeme}
command: redis-server --requirepass ${REDIS_PASSWORD:-changeme}
```

**Problème :** Si les variables d'environnement ne sont pas définies sur le NAS (ex. après une réinstallation), PostgreSQL et Redis démarrent avec le mot de passe `changeme`.

**Impact :** Accès non autorisé à la base de données et au cache de sessions.

**Correctif :** Rendre la variable obligatoire avec un message d'erreur explicite :
```yaml
- POSTGRES_PASSWORD=${POSTGRES_PASSWORD:?Erreur : POSTGRES_PASSWORD non défini}
command: redis-server --requirepass ${REDIS_PASSWORD:?Erreur : REDIS_PASSWORD non défini}
```

---

### 🟠 ÉLEVÉ — Endpoint `/api/health` non protégé

**Fichier :** `app/routes/api.health.ts:11`

```typescript
export async function loader() {   // Aucune vérification d'authentification
  // expose : statut PostgreSQL, Redis, timestamp serveur
}
```

**Problème :** L'endpoint expose le statut de l'infrastructure (BDD opérationnelle ou non, Redis opérationnel ou non) sans authentification. Ces informations facilitent la reconnaissance avant une attaque.

**Impact :** Divulgation d'informations d'infrastructure à des tiers non authentifiés.

**Correctif :** Restreindre l'accès aux admins ou à des IPs internes uniquement :
```typescript
export async function loader({ request }: { request: Request }) {
  const session = await requireAuth(request);
  if (session?.user?.role !== "admin") {
    return new Response("Forbidden", { status: 403 });
  }
  // ... reste du code
}
```

---

### 🟠 ÉLEVÉ — Headers de sécurité HTTP absents (Nginx)

**Fichier :** `docker/nginx/nginx.conf`

**Problème :** La configuration Nginx ne positionne aucun header de sécurité HTTP standard.

**Headers manquants :**

| Header | Protection |
|--------|-----------|
| `X-Frame-Options: SAMEORIGIN` | Clickjacking |
| `X-Content-Type-Options: nosniff` | MIME sniffing |
| `Referrer-Policy: strict-origin-when-cross-origin` | Fuite d'URL |
| `Content-Security-Policy` | XSS |
| `Strict-Transport-Security` | Downgrade HTTPS |

**Correctif** — Ajouter dans le bloc `server {}` de `nginx.conf` :
```nginx
add_header X-Frame-Options "SAMEORIGIN" always;
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Permissions-Policy "geolocation=(), microphone=(), camera=()" always;
add_header Content-Security-Policy "default-src 'self'; img-src 'self' data:; script-src 'self'; style-src 'self' 'unsafe-inline'" always;
```

---

### 🟠 ÉLEVÉ — Connexion Redis non chiffrée

**Fichier :** `app/lib/server/redis.server.ts`

**Problème :** La connexion Redis utilise le protocole `redis://` (TCP en clair). En production sur un NAS Synology, les tokens de session transitent en clair sur le réseau local.

**Impact :** Interception possible des tokens de session sur le réseau (LAN ou si exposé).

**Correctif :** Activer TLS en production :
```typescript
export const redis = new Redis({
  host: process.env.REDIS_HOST || "localhost",
  port: Number(process.env.REDIS_PORT) || 6379,
  password: process.env.REDIS_PASSWORD,
  tls: process.env.NODE_ENV === "production" ? {} : undefined,
  maxRetriesPerRequest: 3,
  lazyConnect: true,
});
```

---

### 🟡 MOYEN — Rate limiting partiel sur les routes d'authentification

**Fichier :** `app/routes/api.auth.$.ts:14-16`

```typescript
const isSignIn = url.pathname.includes("sign-in");
const isSignUp = url.pathname.includes("sign-up");
```

**Problème :** Le rate limiting repose sur la détection de chaînes dans l'URL. Si Better Auth expose d'autres endpoints sensibles (reset de mot de passe, vérification d'email), ils ne sont pas couverts.

**Impact :** Brute force possible sur les endpoints non détectés.

**Recommandation :** Appliquer un rate limiting par IP sur toutes les routes `api/auth/*`, pas uniquement sign-in / sign-up.

---

### 🟡 MOYEN — Absence de protection CSRF explicite

**Scope :** Ensemble de l'application

**Problème :** Aucun token CSRF n'est généré ou validé dans les formulaires. React Router offre une protection partielle via la vérification des headers `Origin`/`Referer`, mais elle n'est pas configurée explicitement.

**Impact :** Attaques CSRF possibles si l'utilisateur visite un site malveillant pendant une session active.

**Recommandation :** Utiliser `remix-utils` ou implémenter un middleware de validation CSRF côté serveur.

---

### 🟡 MOYEN — Utilisation de `as any` pour les vérifications de rôle

**Fichier :** `app/routes/feed.server.ts:99,124,184,200`

```typescript
const isAdmin = (session.user as any).role === "admin";
```

**Problème :** Le cast `as any` contourne la vérification de type TypeScript. Si la structure de `session.user` évolue, l'autorisation peut silencieusement retourner `false` sans erreur de compilation.

**Impact :** Risque d'erreur d'autorisation non détectée en cas de refactoring.

**Correctif :** Typer correctement l'utilisateur de session :
```typescript
interface SessionUser { id: string; role: "member" | "admin" | "partner" }
const isAdmin = (session.user as SessionUser).role === "admin";
```

---

### 🟡 MOYEN — Absence de validation de longueur sur les entrées utilisateur

**Fichier :** `app/routes/api.micro-predictions.ts:30,74`

**Problème :** Les réponses aux micro-pronostics ne sont pas bornées en taille avant persistance en base.

**Impact :** Stockage de données volumineuses, potentiel déni de service sur la base de données.

**Correctif :** Ajouter une validation Zod sur la longueur des champs :
```typescript
const answerSchema = z.object({
  answer: z.string().min(1).max(500),
});
```

---

### 🟢 FAIBLE — Script de backup sans gestion d'erreurs

**Fichier :** `backup.sh`

**Problème :** En cas d'échec de `pg_dump`, le script continue et affiche "Backup terminé" même si le fichier est vide ou corrompu. Pas de notification en cas d'échec.

**Impact :** Backups silencieusement invalides.

**Correctif :**
```bash
#!/bin/bash
set -euo pipefail

BACKUP_DIR="/volume1/docker/backups/penya"
DATE=$(date +%Y%m%d_%H%M%S)

mkdir -p "$BACKUP_DIR"

docker compose -f /volume1/docker/penya-barca-nantes/docker-compose.prod.yml \
  exec -T postgres pg_dump -U penya penya_barca_nantes \
  > "$BACKUP_DIR/penya_$DATE.sql" || { echo "ERREUR: pg_dump échoué"; exit 1; }

find "$BACKUP_DIR" -name "*.sql" -type f | sort -r | tail -n +31 | xargs -r rm -f

echo "Backup terminé : penya_$DATE.sql"
```

---

### 🟢 FAIBLE — Endpoints API hardcodés

**Fichier :** `app/lib/server/api-football.server.ts:13-14`

**Problème :** L'URL de base de l'API Football est codée en dur. Si le fournisseur change de domaine, une modification de code est nécessaire.

**Recommandation :** Externaliser dans les variables d'environnement ou dans une constante de configuration centralisée.

---

## 3. Points conformes — Bonnes pratiques observées

| Pratique | Détail |
|----------|--------|
| ✅ ORM paramétré | Drizzle ORM utilisé systématiquement, pas de concaténation SQL brute |
| ✅ Authentification | Better Auth correctement intégré avec gestion des sessions |
| ✅ Validation des entrées | Zod utilisé sur la majorité des endpoints |
| ✅ Rate limiting | Limites sur sign-in (10 req/15 min) et sign-up (5 req/h) |
| ✅ Upload sécurisé | Validation MIME + taille + traitement par Sharp |
| ✅ Pas de credentials dans le repo | `.gitignore` correct, commit `aed5841` a supprimé les credentials |
| ✅ Autorisation par rôle | Vérifications `role === "admin"` présentes sur les routes sensibles |
| ✅ Logs structurés | `pino` utilisé avec contexte (action, userId) |
| ✅ Healthcheck Docker | Services postgres et redis ont des healthchecks définis |
| ✅ Variables d'environnement | `.env.example` documenté, pas de secrets par défaut dans le code |

---

## 4. Plan d'action recommandé

| Priorité | Action | Fichier | Effort |
|----------|--------|---------|--------|
| 1 | Corriger la path traversal uploads | `uploads-files.ts:5` | 5 min |
| 2 | Rendre les mots de passe Docker obligatoires | `docker-compose.prod.yml:22,32` | 5 min |
| 3 | Protéger `/api/health` par rôle admin | `api.health.ts` | 15 min |
| 4 | Ajouter les security headers Nginx | `nginx.conf` | 15 min |
| 5 | Activer TLS Redis en production | `redis.server.ts` | 30 min |
| 6 | Renforcer le rate limiting auth | `api.auth.$.ts` | 30 min |
| 7 | Ajouter validation longueur micro-pronos | `api.micro-predictions.ts` | 15 min |
| 8 | Typer correctement les rôles | `feed.server.ts` | 20 min |
| 9 | Ajouter `set -euo pipefail` au backup | `backup.sh` | 5 min |

---

*Document généré le 12/05/2026 — Analyse statique, aucun test de pénétration dynamique réalisé.*
