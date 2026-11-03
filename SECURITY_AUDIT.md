# Audit de sécurité — Penya Blaugrana Nantes

> Généré automatiquement le 2026-11-03 à partir de l'analyse des derniers commits.

---

## Résumé des derniers commits analysés

| Hash | Message | Auteur | Date |
|------|---------|--------|------|
| `003faca` | fix: évaluer les badges immédiatement après chaque action | Biteau Gaël | 13 avr. 2026 |
| `b1c88f6` | feat: Phase 2 — soirée match live, micro-pronos, badges, séries, saisons | Biteau Gaël | 13 avr. 2026 |
| `d461ee5` | Merge branch 'claude/deploy-synology-nas-cLkOL' | Claude | 12 avr. 2026 |
| `554b873` | Add deployment guide for Synology NAS updates | Claude | 12 avr. 2026 |
| `68e22d2` | feat: menu burger mobile pour la navigation | Biteau Gaël | 13 avr. 2026 |
| `6aebaf7` | Fix Better Auth trusted origins for custom domain support | Claude | — |
| `9823bc5` | Add migrate service to docker-compose.prod.yml | Claude | — |
| `aed5841` | security: supprimer credentials du repo et renforcer .gitignore | — | — |

---

## Résultats de l'audit par ordre de criticité

---

### 🔴 CRITIQUE — Path Traversal sur le service de fichiers uploadés

**Fichier :** `app/routes/uploads-files.ts` (ligne 5)

**Description :**
Le loader de fichiers uploadés construit le chemin sans vérifier que le résultat reste dans le répertoire `uploads/`. La fonction `path.join()` normalise les séquences `../` sans rejeter les chemins qui sortent du répertoire autorisé. Un attaquant authentifié (ou non, si la route n'est pas protégée) peut lire des fichiers arbitraires sur le serveur.

**Exemple d'exploitation :**
```
GET /uploads/../../etc/passwd
→ path.join(cwd, "uploads", "../../etc/passwd") = /etc/passwd
```

**Code vulnérable :**
```ts
// uploads-files.ts:5
const filePath = path.join(process.cwd(), "uploads", params["*"]);
```

**Correction recommandée :**
```ts
const UPLOADS_ROOT = path.resolve(process.cwd(), "uploads");
const filePath = path.resolve(UPLOADS_ROOT, params["*"]);

// Rejeter toute tentative de sortie du répertoire
if (!filePath.startsWith(UPLOADS_ROOT + path.sep)) {
  return new Response("Forbidden", { status: 403 });
}
```

---

### 🟠 HAUTE — Mots de passe par défaut faibles en production

**Fichier :** `docker-compose.prod.yml` (lignes 19, 26)

**Description :**
Les services PostgreSQL et Redis utilisent `changeme` comme mot de passe de secours si les variables d'environnement ne sont pas définies. En cas d'oubli de configuration du fichier `.env` sur le NAS, la base de données et le cache seraient accessibles avec ce mot de passe trivial.

**Code concerné :**
```yaml
POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-changeme}
command: redis-server --requirepass ${REDIS_PASSWORD:-changeme}
```

**Correction recommandée :** Supprimer les valeurs par défaut et faire échouer explicitement le démarrage si les variables sont absentes, ou remplacer `changeme` par une valeur impossible à deviner.

```yaml
POSTGRES_PASSWORD=${POSTGRES_PASSWORD:?POSTGRES_PASSWORD doit être défini}
command: redis-server --requirepass ${REDIS_PASSWORD:?REDIS_PASSWORD doit être défini}
```

---

### 🟡 MOYENNE — Absence de rate limiting sur les endpoints métier (feed, micro-pronos)

**Fichiers :** `app/routes/feed.server.ts`, `app/routes/api.micro-predictions.ts`, `app/routes/soiree.server.ts`

**Description :**
Le rate limiting (`checkRateLimit`) est correctement implémenté sur les routes d'authentification (`api.auth.$.ts`), mais il est absent des actions utilisateur : création de posts, commentaires, réactions, soumission de micro-pronostics. Un utilisateur malveillant peut créer des centaines de posts/commentaires ou spammer des réponses à des micro-pronos en quelques secondes.

**Correction recommandée :** Appliquer un rate limit par userId ou IP sur chaque action d'écriture :
```ts
await checkRateLimit({
  key: `feed-post:${session.user.id}`,
  maxAttempts: 10,
  windowSeconds: 60,
});
```

---

### 🟡 MOYENNE — Absence de validation de longueur sur le champ `answer` des micro-pronostics

**Fichier :** `app/routes/api.micro-predictions.ts` (ligne ~84)

**Description :**
L'intent `"answer"` accepte n'importe quelle valeur pour le champ `answer` sans limitation de longueur. Un attaquant peut stocker des chaînes très longues (plusieurs Mo) pour saturer la base de données.

**Code concerné :**
```ts
const answer = formData.get("answer") as string;
if (!microId || !answer) { ... }
// Aucune validation de longueur
```

**Correction recommandée :**
```ts
if (!answer || answer.length > 200) {
  return Response.json({ error: "Réponse invalide" }, { status: 400 });
}
```

---

### 🟢 FAIBLE — Absence d'en-têtes de sécurité HTTP (CSP, HSTS, etc.)

**Fichiers :** Non observés dans le code source (vite.config.ts, root.tsx, Dockerfile)

**Description :**
Aucun en-tête de sécurité HTTP (`Content-Security-Policy`, `X-Frame-Options`, `Strict-Transport-Security`, `X-Content-Type-Options`) n'est configuré. Ces en-têtes renforcent la protection contre le clickjacking, le MIME-sniffing et les injections cross-site.

**Correction recommandée :** Ajouter un middleware dans `app/root.tsx` ou configurer le reverse proxy Nginx/Caddy sur le NAS.

---

## Points positifs (conformité respectée)

| Domaine | Statut |
|---------|--------|
| Secrets hors du dépôt (`.gitignore` couvre `.env`) | ✅ |
| Authentification requise sur toutes les routes protégées | ✅ |
| Vérification du rôle `admin` sur toutes les actions admin | ✅ |
| Mots de passe gérés par Better Auth (non stockés en clair) | ✅ |
| Requêtes SQL paramétrées via Drizzle ORM (pas d'injection SQL) | ✅ |
| Validation Zod sur les entrées utilisateur (posts, matchs, commentaires) | ✅ |
| Upload d'avatar : type MIME, taille max 2 Mo, conversion WebP via Sharp | ✅ |
| Rate limiting actif sur login/register | ✅ |
| Pas de `dangerouslySetInnerHTML` dans les composants React | ✅ |
| Protection CSRF via Better Auth (cookies HttpOnly) | ✅ |

---

## Recommandations prioritaires

1. **[IMMÉDIAT]** Corriger la traversée de chemin dans `uploads-files.ts` — risque de fuite de fichiers système.
2. **[COURT TERME]** Supprimer les mots de passe par défaut dans `docker-compose.prod.yml`.
3. **[MOYEN TERME]** Ajouter du rate limiting sur les actions du feed et des micro-pronos.
4. **[MOYEN TERME]** Valider la longueur de `answer` dans `api.micro-predictions.ts`.
5. **[LONG TERME]** Configurer les en-têtes HTTP de sécurité au niveau du reverse proxy ou de l'application.
