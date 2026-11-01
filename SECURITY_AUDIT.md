# Audit Sécurité — Penya Barca Nantes

**Date :** 2026-11-01  
**Périmètre :** Analyse des derniers commits et vérification des conventions de sécurité

---

## 1. Résumé des derniers commits

| Hash | Type | Description |
|------|------|-------------|
| `003faca` | fix | Évaluation des badges immédiatement après chaque action utilisateur (pronostic, post, commentaire, réaction) |
| `b1c88f6` | feat | Phase 2 complète : page soirée match live (polling API 60s), micro-pronostics, badges (10), séries de scores exacts, saisons |
| `d461ee5` | merge | Fusion de la branche déploiement Synology NAS |
| `554b873` | docs | Guide de mise à jour du NAS (pull, rebuild, commandes utiles) |
| `68e22d2` | feat | Menu burger mobile pour la navigation |
| `6aebaf7` | fix | Correction des origines de confiance Better Auth pour le domaine custom |
| `9823bc5` | fix | Ajout du service `migrate` dans docker-compose.prod.yml |
| `8d6e5e9` | feat | Docker Compose production et script de sauvegarde pour NAS Synology |
| `3d80133` | docs | Roadmap Phase 2 documentée |
| `aed5841` | security | Suppression des credentials du repo, renforcement `.gitignore` |

### Nouveaux éléments techniques (Phase 2)

- **Nouvelles tables DB :** `seasons`, `badges`, `user_badges`, `rewards`, `micro_predictions`, `micro_prediction_answers`
- **Nouvelles colonnes :** `user.currentStreak`, `user.bestStreak`, `matches.season`
- **Migration :** `0007_slimy_maria_hill.sql`
- **Nouvelles routes :** `/soiree/:matchId`, `/badges`, `/api/micro-predictions`
- **Nouveaux services :** `badges.server.ts`, `streaks.server.ts`, `seasons.server.ts`

---

## 2. Bonnes pratiques respectées

| Domaine | Observation |
|---------|-------------|
| **Authentification** | `requireAuth()` appliqué sur toutes les routes protégées |
| **Autorisation admin** | Routes admin vérifiées avec `requireAuth(request, ["admin"])` |
| **Rate limiting** | Implémenté sur login (10 req / 15 min) et register (5 req / 1 h) via Redis |
| **Validation des inputs** | Schemas Zod sur predictions, posts, commentaires, matchs |
| **ORM paramétré** | Drizzle ORM — aucune injection SQL possible via les requêtes |
| **Pas de secrets dans le repo** | `.gitignore` couvre `.env`, confirmé par le commit `aed5841` |
| **Validation ENV** | `getEnv()` avec Zod vérifie toutes les variables au démarrage |
| **Pas de XSS** | Aucun `dangerouslySetInnerHTML` ni `innerHTML` détecté |
| **Contrôle de suppression** | Vérification d'appartenance avant suppression de posts et commentaires |
| **Protection auto-modification** | Un admin ne peut pas modifier ni supprimer son propre compte |
| **Logs structurés** | Pino logger avec niveaux configurables, sans exposition de mots de passe |

---

## 3. Remarques de sécurité par ordre de criticité

---

### CRITIQUE — Mots de passe par défaut en production

**Fichier :** `docker-compose.prod.yml`

```yaml
POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-changeme}
redis-server --requirepass ${REDIS_PASSWORD:-changeme}
```

**Risque :** Si les variables d'environnement `POSTGRES_PASSWORD` et `REDIS_PASSWORD` ne sont pas définies dans le fichier `.env` sur le NAS, PostgreSQL et Redis démarrent avec le mot de passe `changeme`. Un attaquant ayant accès au réseau local du NAS pourrait accéder aux données sans authentification réelle.

**Action recommandée :** Supprimer les valeurs par défaut (`:-changeme`) pour forcer une erreur de démarrage si les variables sont absentes, ou vérifier dans le script de déploiement que ces variables sont bien définies.

---

### HAUTE — Contournement du rate limiting via X-Forwarded-For

**Fichier :** `app/routes/api.auth.$.ts` (lignes 5–11)

```typescript
function getClientIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}
```

**Risque :** Si le proxy inverse (nginx sur NAS) ne remplace pas le header `x-forwarded-for` mais le laisse passer tel quel, un attaquant peut envoyer `X-Forwarded-For: 1.2.3.4` dans sa requête pour se faire passer pour une IP différente à chaque tentative, contournant entièrement le rate limiting.

