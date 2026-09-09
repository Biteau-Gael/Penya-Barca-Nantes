# Rapport d'analyse de sécurité — Penya Blaugrana Nantes

> **Date d'analyse :** 09 septembre 2026  
> **Branche analysée :** `main` (commits jusqu'au 13 avril 2026)  
> **Analyseur :** Routine automatisée Claude Code

---

## Résumé des derniers commits

| Date | Hash | Auteur | Description |
|------|------|--------|-------------|
| 2026-04-13 | `003faca` | Biteau Gaël | **fix:** évaluer les badges immédiatement après chaque action |
| 2026-04-13 | `b1c88f6` | Biteau Gaël | **feat:** Phase 2 — soirée match live, micro-pronos, badges, séries, saisons |
| 2026-04-13 | `68e22d2` | Biteau Gaël | **feat:** menu burger mobile pour la navigation |
| 2026-04-12 | `d461ee5` | Claude | Merge branch `claude/deploy-synology-nas-cLkOL` |
| 2026-04-12 | `554b873` | Claude | Add deployment guide for Synology NAS updates |
| 2026-04-12 | `6aebaf7` | Claude | Fix Better Auth trusted origins for custom domain support |
| 2026-04-12 | `9823bc5` | Claude | Add migrate service to docker-compose.prod.yml |
| 2026-04-12 | `8d6e5e9` | Claude | Add production Docker Compose and backup script |
| 2026-04-12 | `3d80133` | Biteau Gaël | docs: roadmap Phase 2 |
| 2026-04-12 | `aed5841` | Biteau Gaël | **security:** supprimer credentials du repo et renforcer .gitignore |

---

## Analyse de sécurité par ordre de criticité

---

### 🔴 CRITIQUE

#### 1. Path Traversal dans le serveur de fichiers uploadés

- **Fichier :** `app/routes/uploads-files.ts`
- **Risque :** Lecture de fichiers arbitraires sur le serveur (ex. `.env`, clés privées)

**Code vulnérable :**
```ts
const filePath = path.join(process.cwd(), "uploads", params["*"]);
const file = await readFile(filePath);
```

`path.join` ne bloque pas les séquences `../`. Un attaquant authentifié ou non (route publique) peut demander :
```
GET /uploads/../../.env
GET /uploads/../../app/config/env.server.ts
```
et récupérer des secrets (clés API, AUTH_SECRET, DATABASE_URL).

**Correction recommandée :**
```ts
import path from "node:path";

const uploadsDir = path.resolve(process.cwd(), "uploads");
const filePath = path.resolve(uploadsDir, params["*"]);

// Rejeter si le chemin résolu sort du dossier uploads
if (!filePath.startsWith(uploadsDir + path.sep)) {
  return new Response("Accès interdit", { status: 403 });
}
```

---

### 🟠 ÉLEVÉ

#### 2. Mots de passe par défaut en production (Docker)

- **Fichier :** `docker-compose.prod.yml`
- **Risque :** Base de données et Redis accessibles avec le mot de passe `changeme` si le fichier `.env` n'est pas configuré

**Code vulnérable :**
```yaml
POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-changeme}
redis-server --requirepass ${REDIS_PASSWORD:-changeme}
```

Si le `.env` n'est pas déployé ou mal configuré sur le NAS Synology, les services démarrent avec un mot de passe trivial.

**Correction recommandée :** Supprimer la valeur par défaut pour forcer une configuration explicite :
```yaml
POSTGRES_PASSWORD=${POSTGRES_PASSWORD:?POSTGRES_PASSWORD doit être défini dans .env}
```

#### 3. Conteneur Docker s'exécute en tant que root

- **Fichier :** `Dockerfile`
- **Risque :** En cas de compromission de l'application, l'attaquant a les privilèges root dans le conteneur

**Problème :** Aucune directive `USER` dans le Dockerfile final — le processus Node.js tourne en root.

**Correction recommandée :** Ajouter avant la commande finale :
```dockerfile
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser
CMD ["npm", "run", "start"]
```

---

### 🟡 MOYEN

#### 4. Contournement du typage TypeScript pour les rôles utilisateur

- **Fichier :** `app/routes/feed.server.ts` (lignes multiples)
- **Risque :** Masque des erreurs potentielles dans la vérification de rôle admin ; toute évolution du type `User` ne serait pas détectée par le compilateur

**Code concerné :**
```ts
isAdmin: (session.user as any).role === "admin",
if (isAnnouncement && (session.user as any).role !== "admin") { ... }
```

La vérification fonctionne en runtime mais contourne la sécurité du type. Si le champ `role` venait à être renommé ou restructuré, aucun avertissement TypeScript ne serait émis.

**Correction recommandée :** Étendre le type `User` via Better Auth ou créer un helper typé :
```ts
function isAdmin(user: { role?: string }): boolean {
  return user.role === "admin";
}
```

#### 5. Absence de validation de la réponse aux micro-pronostics

- **Fichier :** `app/routes/api.micro-predictions.ts`
- **Risque :** Injection de contenu long ou malformé dans la base de données

**Code concerné :**
```ts
const answer = formData.get("answer") as string;
// Aucune validation de longueur ou de format
await db.insert(microPredictionAnswers).values({ ..., answer });
```

**Correction recommandée :** Ajouter une validation Zod :
```ts
const answerSchema = z.string().min(1).max(500).trim();
const parsedAnswer = answerSchema.safeParse(formData.get("answer"));
if (!parsedAnswer.success) return Response.json({ error: "Réponse invalide" }, { status: 400 });
```

---

### 🟢 FAIBLE

#### 6. Utilisation de `data: any` pour les données API externe

- **Fichier :** `app/routes/soiree.server.ts`
- **Risque :** En cas de changement de format de l'API, les erreurs passent silencieusement

**Code concerné :**
```ts
res.value.json().then((data: any) => { ... })
```

Les données de l'API externe sont manipulées sans validation structurée, risquant des accès à propriétés `undefined`.

**Correction recommandée :** Définir une interface ou utiliser une validation Zod pour les réponses API (comme c'est fait dans `api-football.server.ts`).

---

## Points positifs — Bonnes pratiques respectées

| Pratique | Fichier(s) | Statut |
|----------|-----------|--------|
| `.env` exclu du dépôt | `.gitignore` | ✅ Correct |
| Variables d'env. validées avec Zod | `app/config/env.server.ts` | ✅ Excellent |
| Routes admin protégées par `requireAuth(request, ["admin"])` | `admin.*.server.ts` | ✅ Consistant |
| Protection contre auto-modification de rôle | `admin.members.server.ts` | ✅ Implémenté |
| Requêtes SQL paramétrées (Drizzle ORM) | Tous les fichiers DB | ✅ Pas d'injection SQL |
| Journalisation des actions sensibles | Routes + lib/server/ | ✅ Cohérent |
| Validation Zod sur les formulaires admin | `admin.events.server.ts` | ✅ Correct |
| Credential secrets supprimés du dépôt | commit `aed5841` | ✅ Fait |
| Session Redis pour les tokens auth | `auth.server.ts` | ✅ Sécurisé |
| Vérification d'appartenance avant suppression | `feed.server.ts` | ✅ Correct |

---

## Récapitulatif des actions recommandées

| Priorité | Action | Effort |
|----------|--------|--------|
| 🔴 CRITIQUE | Corriger le path traversal dans `uploads-files.ts` | ~15 min |
| 🟠 ÉLEVÉ | Supprimer les mots de passe par défaut dans `docker-compose.prod.yml` | ~5 min |
| 🟠 ÉLEVÉ | Ajouter directive `USER` non-root dans `Dockerfile` | ~5 min |
| 🟡 MOYEN | Typer correctement les rôles dans `feed.server.ts` | ~30 min |
| 🟡 MOYEN | Valider la réponse aux micro-pronostics | ~15 min |
| 🟢 FAIBLE | Typer les réponses API dans `soiree.server.ts` | ~1h |
