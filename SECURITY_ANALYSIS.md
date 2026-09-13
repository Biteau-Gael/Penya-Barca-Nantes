# Analyse de sécurité — Penya Blaugrana Nantes

**Date :** 2026-09-13  
**Branche analysée :** `main` (commits jusqu'à `003faca`)  
**Auteur de l'analyse :** Claude Code (session automatisée)

---

## Résumé des derniers commits

| SHA | Message | Impact |
|-----|---------|--------|
| `003faca` | fix: évaluer les badges immédiatement après chaque action | Badges déclenchés après pronostic, post, commentaire, réaction |
| `b1c88f6` | feat: Phase 2 — soirée match live, micro-pronos, badges, séries, saisons | Ajout de 26 fichiers (~2 965 lignes) : soirée live, micro-pronostics, badges, séries, saisons |
| `d461ee5` | Merge branch 'claude/deploy-synology-nas-cLkOL' | Intégration du guide de déploiement NAS |
| `554b873` | Add deployment guide for Synology NAS updates | DEPLOY.md : guide de mise à jour et commandes utiles |
| `68e22d2` | feat: menu burger mobile pour la navigation | Navigation mobile améliorée (`header.tsx`) |

---

## Analyse de sécurité par ordre de criticité

### 🔴 CRITIQUE — Aucun

Aucun problème critique identifié.

---

### 🟠 MOYEN — 2 problèmes

#### M1 — Mots de passe par défaut dans `docker-compose.prod.yml`

**Fichier :** `docker-compose.prod.yml`  
**Lignes concernées :**
```yaml
POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-changeme}
redis-server --requirepass ${REDIS_PASSWORD:-changeme}
```

**Risque :** Si les variables d'environnement `POSTGRES_PASSWORD` et `REDIS_PASSWORD` ne sont pas définies dans le fichier `.env` de production, Docker utilisera le mot de passe par défaut `changeme`. Un attaquant ayant accès au réseau interne du NAS pourrait se connecter aux bases de données.

**Recommandation :** Supprimer les valeurs de repli `:-changeme` pour que le conteneur échoue au démarrage si le mot de passe n'est pas configuré, forçant une configuration explicite.

```yaml
# Avant
POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-changeme}
# Après
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
```

---

#### M2 — Absence de validation de longueur sur le champ `answer` des micro-pronostics

**Fichier :** `app/routes/api.micro-predictions.ts` (ligne ~92)  
**Code concerné :**
```ts
const answer = formData.get("answer") as string;
if (!microId || !answer) {
  return Response.json({ error: "Champs manquants" }, { status: 400 });
}
// Pas de vérification de longueur avant insert
await db.insert(microPredictionAnswers).values({ ..., answer });
```

**Risque :** Un utilisateur authentifié peut envoyer une chaîne de caractères arbitrairement longue dans le champ `answer`, saturant la colonne en base ou provoquant des erreurs ORM si la colonne a une contrainte implicite.

**Recommandation :** Ajouter une validation de longueur (ex. 500 caractères max) avec Zod, comme le font déjà `createPostSchema` et `createCommentSchema`.

```ts
const answerSchema = z.string().min(1).max(500);
const parsed = answerSchema.safeParse(answer);
if (!parsed.success) {
  return Response.json({ error: "Réponse invalide" }, { status: 400 });
}
```

---

### 🟡 FAIBLE — 3 points

#### F1 — Rate limiting limité aux endpoints d'authentification

**Fichier :** `app/routes/api.auth.$.ts`

Le rate limiting (10 tentatives/15 min pour le login, 5/heure pour l'inscription) est bien implémenté sur les routes d'authentification. Cependant, les endpoints d'action suivants n'ont pas de limitation :

- `feed.server.ts` : création de posts, commentaires, réactions
- `api.micro-predictions.ts` : soumission de réponses aux micro-pronostics
- `soiree.server.ts` : interactions live pendant les matchs

**Risque :** Un utilisateur authentifié pourrait spammer les endpoints sans blocage, générant du bruit ou saturant la base.

**Recommandation :** Appliquer `checkRateLimit` sur les actions de contenu (ex. 30 posts/heure, 100 commentaires/heure).

---

#### F2 — Cast de type `as any` pour la vérification de rôle

**Fichier :** `app/routes/feed.server.ts` (ligne ~issue création d'annonce)

```ts
if (isAnnouncement && (session.user as any).role !== "admin") {
```

**Risque :** Le cast `as any` contourne la vérification statique TypeScript. Si le type de session évolue, ce contrôle pourrait silencieusement casser sans erreur de compilation.

**Recommandation :** Utiliser la fonction `requireAuth` avec le paramètre `allowedRoles` ou typer correctement la session.

```ts
if (isAnnouncement && session.user.role !== "admin") { // si le type est correct
```

---

#### F3 — SQL brut dans `badges.server.ts` pour accéder à la table `user`

**Fichier :** `app/lib/server/badges.server.ts` (lignes 141-142)

```ts
.from(sql`"user"`)
.where(sql`id = ${userId}`)
```

**Risque :** L'usage de SQL brut pour contourner la résolution du nom de table `user` (mot réservé PostgreSQL) est fonctionnellement sûr ici car `userId` vient de la session serveur. Cependant, cette pratique est fragile : si le pattern est reproduit avec une valeur non sanitisée, cela ouvre une injection SQL.

**Recommandation :** Utiliser la référence Drizzle directe avec la table `user` importée du schéma et la fonction `eq()` plutôt que le SQL brut.

---

### ✅ POINTS POSITIFS

| Domaine | État |
|---------|------|
| Authentification | `requireAuth()` appliqué sur toutes les routes protégées |
| Contrôle d'accès admin | Routes admin vérifient `["admin"]` via `requireAuth` |
| Validation d'entrées | Zod utilisé pour posts et commentaires |
| Protection des secrets | `.env` dans `.gitignore`, credentials supprimés (commit `aed5841`) |
| Upload de fichiers | Vérification MIME, limite 2 Mo, conversion WebP via Sharp |
| Pas de XSS | Aucun `dangerouslySetInnerHTML` ou `innerHTML` détecté |
| ORM sécurisé | Drizzle ORM avec requêtes paramétrées (hors cas F3) |
| Sessions | Better Auth + Redis pour stockage de session |
| Rate limiting auth | 10 tentatives/15 min login, 5/h inscription |
| Logs de sécurité | Logger pino sur toutes les actions sensibles |

---

## Plan d'action suggéré

| Priorité | Action | Effort |
|----------|--------|--------|
| 1 | Supprimer les fallbacks `:-changeme` dans `docker-compose.prod.yml` | 5 min |
| 2 | Ajouter validation Zod sur `answer` dans `api.micro-predictions.ts` | 15 min |
| 3 | Typer correctement la session pour supprimer le `as any` dans `feed.server.ts` | 10 min |
| 4 | Ajouter rate limiting sur les endpoints d'action (posts, commentaires) | 30 min |
| 5 | Refactoriser les requêtes SQL brutes de `badges.server.ts` | 20 min |
