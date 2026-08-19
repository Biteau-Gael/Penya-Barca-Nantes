# Rapport d'analyse sécurité — Penya Blaugrana Nantes

> **Date de l'analyse :** 19 août 2026  
> **Branche analysée :** `main` (commit `003faca`)  
> **Périmètre :** Revue des derniers commits + audit des conventions de sécurité

---

## Résumé des derniers commits

| Commit | Description |
|--------|-------------|
| `003faca` | fix: évaluer les badges immédiatement après chaque action (feed, match-detail) |
| `b1c88f6` | feat: Phase 2 — soirée match live, micro-pronos, badges, séries, saisons |
| `d461ee5` | Merge branch deploy Synology NAS |
| `554b873` | docs: guide de mise à jour déploiement Synology |
| `68e22d2` | feat: menu burger mobile pour la navigation |
| `6aebaf7` | Fix Better Auth trusted origins pour support domaine personnalisé |
| `9823bc5` | Add service migrate dans docker-compose.prod.yml |
| `8d6e5e9` | Docker Compose production + script de backup Synology NAS |
| `aed5841` | **security:** supprimer credentials du repo + renforcer .gitignore |
| `6583da3` | docs: README complet avec guide de déploiement |
| `ab7fc5d` | feat: intégration API Football + stats enrichies + classement Liga |

---

## Analyse de sécurité par ordre de criticité

---

### 🔴 CRITIQUE

#### 1. Path Traversal dans le serveur de fichiers uploadés

**Fichier :** `app/routes/uploads-files.ts:5`

```typescript
const filePath = path.join(process.cwd(), "uploads", params["*"]);
```

**Problème :** Le chemin construit avec `path.join` n'est pas validé. Un attaquant peut forger une requête avec des séquences `../` pour sortir du dossier `uploads/` et lire des fichiers arbitraires du serveur, y compris le fichier `.env` (avec DATABASE_URL, AUTH_SECRET, API_FOOTBALL_KEY).

**Exemple d'attaque :**
```
GET /uploads/../../.env
```

**Correctif recommandé :**
```typescript
const uploadsDir = path.join(process.cwd(), "uploads");
const filePath = path.resolve(uploadsDir, params["*"]);

// Vérifier que le chemin résolu est bien dans uploads/
if (!filePath.startsWith(uploadsDir + path.sep)) {
  return new Response("Accès refusé", { status: 403 });
}
```

---

### 🟠 ÉLEVÉ

#### 2. Absence de validation des entrées sur l'API micro-pronostics

**Fichier :** `app/routes/api.micro-predictions.ts`

Contrairement aux autres routes qui utilisent des schémas Zod, l'API de micro-pronostics n'effectue aucune validation structurée :

| Champ | Problème |
|-------|----------|
| `question` | Longueur non bornée — risque de stockage de données massives en DB |
| `answer` | Longueur non bornée — risque de stockage et de traitement excessif |
| `pointsValue` | Parsé en int mais pas borné — un admin pourrait attribuer 999 999 points |
| `deadlineSeconds` | Pas de borne — valeur arbitraire possible |
| `options` | Split par virgule sans validation des items — données non sanitizées |

**Correctif recommandé :** Ajouter un schéma Zod similaire aux autres routes :
```typescript
const createMicroSchema = z.object({
  matchId: z.string().min(1).max(50),
  question: z.string().min(1).max(200),
  type: z.enum(["qcm", "libre"]),
  options: z.string().max(500).optional(),
  pointsValue: z.number().int().min(1).max(10),
  deadlineSeconds: z.number().int().min(10).max(600),
});
```

#### 3. Mots de passe par défaut dans docker-compose de production

**Fichier :** `docker-compose.prod.yml:20-27`

```yaml
POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-changeme}
# redis: --requirepass ${REDIS_PASSWORD:-changeme}
```

Si les variables d'environnement ne sont pas définies, les mots de passe `changeme` sont utilisés en production. Un oubli de configuration expose toute la base de données.

**Correctif recommandé :** Supprimer les valeurs par défaut et faire échouer le démarrage si les variables sont manquantes :
```yaml
POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}
```

---

### 🟡 MOYEN

#### 4. Fuite de données sensibles dans les logs

**Fichier :** `app/routes/api.micro-predictions.ts:71`

```typescript
logger.info({ microId, correctAnswer, scored, total }, "Micro-pronostic clôturé");
```

La réponse correcte est enregistrée en clair dans les logs. Si les logs sont accessibles à d'autres personnes (fichiers, outils de monitoring), cela révèle les réponses aux questions avant que les utilisateurs ne puissent les voir.

**Correctif recommandé :** Ne pas logger `correctAnswer` en clair :
```typescript
logger.info({ microId, scored, total }, "Micro-pronostic clôturé");
```

