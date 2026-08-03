# Rapport d'analyse de sécurité — Penya Barca Nantes

**Date :** 2026-08-03  
**Branche analysée :** `main` (commits jusqu'au `003faca`)  
**Périmètre :** Phase 2 — soirée match live, micro-pronos, badges, séries, saisons

---

## Résumé des derniers commits

| Hash | Date | Auteur | Description |
|------|------|--------|-------------|
| `003faca` | 2026-04-13 | Biteau Gaël | fix: évaluer les badges immédiatement après chaque action (pronostic, post, commentaire, réaction) |
| `b1c88f6` | 2026-04-13 | Biteau Gaël | feat: Phase 2 — soirée match live, micro-pronos, badges, séries, saisons (2965 lignes ajoutées) |
| `554b873` | 2026-04-12 | Claude | Add deployment guide for Synology NAS updates |
| `68e22d2` | 2026-04-13 | Biteau Gaël | feat: menu burger mobile pour la navigation |
| `6aebaf7` | 2026-04-12 | Claude | Fix Better Auth trusted origins for custom domain support |

La Phase 2 est un sprint majeur incluant :
- Page soirée match avec score live (polling API 60s)
- Micro-pronostics en temps réel (création admin, vote, clôture automatique)
- Système de badges (10 badges évalués automatiquement)
- Séries de scores exacts (currentStreak / bestStreak)
- Gestion des saisons et classement filtré

---

## Analyse de sécurité par ordre de criticité

### CRITIQUE

#### 1. Fuite de la réponse correcte des micro-pronostics ouverts
**Fichier :** `app/routes/soiree.server.ts:250-260`

```typescript
return {
  id: m.id,
  question: m.question,
  // ...
  correctAnswer: m.correctAnswer,  // ← exposé même quand closedAt est null
  // ...
};
```

Le champ `correctAnswer` est renvoyé au client pour **tous** les micro-pronostics, y compris ceux qui ne sont pas encore clôturés (`closedAt === null`). N'importe quel joueur peut inspecter les données du loader via les outils de développement pour connaître la bonne réponse avant la fin du micro-pronostic.

**Correction recommandée :**
```typescript
correctAnswer: m.closedAt ? m.correctAnswer : null,
```

---

### ÉLEVÉ

#### 2. Contournement du rate-limiting par falsification d'IP
**Fichier :** `app/routes/api.auth.$.ts:6-10`

```typescript
function getClientIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}
```

Les headers `X-Forwarded-For` et `X-Real-IP` peuvent être falsifiés par n'importe quel client si le serveur n'est pas derrière un reverse-proxy de confiance qui les nettoie. Cela permet à un attaquant de contourner le rate-limiting sur les routes de connexion (`sign-in` : 10 tentatives/15 min) et d'inscription (`sign-up` : 5 tentatives/heure).

**Correction recommandée :** En production (NAS Synology derrière un reverse-proxy), configurer le proxy pour réécrire ces headers et documenter que la valeur est fiable. Si le déploiement direct sans proxy est possible, utiliser l'IP de connexion réelle (non disponible dans l'API Web standard de React Router — prévoir une couche middleware).

---

#### 3. Absence de validation et de limite de taille sur les réponses aux micro-pronostics
**Fichier :** `app/routes/api.micro-predictions.ts:90-131`

La route `intent === "answer"` accepte n'importe quelle chaîne comme réponse sans contrainte de taille ni de format. Pour les micro-pronostics de type `qcm`, les options sont définies côté serveur mais la validation que la réponse soumise fait partie des options autorisées n'est pas effectuée.

```typescript
// Aucune validation du contenu ou de la taille de `answer`
await db.insert(microPredictionAnswers).values({
  id: createId(),
  microPredictionId: microId,
  userId: session.user.id,
  answer,
});
```

**Correction recommandée :**
```typescript
if (answer.length > 200) {
  return Response.json({ error: "Réponse trop longue" }, { status: 400 });
}
// Pour les QCM : vérifier que answer fait partie de micro.options
if (micro.type === "qcm" && micro.options) {
  const allowed = JSON.parse(micro.options) as string[];
  if (!allowed.includes(answer)) {
    return Response.json({ error: "Option invalide" }, { status: 400 });
  }
}
```

---

### MOYEN

#### 4. Casts `as any` sur les vérifications de rôle
**Fichier :** `app/routes/feed.server.ts:99, 124, 184, 200`

```typescript
isAdmin: (session.user as any).role === "admin",
if (isAnnouncement && (session.user as any).role !== "admin") {
```

L'utilisation de `as any` contourne la vérification de type TypeScript sur les contrôles de rôle. Si la structure de session évolue, ces vérifications pourraient silencieusement échouer ou renvoyer des valeurs inattendues. La fonction `requireAuth` avec `allowedRoles` devrait être utilisée systématiquement.

**Correction recommandée :** Typer correctement le rôle dans le type `Session` de Better Auth et utiliser `requireAuth(request, ["admin"])` plutôt que des casts manuels.

---

#### 5. Absence de rate-limiting sur les endpoints de mutation
**Fichier :** `app/routes/feed.server.ts`, `app/routes/api.micro-predictions.ts`

