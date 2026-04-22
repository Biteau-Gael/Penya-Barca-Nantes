# Rapport d'audit de sécurité — Penya Blaugrana Nantes

**Date** : 2026-04-22  
**Branche analysée** : `main` (HEAD: `003faca`)  
**Périmètre** : Code source, configuration Docker, scripts de déploiement  
**Statut** : Corrections critiques et hautes appliquées dans ce commit

---

## 1. Résumé des derniers commits

| Commit | Date | Type | Description |
|--------|------|------|-------------|
| `003faca` | 13 avr. 2026 | fix | Évaluation immédiate des badges après chaque action (pronostic, post, commentaire, réaction) |
| `b1c88f6` | 13 avr. 2026 | feat | **Phase 2 complète** — soirée match live, micro-pronos, badges, séries, saisons (migration DB `0007`, 26 fichiers, +2965 lignes) |
| `68e22d2` | 13 avr. 2026 | feat | Menu burger mobile pour la navigation |
| `554b873` | 12 avr. 2026 | docs | Guide de déploiement NAS Synology (`DEPLOY.md`) |
| `6aebaf7` | 12 avr. 2026 | fix | Better Auth `trustedOrigins` pour support du domaine custom (`APP_URL`) |
| `9823bc5` | 12 avr. 2026 | fix | Service `migrate` ajouté dans `docker-compose.prod.yml` pour les migrations DB |
| `8d6e5e9` | 12 avr. 2026 | feat | Docker Compose production + script de backup automatisé pour Synology NAS |

### Détail Phase 2 (`b1c88f6`)
- **Soirée match live** (`/soiree/:matchId`) : score polling API (60s), fil du match, révélation des pronos au coup d'envoi
- **Micro-pronostics** : création admin, vote joueur, clôture avec attribution automatique des points
- **Séries** : `currentStreak` / `bestStreak` par utilisateur, récompenses aux paliers 3/5/10 avec post auto
- **Badges** : 10 badges avec évaluation automatique, page `/badges`, affichage sur le profil
- **Saisons** : filtrage classement par saison, support archives (`/classement?saison=2024-2025`)

---

## 2. Analyse de sécurité — par ordre de criticité

> **Légende** : ✅ Corrigé dans ce commit | ⚠️ À planifier | ℹ️ Information

---

### HAUTE — Path Traversal sur le service de fichiers uploadés ✅ Corrigé

**Fichier** : `app/routes/uploads-files.ts`

Le paramètre wildcard de la route `/uploads/*` était concaténé directement au chemin sans vérification :

```typescript
// AVANT (vulnérable)
const filePath = path.join(process.cwd(), "uploads", params["*"]);
```

Un attaquant pouvait requêter `/uploads/../../.env` pour lire les secrets de l'application.

**Correction appliquée** :

```typescript
const uploadsDir = path.join(process.cwd(), "uploads");
const filePath = path.resolve(uploadsDir, params["*"]);

if (!filePath.startsWith(uploadsDir + path.sep)) {
  return new Response("Forbidden", { status: 403 });
}
```

---

### HAUTE — Mots de passe par défaut "changeme" en production ✅ Corrigé

**Fichier** : `docker-compose.prod.yml`

Les variables `POSTGRES_PASSWORD` et `REDIS_PASSWORD` avaient un fallback `:-changeme`. Si le fichier `.env` de production était incomplet, les services démarraient avec un mot de passe trivial.

**Correction appliquée** : Remplacement par `${VAR:?message}` qui force une erreur explicite au démarrage si la variable n'est pas définie.

---

### HAUTE — Absence de headers HTTP de sécurité ⚠️ À planifier

Aucun header de sécurité n'est configuré côté application ou reverse proxy :

| Header manquant | Risque |
|-----------------|--------|
| `Content-Security-Policy` | XSS, injection de scripts externes |
| `X-Frame-Options: DENY` | Clickjacking |
| `X-Content-Type-Options: nosniff` | MIME sniffing |
| `Strict-Transport-Security` | Downgrade HTTP |
| `Referrer-Policy` | Fuite d'URL dans les requêtes tierces |

