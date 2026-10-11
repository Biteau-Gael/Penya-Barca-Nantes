# Analyse Sécurité — Penya Blaugrana Nantes
**Date d'analyse :** 2026-10-11  
**Branche :** `main` (dernier commit : `003faca`)

---

## Résumé des derniers commits

| Hash | Date | Description |
|------|------|-------------|
| `003faca` | 2026-04-13 | fix: évaluer les badges immédiatement après chaque action |
| `b1c88f6` | 2026-04-13 | feat: Phase 2 — soirée match live, micro-pronos, badges, séries, saisons |
| `d461ee5` | 2026-04-12 | Merge branch deploy-synology-nas |
| `554b873` | 2026-04-12 | Add deployment guide for Synology NAS updates |
| `68e22d2` | 2026-04-13 | feat: menu burger mobile pour la navigation |
| `6aebaf7` | 2026-04-12 | Fix Better Auth trusted origins for custom domain support |
| `9823bc5` | 2026-04-12 | Add migrate service to docker-compose.prod.yml |
| `8d6e5e9` | 2026-04-12 | Add production Docker Compose and backup script |
| `aed5841` | 2026-04-12 | **security**: supprimer credentials du repo et renforcer .gitignore |

### Changements majeurs (Phase 2)
Le commit `b1c88f6` est le plus volumineux : **2 965 lignes ajoutées** sur 26 fichiers. Il introduit :
- Soirée match live (`soiree.server.ts`, `soiree.tsx`)
- Micro-pronostics (`api.micro-predictions.ts`, schéma DB)
- Système de badges (10 badges, `badges.server.ts`)
- Séries de scores exacts (`streaks.server.ts`)
- Saisons (`seasons.server.ts`)
- Nouvelles tables DB (migration `0007`)

---

## Analyse Sécurité par ordre de criticité

---

### 🔴 CRITIQUE

#### 1. Mots de passe par défaut en production (`docker-compose.yml`)
**Fichier :** `docker-compose.yml` et `docker-compose.prod.yml`

```yaml
POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-changeme}
redis-server --requirepass ${REDIS_PASSWORD:-changeme}
```

Si le fichier `.env` n'est pas présent ou ne définit pas ces variables, les services démarrent avec le mot de passe `changeme`. En cas de déploiement NAS Synology sans `.env` correctement configuré, la base de données et Redis sont accessibles avec un mot de passe trivial.

**Recommandation :** Supprimer les valeurs par défaut (`:-changeme`) pour forcer une erreur explicite si les variables manquent. Ou utiliser `:-` (chaîne vide) afin que le service refuse de démarrer.

---

### 🟠 ÉLEVÉ

#### 2. HTTPS absent — nginx en HTTP uniquement
**Fichier :** `docker/nginx/nginx.conf`

```nginx
server {
    listen 80;
    # Pas de listen 443, pas de TLS
}
```

Toutes les communications transitent en clair. Les cookies de session, le token AUTH_SECRET, les données utilisateurs sont exposés sur le réseau.

**Recommandation :** Configurer HTTPS avec Let's Encrypt (Certbot) ou un certificat du NAS Synology (DSM intègre un reverse proxy SSL). Ajouter une redirection HTTP → HTTPS.

#### 3. En-têtes de sécurité HTTP absents
**Fichier :** `docker/nginx/nginx.conf`

Les en-têtes de sécurité HTTP standard sont tous absents :

| En-tête | Risque si absent |
|---------|-----------------|
| `X-Frame-Options` | Clickjacking |
| `X-Content-Type-Options` | MIME sniffing |
| `Content-Security-Policy` | XSS si contenu dynamique |
| `Referrer-Policy` | Fuite d'URL en référent |
| `Permissions-Policy` | Accès caméra/micro non restreint |

**Recommandation :**
```nginx
add_header X-Frame-Options "SAMEORIGIN" always;
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Content-Security-Policy "default-src 'self'; img-src 'self' data:;" always;
```

---

### 🟡 MODÉRÉ

#### 4. Typage `as any` pour le rôle utilisateur
**Fichier :** `app/routes/feed.server.ts` (lignes 99, 124, 184, 200)

```typescript
isAdmin: (session.user as any).role === "admin",
if (isAnnouncement && (session.user as any).role !== "admin") {
```

Le cast `as any` contourne le système de types TypeScript. Si Better Auth change la structure de son objet session, ce code ne lèvera aucune erreur de compilation alors que le contrôle d'accès admin pourrait silencieusement échouer.

