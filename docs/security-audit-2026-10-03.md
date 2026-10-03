# Audit de sécurité — Penya Blaugrana Nantes
**Date :** 2026-10-03  
**Scope :** analyse statique du code source (branche `claude/sharp-fermi-8dzw5j`)  
**Derniers commits couverts :** `003faca` → `4da20f3` (17 commits)

---

## Résumé des derniers commits

| Hash | Date | Auteur | Description |
|------|------|--------|-------------|
| `003faca` | 2026-04-13 | Biteau Gaël | fix: évaluer les badges immédiatement après chaque action |
| `b1c88f6` | 2026-04-13 | Biteau Gaël | feat: Phase 2 — soirée match live, micro-pronos, badges, séries, saisons |
| `d461ee5` | 2026-04-12 | Claude | Merge branch 'claude/deploy-synology-nas-cLkOL' |
| `554b873` | 2026-04-12 | Claude | Add deployment guide for Synology NAS updates |
| `68e22d2` | 2026-04-13 | Biteau Gaël | feat: menu burger mobile pour la navigation |
| `6aebaf7` | 2026-04-12 | Claude | Fix Better Auth trusted origins for custom domain support |
| `9823bc5` | 2026-04-12 | Claude | Add migrate service to docker-compose.prod.yml |
| `8d6e5e9` | 2026-04-12 | Claude | Add production Docker Compose and backup script for Synology NAS |
| `3d80133` | 2026-04-12 | Biteau Gaël | docs: roadmap Phase 2 |
| `aed5841` | 2026-04-12 | Biteau Gaël | **security: supprimer credentials du repo et renforcer .gitignore** |
| `6583da3` | 2026-04-12 | Biteau Gaël | docs: README complet avec guide de déploiement |
| `ab7fc5d` | 2026-04-12 | Biteau Gaël | feat: intégration API Football + stats enrichies + classement Liga |
| `16c43e6` | 2026-04-11 | Biteau Gaël | feat: MVP Phase 1 |
| `fec3e63` | 2026-04-11 | Biteau Gaël | feat: initial commit |

---

## Analyse de sécurité — par ordre de criticité

### 🔴 CRITIQUE

#### 1. Path Traversal sur la route de fichiers uploadés *(corrigé)*
**Fichier :** `app/routes/uploads-files.ts:5`  
**Statut :** ✅ Corrigé dans ce commit

**Problème :** Le paramètre wildcard de la route était joint directement au chemin de base sans vérifier que le chemin résolu restait dans le répertoire `uploads/`. Une requête comme `/uploads/../../../../etc/passwd` permettait de lire n'importe quel fichier accessible au processus Node.

```ts
// AVANT (vulnérable)
const filePath = path.join(process.cwd(), "uploads", params["*"]);

// APRÈS (sécurisé)
const base = path.resolve(process.cwd(), "uploads");
const filePath = path.resolve(base, params["*"]);
if (!filePath.startsWith(base + path.sep)) {
  return new Response("Not found", { status: 404 });
}
```

---

### 🟠 ÉLEVÉ

#### 2. Compteur de rate-limit non atomique — blocage permanent en cas de crash *(corrigé)*
**Fichier :** `app/lib/server/rate-limit.server.ts:16-19`  
**Statut :** ✅ Corrigé dans ce commit

**Problème :** `INCR` et `EXPIRE` étaient deux commandes Redis séparées. En cas de crash entre les deux, la clé restait sans TTL et bloquait définitivement les requêtes pour cette IP/clé.

```ts
// AVANT (non-atomique)
const current = await redis.incr(redisKey);
if (current === 1) {
  await redis.expire(redisKey, windowSeconds);
}

// APRÈS (atomique via Lua)
const current = await redis.eval(
  "local c = redis.call('INCR', KEYS[1]); if c == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end; return c",
  1, redisKey, windowSeconds
) as number;
```

---

### 🟡 MOYEN

#### 3. `trustedOrigins` CORS vide si `APP_URL` non défini
**Fichier :** `app/lib/server/auth.server.ts:12`  
**Statut :** ⚠️ À corriger

**Problème :** `APP_URL` est déclaré optionnel dans le schéma env. Si absent (déploiement mal configuré ou dev local), `trustedOrigins` devient un tableau vide. Selon le comportement de Better Auth avec un tableau vide, cela peut silencieusement autoriser toutes les origines.

**Recommandation :** Rendre `APP_URL` obligatoire en production ou définir une valeur par défaut sûre explicite.