**Recommandation** : Configurer ces headers dans la configuration Nginx du reverse proxy Synology ou ajouter un middleware dans `app/root.tsx`.

Exemple pour Nginx :
```nginx
add_header X-Content-Type-Options "nosniff" always;
add_header X-Frame-Options "DENY" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Content-Security-Policy "default-src 'self'; img-src 'self' data: https:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline';" always;
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
```

---

### HAUTE — Dockerfile : conteneur s'exécute en root ✅ Corrigé

Le stage final du Dockerfile ne définissait pas d'utilisateur non-root. En cas de compromission de l'application, le processus avait les privilèges `root` dans le conteneur.

**Correction appliquée** :
```dockerfile
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
RUN chown -R appuser:appgroup /app
USER appuser
```

---

### MOYENNE — Endpoint `/api/health` non authentifié ⚠️ À planifier

**Fichier** : `app/routes/api.health.ts`

La route expose l'état des services (PostgreSQL, Redis) sans authentification ni rate limiting, facilitant la reconnaissance de l'infrastructure.

**Recommandation** : Restreindre l'accès à une clé secrète en header, ou déléguer la protection au reverse proxy (accès réseau interne uniquement).

---

### MOYENNE — IP spoofing possible sur le rate limiting d'auth ⚠️ À planifier

**Fichier** : `app/routes/api.auth.$.ts`

```typescript
request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
```

Si le reverse proxy est mal configuré ou si un attaquant peut injecter un header `X-Forwarded-For`, il peut contourner le rate limiting en usurpant une IP différente à chaque requête.

**Recommandation** : Utiliser le dernier IP de la chaîne `X-Forwarded-For` (ajouté par le reverse proxy de confiance), ou configurer Nginx pour réécrire ce header avec l'IP réelle.

---

### MOYENNE — Redis sans authentification en développement ⚠️ À planifier

**Fichier** : `docker-compose.yml`

Redis est démarré sans `--requirepass` en dev, accessible sur le port 6379 du host. Si la machine de développement est sur un réseau partagé, Redis est accessible sans mot de passe.

**Recommandation** :
```yaml
redis:
  command: redis-server --requirepass ${REDIS_PASSWORD:-dev-local-password}
```

---

### MOYENNE — `trustedOrigins` vide si `APP_URL` non défini ⚠️ À planifier

**Fichier** : `app/lib/server/auth.server.ts`

```typescript
trustedOrigins: env.APP_URL ? [env.APP_URL] : [],
```

Quand `APP_URL` n'est pas défini, `trustedOrigins` est vide. Le comportement CSRF de Better Auth dans ce cas mérite vérification dans la documentation de la bibliothèque.

**Recommandation** : Documenter dans `.env.example` que `APP_URL` est obligatoire en production. Envisager de le rendre obligatoire dans `env.server.ts` en production.

---

### MOYENNE — ORM non utilisé pour la requête bestStreak dans badges.server.ts ✅ Corrigé

**Fichier** : `app/lib/server/badges.server.ts`

Utilisation de `sql\`"user"\`` et `sql\`id = ${userId}\`` au lieu du schéma ORM Drizzle, contournant les protections de typage et les garanties de l'ORM.

**Correction appliquée** : Remplacé par la syntaxe ORM standard utilisant `user` (table importée du schéma) et `eq()`.

---

### MOYENNE — `JSON.parse` sans try-catch sur le cache des détails de match ✅ Corrigé

**Fichier** : `app/routes/match-detail.server.ts`

Le cache JSON stocké en base de données était parsé sans protection contre les données corrompues.

**Correction appliquée** : Ajout d'un try-catch avec log et fallback vers un re-fetch depuis l'API.

---

### FAIBLE — Pas de limites de ressources dans Docker Compose ⚠️ À planifier

**Fichiers** : `docker-compose.yml`, `docker-compose.prod.yml`

