# Rapport d'analyse de sécurité — Penya Blaugrana Nantes

**Date :** 2026-10-08  
**Scope :** Commits récents (Phase 2 + déploiement NAS)  
**Analyste :** Claude Code (session automatisée)

---

## Résumé des derniers commits

| Hash | Date | Description |
|------|------|-------------|
| `003faca` | 2026-04-13 | fix: évaluer les badges immédiatement après chaque action |
| `b1c88f6` | 2026-04-13 | feat: Phase 2 — soirée match live, micro-pronos, badges, séries, saisons |
| `d461ee5` | 2026-04-12 | Merge branch 'claude/deploy-synology-nas-cLkOL' |
| `554b873` | 2026-04-12 | Add deployment guide for Synology NAS updates |
| `68e22d2` | 2026-04-13 | feat: menu burger mobile pour la navigation |
| `4a65a7b` | 2026-04-12 | Merge pull request #2 — déploiement NAS |
| `6aebaf7` | 2026-04-12 | Fix Better Auth trusted origins for custom domain |
| `9823bc5` | 2026-04-12 | Add migrate service to docker-compose.prod.yml |

### Périmètre des changements Phase 2

La Phase 2 a ajouté ~2 965 lignes de code :
- **Soirée match live** : suivi en temps réel via API Football, score, événements
- **Micro-pronostics** : questions rapides pendant un match, système de points
- **Badges** : 10 badges débloquables selon activité (pronostics, commentaires, réactions, posts)
- **Séries** : suivi des séries de scores exacts (`currentStreak`, `bestStreak`)
- **Saisons** : structure DB pour gérer les saisons de compétition

---

## Analyse de sécurité — Résultats par criticité

---

### 🔴 CRITIQUE — Path Traversal dans le serveur de fichiers uploadés

**Fichier :** `app/routes/uploads-files.ts` (ligne 5)  
**Statut :** ✅ **Corrigé dans ce rapport**

**Description :**  
Le paramètre de route wildcard `params["*"]` était concaténé directement avec `path.join()` sans vérification que le chemin résolu restait dans le répertoire `uploads/`. Un attaquant authentifié pouvait lire des fichiers arbitraires du système :

```
GET /uploads/../../etc/passwd
→ path.join(cwd, "uploads", "../../etc/passwd") = /etc/passwd
```