---

#### 4. Validation manquante sur le champ `pointsScheme` (route admin)
**Fichier :** `app/routes/admin.matches.server.ts:59` et `:95`  
**Statut :** ⚠️ À corriger

**Problème :** `pointsScheme` est stocké en base sans validation par liste blanche. Un administrateur mal intentionné (ou compte compromis) pourrait persister une valeur arbitraire.

**Recommandation :**
```ts
const VALID_SCHEMES = ["standard", "bonus"] as const;
if (!VALID_SCHEMES.includes(pointsScheme)) return badRequest();
```

---

#### 5. Validation manquante sur le champ `type` des micro-pronos (admin)
**Fichier :** `app/routes/api.micro-predictions.ts:21`  
**Statut :** ⚠️ À corriger

**Problème :** `type` est stocké en base sans whitelist. Identique au point 4 mais sur les micro-pronos.

**Recommandation :** Valider contre `["qcm", "ouinon", "libre"]` (ou les valeurs effectivement définies dans le schéma Drizzle).

---

#### 6. Absence de contrainte de longueur sur la réponse utilisateur aux micro-pronos
**Fichier :** `app/routes/api.micro-predictions.ts:92-94`  
**Statut :** ⚠️ À corriger

**Problème :** Tout utilisateur authentifié peut soumettre une réponse sans limite de longueur ni de format. Risque de stockage gonflé ou contournement des limites UI.

**Recommandation :**
```ts
if (answer.length > 500) return badRequest("Réponse trop longue");
```

---

### 🟢 FAIBLE / INFORMATIF

#### 7. Vérification MIME basée sur `file.type` fourni par le client
**Fichier :** `app/lib/server/upload.ts:13`  
**Statut :** ℹ️ Acceptable (atténué par Sharp)

**Problème :** `file.type` peut être falsifié par le client. La bibliothèque Sharp rejette les fichiers invalides, mais ce comportement dépend d'un contrat implicite avec une librairie tierce.

**Recommandation :** Ajouter une vérification des octets magiques (`FF D8 FF` pour JPEG, `89 50 4E 47` pour PNG, `52 49 46 46` pour WebP) pour une défense en profondeur.

---

#### 8. Endpoint `/api/health` non authentifié expose la topologie des services
**Fichier :** `app/routes/api.health.ts:11`  
**Statut :** ℹ️ Acceptable selon l'infrastructure

**Problème :** Aucune authentification requise. Retourne l'état up/down de PostgreSQL et Redis, révélant la stack technique si l'endpoint est exposé sur internet.

**Recommandation :** Protéger par un bearer token ou restreindre l'accès au réseau interne (pare-feu NAS Synology).

---

## Ce qui a été vérifié et est conforme ✅

| Vérification | Résultat |
|---|---|
| Secrets / clés API hardcodés dans le code | ✅ Aucun — tout passe par `process.env` via `getEnv()` |
| Injection SQL | ✅ Aucun — utilisation systématique de l'ORM Drizzle avec paramètres |
| XSS via `innerHTML` / `dangerouslySetInnerHTML` | ✅ Aucun trouvé |
| Vérification auth sur les routes admin | ✅ Toutes les routes admin appellent `requireAuth(request, ["admin"])` |
| Rate limiting sur les endpoints d'authentification | ✅ 10 tentatives/15 min (login), 5 tentatives/h (register) |
| Fichiers `.env` commités | ✅ `.env` dans `.gitignore`, seul `.env.example` avec des placeholders |

---

## Plan d'action recommandé

| Priorité | Action | Fichier | Effort |
|---|---|---|---|
| 1 | ~~Corriger path traversal (uploads)~~ | `uploads-files.ts` | ✅ Fait |
| 2 | ~~Rendre INCR+EXPIRE atomique~~ | `rate-limit.server.ts` | ✅ Fait |
| 3 | Valider `pointsScheme` par whitelist | `admin.matches.server.ts` | 30 min |
| 4 | Valider `type` micro-pronos par whitelist | `api.micro-predictions.ts` | 15 min |
| 5 | Ajouter limite longueur sur `answer` | `api.micro-predictions.ts` | 15 min |
| 6 | Rendre `APP_URL` obligatoire en prod | `env.server.ts` + `auth.server.ts` | 20 min |
| 7 | Protéger `/api/health` par token | `api.health.ts` | 30 min |
| 8 | Vérification magic bytes upload | `upload.ts` | 45 min |