Aucune limite de mémoire ou CPU n'est configurée pour les services. Une fuite mémoire ou une attaque DoS dans l'application pourrait consommer toutes les ressources du NAS.

**Recommandation** :
```yaml
deploy:
  resources:
    limits:
      cpus: '1'
      memory: 512M
```

---

### FAIBLE — backup.sh sans gestion d'erreur ✅ Corrigé

**Fichier** : `backup.sh`

Le script ne vérifiait pas le code de retour de `pg_dump`. Un backup silencieusement échoué créait un fichier vide inclus dans la rotation.

**Correction appliquée** : Ajout de `set -euo pipefail`, vérification du code de retour, suppression du fichier partiel en cas d'échec.

---

### FAIBLE — Vérification de rôle avec cast `as any` ⚠️ À planifier

**Fichier** : `app/routes/feed.server.ts` (lignes 99, 124, 184, 200)

```typescript
(session.user as any).role === "admin"
```

Le cast `any` bypasse la vérification de type TypeScript. Ce n'est pas un risque runtime (le rôle est bien vérifié côté serveur sur les routes sensibles), mais c'est une mauvaise pratique qui masque les erreurs de type.

**Recommandation** : Augmenter le type `Session` de Better Auth pour inclure les champs additionnels.

---

### FAIBLE — Type `any` sur les réponses API externes ⚠️ À planifier

**Fichier** : `app/routes/soiree.server.ts`

Les réponses de l'API Football externe sont parsées avec le type `any`, désactivant la vérification de structure. Des changements dans l'API externe peuvent provoquer des erreurs runtime silencieuses.

**Recommandation** : Définir des interfaces TypeScript et valider avec Zod (cohérent avec le reste du projet).

---

## 3. Points positifs identifiés

| Domaine | Statut | Détail |
|---------|--------|--------|
| Rate limiting auth | ✅ | Login : 10 req/15min — Register : 5 req/1h via Redis |
| Validation des inputs | ✅ | Schemas Zod systématiques sur toutes les actions et loaders |
| Protection SQL injection | ✅ | ORM Drizzle avec requêtes paramétrées |
| Upload sécurisé | ✅ | Validation MIME + taille (2 Mo max) + retraitement obligatoire via Sharp |
| Authentification | ✅ | Better Auth avec sessions Redis, rôles vérifiés sur toutes les routes admin |
| Absence de XSS | ✅ | Aucun `dangerouslySetInnerHTML`, rendu JSX standard qui échappe automatiquement |
| Secrets hors du repo | ✅ | `.gitignore` couvre `.env`, nettoyage effectué en `aead5841` |
| Protection accès admin | ✅ | `requireAuth(request, ["admin"])` systématique sur toutes les routes `/admin/*` |
| Auto-protection admin | ✅ | Un admin ne peut pas modifier ni supprimer son propre compte |
| Validation mots de passe | ✅ | 8+ chars, majuscule + minuscule + chiffre obligatoires |
| Logging structuré | ✅ | Pino avec niveaux, actions critiques loggées avec contexte |

---

## 4. Plan d'action — corrections restantes

| Priorité | Action | Fichier | Effort estimé |
|----------|--------|---------|---------------|
| 1 | Ajouter les headers HTTP de sécurité | Nginx / `app/root.tsx` | 1h |
| 2 | Restreindre `/api/health` | `app/routes/api.health.ts` | 30 min |
| 3 | Corriger le rate limiting IP (dernier hop) | `app/routes/api.auth.$.ts` | 30 min |
| 4 | Ajouter `--requirepass` Redis en dev | `docker-compose.yml` | 5 min |
| 5 | Ajouter les limites de ressources Docker | `docker-compose.prod.yml` | 30 min |
| 6 | Typer les réponses API externes avec Zod | `app/routes/soiree.server.ts` | 1h |
| 7 | Corriger le cast `as any` pour les rôles | `app/routes/feed.server.ts` | 30 min |
