# Revue de sécurité — Penya Barca Nantes

**Date :** 2026-10-23  
**Branche analysée :** `claude/sharp-fermi-pn937f`  
**Commits couverts :** `fec3e63` → `003faca` (historique complet)

---

## Résumé des derniers commits

| Date | Hash | Auteur | Description |
|------|------|--------|-------------|
| 2026-04-13 | `003faca` | Biteau Gaël | **fix:** évaluer les badges immédiatement après chaque action |
| 2026-04-13 | `b1c88f6` | Biteau Gaël | **feat:** Phase 2 — soirée match live, micro-pronos, badges, séries, saisons |
| 2026-04-13 | `68e22d2` | Biteau Gaël | **feat:** menu burger mobile pour la navigation |
| 2026-04-12 | `d461ee5` | Claude | **merge:** branche deploy-synology-nas-cLkOL |
| 2026-04-12 | `554b873` | Claude | **docs:** guide de déploiement pour mises à jour NAS |
| 2026-04-12 | `6aebaf7` | Claude | **fix:** Better Auth trusted origins pour domaine personnalisé |
| 2026-04-12 | `9823bc5` | Claude | **feat:** service migrate dans docker-compose.prod.yml |

---

## Analyse de sécurité par ordre de criticité

---

### 🔴 CRITIQUE — Path Traversal dans le serveur de fichiers uploadés

**Fichier :** `app/routes/uploads-files.ts`

**Description :**  
La route de diffusion des avatars construit le chemin du fichier directement depuis le paramètre URL sans valider que le chemin reste dans le répertoire `uploads/`. Un attaquant peut lire n'importe quel fichier accessible au processus Node.

**Code vulnérable :**
```typescript
// uploads-files.ts
const filePath = path.join(process.cwd(), "uploads", params["*"]);
// Requête : GET /uploads/../../.env  → lit le fichier .env
// Requête : GET /uploads/../../etc/passwd → lit /etc/passwd
```

`path.join` normalise le chemin mais **ne bloque pas la traversée** avec `../`.

**Correction recommandée :**
```typescript
const UPLOAD_DIR = path.resolve(process.cwd(), "uploads");
const filePath = path.resolve(UPLOAD_DIR, params["*"]);

// Vérifier que le chemin reste dans uploads/
if (!filePath.startsWith(UPLOAD_DIR + path.sep)) {
  return new Response("Forbidden", { status: 403 });
}
```

**Impact :** Fuite de secrets (.env, clés API), lecture de fichiers système.

---

### 🟠 HAUTE — Absence de rate limiting sur les routes de contenu

