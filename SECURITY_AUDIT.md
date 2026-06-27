# Rapport d'audit de sécurité — Penya Blaugrana Nantes

> **Date :** 27 juin 2026  
> **Branche analysée :** `main` (HEAD : `003faca`)  
> **Périmètre :** codebase complète, routes API, authentification, upload, Docker

---

## Résumé des derniers commits

| Hash | Auteur | Date | Description |
|------|--------|------|-------------|
| `003faca` | Biteau Gaël | 13 avr. 2026 | fix: évaluer les badges immédiatement après chaque action |
| `b1c88f6` | Biteau Gaël | 13 avr. 2026 | feat: Phase 2 — soirée match live, micro-pronos, badges, séries, saisons |
| `d461ee5` | Merge | 12 avr. 2026 | Merge branch 'claude/deploy-synology-nas-cLkOL' |
| `554b873` | Claude | 12 avr. 2026 | Add deployment guide for Synology NAS updates |
| `68e22d2` | Biteau Gaël | 13 avr. 2026 | feat: menu burger mobile pour la navigation |

### Détail Phase 2 (`b1c88f6`)

Le commit le plus important introduit 2 965 lignes de code sur 26 fichiers :

- **Soirée match live** : route `/soiree/:matchId`, score temps réel (polling 60 s), fil d'événements, pronos révélés au coup d'envoi
- **Micro-pronostics** : création admin, vote joueur, clôture automatique avec attribution de points
- **Badges** : 10 badges évalués automatiquement, page `/badges`, affichage sur profil
- **Séries** : `currentStreak` / `bestStreak`, récompenses aux paliers 3/5/10
- **Saisons** : table `seasons`, filtrage du classement par saison, archivage

---

## Analyse de sécurité — par ordre de criticité

---

### 🔴 CRITIQUE (2 problèmes)

#### C-1 — Path traversal dans la route de fichiers
**Fichier :** `app/routes/uploads-files.ts` · lignes 4-5  
**CVSS estimé :** 9.8

```typescript
// Code actuel — DANGEREUX
const filePath = path.join(process.cwd(), "uploads", params["*"]);
```

Le paramètre `params["*"]` est contrôlé par l'utilisateur et injecté directement dans le chemin. Une requête `/uploads-files/../../../../etc/passwd` ou `/uploads-files/../.env` permet de lire n'importe quel fichier sur le serveur.

**Impact :** divulgation de credentials, clés API, variables d'environnement.

**Correction recommandée :**

```typescript
const filePath = path.resolve(process.cwd(), "uploads", params["*"]);
const uploadsDir = path.resolve(process.cwd(), "uploads");
if (!filePath.startsWith(uploadsDir + path.sep)) {
  return new Response("Accès interdit", { status: 403 });
}
```

---

#### C-2 — Parsing JSON externe sans validation de type
**Fichier :** `app/routes/soiree.server.ts` · lignes 93-94  
**CVSS estimé :** 8.5

```typescript
// Utilisation de `any` sur une réponse externe
return res.value.json().then((data: any) => {
  if (data.status !== "success" || !data.response?.lineup) return;
```

Une réponse API externe malformée ou compromise peut déclencher du prototype pollution ou une corruption d'état applicatif silencieuse.

**Impact :** exécution de code côté serveur via réponse API compromise, pollution de prototype.

**Correction recommandée :** valider avec zod toutes les réponses externes avant usage.

---

### 🟠 ÉLEVÉ (5 problèmes)

#### H-1 — Contournement du rate-limiting par spoofing d'IP
**Fichier :** `app/routes/api.auth.$.ts` · lignes 5-11

```typescript
function getClientIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}
```

L'en-tête `x-forwarded-for` est librement falsifiable par le client. Un attaquant peut contourner le rate-limiting sur login/register en faisant tourner cette valeur.

**Impact :** brute force de mots de passe, credential stuffing.

**Correction :** configurer le proxy (Nginx/Traefik) pour écraser ce header avec la vraie IP source ; ne jamais faire confiance à un header client non signé.

---

#### H-2 — Validation insuffisante des micro-pronostics
**Fichier :** `app/routes/api.micro-predictions.ts` · lignes 14-40

```typescript
const pointsValue = parseInt(formData.get("pointsValue") as string) || 1;
const deadlineSeconds = parseInt(formData.get("deadlineSeconds") as string) || 120;
```

