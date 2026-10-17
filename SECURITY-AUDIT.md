# Audit de Sécurité — Penya Blaugrana Nantes
**Date** : 17 octobre 2026  
**Périmètre** : Commits récents (Phase 2 + correctifs)  
**Branche analysée** : `claude/sharp-fermi-1jzflw` / `main`

---

## Résumé des derniers commits

| Commit | Message | Date |
|--------|---------|------|
| `003faca` | fix: évaluer les badges immédiatement après chaque action | 13 avr. 2026 |
| `b1c88f6` | feat: Phase 2 — soirée match live, micro-pronos, badges, séries, saisons | 13 avr. 2026 |
| `d461ee5` | Merge branch deploy-synology-nas | 12 avr. 2026 |
| `554b873` | Add deployment guide for Synology NAS updates | 12 avr. 2026 |
| `68e22d2` | feat: menu burger mobile pour la navigation | 13 avr. 2026 |
| `6aebaf7` | Fix Better Auth trusted origins for custom domain support | 12 avr. 2026 |
| `9823bc5` | Add migrate service to docker-compose.prod.yml | 12 avr. 2026 |

La **Phase 2** est le commit le plus important : +2965 lignes, ajout des routes `/soiree/:matchId`, `/badges`, de l'API micro-pronostics, du système de séries/saisons et de 10 badges automatiques.

---

## Analyse de Sécurité par Criticité

---

### 🔴 CRITIQUE

#### 1. Mots de passe par défaut faibles en production (Docker)

**Fichier** : `docker-compose.prod.yml`  
**Lignes concernées** :
```yaml
POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-changeme}
redis-server --requirepass ${REDIS_PASSWORD:-changeme}
```

**Risque** : Si les variables d'environnement `POSTGRES_PASSWORD` et `REDIS_PASSWORD` ne sont pas définies dans le fichier `.env` au moment du déploiement, Docker utilisera la valeur par défaut `changeme`. Une base de données et un cache Redis accessibles avec ce mot de passe trivial exposent l'intégralité des données applicatives (membres, pronos, sessions).

**Recommandation** : Supprimer les valeurs par défaut (`:-changeme`) pour forcer une erreur explicite si les variables sont absentes. Ajouter une validation au démarrage.

```yaml
# À remplacer par :
POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?POSTGRES_PASSWORD must be set}
```

---

### 🟠 ÉLEVÉ

#### 2. Absence de rate limiting sur les nouvelles routes d'action

**Fichiers** : `app/routes/api.micro-predictions.ts`, `app/routes/feed.server.ts`, `app/routes/match-detail.server.ts`

**Risque** : Le rate limiting (`checkRateLimit`) n'est appliqué qu'aux routes d'authentification (`api.auth.$.ts`). Les nouvelles routes de la Phase 2 — création de posts, commentaires, réactions, réponses aux micro-pronos — ne sont pas protégées. Un utilisateur authentifié peut envoyer des milliers de requêtes, saturant la base de données ou créant du spam massif.

**Recommandation** : Appliquer `checkRateLimit` sur chaque action mutative, par exemple :
```typescript
// Dans api.micro-predictions.ts, intent "answer" :
await checkRateLimit({
  key: `micro-answer:${session.user.id}`,
  maxAttempts: 20,
  windowSeconds: 60,
});
```

#### 3. Validation manquante sur le champ `answer` des micro-pronostics

**Fichier** : `app/routes/api.micro-predictions.ts` (ligne ~92)

**Risque** : Le champ `answer` soumis par un joueur n'a aucune contrainte de longueur ni de format. Un utilisateur malveillant peut soumettre une chaîne de plusieurs mégaoctets, surchargeant la base de données et les opérations de comparaison. Contrairement aux posts/commentaires qui utilisent des schémas Zod, cette route ne valide pas les entrées.

**Recommandation** :
```typescript
const answerSchema = z.string().min(1).max(200).trim();
const validated = answerSchema.safeParse(answer);
if (!validated.success) return Response.json({ error: "Réponse invalide" }, { status: 400 });
```

---

### 🟡 MOYEN

#### 4. Typage `any` pour la vérification du rôle dans le fil

**Fichier** : `app/routes/feed.server.ts` (lignes 99, 124, 184, 200)

```typescript
const isAdmin = (session.user as any).role === "admin";
```

**Risque** : L'utilisation de `as any` contourne le typage TypeScript. Si la structure de la session évolue, le compilateur ne signalera aucun problème. Une régression silencieuse pourrait aboutir à ce que `isAdmin` soit toujours `false` (ou `true`), accordant ou refusant des droits incorrectement.

**Note** : Dans `soiree.server.ts` (ligne 261), la vérification est correctement typée (`session.user.role === "admin"`). La correction est cohérente avec ce qui existe déjà.

**Recommandation** : Typer proprement la session via Better Auth ou créer un helper `isAdmin(session)` typé.

#### 5. POSTGRES_PASSWORD et REDIS_PASSWORD optionnels dans `.env.example`

**Fichier** : `.env.example`

Les variables de production sont commentées en fin de fichier avec une note "Décommenter pour la production". Ce pattern peut être oublié lors du déploiement initial.

**Recommandation** : Ajouter un script de vérification pré-démarrage (`check-env.sh`) ou intégrer une validation dans `getEnv()` qui exige ces variables en mode `production`.

---

### 🟢 POINTS POSITIFS (conformes aux bonnes pratiques)

| Élément | Statut |
|---------|--------|
| `.env` exclu du repo, `.env.example` avec placeholders | ✅ |
| Better Auth avec `trustedOrigins` correctement configuré | ✅ |
| `requireAuth` appliqué sur toutes les routes admin | ✅ |
| Contrôle de rôle `allowedRoles: ["admin"]` dans les loaders admin | ✅ |
| Validation Zod sur posts et commentaires (`createPostSchema`, `createCommentSchema`) | ✅ |
| ORM Drizzle avec requêtes paramétrées (protection injection SQL) | ✅ |
| Upload d'avatars : validation MIME, limite 2 Mo, retraitement via Sharp | ✅ |
| Aucun `dangerouslySetInnerHTML` ni `eval()` détecté | ✅ |
| Vérification de propriété avant suppression (auteur ou admin) | ✅ |
| Protection admin auto-modification : impossible de changer son propre rôle | ✅ |
| Rate limiting présent sur les routes d'authentification | ✅ |
| Logger pino sans exposition de données sensibles dans les logs | ✅ |
| Validation de l'environnement au démarrage via Zod (`env.server.ts`) | ✅ |

---

## Plan d'action recommandé

| Priorité | Action | Effort |
|----------|--------|--------|
| 🔴 P1 | Supprimer les mots de passe par défaut dans `docker-compose.prod.yml` | 5 min |
| 🟠 P2 | Ajouter rate limiting sur `api.micro-predictions.ts` | 30 min |
| 🟠 P3 | Ajouter validation Zod sur `answer` dans micro-pronos | 15 min |
| 🟠 P4 | Ajouter rate limiting sur `feed.server.ts` (posts/commentaires/réactions) | 30 min |
| 🟡 P5 | Corriger les `as any` sur le rôle dans `feed.server.ts` | 20 min |
| 🟡 P6 | Validation des vars de prod dans `getEnv()` en mode production | 20 min |
