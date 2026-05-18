# Rapport d'audit de sécurité — Penya Barca Nantes

**Date :** 2026-05-18  
**Branche analysée :** `main` (commits jusqu'à `003faca`)  
**Analysé par :** Claude Code (audit automatisé + revue manuelle)

---

## Résumé des derniers commits

| Hash | Auteur | Date | Description |
|------|--------|------|-------------|
| `003faca` | Biteau Gaël | 13/04/2026 | fix: évaluer les badges immédiatement après chaque action |
| `b1c88f6` | Biteau Gaël | 13/04/2026 | feat: Phase 2 — soirée match live, micro-pronos, badges, séries, saisons |
| `68e22d2` | Biteau Gaël | 13/04/2026 | feat: menu burger mobile pour la navigation |
| `6aebaf7` | Claude | 12/04/2026 | Fix Better Auth trusted origins pour support domaine custom |
| `9823bc5` | Claude | 12/04/2026 | Ajout service migrate dans docker-compose.prod.yml |
| `8d6e5e9` | Claude | 12/04/2026 | Docker Compose production et script de sauvegarde Synology NAS |
| `aed5841` | — | — | security: suppression credentials du repo, renforcement .gitignore |
| `ab7fc5d` | — | — | feat: intégration API Football + stats enrichies + classement Liga |

**Commit `b1c88f6` est le plus impactant** : ajout de 26 fichiers (+2 965 lignes) introduisant la Phase 2 (soirée match live, micro-pronos, badges, séries, saisons). C'est le périmètre principal de cet audit.

---

## Résultats d'audit — par ordre de criticité

---

### 🔴 CRITIQUE

#### C1 — Path Traversal dans le serveur de fichiers statiques

- **Fichier :** `app/routes/uploads-files.ts` — ligne 5
- **Statut :** Confirmé
- **Description :** Le paramètre URL `params["*"]` est passé directement à `path.join()` sans aucune validation. Un attaquant peut envoyer `../../.env` ou `../../app/config/env.server.ts` pour lire des fichiers arbitraires sur le serveur.

```typescript
// VULNÉRABLE
const filePath = path.join(process.cwd(), "uploads", params["*"]);
```

- **Impact :** Lecture de fichiers sensibles (`.env`, code source, secrets), compromission totale de l'environnement.
- **Correctif :**

```typescript
const safeName = path.basename(params["*"] ?? "");
const filePath = path.join(process.cwd(), "uploads", safeName);
// Vérifier que le chemin résolu reste dans le dossier uploads
const uploadsDir = path.join(process.cwd(), "uploads");
if (!filePath.startsWith(uploadsDir + path.sep)) {
  return new Response("Interdit", { status: 403 });
}
```

---

#### C2 — Absence de protection CSRF

- **Fichier :** Toute l'application (formulaires POST)
- **Statut :** Confirmé
- **Description :** Aucun token CSRF n'est généré ni validé sur les actions state-changing. Better Auth gère l'authentification mais ne protège pas les formulaires applicatifs.
- **Routes exposées :**
  - `feed.server.ts` — création/suppression de posts et commentaires
  - `profile.server.ts` — upload avatar, **suppression de compte**
  - `admin.*.server.ts` — toutes les actions d'administration
  - `api.micro-predictions.ts` — création/clôture de micro-pronos
- **Impact :** Un attaquant peut forger des requêtes au nom d'un utilisateur authentifié (suppression de compte, changement de rôle, etc.).
- **Correctif :** Implémenter des tokens CSRF via `remix-utils` ou générer/valider manuellement un token en session pour chaque formulaire POST.

---

### 🟠 ÉLEVÉ

#### H1 — Suppression de compte sans confirmation

- **Fichier :** `app/routes/profile.server.ts` — lignes 127–130
- **Statut :** Confirmé
- **Description :** La suppression de compte est exécutée immédiatement sans demander le mot de passe, sans email de confirmation et sans période de grâce. Combiné à C2 (CSRF), une page malveillante peut déclencher la suppression à l'insu de l'utilisateur.

```typescript
if (intent === "delete-account") {
  await db.delete(user).where(eq(user.id, session.user.id)); // suppression définitive immédiate
```

- **Correctif :** Exiger une confirmation par mot de passe, implémenter une suppression douce (`deletedAt: timestamp`) avec un délai de grâce de 30 jours.

---

#### H2 — Validation insuffisante des options de micro-pronostic

- **Fichier :** `app/routes/api.micro-predictions.ts` — lignes 22–30, 92, 127
- **Statut :** Confirmé
- **Description :**
  1. Les options QCM sont stockées sans validation de longueur ni de contenu (risque XSS au rendu).
  2. La réponse d'un joueur (`answer`) est stockée telle quelle sans vérifier qu'elle appartient aux options proposées.
  3. Le champ `question` n'a pas de limite de longueur.
- **Correctif :**

```typescript
// Exemple de validation avec Zod
const createSchema = z.object({
  question: z.string().min(5).max(300),
  options: z.array(z.string().min(1).max(100)).min(2).max(6),
  pointsValue: z.number().int().min(1).max(10),
});
const answerSchema = z.object({
  answer: z.string().max(100),
});
```

---

#### H3 — Rate limiting incomplet

- **Fichier :** `app/routes/api.auth.$.ts` — lignes 13–35
- **Statut :** Confirmé
- **Description :** Le rate limiting ne couvre que `/sign-in` (10 req/15 min) et `/sign-up` (5 req/h). Les actions suivantes ne sont pas limitées :
  - Upload d'avatar (vecteur de DoS potentiel)
  - Soumission de micro-pronos (abus de points)
  - Toutes les actions admin
- **Correctif :** Appliquer `checkRateLimit` dans les actions sensibles, par exemple :

```typescript
await checkRateLimit({ key: `avatar:${session.user.id}`, maxAttempts: 5, windowSeconds: 3600 });
await checkRateLimit({ key: `micro-answer:${session.user.id}`, maxAttempts: 20, windowSeconds: 300 });
```

---

#### H4 — IP client non vérifiée (X-Forwarded-For spoofable)

- **Fichier :** `app/routes/api.auth.$.ts` — lignes 5–11
- **Statut :** Confirmé
- **Description :** La fonction `getClientIp` lit `X-Forwarded-For` sans vérifier que le serveur est derrière un reverse proxy de confiance. Un attaquant peut envoyer un header `X-Forwarded-For: 1.2.3.4` arbitraire pour contourner le rate limiting par IP.
- **Correctif :** Ne lire `X-Forwarded-For` que si la requête provient d'un proxy connu (vérification de l'IP source), ou utiliser uniquement `X-Real-IP` positionné par le reverse proxy Nginx/Traefik.