Aucun contrôle des plages de valeur ni de la taille du champ `options`. Des valeurs négatives, nulles ou hors-limites peuvent corrompre les données.

**Impact :** corruption de données, déni de service par saturation de stockage.

**Correction :** ajouter un schéma zod avec bornes strictes (`pointsValue: z.number().int().min(1).max(100)`, etc.).

---

#### H-3 — Authentification absente sur `/api/sync-matches`
**Fichier :** `app/routes/api.sync-matches.ts`

Vérifier que la route de synchronisation des matchs (appel API Football) exige le rôle `admin`. Si ce n'est pas le cas, n'importe quel utilisateur authentifié (ou anonyme) peut déclencher des appels vers l'API externe et épuiser le quota.

**Impact :** épuisement de quota API, déni de service ciblé.

**Correction :** ajouter `await requireAuth(request, ["admin"])` en tête de la route.

---

#### H-4 — Credentials par défaut faibles dans Docker Compose production
**Fichier :** `docker-compose.prod.yml` · lignes 22, 32

```yaml
POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-changeme}
redis-server --requirepass ${REDIS_PASSWORD:-changeme}
```

Si les variables d'environnement ne sont pas définies, la base de données et Redis sont accessibles avec `changeme`.

**Impact :** compromission totale de la base de données en production.

**Correction :** supprimer tous les fallbacks. Faire échouer le démarrage si la variable est absente (pas de valeur par défaut).

---

#### H-5 — Usage de `sql\`\`` brut pour les noms de table
**Fichier :** `app/lib/server/badges.server.ts` · lignes 140-142

```typescript
.from(sql`"user"`)
.where(sql`id = ${userId}`)
```

L'utilisation de `sql\`\`` pour les noms de table contourne la sûreté de type de Drizzle. Si un nom de table devenait dynamique (refactoring), le risque d'injection SQL serait immédiat.

**Impact :** injection SQL potentielle lors d'un refactoring ; logique fragile.

**Correction :** utiliser les références de table Drizzle directement (`from(user).where(eq(user.id, userId))`).

---

### 🟡 MOYEN (6 problèmes)

#### M-1 — Absence de protection CSRF
**Fichiers :** tous les fichiers de routes avec actions formulaire

Aucun token CSRF n'est généré ni vérifié sur les actions d'état (pronos, posts, changement de rôle, suppression). Un attaquant peut soumettre un formulaire cross-site à la place de l'utilisateur.

**Correction :** implémenter un token CSRF dans les formulaires React Router ou utiliser le header `Sec-Fetch-Site` pour les requêtes fetch.

---

#### M-2 — Rate-limiting absent hors authentification
**Fichiers :** `api.micro-predictions.ts`, `api.welcome-dismiss.ts`

Seules les routes `/api/auth/sign-in` et `/api/auth/sign-up` ont un rate-limiting. Les autres endpoints d'action sont exposés à l'abus.

**Correction :** étendre `checkRateLimit()` à toutes les routes de mutation, avec des seuils adaptés par endpoint.

---

#### M-3 — `JSON.parse()` sans try-catch ni validation
**Fichiers :**
- `app/routes/soiree.server.ts` · ligne 95 : `JSON.parse(m.options)`
- `app/routes/match-detail.server.ts` · ligne 103 : `JSON.parse(match.matchDetails)`
- `app/lib/server/badges.server.ts` · ligne 159 : `JSON.parse(badge.condition)`

Un JSON corrompu en base provoque un crash applicatif (DoS).

**Correction :** entourer chaque `JSON.parse` d'un try-catch et valider avec zod.

---

#### M-4 — Cast de rôle non validé dans `requireAuth`
**Fichier :** `app/lib/server/auth-utils.server.ts` · ligne 20

```typescript
if (allowedRoles && !allowedRoles.includes(session.user.role as Role)) {
```

Le cast `as Role` ignore une valeur de rôle inattendue au lieu de la rejeter.

**Correction :** valider explicitement : `if (!(['member','admin','partner'] as string[]).includes(session.user.role)) throw ...`.

---

#### M-5 — Absence de Content Security Policy (CSP)
**Fichier :** `app/root.tsx`

Aucun header CSP n'est configuré. Des images externes (`fotmob.com`, `rapidapi.com`) sont chargées sans restriction.

**Correction :** ajouter un middleware React Router qui injecte les headers CSP appropriés (`Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Options`).

---

#### M-6 — Logs admin insuffisants (pas de table d'audit)
**Fichiers :** `app/routes/admin.*.server.ts`