Le rate-limiting n'est appliqué que sur les routes d'authentification (`sign-in`, `sign-up`). Les actions suivantes n'ont aucune limite de fréquence :
- Création de posts et commentaires (fil d'actualité)
- Réactions aux posts
- Soumission de réponses aux micro-pronostics

Un utilisateur authentifié malveillant pourrait spammer ces endpoints.

**Correction recommandée :** Appliquer `checkRateLimit` sur les actions sensibles, par exemple :
```typescript
await checkRateLimit({ key: `post:${session.user.id}`, maxAttempts: 5, windowSeconds: 60 });
```

---

#### 6. Mot de passe par défaut faible en production Docker
**Fichier :** `docker-compose.prod.yml:22, 32`

```yaml
POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-changeme}
redis-server --requirepass ${REDIS_PASSWORD:-changeme}
```

Si les variables d'environnement `POSTGRES_PASSWORD` et `REDIS_PASSWORD` ne sont pas définies, les mots de passe par défaut `changeme` sont utilisés. Ce risque est présent en cas de déploiement sans fichier `.env` correctement configuré.

**Correction recommandée :** Supprimer les valeurs par défaut pour forcer l'erreur en cas de variable manquante :
```yaml
POSTGRES_PASSWORD=${POSTGRES_PASSWORD:?POSTGRES_PASSWORD must be set}
```

---

#### 7. N+1 queries dans le loader du fil d'actualité
**Fichier :** `app/routes/feed.server.ts:38-94`

Pour chaque post (jusqu'à 50), trois requêtes SQL distinctes sont exécutées : comptage des réactions, chargement des commentaires, vérification de la réaction de l'utilisateur. Cela génère potentiellement **150+ requêtes** par chargement de page.

Ce pattern peut être exploité comme vecteur de déni de service partiel si plusieurs utilisateurs chargent la page simultanément lors d'un pic d'activité (soirée match).

**Correction recommandée :** Utiliser des jointures et des sous-requêtes agrégées pour récupérer toutes les données en un minimum de requêtes.

---

### FAIBLE

#### 8. Divulgation d'informations sur l'endpoint de santé
**Fichier :** `app/routes/api.health.ts`

L'endpoint `/api/health` est accessible sans authentification et révèle l'état des services internes (PostgreSQL, Redis). Cette information peut aider un attaquant à cibler des services dégradés.

**Correction recommandée :** Protéger cet endpoint avec un token secret dans les headers, ou le restreindre aux IP internes au niveau du reverse-proxy.

---

#### 9. Erreurs d'évaluation de badges silencieusement ignorées
**Fichier :** `app/routes/feed.server.ts:136, 156, 178`, `app/routes/match-detail.server.ts:188`

```typescript
evaluateBadges(session.user.id).catch(() => {});
```

Les erreurs lors de l'attribution de badges sont complètement ignorées. Cela rend le débogage difficile en cas de régression sur le système de badges.

**Correction recommandée :**
```typescript
evaluateBadges(session.user.id).catch((err) => logger.error({ err, userId: session.user.id }, "Erreur évaluation badges"));
```

---

#### 10. Absence de headers de sécurité HTTP
**Périmètre :** Configuration globale (non trouvé dans le code applicatif)

Aucun header de sécurité n'est configuré au niveau de l'application :
- `Content-Security-Policy` (CSP)
- `X-Frame-Options`
- `X-Content-Type-Options`
- `Referrer-Policy`
- `Permissions-Policy`

**Correction recommandée :** Ajouter ces headers dans le reverse-proxy Nginx du NAS Synology, ou via un middleware React Router dans `entry.server.ts`.

---

#### 11. Requête SQL brute sur la table `user`
**Fichier :** `app/lib/server/badges.server.ts:140-142`

```typescript
const [userRow] = await db.select({ bestStreak: sql<number>`coalesce(best_streak, 0)::int` })
  .from(sql`"user"`)
  .where(sql`id = ${userId}`);
```

L'utilisation de `sql\`"user"\`` (nom de table en SQL brut) est incohérente avec le reste du code qui utilise les schémas Drizzle. Bien que les paramètres soient correctement escapés par Drizzle, c'est une odeur de code qui peut tromper de futurs contributeurs sur la sécurité des requêtes.

**Correction recommandée :** Utiliser le schéma Drizzle directement :
```typescript
import { user } from "~/db/schema";
const [userRow] = await db.select({ bestStreak: user.bestStreak }).from(user).where(eq(user.id, userId));
```

---

## Ce qui fonctionne bien

- **Authentification robuste** : Better Auth avec sessions Redis, `requireAuth` systématiquement appliqué sur les routes protégées.
- **Validation des variables d'environnement** : Zod valide les variables critiques au démarrage (`AUTH_SECRET` ≥ 16 caractères obligatoire).
- **Queries paramétrées** : Drizzle ORM protège contre les injections SQL dans tous les accès à la base de données.
- **Contrôle des rôles admin** : Les actions admin (créer/clôturer/supprimer des micro-pronos) vérifient systématiquement `session.user.role === "admin"`.
- **Upload d'avatars sécurisé** : Validation du type MIME, limite de taille (2 Mo), retraitement via Sharp, et nom de fichier basé sur l'userId (pas sur le nom du fichier original).
- **Rate-limiting sur l'authentification** : Login (10 tentatives/15 min), inscription (5 tentatives/heure).
- **`.gitignore` correct** : Le fichier `.env` et les uploads sont exclus du dépôt.
- **Secrets supprimés du dépôt** : Commit `aed5841` confirme une correction antérieure.
- **Logging structuré** : Pino est utilisé de façon cohérente pour tracer les actions sensibles.
