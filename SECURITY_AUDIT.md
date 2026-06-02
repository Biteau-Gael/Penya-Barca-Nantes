# Audit de Sécurité — Penya Blaugrana Nantes

**Date** : 02 juin 2026  
**Périmètre** : Commits `fec3e63` → `003faca` (Phase 1 + Phase 2 complètes)  
**Branche analysée** : `claude/sharp-fermi-hSsnB`

---

## Résumé des derniers commits

| Commit | Description |
|--------|-------------|
| `003faca` | fix: évaluation immédiate des badges après chaque action (pronostic, post, commentaire, réaction) |
| `b1c88f6` | feat: Phase 2 — soirée match live, micro-pronos, badges, séries, saisons (Sprint 2–5) |
| `d461ee5` | Merge branch deploy Synology NAS |
| `554b873` | docs: guide de déploiement NAS Synology |
| `68e22d2` | feat: menu burger mobile pour la navigation |
| `6aebaf7` | fix: Better Auth trusted origins pour le support domaine custom |
| `9823bc5` | Add service migrate dans docker-compose.prod.yml |
| `8d6e5e9` | feat: Docker Compose production + script de backup Synology NAS |
| `3d80133` | docs: roadmap Phase 2 |
| `aed5841` | security: suppression des credentials du repo + renforcement .gitignore |
| `6583da3` | docs: README complet avec guide déploiement |
| `ab7fc5d` | feat: intégration API Football + stats enrichies + classement Liga |
| `fec3e63` | feat: MVP Phase 1 — Penya Blaugrana Nantes |

---

## Analyse de Sécurité — par ordre de criticité

---

### CRITIQUE

#### 1. Path Traversal / Local File Inclusion (LFI)

**Fichier** : `app/routes/uploads-files.ts:5`  
**Statut** : **CORRIGÉ** dans ce commit

```typescript
// VULNÉRABLE (avant)
const filePath = path.join(process.cwd(), "uploads", params["*"]);

// CORRIGÉ (après)
const uploadRoot = path.resolve(process.cwd(), "uploads");
const filePath = path.resolve(uploadRoot, params["*"]);
if (!filePath.startsWith(uploadRoot + path.sep) && filePath !== uploadRoot) {
  return new Response("Not found", { status: 404 });
}
```

**Risque** : Un attaquant pouvait accéder à n'importe quel fichier du système en forgeant une URL contenant des séquences `../`. Exemples d'exploits :
- `GET /uploads/../../.env` → récupération de `DATABASE_URL`, `AUTH_SECRET`, `API_FOOTBALL_KEY`
- `GET /uploads/../../../etc/passwd` → lecture des utilisateurs système

`path.join()` normalise les chemins mais ne contraint pas la sortie dans le répertoire de base. Seul `path.resolve()` combiné à une vérification `startsWith` offre la protection correcte.

---

### HAUTE

#### 2. Mots de passe par défaut en production