Les actions admin (changement de rôle, suppression) sont loguées via pino mais sans table d'audit persistante ni valeur `old_value`/`new_value`.

**Correction :** créer une table `audit_log` avec `action`, `actor_id`, `target_id`, `old_value`, `new_value`, `created_at`.

---

### 🟢 FAIBLE (5 problèmes)

#### L-1 — Casts `as any` pour le rôle utilisateur
**Fichiers :** multiples routes utilisant `(session.user as any).role`

**Correction :** mettre à jour le type `Session` pour inclure le champ `role`.

---

#### L-2 — URLs externes codées en dur
**Fichiers :** plusieurs composants

```typescript
`https://images.fotmob.com/image_resources/logo/teamlogo/${teamId}.png`
```

**Correction :** déplacer ces URLs dans les variables d'environnement ou la configuration.

---

#### L-3 — Caractère mal encodé dans un message d'erreur
**Fichier :** `app/routes/api.micro-predictions.ts` · ligne 105

```typescript
return Response.json({ error: "Micro-pronostic ferm��" }, { status: 400 });
```

**Correction :** corriger l'encodage UTF-8 du message.

---

#### L-4 — Énumération de comptes à l'inscription
**Fichier :** `app/routes/register.tsx`

Un attaquant peut tester si un email est déjà enregistré en observant le message d'erreur de l'inscription.

**Correction :** retourner un message générique identique que l'email existe ou non.

---

#### L-5 — Headers de sécurité manquants
**Global**

Les headers suivants ne sont pas configurés :
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Strict-Transport-Security`
- `Referrer-Policy: strict-origin-when-cross-origin`

**Correction :** ajouter un middleware global dans React Router.

---

## Tableau de synthèse

| # | Sévérité | Problème | Fichier principal | Effort fix |
|---|----------|----------|-------------------|------------|
| C-1 | 🔴 CRITIQUE | Path traversal upload | `uploads-files.ts` | Faible |
| C-2 | 🔴 CRITIQUE | JSON externe non validé | `soiree.server.ts` | Moyen |
| H-1 | 🟠 ÉLEVÉ | Spoofing IP / rate-limit | `api.auth.$.ts` | Moyen |
| H-2 | 🟠 ÉLEVÉ | Validation micro-pronos | `api.micro-predictions.ts` | Faible |
| H-3 | 🟠 ÉLEVÉ | Auth manquante sync-matches | `api.sync-matches.ts` | Faible |
| H-4 | 🟠 ÉLEVÉ | Credentials Docker faibles | `docker-compose.prod.yml` | Faible |
| H-5 | 🟠 ÉLEVÉ | SQL brut pour table name | `badges.server.ts` | Faible |
| M-1 | 🟡 MOYEN | Absence CSRF | Toutes les routes action | Moyen |
| M-2 | 🟡 MOYEN | Rate-limit partiel | `api.micro-predictions.ts` | Faible |
| M-3 | 🟡 MOYEN | JSON.parse sans try-catch | 3 fichiers | Faible |
| M-4 | 🟡 MOYEN | Cast rôle non validé | `auth-utils.server.ts` | Faible |
| M-5 | 🟡 MOYEN | Pas de CSP | `root.tsx` | Moyen |
| M-6 | 🟡 MOYEN | Pas de table d'audit | `admin.*.server.ts` | Moyen |
| L-1 | 🟢 FAIBLE | Cast `as any` sur rôle | Multiple | Faible |
| L-2 | 🟢 FAIBLE | URLs codées en dur | Multiple | Faible |
| L-3 | 🟢 FAIBLE | Encodage UTF-8 cassé | `api.micro-predictions.ts` | Faible |
| L-4 | 🟢 FAIBLE | Énumération d'emails | `register.tsx` | Faible |
| L-5 | 🟢 FAIBLE | Headers sécurité absents | Global | Moyen |

---

## Actions prioritaires immédiates

1. **C-1** — Corriger le path traversal (`uploads-files.ts`) — 10 min de travail, risque critique
2. **H-4** — Supprimer les valeurs par défaut Docker (`changeme`) en production — 5 min
3. **H-3** — Vérifier et ajouter `requireAuth(request, ["admin"])` sur `api.sync-matches.ts`
4. **H-2** — Ajouter un schéma zod sur les micro-pronostics
5. **M-3** — Entourer tous les `JSON.parse` base de données d'un try-catch
