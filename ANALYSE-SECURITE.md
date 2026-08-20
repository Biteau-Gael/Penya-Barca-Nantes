# Analyse de sécurité — Penya Blaugrana Nantes

**Date :** 2026-08-20  
**Branche analysée :** `main`  
**Commits couverts :** `fec3e63` → `003faca`

---

## Résumé des derniers commits

| Hash | Date | Type | Description |
|------|------|------|-------------|
| `003faca` | 13 avr. 2026 | fix | Évaluation des badges immédiatement après chaque action (pronostic, post, commentaire, réaction) |
| `b1c88f6` | 13 avr. 2026 | feat | Phase 2 — Soirée match live, micro-pronos, badges, séries, saisons (26 fichiers, ~2 965 insertions) |
| `d461ee5` | 12 avr. 2026 | merge | Fusion branche déploiement Synology NAS |
| `554b873` | 12 avr. 2026 | docs | Guide de mise à jour du déploiement NAS |
| `68e22d2` | 13 avr. 2026 | feat | Menu burger mobile pour la navigation |
| `6aebaf7` | 12 avr. 2026 | fix | Correction Better Auth — trusted origins pour domaine personnalisé |
| `9823bc5` | 12 avr. 2026 | feat | Service `migrate` dans docker-compose.prod.yml |
| `8d6e5e9` | 12 avr. 2026 | feat | Docker Compose production + script de sauvegarde pour Synology NAS |

---

## Analyse de sécurité

### Points positifs

- **Authentification systématique** : `requireAuth()` appliqué à toutes les routes protégées.
- **Contrôle d'accès par rôle** : les actions admin vérifient `session.user.role === "admin"` avant exécution.
- **Rate limiting** : appliqué aux endpoints d'authentification (sign-in : 10 tentatives / 15 min, sign-up : 5 / 1h).
- **Validation des variables d'environnement** : schéma Zod strict, `AUTH_SECRET` imposé à 16 caractères minimum.
- **ORM Drizzle** : requêtes paramétrées — pas de concaténation SQL manuelle.
- **Upload sécurisé** : type MIME vérifié, taille limitée à 2 Mo, conversion systématique en WebP via `sharp`.
- **Pas de XSS** : aucun `dangerouslySetInnerHTML` ni `innerHTML` trouvé dans le code.
- **Logs structurés** : utilisation exclusive de `logger` (pino), pas de `console.log` en production.
- **Secrets hors dépôt** : `.env` dans `.gitignore`, commit `aed5841` a nettoyé des credentials exposés.

---

## Remarques de sécurité — par ordre de criticité

### MOYEN — Absence de validation sur le champ `answer` des micro-pronos

**Fichier :** `app/routes/api.micro-predictions.ts` — ligne 92  
**Impact :** Un utilisateur authentifié peut soumettre une réponse de longueur arbitraire, sans contrôle de contenu.

```ts
// Actuel : aucune validation de longueur ou format
const answer = formData.get("answer") as string;
if (!microId || !answer) { ... }
```

**Risque :** Pollution de base de données, déni de service applicatif sur la comparaison, contournement potentiel de la vérification si `correctAnswer` est très long.

**Recommandation :**

```ts
const answer = (formData.get("answer") as string)?.trim().slice(0, 255);
if (!microId || !answer || answer.length < 1) { ... }
```

---

### FAIBLE — Confiance aveugle dans l'en-tête `x-forwarded-for` pour le rate limiting

**Fichier :** `app/routes/api.auth.$.ts` — ligne 7  
**Impact :** Un attaquant peut forger l'en-tête `x-forwarded-for` pour contourner la limite de tentatives par IP.

```ts
request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
```

**Risque :** Bypass du rate limit sur `/sign-in` (brute force de mot de passe possible).

**Recommandation :** N'accepter `x-forwarded-for` que si la requête provient d'un proxy de confiance (IP Nginx interne), ou utiliser `x-real-ip` uniquement, en s'assurant que Nginx le positionne depuis la configuration reverse proxy.

---

### FAIBLE — Mots de passe PostgreSQL/Redis fallback faibles dans Docker Compose

**Fichier :** `docker-compose.prod.yml` — lignes `POSTGRES_PASSWORD` et `redis-server`  
**Impact :** Si les variables d'environnement ne sont pas définies, les services démarrent avec le mot de passe `changeme`.

```yaml
POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-changeme}
redis-server --requirepass ${REDIS_PASSWORD:-changeme}
```

**Risque :** En cas d'oubli de configuration de `.env` en production, la base de données est accessible avec un mot de passe trivial.

**Recommandation :** Supprimer le fallback `:-changeme` pour forcer une erreur explicite si la variable n'est pas définie, ou utiliser Docker secrets.

```yaml
POSTGRES_PASSWORD=${POSTGRES_PASSWORD:?POSTGRES_PASSWORD must be set}
```

---

### FAIBLE — Sauvegardes SQL non chiffrées

**Fichier :** `backup.sh`  
**Impact :** Les dumps SQL contiennent l'ensemble des données utilisateurs (emails, pseudos, points) en clair sur le NAS.

**Risque :** En cas d'accès physique ou compromission NAS, toutes les données personnelles sont exposées sans protection supplémentaire.

**Recommandation :** Chiffrer les dumps avant stockage :

```bash
pg_dump -U penya penya_barca_nantes \
  | gzip | openssl enc -aes-256-cbc -pbkdf2 -k "$BACKUP_PASSPHRASE" \
  > "$BACKUP_DIR/penya_$DATE.sql.gz.enc"
```

---

### INFO — `APP_URL` optionnel : `trustedOrigins` potentiellement vide

**Fichier :** `app/lib/server/auth.server.ts` — ligne `trustedOrigins`  
**Impact :** Si `APP_URL` n'est pas défini, Better Auth reçoit un tableau vide de trusted origins.

```ts
trustedOrigins: env.APP_URL ? [env.APP_URL] : [],
```

**Risque :** Comportement CSRF et CORS à vérifier selon la version de Better Auth utilisée. En mode développement (sans `APP_URL`), les protections liées aux origines pourraient être désactivées ou plus permissives.

**Recommandation :** Documenter que `APP_URL` est requis en production dans `.env.example`, et envisager de le rendre obligatoire en mode `NODE_ENV=production` dans `env.server.ts`.

---

### INFO — Absence de validation sur le champ `question` des micro-pronos (admin)

**Fichier :** `app/routes/api.micro-predictions.ts` — ligne 22  
**Impact :** Un admin peut créer un micro-pronostic avec une question de longueur illimitée.

**Risque :** Limité (action admin uniquement), mais peut affecter l'affichage UI et la taille des réponses JSON.

**Recommandation :** Ajouter `question.slice(0, 500)` ou une validation Zod côté serveur.

---

## Bilan

| Criticité | Nombre | Statut |
|-----------|--------|--------|
| CRITIQUE  | 0      | ✅ Aucun |
| MOYEN     | 1      | ⚠️ À corriger |
| FAIBLE    | 3      | ⚠️ À planifier |
| INFO      | 2      | ℹ️ À documenter |

L'architecture globale est solide : authentification, ORM, logging et upload suivent les bonnes pratiques. Les points à traiter concernent principalement le durcissement de la configuration de déploiement et la validation d'un champ côté API.
