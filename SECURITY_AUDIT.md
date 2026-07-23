# Audit de Sécurité — Penya Blaugrana Nantes

**Date :** 23 juillet 2026  
**Périmètre :** Analyse statique de la codebase complète  
**Branche analysée :** `main` (dernier commit : `003faca`)

---

## Résumé des derniers commits

| Commit | Description | Fichiers modifiés |
|--------|-------------|-------------------|
| `003faca` | fix: évaluer les badges immédiatement après chaque action (pronostic, post, commentaire, réaction) | `feed.server.ts`, `match-detail.server.ts` |
| `b1c88f6` | feat: Phase 2 — soirée match live, micro-pronos, badges, séries, saisons | 26 fichiers (+2965 lignes) |
| `d461ee5` | Merge branch deploy Synology NAS | `DEPLOY.md` |
| `554b873` | Add deployment guide for Synology NAS updates | `DEPLOY.md` |
| `68e22d2` | feat: menu burger mobile pour la navigation | `header.tsx` |

La Phase 2 est le changement le plus structurant : elle ajoute les schemas DB (`micro-predictions`, `rewards`, `seasons`, `badges`), les serveurs métier (`badges.server.ts`, `streaks.server.ts`, `seasons.server.ts`), une route API publique (`api.micro-predictions.ts`) et la page soirée live (`soiree.server.ts`).

---

## Analyse de Sécurité — Par ordre de criticité

---

### 🔴 CRITIQUE

#### 1. En-têtes de sécurité HTTP absents

**Fichier concerné :** `app/root.tsx`, absence de middleware global  
**Risque :** XSS, Clickjacking, MIME sniffing, absence de HSTS

Aucun en-tête de sécurité HTTP n'est émis par l'application. Les en-têtes manquants :

