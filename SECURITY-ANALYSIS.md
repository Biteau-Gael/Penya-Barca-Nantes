# Rapport d'analyse de sécurité — Penya Blaugrana Nantes

**Date d'analyse :** 2026-07-18  
**Branche analysée :** `main` (HEAD: `003faca`)  
**Périmètre :** Revue des 8 derniers commits + audit des conventions de sécurité

---

## Résumé des derniers commits

| Hash | Type | Description |
|------|------|-------------|
| `003faca` | fix | Évaluation des badges immédiatement après chaque action utilisateur |
| `b1c88f6` | feat | Phase 2 — soirée match live, micro-pronos, badges, séries, saisons |
| `d461ee5` | merge | Fusion branche déploiement Synology NAS |
| `554b873` | docs | Guide de déploiement NAS Synology |
| `68e22d2` | feat | Menu burger mobile pour la navigation |
| `6aebaf7` | fix | Correction des origines de confiance Better Auth pour domaine custom |
| `9823bc5` | feat | Service de migration dans docker-compose.prod.yml |
| `aed5841` | **security** | Suppression credentials du repo et renforcement .gitignore |

---

## Analyse de sécurité par ordre de criticité

---

### 🔴 CRITIQUE

#### 1. Path Traversal dans la route `/uploads/*`

**Fichier :** `app/routes/uploads-files.ts:5`  
**Type :** Directory Traversal (CWE-22)

```typescript
// Code actuel — VULNÉRABLE
const filePath = path.join(process.cwd(), "uploads", params["*"]);
```

**Scénario d'attaque :** Un attaquant peut requêter `/uploads/../etc/passwd` ou `/uploads/../../app/config/env.server.ts`. Node.js résout `path.join` sans vérifier que le chemin final reste dans `uploads/`, permettant la lecture de n'importe quel fichier accessible par le processus.

**Vérification :**
```
path.join("/app/uploads", "../../etc/passwd") → "/app/etc/passwd"  ✗ Hors du répertoire uploads
```

**Correction à appliquer :**
```typescript
export async function loader({ params }: { params: { "*": string } }) {
  const uploadDir = path.join(process.cwd(), "uploads");
  const filePath = path.resolve(uploadDir, params["*"]);

  // Protection contre le path traversal
  if (!filePath.startsWith(uploadDir + path.sep)) {
    return new Response("Forbidden", { status: 403 });
  }
  // ... reste du code
}
```

---

#### 2. Credentials en clair dans l'historique Git

**Commit :** `fec3e63` → supprimé dans `aed5841`  
**Type :** Secret Exposure (CWE-312)

Les credentials suivants sont encore lisibles dans l'historique git via `git show aed5841^` :
- **Mot de passe PostgreSQL :** `penya_secret` (dans `docker-compose.yml` et `settings.local.json`)
- **AUTH_SECRET :** `dev-secret-change-me-min-16` (dans `settings.local.json`)

**Risque :** Toute personne ayant accès au dépôt peut extraire ces credentials. Si `penya_secret` est le mot de passe de production, la base de données est compromise.

**Actions requises :**
1. Vérifier que ces credentials ne sont PAS utilisés en production.
2. Si oui, changer immédiatement les mots de passe PostgreSQL et Redis, et regénérer `AUTH_SECRET`.
3. Pour supprimer de l'historique : `git filter-branch` ou `git-filter-repo` (opération destructive, nécessite coordination de l'équipe).

---

### 🟠 HAUTE

#### 3. URL externe non validée exposée aux utilisateurs

**Fichier :** `app/routes/match-detail.tsx:314`  
**Type :** Open Redirect / Potential XSS (CWE-601)

```tsx
<a href={matchDetails.highlightUrl} target="_blank" rel="noopener noreferrer">
```

`highlightUrl` provient directement de l'API externe (RapidAPI). Si l'API retourne une URL `javascript:alert(1)`, cela produit du XSS. L'attribut `rel="noopener noreferrer"` protège contre le `window.opener`, mais pas contre les URLs malveillantes.

**Correction :**
```typescript
// Dans api-football.server.ts, valider l'URL avant de la retourner
function sanitizeUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}
```

---

#### 4. Endpoint `/api/health` public — exposition de l'infrastructure

**Fichier :** `app/routes/api.health.ts`  
**Type :** Information Disclosure (CWE-200)

Le endpoint de santé est accessible sans authentification et révèle :
- L'état de connexion à PostgreSQL
- L'état de connexion à Redis

Ces informations permettent à un attaquant de cartographier l'infrastructure avant une attaque.

