# Audit de Sécurité — Penya Blaugrana Nantes

**Date :** 28 juin 2026  
**Périmètre :** Codebase complète (Phase 1 + Phase 2)  
**Branche analysée :** `main` (commits `ab65e9a` → `003faca`)

---

## Résumé des derniers commits

| Hash | Message | Date |
|------|---------|------|
| `003faca` | fix: évaluer les badges immédiatement après chaque action | 13 avr. 2026 |
| `b1c88f6` | feat: Phase 2 — soirée match live, micro-pronos, badges, séries, saisons | 13 avr. 2026 |
| `68e22d2` | feat: menu burger mobile pour la navigation | 13 avr. 2026 |
| `6aebaf7` | Fix Better Auth trusted origins for custom domain support | 12 avr. 2026 |
| `9823bc5` | Add migrate service to docker-compose.prod.yml for database migrations | 12 avr. 2026 |
| `554b873` | Add deployment guide for Synology NAS updates | 12 avr. 2026 |
| `8d6e5e9` | Add production Docker Compose and backup script for Synology NAS deployment | 12 avr. 2026 |
| `aed5841` | security: supprimer credentials du repo et renforcer .gitignore | antérieur |

Le sprint Phase 2 a introduit ~3000 lignes de code : page soirée match, micro-pronostics, badges, séries et saisons. C'est le périmètre principal de cet audit.

---

## Résultats par ordre de criticité

---

### CRITIQUE

---

#### [SEC-001] Path Traversal sur le endpoint de fichiers uploadés

- **Fichier :** `app/routes/uploads-files.ts` ligne 5
- **Catégorie :** Injection / Lecture de fichiers arbitraires
- **Impact :** Un attaquant peut lire n'importe quel fichier du serveur (fichiers de configuration, `.env`, clés privées…)

**Code vulnérable :**
```typescript
const filePath = path.join(process.cwd(), "uploads", params["*"]);
const file = await readFile(filePath);
```

`path.join` normalise les séquences `../`, mais ne bloque pas la sortie du répertoire. Une requête vers `/uploads/../../.env` résoudrait vers le fichier `.env` à la racine du projet.

**Correction recommandée :**
```typescript
const uploadDir = path.resolve(process.cwd(), "uploads");
const filePath = path.resolve(uploadDir, params["*"]);

if (!filePath.startsWith(uploadDir + path.sep)) {
  return new Response("Interdit", { status: 403 });
}
```

**Priorité de correction : immédiate**

---

### HAUT

---

#### [SEC-002] En-têtes de sécurité HTTP absents (nginx)

- **Fichier :** `docker/nginx/nginx.conf`
- **Catégorie :** Configuration serveur
- **Impact :** XSS, clickjacking, MIME sniffing, downgrade HTTPS

La configuration nginx actuelle ne définit aucun en-tête de sécurité. Les navigateurs modernes appliquent des comportements permissifs par défaut.

**En-têtes manquants :**
```nginx
add_header X-Content-Type-Options "nosniff" always;
add_header X-Frame-Options "DENY" always;
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:;" always;
add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;
```

---

#### [SEC-003] Credentials par défaut dans docker-compose.prod.yml

- **Fichier :** `docker-compose.prod.yml` lignes 22 et 32
- **Catégorie :** Configuration / Credentials faibles
- **Impact :** Si les variables d'environnement ne sont pas définies en production, PostgreSQL et Redis démarrent avec le mot de passe `changeme`

**Code vulnérable :**
```yaml
POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-changeme}
command: redis-server --requirepass ${REDIS_PASSWORD:-changeme}
```

**Correction recommandée :** Supprimer les valeurs de repli. Docker Compose échouera au démarrage si la variable n'est pas définie, ce qui est le comportement souhaité :
```yaml
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
command: redis-server --requirepass ${REDIS_PASSWORD}
```

---

#### [SEC-004] Protection CSRF absente sur les actions POST

- **Fichiers concernés :** `app/routes/feed.server.ts`, `app/routes/api.micro-predictions.ts`, `app/routes/admin.*.server.ts`
- **Catégorie :** CSRF
- **Impact :** Un site tiers peut déclencher des actions au nom d'un utilisateur authentifié (créer des posts, voter sur des pronos, supprimer du contenu)

