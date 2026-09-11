# Analyse de Sécurité — Penya Blaugrana Nantes

**Date :** 2026-09-11  
**Branche analysée :** `main` (commit `003facad`)  
**Analyste :** Claude (session automatique planifiée)

---

## Résumé des Commits Récents

| Commit | Message | Date |
|--------|---------|------|
| `003facad` | fix: évaluer les badges immédiatement après chaque action | 13 avr. 2026 |
| `b1c88f67` | feat: Phase 2 — soirée match live, micro-pronos, badges, séries, saisons | 13 avr. 2026 |
| `d461ee53` | Merge branch 'claude/deploy-synology-nas-cLkOL' | 12 avr. 2026 |
| `554b873a` | Add deployment guide for Synology NAS updates | 12 avr. 2026 |
| `68e22d2b` | feat: menu burger mobile pour la navigation | 12 avr. 2026 |
| `6aebaf76` | Fix Better Auth trusted origins for custom domain support | 12 avr. 2026 |
| `9823bc58` | Add migrate service to docker-compose.prod.yml | 12 avr. 2026 |
| `8d6e5e96` | Add production Docker Compose and backup script for Synology NAS | 12 avr. 2026 |
| `aed58411` | security: supprimer credentials du repo et renforcer .gitignore | 12 avr. 2026 |
| `ab7fc5d1` | feat: intégration API Football + stats enrichies + classement Liga | 12 avr. 2026 |
| `16c43e66` | feat: MVP Phase 1 — Penya Blaugrana Nantes | 11 avr. 2026 |

---

## Constatations de Sécurité (par ordre de criticité)

---

### 🔴 CRITIQUE — Traversée de chemin (Path Traversal) dans le serveur de fichiers

**Fichier :** `app/routes/uploads-files.ts`  
**Statut :** ✅ **CORRIGÉ dans cette session**

**Description :**  
L'ancienne implémentation construisait le chemin fichier avec `path.join` sans valider que le chemin résultant restait dans le répertoire `uploads/` :

```typescript
// AVANT (vulnérable)
const filePath = path.join(process.cwd(), "uploads", params["*"]);
```

Un attaquant pouvait accéder à n'importe quel fichier du système en passant des séquences `../` dans l'URL :
- `GET /uploads/../../etc/passwd` → lecture du fichier `/etc/passwd`
- `GET /uploads/../../app/lib/server/auth.server.ts` → fuite du code source

**Correction appliquée :**
```typescript
const UPLOADS_DIR = path.resolve(process.cwd(), "uploads");
const filePath = path.resolve(UPLOADS_DIR, params["*"]);

if (!filePath.startsWith(UPLOADS_DIR + path.sep)) {
  return new Response("Not found", { status: 404 });
}
```

---

### 🟠 HAUTE — Mots de passe par défaut dans Docker Compose production

**Fichier :** `docker-compose.prod.yml`  
**Statut :** ⚠️ À corriger manuellement côté déploiement

**Description :**  
Les variables d'environnement PostgreSQL et Redis utilisent `changeme` comme valeur par défaut si le fichier `.env` ne définit pas `POSTGRES_PASSWORD` ou `REDIS_PASSWORD` :

```yaml
POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-changeme}
redis-server --requirepass ${REDIS_PASSWORD:-changeme}
```

Si le fichier `.env` de production omet ces variables, les bases de données seront accessibles avec un mot de passe trivial.

