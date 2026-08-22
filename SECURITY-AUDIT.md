# Audit de Sécurité — Penya Blaugrana Nantes
**Date :** 22 août 2026  
**Branche analysée :** `main` (dernier commit : `003faca`)  
**Périmètre :** Application React Router v7 + Drizzle ORM + Better Auth + Redis

---

## Résumé des Derniers Commits

| Hash | Date | Description |
|------|------|-------------|
| `003faca` | 2026-04-13 | fix: évaluer les badges immédiatement après chaque action |
| `b1c88f6` | 2026-04-13 | feat: Phase 2 — soirée match live, micro-pronos, badges, séries, saisons |
| `d461ee5` | 2026-04-12 | Merge branch deploy Synology NAS |
| `554b873` | 2026-04-12 | Add deployment guide for Synology NAS updates |
| `68e22d2` | 2026-04-13 | feat: menu burger mobile pour la navigation |
| `6aebaf7` | 2026-04-12 | Fix Better Auth trusted origins for custom domain support |
| `9823bc5` | 2026-04-12 | Add migrate service to docker-compose.prod.yml |
| `8d6e5e9` | 2026-04-12 | Add production Docker Compose and backup script |

---

## Analyse de Sécurité par Ordre de Criticité

---

### 🔴 CRITIQUE — Path Traversal dans le serveur de fichiers uploadés

**Fichier :** `app/routes/uploads-files.ts`  
**Ligne :** 5–6

**Description :**  
Le paramètre de route wildcard `params["*"]` est passé directement à `path.join()` sans aucune validation ni sanitisation. Un attaquant peut construire une URL telle que `/uploads/../../.env` ou `/uploads/../../etc/passwd` pour lire des fichiers arbitraires accessibles au processus serveur.

**Preuve :**
```
path.join('/app', 'uploads', '../../etc/passwd')
// → '/etc/passwd'  ✗ Lecture de fichier système possible
```

**Code vulnérable :**
```ts
const filePath = path.join(process.cwd(), "uploads", params["*"]);
// ↑ Aucune vérification que filePath reste dans le dossier uploads/
```

**Correction recommandée :**
```ts
const uploadsDir = path.join(process.cwd(), "uploads");
const filePath = path.resolve(uploadsDir, params["*"]);

// Bloquer toute sortie du répertoire autorisé
if (!filePath.startsWith(uploadsDir + path.sep) && filePath !== uploadsDir) {
  return new Response("Forbidden", { status: 403 });
}
```

---

### 🟠 ÉLEVÉ — Contournement du Rate Limiting par usurpation d'IP

**Fichier :** `app/routes/api.auth.$.ts`  
**Lignes :** 5–11

**Description :**  
La fonction `getClientIp()` lit le header `x-forwarded-for` directement depuis la requête entrante. Si le reverse proxy (Nginx, Caddy…) ne force pas et ne surécrit pas ce header, un attaquant peut le forger pour contourner le rate limiting login/register en changeant d'IP fictive à chaque tentative.

**Code vulnérable :**
```ts
function getClientIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}
```

**Correction recommandée :**  
Configurer le reverse proxy pour **supprimer le header `x-forwarded-for` entrant** et définir uniquement celui provenant du proxy. Exemple Nginx :
```nginx
proxy_set_header X-Forwarded-For $remote_addr;
# OU (pour conserver la chaîne de proxies de confiance) :
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
```

---

### 🟡 MOYEN — Absence d'En-têtes de Sécurité HTTP

**Fichier :** Aucun fichier de middleware HTTP détecté  
**Fichier concerné :** `vite.config.ts`, `react-router.config.ts`

**Description :**  
Aucun en-tête de sécurité HTTP n'est configuré côté serveur. L'absence de ces en-têtes expose l'application à :

| En-tête manquant | Risque |
|-----------------|--------|
| `Content-Security-Policy` | XSS si du contenu tiers est injecté |
| `X-Frame-Options` ou `frame-ancestors` | Clickjacking |
| `X-Content-Type-Options: nosniff` | MIME sniffing |
| `Strict-Transport-Security` | Downgrade HTTPS → HTTP |
| `Referrer-Policy` | Fuite d'URL dans les logs tiers |

**Correction recommandée :**  
Ajouter un middleware React Router qui injecte ces en-têtes sur toutes les réponses :
```ts
// app/middleware/security-headers.ts
export function securityHeaders(response: Response): Response {
  const headers = response.headers;
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  return response;
}
```

---

