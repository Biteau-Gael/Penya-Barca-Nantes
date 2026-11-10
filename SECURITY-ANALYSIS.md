# Analyse de Sécurité — Penya Blaugrana Nantes

**Date de l'analyse :** 10 novembre 2026  
**Branche analysée :** `main` (dernier commit : `003faca`)  
**Analyste :** Claude Code (automatique — tâche planifiée)

---

## Résumé des derniers commits

| Commit | Date | Description |
|--------|------|-------------|
| `003faca` | 13 avr. 2026 | fix: évaluer les badges immédiatement après chaque action |
| `b1c88f6` | 13 avr. 2026 | feat: Phase 2 — soirée match live, micro-pronos, badges, séries, saisons |
| `d461ee5` | 12 avr. 2026 | Merge branch 'claude/deploy-synology-nas-cLkOL' |
| `554b873` | 12 avr. 2026 | Add deployment guide for Synology NAS updates |
| `68e22d2` | 13 avr. 2026 | feat: menu burger mobile pour la navigation |

**Contenu des évolutions récentes :**
- Phase 2 complète : page soirée match en direct (polling API 60 s), micro-pronostics avec votes et clôture automatique, système de séries et récompenses, 10 badges avec évaluation automatique, gestion des saisons et archives du classement
- Corrections : évaluation des badges déclenchée immédiatement après chaque action utilisateur (pronostic, post, commentaire, réaction)
- Infrastructure : guide de mise à jour du NAS Synology, navigation mobile améliorée

---

## Analyse de sécurité — Remarques par ordre de criticité

---

### 🔴 CRITIQUE — Path Traversal dans le serveur de fichiers uploadés

**Fichier :** `app/routes/uploads-files.ts` (ligne 5)

**Description :**  
Le chemin du fichier est construit directement depuis le paramètre URL sans vérification que le chemin résolu reste dans le répertoire `uploads/`.

```typescript
// VULNÉRABLE — aucune validation
const filePath = path.join(process.cwd(), "uploads", params["*"]);
```

**Scénario d'exploitation :**  
Une requête `GET /uploads/../package.json` ou `GET /uploads/../.env` permettrait de lire n'importe quel fichier accessible au processus Node.js, y compris les variables d'environnement, le code source ou les secrets.

**Correction recommandée :**  
Vérifier que le chemin résolu commence bien par le répertoire `uploads/` :

```typescript
const uploadsDir = path.join(process.cwd(), "uploads");
const filePath = path.join(uploadsDir, params["*"]);

// Bloquer toute tentative de sortie du répertoire
if (!filePath.startsWith(uploadsDir + path.sep)) {
  return new Response("Forbidden", { status: 403 });
}
```

---

### 🟠 MODÉRÉ — En-têtes de sécurité HTTP absents

**Fichier :** `app/root.tsx`, `vite.config.ts`

**Description :**  
Aucun en-tête de sécurité HTTP n'est configuré côté serveur :

| En-tête | Risque si absent |
|---------|-----------------|
| `Content-Security-Policy` | XSS, injection de ressources externes |
| `X-Frame-Options` | Clickjacking |
| `X-Content-Type-Options` | MIME sniffing |
| `Strict-Transport-Security` | Downgrade HTTPS → HTTP |
| `Referrer-Policy` | Fuite d'URL dans le referer |

**Correction recommandée :**  
Ajouter un middleware dans `entry.server.tsx` ou configurer un reverse proxy (Nginx/Caddy) avec ces en-têtes. Exemple dans React Router :

```typescript
// entry.server.tsx
export function handleRequest(...) {
  // Après rendu...
  responseHeaders.set("X-Frame-Options", "DENY");
  responseHeaders.set("X-Content-Type-Options", "nosniff");
  responseHeaders.set("Referrer-Policy", "strict-origin-when-cross-origin");
  // CSP à adapter selon les ressources réellement utilisées
}
```

---