**Fichier** : `docker-compose.prod.yml`  
**Statut** : À corriger manuellement (variable d'environnement)

```yaml
POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-changeme}  # fallback "changeme"
REDIS_PASSWORD:    ${REDIS_PASSWORD:-changeme}      # fallback "changeme"
```

**Risque** : Si le fichier `.env` est absent ou incomplet lors du déploiement, Postgres et Redis démarrent avec le mot de passe `changeme`, exposant la base de données et le cache sur le réseau local du NAS.

**Recommandation** : Supprimer les valeurs par défaut pour forcer l'échec explicite plutôt que de silencieusement accepter des credentials faibles :
```yaml
POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?POSTGRES_PASSWORD est obligatoire}
```

---

#### 3. Rate limiting contournable par IP forgée

**Fichier** : `app/routes/api.auth.$.ts:7`  
**Statut** : À monitorer selon infrastructure

```typescript
request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
request.headers.get("x-real-ip") ||
"unknown"
```

**Risque** : Si l'application est exposée directement (sans reverse proxy Nginx/Traefik), un attaquant peut forger l'en-tête `X-Forwarded-For` avec une IP arbitraire pour contourner le rate limiting sur `/sign-in` et `/sign-up`. L'IP `"unknown"` regroupe tous les clients sans IP identifiable sous la même clé Redis, permettant un verrouillage croisé (DoS logique).

**Recommandation** : S'assurer que l'application est toujours derrière un reverse proxy qui écrase ce header, ou utiliser une bibliothèque de parsing multi-proxy fiable.

---

### MOYENNE

#### 4. Absence d'en-têtes de sécurité HTTP

**Fichier** : `app/root.tsx` (aucun header défini)  
**Statut** : Non implémenté

Aucun des en-têtes de sécurité suivants n'est configuré :

| En-tête | Risque si absent |
|---------|-----------------|
| `Content-Security-Policy` | XSS via injection de scripts |
| `X-Frame-Options` | Clickjacking |
| `X-Content-Type-Options: nosniff` | MIME sniffing |
| `Strict-Transport-Security` | Downgrade HTTPS→HTTP |
| `Referrer-Policy` | Fuite d'URL dans les logs tiers |

**Recommandation** : Ajouter un middleware React Router (`headers()` export) ou configurer Nginx avec ces en-têtes.

---

#### 5. Rate limiting absent sur les endpoints applicatifs

**Fichier** : `app/routes/api.micro-predictions.ts`, `app/routes/feed.server.ts`  
**Statut** : Non implémenté (seul `/api/auth/$` est protégé)

Un utilisateur authentifié peut spammer sans limite :
- La création de réponses aux micro-pronostics
- La publication de posts et commentaires dans le fil
- Les réactions

**Recommandation** : Appliquer `checkRateLimit` sur les actions sensibles (ex. : 20 posts/heure par utilisateur).

---

#### 6. Exposition de messages d'erreur internes

**Fichier** : `app/routes/api.sync-matches.ts`  
**Statut** : Faible risque (endpoint admin uniquement)

```typescript
const message = error instanceof Error ? error.message : "Erreur inconnue";
return Response.json({ error: message }, { status: 500 });
```

Les messages d'erreur d'exception (qui peuvent contenir des chemins, noms de tables, credentials partiels) sont retournés directement au client admin.

**Recommandation** : Logger l'erreur complète côté serveur, retourner un message générique au client.

---

#### 7. Cast `any` sur la vérification de rôle

**Fichier** : `app/routes/feed.server.ts`  
**Statut** : Code smell / fragilité

```typescript
const isAdmin = (session.user as any).role === "admin";
```

Contourne le système de types TypeScript pour vérifier les autorisations. Un changement de structure dans Better Auth pourrait rendre cette vérification silencieusement fausse.

**Recommandation** : Utiliser `requireAuth(request, ["admin"])` ou typer correctement `session.user`.

---

#### 8. SQL brut non idiomatique dans badges.server.ts

**Fichier** : `app/lib/server/badges.server.ts:141-142`  
**Statut** : Actuellement sûr (userId paramétré), mais fragile

```typescript
.from(sql`"user"`)
.where(sql`id = ${userId}`);
```

Utilisation de `sql` template brut à la place du schéma Drizzle importé. L'interpolation `${userId}` est bien paramétrisée par Drizzle mais l'approche est peu maintenable et pourrait être copiée incorrectement.

**Recommandation** : Remplacer par `.from(user).where(eq(user.id, userId))` en important le schéma `user`.

---

### FAIBLE

#### 9. URL highlight provenant d'une API tierce

**Fichier** : `app/routes/match-detail.tsx:314`  
**Statut** : Mitigé (pas de rendu iframe)

```tsx
<a href={matchDetails.highlightUrl} target="_blank" rel="noopener noreferrer">
```

L'URL provient de l'API RapidAPI sans validation de domaine. L'utilisation de `rel="noopener noreferrer"` mitigue les risques d'exploitation via `window.opener`. Il n'y a pas de rendu en `<iframe>`, donc le risque est faible.

**Recommandation** : Ajouter une validation que l'URL commence par `https://` avant de la retourner au frontend.

---

#### 10. Erreurs `evaluateBadges` silencieusement ignorées

**Fichier** : `app/routes/feed.server.ts`, `app/routes/match-detail.server.ts`  
**Statut** : Fonctionnel mais opaque

```typescript
evaluateBadges(session.user.id).catch(() => {});
```

Les erreurs lors de l'évaluation des badges sont swallowées sans aucun logging, rendant les pannes invisibles dans les logs.

**Recommandation** : `evaluateBadges(session.user.id).catch((err) => logger.error({ err, userId }, "Erreur évaluation badges"));`

---

## Points positifs

- **Authentification** : Better Auth correctement configuré avec `requireAuth()` systématique sur les routes protégées
- **Validation des entrées** : Zod utilisé sur toutes les actions (pronostics, posts, pseudo, matchs)
- **ORM paramétré** : Drizzle ORM utilisé partout → pas d'injection SQL directe
- **Upload sécurisé** : Sharp retraite les images, vérification du type MIME et de la taille
- **Secrets hors repo** : `.env` dans `.gitignore`, credentials supprimés (commit `aed5841`)
- **Rate limiting auth** : Login limité à 10 tentatives/15 min, inscription à 5/heure
- **Contrôle d'ownership** : Vérification `authorId === session.user.id` avant suppression de posts/commentaires
- **Autorisation admin** : `requireAuth(request, ["admin"])` sur toutes les routes d'administration

---

## Récapitulatif des actions requises

| Priorité | Action | Fichier |
|----------|--------|---------|
| ✅ FAIT | Corriger le path traversal LFI | `uploads-files.ts` |
| 🔴 URGENT | Supprimer les mots de passe par défaut Docker | `docker-compose.prod.yml` |
| 🟠 HAUTE | Valider la confiance sur X-Forwarded-For | `api.auth.$.ts` |
| 🟡 MOYENNE | Ajouter en-têtes de sécurité HTTP | `root.tsx` ou Nginx |
| 🟡 MOYENNE | Rate limiting sur endpoints applicatifs | `api.micro-predictions.ts`, `feed.server.ts` |
| 🟡 MOYENNE | Messages d'erreur génériques côté client | `api.sync-matches.ts` |
| 🟡 MOYENNE | Supprimer le cast `any` sur le rôle | `feed.server.ts` |
| 🟡 MOYENNE | Remplacer SQL brut par schéma Drizzle | `badges.server.ts` |
| 🟢 FAIBLE | Valider le domaine des URLs highlight | `api-football.server.ts` |
| 🟢 FAIBLE | Logger les erreurs `evaluateBadges` | `feed.server.ts`, `match-detail.server.ts` |