**Impact :** Lecture de tout fichier accessible au processus Node.js (variables d'environnement, clés privées, configuration base de données).

**Correction appliquée :**
```ts
const uploadDir = path.resolve(process.cwd(), "uploads");
const filePath = path.resolve(uploadDir, params["*"]);
if (!filePath.startsWith(uploadDir + path.sep)) {
  return new Response("Not found", { status: 404 });
}
```

---

### 🟠 ÉLEVÉ — Absence de vérification de délai sur les micro-pronostics

**Fichier :** `app/routes/api.micro-predictions.ts` (intent `answer`, ligne ~75)  
**Statut :** ⚠️ À corriger

**Description :**  
Le champ `deadlineSeconds` est stocké en base lors de la création d'un micro-pronostic, mais n'est **jamais vérifié** lors de la soumission d'une réponse. Seul `closedAt` (clôture manuelle admin) est testé.

Un joueur peut donc répondre à un micro-pronostic longtemps après son expiration naturelle, jusqu'à ce qu'un admin le clôture manuellement.

**Impact :** Manipulation des scores — un joueur peut attendre le résultat et répondre en connaissance de cause après la deadline théorique.

**Correction recommandée :**
```ts
// Vérifier la deadline automatique
const createdAt = new Date(micro.createdAt).getTime();
const deadline = createdAt + (micro.deadlineSeconds * 1000);
if (Date.now() > deadline) {
  return Response.json({ error: "Délai expiré" }, { status: 400 });
}
```

---

### 🟠 ÉLEVÉ — Absence de rate limiting sur les endpoints Phase 2

**Fichiers :** `app/routes/api.micro-predictions.ts`, `app/routes/feed.server.ts`  
**Statut :** ⚠️ À corriger

**Description :**  
L'infrastructure de rate limiting existe (`app/lib/server/rate-limit.server.ts`) et est utilisée sur certains endpoints, mais les nouveaux endpoints de la Phase 2 ne l'appliquent pas :
- Soumission de réponses micro-pronostics : aucune limite
- Création de posts/commentaires : aucune limite
- Réactions : aucune limite

**Impact :** Spam de contenu, surcharge base de données, déclenchement abusif de badges.

**Correction recommandée :** Appliquer `checkRateLimit` sur chaque action :
```ts
await checkRateLimit({
  key: `micro-answer:${session.user.id}`,
  maxAttempts: 10,
  windowSeconds: 60,
});
```

---

### 🟡 MOYEN — En-têtes de sécurité HTTP absents

**Fichier :** Configuration serveur (React Router / Vite)  
**Statut :** ⚠️ À corriger

**Description :**  
Aucun en-tête de sécurité HTTP n'est configuré : pas de `Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, ni `Strict-Transport-Security`.

**Impact :** Exposition accrue aux attaques XSS (si une injection arrive), clickjacking, MIME sniffing.

**Correction recommandée :** Ajouter dans `vite.config.ts` ou un middleware serveur :
```ts
headers: {
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Content-Security-Policy": "default-src 'self'; img-src 'self' data:; ...",
}
```

---

### 🟡 MOYEN — Type non validé sur les micro-pronostics (injection de valeur arbitraire)

**Fichier :** `app/routes/api.micro-predictions.ts` (ligne ~22)  
**Statut :** ⚠️ À corriger

**Description :**  
Le champ `type` du micro-pronostic est accepté directement depuis le formulaire (`formData.get("type") as string`) sans validation par enum. N'importe quelle valeur string peut être persistée en base.

**Impact :** Données corrompues, comportement inattendu côté client si la valeur `type` est utilisée pour conditionner l'affichage.

**Correction recommandée :**
```ts
const VALID_TYPES = ["qcm", "free"] as const;
const type = formData.get("type") as string;
if (!VALID_TYPES.includes(type as any)) {
  return Response.json({ error: "Type invalide" }, { status: 400 });
}
```

---

### 🟢 BAS — Exposition d'adresses email dans l'API admin membres

**Fichier :** `app/routes/admin.members.server.ts`  
**Statut :** ℹ️ Information

**Description :**  
Le loader admin retourne les emails de tous les membres. C'est intentionnel pour l'administration, mais il faut s'assurer que cette route est bien protégée derrière `requireAuth(request, ["admin"])`, ce qui est le cas.

**Observation :** Protection correcte en place — pas d'action requise.

---

## Points positifs identifiés

- ✅ Authentification via Better Auth avec sessions Redis
- ✅ Contrôle d'accès par rôle (`requireAuth(request, ["admin"])`) sur tous les endpoints admin
- ✅ Protection CSRF implicite via Better Auth (vérification d'origine)
- ✅ Validation des entrées via Zod sur les formulaires d'événements et posts
- ✅ Pas de credentials en clair dans le dépôt (`.gitignore` correct, fichier `.env.example` sans secrets)
- ✅ Logs structurés avec pino (sans données sensibles dans les logs)
- ✅ Upload d'avatars : vérification du type MIME, taille maximale, conversion WebP — pas de stockage d'exécutables
- ✅ Protection anti-auto-modification pour les admins (ne peut pas changer son propre rôle)
- ✅ ORM Drizzle utilisé partout → pas d'injection SQL possible par construction

---

## Actions prioritaires

| Priorité | Action | Fichier |
|----------|--------|---------|
| ✅ Fait | Corriger path traversal uploads | `uploads-files.ts` |
| 🔴 Urgent | Vérifier deadline micro-pronostics | `api.micro-predictions.ts` |
| 🟠 Important | Ajouter rate limiting Phase 2 | `api.micro-predictions.ts`, `feed.server.ts` |
| 🟡 Amélioration | Configurer en-têtes HTTP sécurité | `vite.config.ts` |
| 🟡 Amélioration | Valider enum `type` micro-pronostics | `api.micro-predictions.ts` |