### 🟡 MOYEN — Validation MIME type contrôlée par le client (uploads)

**Fichier :** `app/lib/server/upload.ts`  
**Lignes :** 9–11

**Description :**  
La validation du type de fichier repose sur `file.type`, une valeur fournie par le navigateur et donc non fiable. Un attaquant pourrait soumettre un fichier malveillant avec un MIME type déclaré valide.

**Risque mitigé :** La bibliothèque `sharp` échoue et lève une exception si le buffer n'est pas une image valide, ce qui empêche le stockage de fichiers non-images. Le risque réel est donc faible mais la pratique reste incorrecte.

**Correction recommandée :**  
Utiliser une détection de MIME basée sur les "magic bytes" du fichier :
```ts
import { fileTypeFromBuffer } from "file-type";

const buffer = Buffer.from(await file.arrayBuffer());
const detected = await fileTypeFromBuffer(buffer);
if (!detected || !ALLOWED_TYPES.includes(detected.mime)) {
  throw new Error("Format non supporté détecté côté serveur.");
}
```

---

### 🟢 BAS — Type `as any` sur le rôle utilisateur dans `feed.server.ts`

**Fichier :** `app/routes/feed.server.ts`  
**Lignes :** 99, 124, 184, 200

**Description :**  
Le rôle est accédé via un cast `(session.user as any).role`, ce qui contourne la vérification de type TypeScript. Ce n'est pas une vulnérabilité directe (le contrôle reste effectif à l'exécution), mais cela affaiblit les garanties de sécurité statique.

**Code actuel :**
```ts
if (isAnnouncement && (session.user as any).role !== "admin") {
```

**Correction recommandée :**  
Typer correctement le modèle `session.user` pour inclure `role` ou utiliser `requireAuth(request, ["admin"])`.

---

### 🟢 BAS — Requêtes N+1 sur le feed (risque DoS applicatif)

**Fichier :** `app/routes/feed.server.ts`  
**Lignes :** 45–85

**Description :**  
Pour chaque post (jusqu'à 50), 3 requêtes SQL supplémentaires sont exécutées (count réactions, commentaires, réaction utilisateur), soit jusqu'à 150 requêtes par chargement de page. Sous charge ou avec de nombreux posts, cela peut saturer la base de données.

**Correction recommandée :**  
Consolider via des sous-requêtes ou des `JOIN` agrégés dans une seule requête SQL.

---

## Bonnes Pratiques Constatées ✅

| Pratique | Statut |
|----------|--------|
| Credentials absents du dépôt (commit `aed5841`) | ✅ Corrigé |
| `.env` correctement dans `.gitignore` | ✅ OK |
| Rate limiting login (10/15min) et register (5/h) | ✅ Implémenté |
| `requireAuth` appliqué sur toutes les routes serveur | ✅ Systématique |
| Vérification du rôle admin sur les actions d'administration | ✅ OK |
| ORM Drizzle avec requêtes paramétrées (pas d'interpolation SQL) | ✅ OK |
| Validation des entrées avec Zod | ✅ OK |
| Journalisation des actions admin (audit log) | ✅ OK |
| Sharp re-encode les images (suppression EXIF, redimensionnement) | ✅ OK |
| Protection self-delete / self-role-change pour les admins | ✅ OK |
| `.env.example` sans secrets réels | ✅ OK |

---

## Tableau de Synthèse

| # | Criticité | Fichier | Vulnérabilité | Effort Correction |
|---|-----------|---------|---------------|-------------------|
| 1 | 🔴 Critique | `app/routes/uploads-files.ts` | Path Traversal — lecture de fichiers arbitraires | Faible (5 lignes) |
| 2 | 🟠 Élevé | `app/routes/api.auth.$.ts` | Contournement rate limiting par IP forgée | Moyen (config Nginx) |
| 3 | 🟡 Moyen | Non configuré | Absence d'en-têtes de sécurité HTTP | Faible (middleware) |
| 4 | 🟡 Moyen | `app/lib/server/upload.ts` | MIME type contrôlé par le client | Faible (1 package) |
| 5 | 🟢 Bas | `app/routes/feed.server.ts` | Cast `as any` sur le rôle | Très faible |
| 6 | 🟢 Bas | `app/routes/feed.server.ts` | Requêtes N+1 (risque DoS applicatif) | Moyen (refactoring SQL) |

---

*Rapport généré automatiquement le 22 août 2026 — Branche `claude/sharp-fermi-2hhoya`*