### 🟠 MODÉRÉ — Usurpation d'IP possible dans le rate limiting

**Fichier :** `app/routes/api.auth.$.ts` (lignes 6–11)

**Description :**  
L'IP du client est lue depuis `X-Forwarded-For`, un en-tête que n'importe quel client peut forger si aucun proxy de confiance ne l'écrase.

```typescript
function getClientIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}
```

**Risque :** un attaquant peut contourner le rate limiting en changeant la valeur de cet en-tête à chaque requête.

**Correction recommandée :**  
- En production derrière un reverse proxy (Nginx, Traefik), s'assurer que seul le proxy de confiance écrase `X-Forwarded-For`.  
- En option : lire l'IP depuis `socket.remoteAddress` via une intégration serveur Node.js, ou utiliser la dernière IP de la chaîne `X-Forwarded-For` (qui est celle ajoutée par le proxy de confiance).

---

### 🟡 FAIBLE — Mot de passe Docker par défaut en production

**Fichier :** `docker-compose.prod.yml` (lignes 19, 28)

**Description :**  
Les mots de passe ont une valeur de repli `changeme` si les variables d'environnement ne sont pas définies :

```yaml
POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-changeme}
redis-server --requirepass ${REDIS_PASSWORD:-changeme}
```

**Risque :** si le fichier `.env` est absent ou incomplet lors d'un déploiement, les bases de données tournent avec des credentials triviaux.

**Correction recommandée :**  
Supprimer les valeurs par défaut pour forcer une erreur explicite plutôt qu'un déploiement non sécurisé :

```yaml
POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?POSTGRES_PASSWORD must be set}
```

---

### 🟡 FAIBLE — Absence d'entrée server dans Dockerfile (utilisateur non-root)

**Fichier :** `Dockerfile`

**Description :**  
Le conteneur final s'exécute en tant que `root` (comportement par défaut de l'image `node:20-alpine`).

**Risque :** en cas d'exploitation d'une vulnérabilité applicative, l'attaquant dispose des droits root dans le conteneur.

**Correction recommandée :**

```dockerfile
# Ajouter avant CMD dans l'étape finale
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser
```

---

## Ce qui est bien fait ✅

| Domaine | Détail |
|---------|--------|
| **Authentification** | Better Auth avec sessions Redis, tokens de session sécurisés |
| **Rate limiting** | Login : 10 tentatives / 15 min — Register : 5 / heure via Redis |
| **Autorisation** | `requireAuth(request, ["admin"])` sur toutes les routes admin, vérification du rôle systématique |
| **SQL Injection** | Drizzle ORM avec requêtes paramétrées — aucune concaténation de SQL brut détectée |
| **Mots de passe** | Validation Zod : min 8 caractères, majuscule + minuscule + chiffre obligatoires |
| **Upload avatars** | Validation MIME, limite 2 Mo, conversion forcée en WebP (élimine les images malveillantes) |
| **Secrets** | `.env` et `.env.*` dans `.gitignore`, `.env.example` sans vraies valeurs |
| **Validation entrées** | Schémas Zod sur tous les formulaires, pseudo limité à `[a-zA-Z0-9_-]` |
| **Protection auto-élévation** | Un admin ne peut pas modifier son propre rôle |
| **Logging** | Pino logger structuré avec niveaux, événements de sécurité tracés (rate limit, erreurs auth) |

---

## Recommandations prioritaires

1. **Immédiat — Corriger la faille path traversal** dans `uploads-files.ts` avant toute mise en production accessible publiquement.
2. **Court terme — Ajouter les en-têtes HTTP** via le middleware React Router ou la configuration Nginx/Traefik.
3. **Court terme — Supprimer les mots de passe Docker par défaut** dans `docker-compose.prod.yml`.
4. **Moyen terme — Exécuter Node.js en non-root** dans le Dockerfile.
5. **Moyen terme — Durcir le rate limiting** contre l'usurpation d'IP (vérification au niveau proxy).
