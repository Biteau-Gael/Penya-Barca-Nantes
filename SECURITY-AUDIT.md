# Rapport d'Audit de Sécurité — Penya Blaugrana Nantes

**Date :** 2026-07-24  
**Branche analysée :** `main` (dernier commit : `003faca`)  
**Statut :** 1 vulnérabilité critique corrigée dans ce rapport

---

## Résumé des derniers commits

| Hash | Date | Description |
|------|------|-------------|
| `003faca` | 13/04/2026 | fix: évaluer les badges immédiatement après chaque action |
| `b1c88f6` | 13/04/2026 | feat: Phase 2 — soirée match live, micro-pronos, badges, séries, saisons |
| `68e22d2` | 13/04/2026 | feat: menu burger mobile pour la navigation |
| `554b873` | 12/04/2026 | docs: guide de déploiement NAS Synology (mises à jour) |
| `6aebaf7` | 12/04/2026 | fix: Better Auth trusted origins pour domaine custom |
| `9823bc5` | 12/04/2026 | feat: service migrate dans docker-compose.prod.yml |
| `8d6e5e9` | 12/04/2026 | feat: Docker Compose production + script backup Synology |
| `aed5841` | 12/04/2026 | security: suppression credentials du repo + renforcement .gitignore |
| `ab7fc5d` | 12/04/2026 | feat: intégration API Football + stats enrichies + classement Liga |
| `16c43e6` | 11/04/2026 | feat: MVP Phase 1 — Penya Blaugrana Nantes |

---

## Analyse de Sécurité par Ordre de Criticité

---

### 🔴 CRITIQUE — Vulnérabilité Path Traversal (CORRIGÉE)

**Fichier :** `app/routes/uploads-files.ts:5`  
**Statut :** ✅ Corrigé dans ce rapport

**Description :**  
La route `/uploads/*` construisait le chemin du fichier sans vérifier qu'il restait dans le répertoire `uploads/`. Un attaquant pouvait accéder à n'importe quel fichier du système de fichiers serveur via des séquences `../`.

**Preuve de concept :**
```
GET /uploads/../../../etc/passwd
→ Lecture du fichier /etc/passwd sur le serveur
```

**Correction appliquée (`uploads-files.ts`) :**
```typescript
const uploadDir = path.join(process.cwd(), "uploads");
const filePath = path.join(uploadDir, params["*"]);

// Prevent path traversal attacks
if (!filePath.startsWith(uploadDir + path.sep) && filePath !== uploadDir) {
  return new Response("Not found", { status: 404 });
}
```

---

### 🟠 HAUTE — Absence d'En-têtes de Sécurité HTTP

**Fichier :** `app/root.tsx` (Layout), configuration serveur  
**Statut :** ⚠️ Non corrigé

**Description :**  
L'application ne définit aucun en-tête de sécurité HTTP standard. Cela expose les utilisateurs à plusieurs vecteurs d'attaque :