**Recommandation :** Étendre le type session de Better Auth ou utiliser `getSession` avec un type étendu :
```typescript
import type { Session } from "~/lib/server/auth.server";
const isAdmin = (session.user as Session["user"]).role === "admin";
```

#### 5. `trustedOrigins` vide si `APP_URL` absent
**Fichier :** `app/lib/server/auth.server.ts`

```typescript
trustedOrigins: env.APP_URL ? [env.APP_URL] : [],
```

Si `APP_URL` n'est pas défini dans `.env`, Better Auth reçoit un tableau vide. Selon la version, cela peut désactiver la vérification d'origine (toutes origines acceptées) ou bloquer toutes les requêtes cross-origin. Comportement ambigu.

**Recommandation :** Définir `APP_URL` obligatoire dans le schéma Zod (`app/config/env.server.ts`) ou fournir une valeur par défaut explicite :
```typescript
APP_URL: z.string().url().default("http://localhost:3000"),
```

#### 6. Pas de validation de deadline dans les micro-pronos
**Fichier :** `app/routes/api.micro-predictions.ts`

L'action `answer` vérifie que `closedAt` est null, mais ne vérifie pas que la deadline (`deadlineSeconds`) n'est pas dépassée :

```typescript
if (!micro || micro.closedAt) {
  return Response.json({ error: "Micro-pronostic fermé" }, { status: 400 });
}
// Pas de vérification : new Date() < micro.createdAt + micro.deadlineSeconds
```

Un utilisateur pourrait répondre après le délai tant que l'admin n'a pas clôturé manuellement.

**Recommandation :**
```typescript
const deadlineDate = new Date(micro.createdAt.getTime() + micro.deadlineSeconds * 1000);
if (new Date() > deadlineDate) {
  return Response.json({ error: "Délai expiré" }, { status: 400 });
}
```

---

### 🔵 FAIBLE

#### 7. Ports de base de données exposés en développement
**Fichier :** `docker-compose.yml`

PostgreSQL (5432) et Redis (6379) sont exposés sur l'interface hôte sans authentification Redis en développement. Si le NAS est accessible sur le réseau local (ou pire, depuis l'extérieur), ces services sont directement atteignables.

**Recommandation :** Retirer les mappings de ports en production. En dev, restreindre à localhost : `"127.0.0.1:5432:5432"`.

#### 8. Rate limiting absent sur les API applicatives
**Fichier :** `app/routes/api.micro-predictions.ts`, `app/routes/feed.server.ts`

Le rate limiting existe uniquement sur les routes d'authentification (`api.auth.$.ts`). Les endpoints de création de posts, commentaires, réactions et micro-pronos ne sont pas protégés. Un utilisateur authentifié pourrait spammer le fil ou les pronos.

**Recommandation :** Appliquer `checkRateLimit` sur les actions de création (ex : 20 posts/heure par utilisateur).

---

## Points positifs constatés

- **Credentials hors du dépôt** : commit `aed5841` a nettoyé les secrets précédemment committés. `.env` est bien dans `.gitignore`.
- **Validation des variables d'environnement** : Zod enforce `AUTH_SECRET` ≥ 16 chars au démarrage.
- **ORM paramétré (Drizzle)** : pas d'injection SQL possible via concaténation de chaînes.
- **Upload d'avatar sécurisé** : vérification du MIME type + taille max 2 Mo + retraitement via `sharp` (neutralise les payloads malicieux dans les métadonnées image).
- **Contrôle des rôles côté serveur** : toutes les actions admin vérifient `session.user.role === "admin"` côté serveur.
- **Rate limiting auth** : 10 tentatives/15 min (login), 5 tentatives/heure (inscription).
- **Logger structuré** : pas de `console.log` avec des données sensibles dans le code source.
- **Pas de XSS** : aucun `dangerouslySetInnerHTML` ni `eval()` trouvé.

---

## Récapitulatif

| Criticité | Nb | Actions |
|-----------|-----|---------|
| 🔴 Critique | 1 | Mots de passe par défaut Docker |
| 🟠 Élevé | 2 | HTTPS, en-têtes HTTP |
| 🟡 Modéré | 3 | Typage rôle, APP_URL, deadline micro-pronos |
| 🔵 Faible | 2 | Ports exposés, rate limiting API |

**Priorité immédiate avant mise en production :** points 1, 2 et 3.
