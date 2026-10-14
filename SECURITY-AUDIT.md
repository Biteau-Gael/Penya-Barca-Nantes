# Audit de sécurité — Penya Blaugrana Nantes

**Dépôt** : biteau-gael/penya-barca-nantes  
**Commit analysé** : 003facad  
**Date** : 14 octobre 2026  
**Score** : 1 Critique · 3 Moyen · 3 Faible · 7 Bonnes pratiques

---

## Résumé des derniers commits

| Commit | Message | Type |
|--------|---------|------|
| `003facad` | fix: évaluer les badges immédiatement après chaque action | fix |
| `b1c88f67` | feat: Phase 2 — soirée match live, micro-pronos, badges, séries, saisons | feat |
| `d461ee53` | Merge branch deploy-synology-nas | deploy |
| `6aebaf76` | Fix Better Auth trusted origins pour le domaine personnalisé | fix |
| `9823bc58` | Add service migrate dans docker-compose.prod.yml | deploy |
| `aed5841b` | security: supprimer credentials du repo, renforcer .gitignore | security |
| `ab7fc5d1` | feat: intégration API Football + stats enrichies + classement Liga | feat |
| `16c43e66` | feat: MVP Phase 1 — Penya Blaugrana Nantes | feat |

---

## 🔴 CRITIQUE — action immédiate requise

### C-01 · Path Traversal sur le serveur de fichiers statiques

**Fichier** : `app/routes/uploads-files.ts` · ligne 4  

La route `/uploads/*` construit le chemin du fichier directement depuis `params["*"]` sans vérifier que le chemin résolu reste dans le répertoire `uploads/`. `path.join` normalise les segments `..`, ce qui permet à un attaquant de remonter l'arborescence.

**Exemple d'exploitation** : `GET /uploads/../../.env` retourne le fichier `.env` contenant `AUTH_SECRET`, `DATABASE_URL` et `API_FOOTBALL_KEY`.

```ts
// Vulnérable
const filePath = path.join(process.cwd(), "uploads", params["*"]);
```

**Correction recommandée** :

```ts
const uploadsDir = path.resolve(process.cwd(), "uploads");
const filePath   = path.resolve(uploadsDir, params["*"]);

if (!filePath.startsWith(uploadsDir + path.sep)) {
  return new Response("Forbidden", { status: 403 });
}
```

---

## 🟠 MOYEN — à corriger prochainement

### M-01 · Ports base de données exposés sans authentification (environnement dev)

**Fichier** : `docker-compose.yml` · lignes 20, 27  

PostgreSQL est exposé sur `0.0.0.0:5432` et Redis sur `0.0.0.0:6379` depuis l'hôte. Redis n'a **pas de mot de passe** dans cette configuration. Tout processus ou utilisateur du réseau local peut s'y connecter directement.

**Correction** : Limiter les ports à `127.0.0.1:5432:5432` et `127.0.0.1:6379:6379`. Ajouter `--requirepass ${REDIS_PASSWORD}` à Redis même en dev.

---

### M-02 · Mot de passe par défaut `changeme` en production

**Fichier** : `docker-compose.prod.yml` · lignes 15, 22  

Les variables `POSTGRES_PASSWORD` et `REDIS_PASSWORD` ont `changeme` comme valeur de repli. Si le fichier `.env` est absent, les services démarrent avec un mot de passe connu.

**Correction** : Supprimer le repli `:-changeme` pour forcer une erreur explicite :
```yaml
POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?La variable POSTGRES_PASSWORD est requise}
```

---

### M-03 · Suppression de compte sans vérification du mot de passe

**Fichier** : `app/routes/profile.server.ts` · ligne 62  

L'action `delete-account` supprime le compte immédiatement, sans confirmer l'identité. En cas de vol de session, un tiers peut supprimer définitivement le compte.

**Correction** : Exiger la ressaisie du mot de passe via `auth.api.verifyPassword` avant suppression. Envisager une période de grâce de 24 h avec email de confirmation.

---

## 🟡 FAIBLE — amélioration recommandée

### F-01 · Absence de headers de sécurité HTTP

**Concerne** : Configuration serveur / nginx  

Aucun header de sécurité n'est configuré : pas de CSP, ni de `X-Frame-Options`, `X-Content-Type-Options`, `Strict-Transport-Security` ni `Referrer-Policy`.

**Correction** : Ajouter via Nginx ou un middleware React Router au minimum :
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Strict-Transport-Security: max-age=31536000` (prod uniquement)

---

### F-02 · `trustedOrigins` vide si `APP_URL` non configuré

**Fichier** : `app/lib/server/auth.server.ts` · ligne 11  

Si `APP_URL` n'est pas définie, `trustedOrigins` reçoit `[]`. Selon la version de Better Auth, cela peut affaiblir la protection CSRF.

**Correction** : Forcer `APP_URL` comme variable requise ou fournir `http://localhost:3000` comme défaut explicite.

---

### F-03 · Contournement du typage TypeScript pour les rôles

**Fichiers** : `feed.server.ts`, `soiree.server.ts`, autres  

Le pattern `(session.user as any).role` est utilisé pour accéder au rôle, contournant le compilateur. Une refactorisation du modèle peut passer inaperçue.

**Correction** : Étendre le type `Session` de Better Auth pour inclure `role`, ou créer un helper `getUserRole(session): Role` typé.

---

## ✅ Bonnes pratiques identifiées

- **Rate limiting** sur login (10 requêtes/15 min) et inscription (5/h) via Redis
- **`requireAuth()`** systématiquement appliqué sur toutes les routes admin et protégées
- **Validation Zod** sur tous les formulaires (posts, commentaires, profil)
- **Secrets en variables d'environnement** — aucune clé en dur dans le code
- **`.env` et `.claude/` exclus** du dépôt via `.gitignore`
- **Traitement des avatars** avec `sharp` : resize 256×256, conversion WebP, rejet des non-images
- **Journalisation structurée** des actions sensibles (connexion, suppression, upload, sync)