- **Content-Security-Policy (CSP)** absent → risque XSS si une injection de contenu est trouvée
- **X-Frame-Options** absent → risque de clickjacking (l'app peut être iframée)
- **X-Content-Type-Options** absent → risque MIME-sniffing
- **Strict-Transport-Security (HSTS)** absent → pas de force HTTPS

**Recommandation :**  
Ajouter un middleware dans React Router pour injecter ces headers sur chaque réponse :
```typescript
// app/entry.server.tsx ou middleware React Router
response.headers.set("X-Frame-Options", "DENY");
response.headers.set("X-Content-Type-Options", "nosniff");
response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
response.headers.set("Content-Security-Policy",
  "default-src 'self'; img-src 'self' https://images.fotmob.com data:; ...");
```

---

### 🟠 HAUTE — Mots de Passe par Défaut "changeme" en Production

**Fichier :** `docker-compose.prod.yml:18,23`  
**Statut :** ⚠️ Non corrigé

**Description :**  
Le fichier Docker Compose de production utilise `changeme` comme valeur par défaut si les variables d'environnement ne sont pas définies :

```yaml
POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-changeme}
redis-server --requirepass ${REDIS_PASSWORD:-changeme}
```

Si le fichier `.env` est absent ou incomplet lors du déploiement, la base de données et Redis seront accessibles avec le mot de passe `changeme`.

**Recommandation :**  
Supprimer les valeurs par défaut et faire échouer explicitement le démarrage si les variables ne sont pas définies :
```yaml
POSTGRES_PASSWORD=${POSTGRES_PASSWORD:?POSTGRES_PASSWORD must be set}
```

---

### 🟠 HAUTE — Contournement Possible du Rate Limiting via IP Spoofing

**Fichier :** `app/routes/api.auth.$.ts:7-9`  
**Statut :** ⚠️ Non corrigé

**Description :**  
Le rate limiting de connexion/inscription utilise l'IP extraite du header `x-forwarded-for`, qui peut être falsifié par un attaquant :

```typescript
return (
  request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
  request.headers.get("x-real-ip") ||
  "unknown"
);
```

Un attaquant peut envoyer `X-Forwarded-For: 1.2.3.4` pour contourner les limites de tentatives et effectuer du brute-force sur les mots de passe.

**Recommandation :**  
Configurer le reverse proxy (nginx/Traefik) pour qu'il soit la seule source fiable de l'IP réelle, et utiliser un header interne non accessible depuis l'extérieur (ex: `X-Real-IP` injecté uniquement par le proxy).

---

### 🟡 MOYENNE — Credentials dans l'Historique Git

**Commit :** `aed5841` (12/04/2026)  
**Statut :** ⚠️ Partiellement traité

**Description :**  
Le commit `aed5841` indique la suppression de credentials du repo. Cependant, l'historique Git contient encore les données supprimées. Si le repo est (ou a été) public, ces credentials doivent être considérés comme compromis.

**Recommandation :**  
1. Rotation immédiate de tous les secrets qui ont été exposés (`AUTH_SECRET`, mots de passe PostgreSQL/Redis, clé API Football)
2. Si le repo doit rester privé, l'historique peut être nettoyé avec `git filter-repo`
3. Vérifier via GitHub Secret Scanning si des alertes existent

---

### 🟡 MOYENNE — Validation Insuffisante des Entrées (Micro-pronostics Admin)

**Fichier :** `app/routes/api.micro-predictions.ts:19-24`  
**Statut :** ⚠️ Non corrigé

**Description :**  
Les champs des micro-pronostics créés par l'admin ne sont pas validés en termes de longueur, format ou contenu :

```typescript
const question = formData.get("question") as string;    // pas de limite longueur
const type = (formData.get("type") as string) || "qcm"; // pas de whitelist
const optionsRaw = formData.get("options") as string;   // pas de validation
```

Bien que réservé aux admins, cela devrait quand même valider les types et longueurs pour éviter des données corrompues ou des payloads trop larges.

**Recommandation :**  
Utiliser Zod pour valider les entrées admin :
```typescript
const schema = z.object({
  matchId: z.string().min(1).max(100),
  question: z.string().min(3).max(500),
  type: z.enum(["qcm", "boolean", "text"]),
  pointsValue: z.number().int().min(1).max(10),
  deadlineSeconds: z.number().int().min(30).max(3600),
});
```

---

### 🟡 MOYENNE — Usage de SQL Brut dans badges.server.ts

**Fichier :** `app/lib/server/badges.server.ts:141-142`  
**Statut :** ⚠️ Non corrigé

**Description :**  
La requête utilisant `sql\`\`` directement au lieu de l'API Drizzle standard est moins lisible et moins robuste. Drizzle paramétrise correctement la valeur, donc il n'y a pas d'injection SQL directe, mais la pratique peut induire en erreur lors de révisions :

```typescript
.from(sql`"user"`)
.where(sql`id = ${userId}`);
```

**Recommandation :**
```typescript
import { user } from "~/db/schema";
// ...
.from(user)
.where(eq(user.id, userId))
```

---

### 🟢 FAIBLE — Ressource Externe Non Contrôlée (Logo Barça)

**Fichier :** `app/routes/soiree.tsx:13`  
**Statut :** ℹ️ Risque acceptable

**Description :**  
Le logo du FC Barcelone est chargé depuis une URL externe `https://images.fotmob.com/` hardcodée dans le composant. Si ce CDN change ou devient indisponible, l'image sera cassée.

```typescript
const BARCA_LOGO = "https://images.fotmob.com/image_resources/logo/teamlogo/8634.png";
```

**Recommandation :**  
Télécharger et héberger l'image localement dans `/public/` ou utiliser une image de fallback.

---

## Points Positifs Notés

- ✅ **Authentification robuste** — Better Auth avec sessions Redis, secrets validés (min 16 chars via Zod)
- ✅ **Rate limiting** sur login/inscription (10 tentatives/15min, 5 inscriptions/heure)
- ✅ **Séparation admin/member** — Vérification `session.user.role === "admin"` présente sur toutes les actions admin
- ✅ **Upload d'avatars sécurisé** — Sharp redimensionne et recompresse, types MIME validés, taille limitée à 2 Mo
- ✅ **Variables d'environnement validées** — Zod parse toutes les variables au démarrage
- ✅ **Logs structurés** — Pino avec niveaux configurables, pas d'exposition d'infos sensibles dans les logs
- ✅ **Credentials supprimés du repo** — Commit `aed5841` a nettoyé les credentials en dur
- ✅ **Pas de `dangerouslySetInnerHTML`** — Aucune injection HTML directe dans les composants React
- ✅ **ORM paramétré** — Drizzle ORM protège contre les injections SQL dans 99% des requêtes

---

## Actions Prioritaires

| Priorité | Action | Effort |
|----------|--------|--------|
| 1 | ~~Corriger le path traversal uploads~~ | ✅ Fait |
| 2 | Ajouter les en-têtes de sécurité HTTP | Faible |
| 3 | Supprimer les defaults "changeme" en prod | Très faible |
| 4 | Rotation des credentials exposés dans l'historique git | Immédiat |
| 5 | Valider les entrées micro-pronos avec Zod | Moyen |
| 6 | Fiabiliser la source d'IP pour le rate limiting | Moyen |