---

### 🟡 MOYEN

#### M1 — En-têtes de sécurité HTTP absents

- **Fichier :** `app/root.tsx` (loader/headers)
- **Statut :** Confirmé
- **Description :** Aucun en-tête de sécurité n'est défini. Les navigateurs appliquent leurs comportements par défaut, moins restrictifs.
- **En-têtes manquants :**
  - `Content-Security-Policy`
  - `X-Frame-Options: DENY`
  - `X-Content-Type-Options: nosniff`
  - `Strict-Transport-Security`
  - `Referrer-Policy: strict-origin-when-cross-origin`
- **Correctif :** Ajouter une fonction `headers` dans `root.tsx` ou configurer les en-têtes au niveau du reverse proxy Nginx.

---

#### M2 — Validation MIME uniquement côté client pour les uploads

- **Fichier :** `app/lib/server/upload.ts` — lignes 13–15
- **Statut :** Confirmé
- **Description :** La validation du type de fichier repose sur `file.type`, fourni par le client HTTP et facilement falsifiable. Un fichier malveillant nommé `.php` avec `Content-Type: image/jpeg` passerait le contrôle avant d'être traité par Sharp.
- **Note positive :** Sharp reconvertit systématiquement le fichier en WebP 256×256, ce qui neutralise la plupart des payloads malveillants. Le risque est limité mais réel (image bombs, exploitation de vulnérabilités Sharp).
- **Correctif :** Valider les magic bytes du fichier (premiers octets) avec le package `file-type` avant de passer à Sharp.

---

#### M3 — Journalisation des événements de sécurité incomplète

- **Fichier :** `app/lib/server/logger.server.ts`, routes admin
- **Statut :** Partiel
- **Description :**
  - Les changements de rôle et suppressions de membres sont bien loggés (bon point).
  - Les échecs d'autorisation (403) ne sont **pas** loggés.
  - L'adresse IP et le user-agent ne sont pas inclus dans les logs d'actions sensibles.
  - Pas de corrélation request ID entre les logs.
- **Correctif :** Ajouter dans `requireAuth` un log en cas de 403, et passer l'IP dans le contexte des actions admin.

---

#### M4 — `trustedOrigins` vide possible en production