#### 5. Vérification de rôle non typée (type `any`)

**Fichiers :** `app/routes/feed.server.ts`, `app/routes/soiree.server.ts`

```typescript
const isAdmin = (session.user as any).role === "admin";
```

L'utilisation de `as any` contourne la sécurité de typage TypeScript. Si la structure de `session.user` change, cette vérification peut silencieusement devenir `undefined === "admin"` (toujours `false`), ou au contraire ne pas protéger correctement.

**Correctif recommandé :** Utiliser la fonction `requireAuth` déjà disponible avec la liste de rôles, ou définir un type propre pour l'utilisateur avec le champ `role`.

#### 6. Absence de rate limiting visible

Les actions suivantes ne montrent aucun mécanisme de protection contre les abus :
- Soumission de réponses aux micro-pronostics (`api.micro-predictions.ts`)
- Réactions et commentaires sur le fil (`feed.server.ts`)
- Soumission de pronostics (`match-detail.server.ts`)

Un utilisateur malveillant peut automatiser des milliers de requêtes (harvesting de points, spam de réactions, déni de service applicatif).

**Recommandation :** Implémenter un rate limiting côté serveur (par ex. avec Redis, déjà présent dans le projet) sur les endpoints d'action.

#### 7. Credentials dev encore accessibles dans l'historique git

Le commit `aed5841` a supprimé les credentials du code, mais ils restent dans l'historique git :
- Mot de passe DB : `penya_secret`
- AUTH_SECRET : `dev-secret-change-me-min-16`

Si ces credentials ont été réutilisés en production, ils doivent être changés immédiatement. L'historique git est public si le dépôt l'est.

**Recommandation :** S'assurer que ces credentials ne sont utilisés **qu'en développement local** et jamais en production.

---

### 🔵 FAIBLE / AMÉLIORATIONS

#### 8. Absence d'en-têtes de sécurité HTTP

Aucun en-tête de sécurité n'est configuré dans l'application :
- `Content-Security-Policy` (XSS)
- `X-Frame-Options` (clickjacking)
- `X-Content-Type-Options` (MIME sniffing)
- `Strict-Transport-Security` (HTTPS)
- `Referrer-Policy`

**Recommandation :** Configurer ces en-têtes dans le middleware React Router ou via un reverse proxy (nginx).

#### 9. Image Docker sans digest fixe

**Fichier :** `docker-compose.prod.yml`

```yaml
image: postgres:16-alpine
image: redis:7-alpine
```

Les tags sans digest fixe (`@sha256:...`) peuvent pointer vers une image différente si un tag est réécrit (tag mutable), ce qui expose à des attaques supply chain.

**Recommandation :** Épingler les images avec leur digest SHA en production.

#### 10. N+1 queries dans le feed

**Fichier :** `app/routes/feed.server.ts:37-70`

Pour chaque post, 3 requêtes DB sont exécutées (réactions, commentaires, réaction utilisateur). Avec 50 posts, cela fait jusqu'à 150 requêtes DB par chargement de page. Ce n'est pas une vulnérabilité de sécurité directe mais peut causer un déni de service involontaire sous charge.

---

## Points positifs constatés

- ✅ Validation Zod appliquée sur les routes admin (matches, profil, prédictions)
- ✅ Authentification centralisée via `requireAuth` avec vérification de rôle
- ✅ Upload d'avatar avec restriction MIME type + taille + conversion WebP via Sharp
- ✅ ORM Drizzle avec requêtes paramétrées (protection SQL injection)
- ✅ Contrainte GDPR sur l'inscription (consentement obligatoire)
- ✅ Mot de passe avec exigences de complexité (majuscule, minuscule, chiffre, 8 chars min)
- ✅ Suppression des credentials hardcodés du repo (commit `aed5841`)
- ✅ Logs structurés avec `pino` (sans données sensibles dans la plupart des cas)
- ✅ Séparation claire des vérifications de rôle admin sur les actions sensibles

---

## Priorisation des correctifs

| Priorité | Action | Effort |
|----------|--------|--------|
| 🔴 P0 | Corriger le path traversal sur `/uploads/` | 30 min |
| 🟠 P1 | Ajouter validation Zod sur `api.micro-predictions.ts` | 1h |
| 🟠 P1 | Supprimer les mots de passe par défaut dans docker-compose.prod.yml | 15 min |
| 🟡 P2 | Supprimer `correctAnswer` des logs | 5 min |
| 🟡 P2 | Typer correctement les vérifications de rôle | 30 min |
| 🟡 P2 | Implémenter rate limiting Redis | 2-4h |
| 🔵 P3 | Configurer les en-têtes de sécurité HTTP | 1h |
| 🔵 P3 | Épingler les images Docker avec digest | 30 min |