- `Content-Security-Policy` → protège contre les injections XSS
- `X-Frame-Options: DENY` → protège contre le clickjacking
- `X-Content-Type-Options: nosniff` → empêche le MIME sniffing
- `Strict-Transport-Security` → impose HTTPS
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy`

**Recommandation :** Ajouter un middleware React Router qui applique ces en-têtes sur toutes les réponses, ou configurer un reverse proxy (Nginx) pour les injecter.

---

#### 2. Rate limiting absent sur les routes métier

**Fichiers concernés :** `api.micro-predictions.ts`, `feed.server.ts`, `profile.server.ts`  
**Risque :** Spam, abus de ressources, flood de la base de données

Le rate limiting (`checkRateLimit`) n'est appliqué **que** sur les routes `/api/auth` (sign-in : 10 req/15 min, sign-up : 5 req/h). Les routes suivantes n'ont aucune protection :

- `api.micro-predictions.ts` → soumission de réponses répétées
- `feed.server.ts` → flood de posts/commentaires/réactions
- `profile.server.ts` → tentatives répétées de changement de pseudo
- `api.sync-matches.ts` → déclenchement répété de la sync API Football (coûteuse)

**Recommandation :** Appliquer `checkRateLimit` sur chaque action sensible, par exemple `action:${session.user.id}` comme clé Redis.

---

#### 3. IP Spoofing possible dans le rate limit d'authentification

**Fichier concerné :** `app/routes/api.auth.$.ts` lignes 5-11  
**Risque :** Contournement du rate limiting via header forgé

```typescript
function getClientIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}
```

Le header `X-Forwarded-For` peut être librement forgé par le client (`curl -H "X-Forwarded-For: 1.2.3.4"`). Un attaquant peut changer d'IP fictive à chaque tentative et contourner le rate limiting sur la connexion.

**Recommandation :** En production derrière un reverse proxy de confiance (Nginx), utiliser uniquement la dernière IP de la chaîne `X-Forwarded-For` (ajoutée par le proxy), ou la socket IP directe. Configurer le proxy pour écraser/supprimer le header avant de le transmettre.

---

### 🟠 IMPORTANT

#### 4. Endpoint `/api/health` public sans authentification

**Fichier concerné :** `app/routes/api.health.ts`  
**Risque :** Fuite d'informations infrastructure

L'endpoint health check est accessible sans authentification et expose l'état de la base de données et de Redis :

```json
{"status": "degraded", "services": {"app": "ok", "db": "error", "redis": "ok"}, "timestamp": "..."}
```

Ces informations renseignent un attaquant sur l'état de l'infrastructure et les services utilisés.

**Recommandation :** Restreindre cet endpoint à un réseau interne/VPN, ou ajouter une authentification par token secret (header `Authorization: Bearer <HEALTH_CHECK_SECRET>`).

---

#### 5. Validation du type de fichier uploadé insuffisante

**Fichier concerné :** `app/lib/server/upload.ts` ligne 13  
**Risque :** Upload de fichiers malveillants

```typescript
if (!ALLOWED_TYPES.includes(file.type)) {
  throw new Error("Format non supporté.");
}
```

`file.type` est fourni par le client (navigateur) et peut être forgé. Un attaquant peut envoyer un fichier `.php` ou `.svg` avec un `Content-Type: image/jpeg` forgé. La bibliothèque `sharp` offre une protection partielle en échouant sur les formats non-image, mais ne couvre pas les SVG (qui sont des images valides mais peuvent contenir du JavaScript malveillant).

**Recommandation :** Valider le type de fichier via les **magic bytes** (les premiers octets du buffer) après lecture, avant de passer à `sharp`. Refuser explicitement les SVG (`image/svg+xml`).

---

#### 6. Mots de passe par défaut `changeme` en production

**Fichier concerné :** `docker-compose.prod.yml` lignes 22, 32  
**Risque :** Accès non autorisé à la base de données et Redis si `.env` mal configuré

```yaml
POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-changeme}
command: redis-server --requirepass ${REDIS_PASSWORD:-changeme}
```

Si les variables `POSTGRES_PASSWORD` et `REDIS_PASSWORD` ne sont pas définies dans `.env`, les services démarrent avec le mot de passe `changeme`.

**Recommandation :** Supprimer les valeurs par défaut (`:−changeme`) pour que Docker Compose échoue au démarrage si les variables sont absentes, plutôt que de démarrer avec un mot de passe faible. Documenter cette exigence dans `DEPLOY.md`.

---

#### 7. Exposition des pronostics futurs dans les profils membres

**Fichier concerné :** `app/routes/member-profile.server.ts` lignes 55-73  
**Risque :** Avantage compétitif — un utilisateur peut voir les pronos futurs d'un autre

La route de profil public d'un membre expose **tous ses pronostics**, y compris ceux dont la deadline n'est pas encore passée. N'importe quel membre connecté peut visiter le profil d'un autre et voir son pronostic avant la clôture.

**Recommandation :** Filtrer les pronostics exposés pour n'inclure que ceux dont la `predictionDeadline` est passée, en ajoutant un filtre sur la jointure avec `matches`.

---

### 🟡 MINEUR

#### 8. Utilisation de `as any` pour accéder au rôle utilisateur

**Fichier concerné :** `app/routes/feed.server.ts` lignes 99, 124, 184, 200  
**Risque :** Régression silencieuse si le nom du champ change

```typescript
isAdmin: (session.user as any).role === "admin",
```

Le champ `role` est défini dans les `additionalFields` de `auth.server.ts` mais le type `Session` généré par Better Auth ne l'inclut pas directement, forçant l'usage de `as any`. C'est une dette technique qui peut masquer des bugs.

**Recommandation :** Étendre le type `Session` avec les champs additionnels, ou créer un helper `isAdmin(session)` typé qui centralise cette logique.

---

#### 9. `trustedOrigins` vide si `APP_URL` absent

**Fichier concerné :** `app/lib/server/auth.server.ts` ligne 12  
**Risque :** Comportement inattendu de Better Auth selon la documentation

```typescript
trustedOrigins: env.APP_URL ? [env.APP_URL] : [],
```

Une liste vide peut, selon la version de Better Auth, soit tout refuser soit tout accepter. Le comportement exact dépend de la bibliothèque.

**Recommandation :** Documenter le comportement attendu et s'assurer que `APP_URL` est toujours définie en production. Envisager de le rendre obligatoire dans `env.server.ts` en production.

---

#### 10. N+1 requêtes DB dans le loader du feed

**Fichier concerné :** `app/routes/feed.server.ts` lignes 38-94  
**Risque :** Performance dégradée sous charge, pas de sécurité directe mais surface d'attaque DoS

Pour chaque post (jusqu'à 50), 3 requêtes sont émises (réactions count, commentaires, réaction utilisateur), soit jusqu'à 151 requêtes par chargement de page.

**Recommandation :** Utiliser des agrégations SQL ou des `JOIN` pour réduire à 2-3 requêtes totales.

---

## Synthèse

| Priorité | Nb | Actions recommandées |
|----------|----|----------------------|
| 🔴 Critique | 3 | En-têtes HTTP, rate limiting métier, fix IP spoofing |
| 🟠 Important | 4 | Health check auth, validation upload, mots de passe prod, pronos publics |
| 🟡 Mineur | 3 | Type `as any`, `trustedOrigins`, N+1 queries |

**Points positifs observés :**
- Validation Zod systématique sur tous les inputs utilisateur
- ORM Drizzle utilisé partout (pas de SQL raw → protection injection SQL)
- Authentification correctement appliquée sur toutes les routes protégées
- Vérification des droits d'authorship avant suppression (posts, commentaires)
- Auto-protection admin contre modification de son propre rôle
- Logs structurés (pino) avec niveaux appropriés
- Secrets exclus du repo via `.gitignore` et validés au démarrage via Zod