Better Auth gère le CSRF pour les routes `/api/auth/*`, mais les actions React Router custom n'ont aucune protection équivalente.

**Correction recommandée :** Vérifier l'en-tête `Origin` ou `Referer` côté serveur, ou utiliser un token CSRF stocké en session :
```typescript
const origin = request.headers.get("origin");
const appUrl = getEnv().APP_URL;
if (origin && origin !== appUrl) {
  return Response.json({ error: "Origine non autorisée" }, { status: 403 });
}
```

---

### MOYEN

---

#### [SEC-005] Bypass du rate limiting par usurpation d'IP

- **Fichier :** `app/routes/api.auth.$.ts` lignes 5–10
- **Catégorie :** Contournement de contrôle
- **Impact :** Un attaquant peut forger l'en-tête `X-Forwarded-For` pour changer son IP perçue et contourner la limite de tentatives de connexion

**Code vulnérable :**
```typescript
function getClientIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}
```

nginx est configuré pour transmettre le vrai IP (`$remote_addr`) dans `X-Real-IP`. Il est plus sûr de se baser sur celui-ci en priorité, car il ne peut pas être falsifié par le client.

**Correction recommandée :**
```typescript
function getClientIp(request: Request): string {
  return (
    request.headers.get("x-real-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}
```

---

#### [SEC-006] Endpoint `/api/health` non authentifié

- **Fichier :** `app/routes/api.health.ts`
- **Catégorie :** Divulgation d'informations
- **Impact :** Expose l'état des services internes (PostgreSQL, Redis) sans authentification, révélant la topologie de l'infrastructure à tout visiteur

La route est utile pour le monitoring Docker (`healthcheck`), mais elle ne devrait pas être publiquement accessible.

**Correction recommandée :** Restreindre l'accès par un token secret dans le header ou par l'IP source, ou déplacer le healthcheck sur un port interne non exposé :
```typescript
const token = request.headers.get("x-health-token");
if (token !== getEnv().HEALTH_CHECK_TOKEN) {
  return new Response("Unauthorized", { status: 401 });
}
```

---

#### [SEC-007] Absence de rate limiting sur les actions utilisateur

- **Fichiers concernés :** `app/routes/feed.server.ts`, `app/routes/api.micro-predictions.ts`, `app/routes/match-detail.server.ts`
- **Catégorie :** Déni de service / Spam
- **Impact :** Un utilisateur authentifié peut spammer des posts, commentaires, réactions ou réponses aux micro-pronos sans limite

Le rate limiting existe uniquement sur les routes d'authentification (`sign-in`, `sign-up`).

**Correction recommandée :** Appliquer `checkRateLimit` par utilisateur sur les endpoints sensibles :
```typescript
await checkRateLimit({
  key: `feed:post:${session.user.id}`,
  maxAttempts: 10,
  windowSeconds: 60,
});
```

---

#### [SEC-008] Cast `(session.user as any).role` — vérification de rôle fragile

- **Fichier :** `app/routes/feed.server.ts` lignes 99, 124, 184, 200
- **Catégorie :** Authorisation
- **Impact :** Le contournement du typage TypeScript pour accéder au rôle crée un risque de régression silencieuse si le modèle de session évolue

**Code actuel :**
```typescript
isAdmin: (session.user as any).role === "admin"
if (isAnnouncement && (session.user as any).role !== "admin") {
```

**Correction recommandée :** Utiliser systématiquement `requireAuth` avec les rôles autorisés, ou typer correctement la session :
```typescript
// Option 1 — utiliser requireAuth
await requireAuth(request, ["admin"]);

// Option 2 — typer la session
import type { Role } from "~/lib/server/auth-utils.server";
const role = session.user.role as Role;
```

---

#### [SEC-009] Fuite d'informations dans les erreurs API Football