**Action recommandée :** S'assurer que nginx écrase ce header avec l'IP réelle du client (`proxy_set_header X-Forwarded-For $remote_addr;`). Si la chaîne de proxies est maîtrisée, utiliser la dernière IP de la liste plutôt que la première.

---

### MOYENNE — Deadline côté serveur absente pour les micro-pronostics

**Fichier :** `app/routes/api.micro-predictions.ts` (lignes 87–91)

```typescript
const [micro] = await db.select().from(microPredictions).where(eq(microPredictions.id, microId));
if (!micro || micro.closedAt) {
  return Response.json({ error: "Micro-pronostic fermé" }, { status: 400 });
}
```

**Risque :** La seule protection contre les réponses tardives est la clôture manuelle par l'admin (`closedAt`). Le champ `deadlineSeconds` existe mais n'est pas vérifié côté serveur. Un joueur pourrait répondre après l'expiration du délai affiché côté client tant que l'admin n'a pas manuellement fermé le micro-pronostic.

**Action recommandée :** Vérifier côté serveur que `new Date() <= new Date(micro.createdAt.getTime() + micro.deadlineSeconds * 1000)` avant d'accepter une réponse.

---

### MOYENNE — Posts auto dans le fil sous l'identité de l'utilisateur

**Fichier :** `app/lib/server/streaks.server.ts` (lignes 50–70)

```typescript
await db.insert(feedPosts).values({
  id: createId(),
  authorId: userId,      // post attribué à l'utilisateur
  content: message,
  isAnnouncement: true,
});
```

**Risque :** Lors d'une récompense de série, un post d'annonce est créé automatiquement sous le compte de l'utilisateur sans son consentement explicite. En cas de bug ou de manipulation, des contenus indésirables pourraient apparaître sous l'identité d'un membre.

**Action recommandée :** Attribuer ces posts à un compte système/bot dédié, ou à un `authorId` d'admin, plutôt qu'à l'utilisateur concerné.

---

### FAIBLE — APP_URL optionnel et origines de confiance vides

**Fichier :** `app/lib/server/auth.server.ts` (ligne 13)

```typescript
trustedOrigins: env.APP_URL ? [env.APP_URL] : [],
```

**Risque :** Si `APP_URL` n'est pas défini, Better Auth démarre sans origines de confiance. Selon la version de Better Auth, cela peut désactiver la protection CSRF ou la rendre plus permissive qu'attendu.

**Action recommandée :** Rendre `APP_URL` obligatoire dans le schema Zod de `env.server.ts` en production, ou définir explicitement l'URL de repli.

---

### FAIBLE — En-têtes de sécurité HTTP non visibles dans le code

**Observation :** Aucun middleware de headers de sécurité (`X-Frame-Options`, `X-Content-Type-Options`, `Content-Security-Policy`, `Strict-Transport-Security`) n'est configuré dans le code applicatif.

**Remarque :** Ces headers sont probablement gérés par nginx sur le NAS, mais cela n'est pas documenté ni vérifiable depuis le code.

**Action recommandée :** Vérifier la configuration nginx et documenter les headers en place. En alternative, ajouter un middleware dans `entry.server.tsx` pour les injecter dans chaque réponse.

---

### FAIBLE — Rate limiting absent sur les routes d'action utilisateur

**Observation :** Les routes `/api/micro-predictions`, actions du fil (`feed.server.ts`), etc. n'ont pas de rate limiting.

**Risque :** Un utilisateur pourrait automatiser des réactions, commentaires ou réponses à des micro-pronostics. Impact limité (authentification requise) mais possible.

**Action recommandée :** Envisager un rate limiting léger (ex. 30 requêtes / minute par utilisateur) sur ces routes via le middleware Redis existant.

---

## 4. Récapitulatif

| Criticité | Nombre | Statut recommandé |
|-----------|--------|-------------------|
| CRITIQUE | 1 | Corriger avant mise en production |
| HAUTE | 1 | Corriger dès que possible |
| MOYENNE | 2 | Planifier dans le prochain sprint |
| FAIBLE | 3 | À traiter selon les priorités |

**Bilan général :** L'architecture de sécurité est globalement solide pour une application communautaire de cette envergure. L'authentification, l'autorisation et la validation des données sont bien implémentées. Les points critiques concernent principalement la configuration de déploiement (mots de passe par défaut) et le durcissement du rate limiting.