**Fichiers concernés :**  
- `app/routes/feed.server.ts` (posts, commentaires, réactions)  
- `app/routes/api.micro-predictions.ts` (soumission de réponses)  
- `app/routes/profile.server.ts` (changement de pseudo, upload d'avatar)

**Description :**  
La fonction `checkRateLimit` existe et est utilisée uniquement sur `api.auth.$.ts` (login/register). Les routes de contenu ne sont pas protégées. Un utilisateur authentifié peut :
- Spammer des posts ou commentaires sans limite
- Soumettre des requêtes massives d'upload d'avatar (contournement du quota stockage)
- Surcharger les appels API Football dans la soirée live

**Correction recommandée :**
```typescript
// feed.server.ts — action create-post
await checkRateLimit({
  key: `feed:post:${session.user.id}`,
  maxAttempts: 10,
  windowSeconds: 300,  // 10 posts / 5 min
});

// feed.server.ts — action comment
await checkRateLimit({
  key: `feed:comment:${session.user.id}`,
  maxAttempts: 30,
  windowSeconds: 300,
});
```

---

### 🟠 HAUTE — En-têtes de sécurité HTTP absents

**Fichier :** `app/root.tsx`, configuration serveur

**Description :**  
Aucun en-tête de sécurité HTTP n'est défini dans l'application :
- Pas de `Content-Security-Policy` → risque XSS si du contenu utilisateur est injecté dans le DOM
- Pas de `X-Frame-Options` ou `frame-ancestors` → risque de clickjacking
- Pas de `X-Content-Type-Options: nosniff` → sniffing MIME par le navigateur
- Pas de `Referrer-Policy`

React Router (Remix) permet d'ajouter ces en-têtes dans le loader root ou via un middleware.

**Correction recommandée :**
```typescript
// app/root.tsx
export function headers() {
  return {
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  };
}
```
Un CSP complet nécessite d'inventorier toutes les sources utilisées (Google Fonts, etc.).

---

### 🟡 MOYENNE — Cast `as any` contournant le typage du rôle utilisateur

**Fichiers concernés :**  
- `app/routes/feed.server.ts` — lignes utilisant `(session.user as any).role`  
- `app/routes/match-detail.server.ts`  
- `app/routes/soiree.server.ts`

**Description :**  
Le champ `role` est défini comme `additionalFields` dans Better Auth mais TypeScript ne l'expose pas directement dans le type `Session`. Le workaround `as any` désactive les garanties du typage — si le nom du champ changeait, il n'y aurait aucune erreur de compilation.

**Correction recommandée :** Étendre le type Session pour inclure les champs additionnels :
```typescript
// app/lib/server/auth.server.ts
export type Session = typeof auth.$Infer.Session & {
  user: { role: "member" | "admin" | "partner"; pseudo?: string; avatarUrl?: string };
};
```
Puis supprimer tous les `as any` dans les vérifications de rôle.

---

### 🟡 MOYENNE — Taille de réponse non bornée dans les micro-prédictions

**Fichier :** `app/routes/api.micro-predictions.ts` (intent `answer`)

**Description :**  
La valeur du champ `answer` est insérée en base sans validation de longueur maximale. Pour les types `qcm` les réponses attendues sont des choix prédéfinis, mais rien n'empêche de soumettre une chaîne arbitrairement longue pour `open` ou d'autres types.

**Correction recommandée :**
```typescript
const answer = formData.get("answer") as string;
if (!answer || answer.length > 200) {
  return Response.json({ error: "Réponse invalide" }, { status: 400 });
}
// Pour QCM : vérifier que la réponse est dans les options définies
```

---

### 🟢 FAIBLE — Absence de validation du type MIME côté serveur pour les uploads

**Fichier :** `app/lib/server/upload.ts`

**Description :**  
La validation du type de fichier repose sur `file.type` qui est fourni par le client (HTTP `Content-Type`). Un attaquant peut envoyer un fichier malveillant (ex. SVG avec JavaScript embarqué) en falsifiant ce champ. La bibliothèque `sharp` traite le contenu binaire mais la vérification en entrée reste côté client.

**Correction recommandée :** Utiliser une détection basée sur la signature magique (magic bytes) du fichier avec une bibliothèque comme `file-type` :
```typescript
import { fileTypeFromBuffer } from "file-type";
const detected = await fileTypeFromBuffer(buffer);
if (!detected || !["image/jpeg", "image/png", "image/webp"].includes(detected.mime)) {
  throw new Error("Type de fichier non supporté.");
}
```

---

## Bonnes pratiques déjà en place ✅

| Pratique | Statut |
|----------|--------|
| `.env` exclu du dépôt via `.gitignore` | ✅ |
| Variables d'environnement validées avec Zod (`env.server.ts`) | ✅ |
| Authentification centralisée via Better Auth | ✅ |
| `requireAuth` systématique sur les routes protégées | ✅ |
| Rate limiting sur les endpoints d'authentification | ✅ |
| Validation Zod des formulaires utilisateur (posts, commentaires, profil) | ✅ |
| ORM Drizzle (pas de SQL brut → pas d'injection SQL) | ✅ |
| Redimensionnement des avatars via `sharp` avant stockage | ✅ |
| Vérification d'autorisation ownership avant suppression de post/commentaire | ✅ |
| Secrets retirés de l'historique git (commit `aed5841`) | ✅ |

---

## Actions prioritaires recommandées

1. **Immédiat** — Corriger le path traversal dans `uploads-files.ts` (1 ligne de code).
2. **Court terme** — Ajouter les en-têtes de sécurité HTTP dans `root.tsx`.
3. **Court terme** — Ajouter rate limiting sur les actions de création dans `feed.server.ts`.
4. **Moyen terme** — Typer correctement le rôle dans la Session pour supprimer les `as any`.
5. **Moyen terme** — Valider la longueur des réponses aux micro-prédictions.
6. **Optionnel** — Ajouter détection magic bytes pour les uploads d'avatar.