**Correction :** Restreindre à un IP de confiance (réseau interne du NAS) ou ajouter un header secret :
```typescript
// Option simple : vérifier un token de monitoring
const monitorToken = request.headers.get("x-monitor-token");
if (monitorToken !== process.env.MONITOR_TOKEN) {
  return new Response("Forbidden", { status: 403 });
}
```

---

### 🟡 MOYEN

#### 5. Mot de passe par défaut dans docker-compose.prod.yml

**Fichier :** `docker-compose.prod.yml:22`  
**Type :** Weak Default Credentials (CWE-1392)

```yaml
POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-changeme}
```

Si la variable d'environnement `POSTGRES_PASSWORD` n'est pas définie lors du déploiement, PostgreSQL démarrera avec le mot de passe `changeme`.

**Correction :** Supprimer la valeur par défaut pour forcer une erreur si la variable n'est pas définie :
```yaml
POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?POSTGRES_PASSWORD must be set}
```

---

#### 6. Rate limiting basé sur `x-forwarded-for` sans validation Nginx

**Fichier :** `app/routes/api.auth.$.ts:7-9`  
**Type :** Rate Limit Bypass (CWE-307)

```typescript
request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
```

Si Nginx ne force pas l'en-tête `x-forwarded-for` et que le serveur est directement accessible, un attaquant peut passer `X-Forwarded-For: 1.2.3.4` dans sa requête pour contourner le rate limiting.

**Vérification requise :** S'assurer que la configuration Nginx inclut :
```nginx
# Supprimer les headers X-Forwarded-For du client, puis forcer avec l'IP réelle
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
```

---

#### 7. Ports de base de données exposés dans l'historique (docker-compose initial)

**Commit :** `fec3e63` (docker-compose initial)  
**Type :** Network Exposure (CWE-1244)

Le `docker-compose.yml` original exposait les ports `5432` (PostgreSQL) et `6379` (Redis) sur l'interface hôte. Si ce fichier a été déployé avant la correction, vérifier que les ports ne sont plus accessibles depuis l'extérieur du réseau du NAS.

**Vérification :** `docker compose ps` sur le NAS pour confirmer que les ports DB ne sont plus exposés.

---

### 🟢 FAIBLE

#### 8. Absence de headers de sécurité HTTP

**Aucun header de sécurité** n'est configuré au niveau applicatif :
- `Content-Security-Policy` (CSP)
- `Strict-Transport-Security` (HSTS)
- `X-Content-Type-Options`
- `X-Frame-Options`

Ces protections doivent être configurées dans Nginx (recommandé) ou dans le serveur React Router.

**Configuration Nginx recommandée :**
```nginx
add_header X-Content-Type-Options "nosniff" always;
add_header X-Frame-Options "DENY" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
```

---

#### 9. MIME type déterminé uniquement par extension de fichier

**Fichier :** `app/routes/uploads-files.ts:10-19`  
**Type :** MIME Confusion (CWE-430)

Le Content-Type est déterminé uniquement par l'extension du fichier, non par son contenu réel. En combinaison avec la vulnérabilité #1 (corrigée), ceci n'est plus exploitable, mais reste une pratique à risque.

---

## Points positifs identifiés

| Aspect | Statut |
|--------|--------|
| ORM Drizzle — pas de SQL brut injecté côté utilisateur | ✅ |
| Rate limiting sur login/register | ✅ |
| `requireAuth()` systématique sur toutes les routes protégées | ✅ |
| Vérification de rôle admin côté serveur (pas seulement client) | ✅ |
| Validation Zod des entrées utilisateur (posts, commentaires, matchs) | ✅ |
| Credentials retirés du repo (commit `aed5841`) | ✅ |
| `.gitignore` renforcé (`.env`, `.claude/`) | ✅ |
| Traitement des images via Sharp (resize + reformat WebP) | ✅ |
| CUID pour les IDs (pas d'ID séquentiel prévisible) | ✅ |
| Logs structurés sans exposition de données sensibles | ✅ |

---

## Plan d'action recommandé

| Priorité | Action | Effort |
|----------|--------|--------|
| 🔴 Immédiat | Corriger le path traversal dans `uploads-files.ts` | 15 min |
| 🔴 Immédiat | Vérifier et changer les credentials de prod si `penya_secret` est utilisé | 30 min |
| 🟠 Court terme | Valider les URLs externes avant de les exposer aux clients | 30 min |
| 🟠 Court terme | Ajouter authentification sur `/api/health` | 20 min |
| 🟡 Moyen terme | Configurer les security headers dans Nginx | 1h |
| 🟡 Moyen terme | Forcer les variables d'env en prod sans valeur par défaut | 15 min |
| 🟢 Long terme | Nettoyer l'historique Git (git-filter-repo) | 2h |