**Recommandation :**
- Vérifier que le fichier `.env` de production définit bien `POSTGRES_PASSWORD` et `REDIS_PASSWORD` avec des valeurs fortes
- Envisager de supprimer la valeur par défaut (forcer l'échec explicite si la variable est absente)

---

### 🟠 HAUTE — Absence de rate limiting sur les routes d'authentification

**Fichiers :** `app/routes/login.tsx`, `app/routes/register.tsx`  
**Statut :** ⚠️ À corriger

**Description :**  
Le module `app/lib/server/rate-limit.server.ts` existe et fonctionne via Redis, mais il **n'est pas appliqué** aux routes de connexion (`/connexion`) et d'inscription (`/inscription`). Cela expose l'application aux attaques par force brute sur les mots de passe.

**Recommandation :**  
Appliquer `checkRateLimit` dans les handlers de connexion :
```typescript
await checkRateLimit({
  key: `login:${ip}`,
  maxAttempts: 5,
  windowSeconds: 900, // 15 minutes
});
```

---

### 🟡 MOYENNE — `trustedOrigins` vide si APP_URL non configuré (risque CSRF)

**Fichier :** `app/lib/server/auth.server.ts`  
**Statut :** ⚠️ Surveillance recommandée

**Description :**  
```typescript
trustedOrigins: env.APP_URL ? [env.APP_URL] : [],
```
Si `APP_URL` n'est pas défini dans `.env`, Better Auth reçoit un tableau vide pour `trustedOrigins`. Selon la version de Better Auth, cela peut soit bloquer toutes les requêtes cross-origin, soit n'appliquer aucune restriction CSRF.

**Recommandation :**
- S'assurer que `APP_URL` est toujours défini en production (ex: `https://penya.example.com`)
- Valider le comportement exact de Better Auth avec `trustedOrigins: []`

---

### 🟡 MOYENNE — Validation du type MIME basée sur la déclaration client

**Fichier :** `app/lib/server/upload.ts`  
**Statut :** ⚠️ Risque atténué par `sharp`

**Description :**  
La vérification du type de fichier repose sur `file.type`, qui est la valeur déclarée par le client et peut être falsifiée :

```typescript
if (!ALLOWED_TYPES.includes(file.type)) {
  throw new Error("Format non supporté.");
}
```

**Atténuation :** La librairie `sharp` valide le contenu binaire réel et rejettera tout fichier qui n'est pas une image valide.

**Recommandation :**
- Conserver la vérification `file.type` comme premier filtre
- Considérer une analyse des magic bytes (ex: `file-type` npm) pour une validation plus robuste, indépendante de `sharp`

---

### 🟢 FAIBLE — Requêtes N+1 dans le fil d'actualité (surface DoS)

**Fichier :** `app/routes/feed.server.ts`  
**Statut :** ℹ️ Observation

**Description :**  
Pour chaque post du fil, plusieurs requêtes SQL séparées sont émises (réactions, commentaires, réaction utilisateur). Avec 50 posts (limite actuelle), cela génère jusqu'à 150 requêtes par chargement de page. Une augmentation du volume de contenu pourrait provoquer des lenteurs exploitables.

**Recommandation :**  
Regrouper les requêtes avec des JOINs ou des sous-requêtes aggrégées plutôt que des appels en boucle.

---

## Points Conformes (Bonnes Pratiques Respectées)

| Contrôle | Statut |
|----------|--------|
| `.env` et `.claude/` exclus du git | ✅ |
| Pas de credentials codés en dur dans le code | ✅ |
| ORM Drizzle (protection injection SQL) | ✅ |
| Validation Zod des variables d'environnement | ✅ |
| Vérification des rôles admin sur toutes les routes sensibles | ✅ |
| Schémas de validation Zod pour les inputs utilisateur (feed, commentaires) | ✅ |
| Limitation taille fichier upload (2 Mo) + formats restreints | ✅ |
| Sessions stockées en Redis avec TTL | ✅ |
| Logs structurés (pino) sans exposition de données sensibles | ✅ |
| Module rate-limit implémenté et prêt à l'emploi | ✅ (non appliqué partout) |
| Secrets API Football hors du code source | ✅ |

---

## Actions Prioritaires Recommandées

1. **[URGENT — fait]** Corriger la traversée de chemin dans `uploads-files.ts` ✅
2. **[URGENT]** Vérifier que `POSTGRES_PASSWORD` et `REDIS_PASSWORD` sont définis dans `.env` de production
3. **[IMPORTANT]** Appliquer `checkRateLimit` aux routes `/connexion` et `/inscription`
4. **[IMPORTANT]** Confirmer que `APP_URL` est défini en production
5. **[OPTIONNEL]** Optimiser les requêtes N+1 du fil d'actualité