- **Fichier :** `app/lib/server/auth.server.ts` — ligne 12
- **Statut :** Confirmé
- **Description :** Si `APP_URL` n'est pas défini, `trustedOrigins` est un tableau vide. Le comportement de Better Auth avec un tableau vide doit être vérifié (potentiellement : toutes les origines acceptées).
- **Correctif :** Faire échouer le démarrage de l'application si `APP_URL` est absent en production :

```typescript
// Dans env.server.ts
if (process.env.NODE_ENV === "production" && !process.env.APP_URL) {
  throw new Error("APP_URL est obligatoire en production");
}
```

---

#### M5 — Connexion Redis sans TLS

- **Fichier :** `app/lib/server/redis.server.ts` — ligne 3
- **Statut :** Confirmé
- **Description :** Le fallback `redis://localhost:6379` utilise du TCP non chiffré. En production sur NAS Synology avec Docker, si Redis est exposé sur le réseau local, les sessions et les données de rate limiting transitent en clair.
- **Correctif :** Forcer `rediss://` en production, ou s'assurer que Redis est uniquement accessible via le réseau Docker interne (ne pas exposer le port 6379 à l'extérieur du réseau Docker).

---

### 🔵 FAIBLE

#### F1 — Pas de borne supérieure sur les scores de matchs

- **Fichier :** `app/routes/admin.matches.server.ts`
- **Description :** Les scores ne sont validés que comme entiers positifs (`>= 0`). Un score de `99999` est accepté.
- **Correctif :** Ajouter `&& homeScore <= 99 && awayScore <= 99`.

---

#### F2 — Longueur maximale absente sur les descriptions d'événements

- **Fichier :** `app/routes/admin.events.server.ts`
- **Description :** Le champ `description` est optionnel mais sans limite de taille (`z.string().optional()`).
- **Correctif :** `z.string().max(2000).optional()`.

---

#### F3 — Stack trace exposée en mode développement

- **Fichier :** `app/root.tsx` — ErrorBoundary
- **Description :** En mode `DEV`, le message et la stack trace des erreurs sont affichés dans l'UI.
- **Correctif :** Loguer côté serveur, afficher uniquement un message générique côté client.

---

#### F4 — Absence de timeout sur les appels API Football

- **Fichier :** `app/lib/server/api-football.server.ts`
- **Description :** Les appels `fetch` vers l'API externe n'ont pas de timeout. Un blocage de l'API tierce peut provoquer un blocage des requêtes serveur.
- **Correctif :**

```typescript
const controller = new AbortController();
const timeoutId = setTimeout(() => controller.abort(), 10_000);
const response = await fetch(url, { signal: controller.signal, headers: { ... } });
clearTimeout(timeoutId);
```

---

## Bilan et conformité globale

| Catégorie | Statut |
|-----------|--------|
| Secrets non commités | ✅ Bon — `.gitignore` couvre `.env`, `commit aed5841` a nettoyé les credentials |
| Authentification | ✅ Bon — Better Auth, sessions Redis, rôles vérifiés en serveur |
| Autorisation | ✅ Bon — `requireAuth(request, ["admin"])` systématique sur toutes les routes admin |
| Validation des entrées | ⚠️ Partiel — Zod utilisé sur certains champs, absent sur micro-pronos |
| Protection CSRF | ❌ Absent |
| Path traversal | ❌ Critique — `uploads-files.ts` |
| Rate limiting | ⚠️ Partiel — auth seulement |
| En-têtes HTTP sécurité | ❌ Absent |
| Chiffrement (Redis/TLS) | ⚠️ À vérifier en production |
| Journalisation sécurité | ⚠️ Partiel — actions admin loggées, 403 non loggés |
| Upload de fichiers | ⚠️ MIME client-only, Sharp neutralise partiellement |

---

## Plan d'action recommandé

### Immédiat (avant prochaine mise en production)
1. **[C1]** Corriger le path traversal dans `uploads-files.ts` — 30 min
2. **[C2]** Implémenter la protection CSRF sur tous les formulaires POST — 2–4h
3. **[H1]** Ajouter confirmation par mot de passe pour la suppression de compte — 1h

### Court terme (sprint suivant)
4. **[H2]** Ajouter validation Zod complète sur les micro-pronos — 1h
5. **[H3]** Étendre le rate limiting aux actions sensibles — 1h
6. **[H4]** Fiabiliser la détection IP derrière proxy — 30 min
7. **[M1]** Configurer les en-têtes de sécurité HTTP — 1h

### Moyen terme
8. **[M2]** Validation magic bytes des uploads — 1h
9. **[M4]** Rendre `APP_URL` obligatoire en production — 15 min
10. **[M5]** Vérifier l'isolation réseau de Redis en production Docker — 30 min