- **Fichier :** `app/routes/api.sync-matches.ts` ligne 22
- **Catégorie :** Divulgation d'informations
- **Impact :** Le message d'erreur brut de l'API tierce (qui peut contenir des détails sur l'infrastructure ou les clés) est renvoyé directement au client admin

**Code vulnérable :**
```typescript
const message = error instanceof Error ? error.message : "Erreur inconnue";
return Response.json({ error: message }, { status: 500 });
```

**Correction recommandée :**
```typescript
logger.error({ error, message: error instanceof Error ? error.message : "unknown" }, "Erreur sync API-Football");
return Response.json({ error: "Erreur lors de la synchronisation des matchs" }, { status: 500 });
```

---

### FAIBLE

---

#### [SEC-010] Consentement GDPR hardcodé côté client

- **Fichier :** `app/routes/register.tsx` ligne 59
- **Catégorie :** Conformité RGPD
- **Impact :** La valeur `gdprConsent: true` est toujours envoyée à Better Auth indépendamment de la case cochée par l'utilisateur. Si la validation Zod côté client est contournée, le consentement est enregistré comme accordé même s'il ne l'était pas

**Code vulnérable :**
```typescript
const { error } = await signUp.email({
  // ...
  gdprConsent: true,  // ← hardcodé, n'utilise pas raw.gdprConsent
});
```

**Correction recommandée :**
```typescript
gdprConsent: result.data.gdprConsent,
```

---

#### [SEC-011] Absence de journalisation d'audit pour les actions admin

- **Fichiers concernés :** `app/routes/admin.members.server.ts`, `app/routes/admin.matches.server.ts`
- **Catégorie :** Traçabilité
- **Impact :** Les actions sensibles (changement de rôle, suppression de membre, modification de match) ne sont pas tracées avec suffisamment de détails pour un audit de sécurité

**Amélioration recommandée :** Ajouter des logs structurés incluant l'ID de l'admin, l'action, l'ID de la cible et les valeurs avant/après :
```typescript
logger.info({
  action: "member-role-changed",
  adminId: session.user.id,
  targetUserId: memberId,
  oldRole: existing.role,
  newRole: newRole,
}, "Rôle modifié par un admin");
```

---

## Points positifs constatés

| Domaine | Statut |
|---------|--------|
| Aucun secret hardcodé dans le code | ✅ |
| `.gitignore` protège `.env` et `uploads/` | ✅ |
| ORM Drizzle avec requêtes paramétrées (anti SQL injection) | ✅ |
| Rate limiting sur sign-in et sign-up | ✅ |
| Validation des fichiers uploadés (type MIME + taille) | ✅ |
| Routes admin protégées par `requireAuth(request, ["admin"])` | ✅ |
| Validation des entrées avec Zod | ✅ |
| Logs structurés avec Pino | ✅ |
| Traitement des images avec Sharp (anti malware embarqué) | ✅ |
| Stack traces cachés en production | ✅ |

---

## Plan d'action recommandé

| Priorité | Ticket | Action | Effort |
|----------|--------|--------|--------|
| P0 — Immédiat | SEC-001 | Corriger le Path Traversal sur `/uploads/*` | 30 min |
| P1 — Cette semaine | SEC-003 | Supprimer les passwords par défaut dans docker-compose.prod.yml | 15 min |
| P1 — Cette semaine | SEC-002 | Ajouter les en-têtes de sécurité dans nginx.conf | 1h |
| P1 — Cette semaine | SEC-004 | Ajouter la vérification d'origine sur les actions POST | 2h |
| P2 — Prochain sprint | SEC-005 | Corriger la priorité IP dans getClientIp | 15 min |
| P2 — Prochain sprint | SEC-007 | Ajouter rate limiting sur les actions feed et micro-pronos | 2h |
| P2 — Prochain sprint | SEC-009 | Masquer les messages d'erreur API tiers | 30 min |
| P2 — Prochain sprint | SEC-010 | Utiliser la vraie valeur gdprConsent dans signUp | 5 min |
| P3 — Backlog | SEC-006 | Sécuriser l'endpoint /api/health | 1h |
| P3 — Backlog | SEC-008 | Typer correctement les rôles dans feed.server.ts | 1h |
| P3 — Backlog | SEC-011 | Renforcer les logs d'audit admin | 2h |
