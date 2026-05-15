# Rapport d'Audit Sécurité — Penya Blaugrana Nantes

**Date :** 15 mai 2026  
**Branche analysée :** `main` (commit `003faca`)  
**Périmètre :** Application React Router 7 / TypeScript / Drizzle ORM / Better Auth  

---

## Résumé des derniers commits

| Commit | Date | Description |
|--------|------|-------------|
| `003faca` | 13 avr. 2026 | fix: évaluer les badges immédiatement après chaque action (pronostic, post, commentaire, réaction) |
| `b1c88f6` | 13 avr. 2026 | feat: Phase 2 — soirée match live, micro-pronos, badges, séries, saisons (2 965 lignes ajoutées) |
| `d461ee5` | 12 avr. 2026 | Merge branch deploy-synology-nas |
| `554b873` | 12 avr. 2026 | docs: guide de déploiement NAS Synology (mises à jour, logs, backups, admin) |
| `68e22d2` | 13 avr. 2026 | feat: menu burger mobile pour la navigation |

Le commit `b1c88f6` représente le travail le plus conséquent : ajout des routes `/soiree/:matchId`, `/badges`, des micro-pronostics, du système de séries et de la gestion des saisons, avec une nouvelle migration DB (0007).

---

## Bilan des vulnérabilités

| Criticité | Nombre |
|-----------|--------|
| CRITIQUE  | 2      |
| HAUTE     | 3      |
| MOYENNE   | 3      |
| FAIBLE    | 2      |
| **Total** | **10** |

---

## CRITIQUE

### C-1 — Path Traversal sur le service de fichiers uploadés

**Fichier :** `app/routes/uploads-files.ts` (lignes 4–5)  
**Vecteur :** `GET /uploads/../../../../etc/passwd`

```typescript
// Code vulnérable
const filePath = path.join(process.cwd(), "uploads", params["*"]);
const file = await readFile(filePath); // Aucune vérification de confinement
```

`path.join()` résout les séquences `../` sans vérifier que le chemin final reste dans le répertoire `uploads/`. Un attaquant non authentifié peut lire n'importe quel fichier accessible par le processus Node : fichiers de configuration, variables d'environnement, code source.

**Correction recommandée :**

```typescript
const uploadsDir = path.resolve(process.cwd(), "uploads");
const filePath = path.resolve(uploadsDir, params["*"]);

// Rejeter si le chemin sort du répertoire autorisé
if (!filePath.startsWith(uploadsDir + path.sep)) {
  return new Response("Forbidden", { status: 403 });
}
```

---

### C-2 — Absence de protection CSRF sur toutes les actions de formulaire

**Fichiers concernés :** `app/routes/feed.server.ts`, `app/routes/profile.server.ts`, `app/routes/admin.matches.server.ts`, `app/routes/api.micro-predictions.ts`, et tous les handlers `action()`

Aucun token CSRF n'est validé dans les actions. React Router 7 ne fournit pas de protection CSRF automatique — elle doit être implémentée manuellement. Un attaquant peut forger une requête cross-site qui crée des posts, vote à des micro-pronos, ou modifie des données au nom de la victime authentifiée.

**Correction recommandée :**

1. Générer un token CSRF côté serveur, le stocker en session, l'injecter dans chaque formulaire via un champ `<input type="hidden">`.
2. Valider le token dans chaque `action()` avant tout traitement.
3. Configurer les cookies de session avec `SameSite=Strict`.

---

## HAUTE

### H-1 — Mots de passe par défaut dans la configuration Docker de production

**Fichier :** `docker-compose.prod.yml` (lignes 22 et 32)

```yaml
POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-changeme}
command: redis-server --requirepass ${REDIS_PASSWORD:-changeme}
```

Si `.env` n'est pas créé avant le premier déploiement, PostgreSQL et Redis démarrent avec `changeme`. Redis est particulièrement risqué : il peut être utilisé pour lire/écrire les sessions Better Auth stockées.

**Correction recommandée :**

- Supprimer les valeurs par défaut `:-changeme` pour forcer une erreur de démarrage plutôt qu'un déploiement non sécurisé.
- Ajouter une validation dans le script de démarrage qui refuse de lancer l'application si `POSTGRES_PASSWORD` ou `REDIS_PASSWORD` sont absents ou égaux à `changeme`.

---

### H-2 — En-têtes de sécurité HTTP absents dans nginx

**Fichier :** `docker/nginx/nginx.conf`

Le reverse proxy ne définit aucun en-tête de sécurité. Un attaquant peut exploiter des failles de clickjacking, de MIME sniffing, ou forcer des connexions non chiffrées.

**En-têtes manquants :**

```nginx
add_header X-Frame-Options "SAMEORIGIN" always;
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Permissions-Policy "geolocation=(), camera=(), microphone=()" always;
# En production avec HTTPS :
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
add_header Content-Security-Policy "default-src 'self'; img-src 'self' data:; script-src 'self'" always;
```

---

### H-3 — Rate limiting contournable par usurpation d'IP

**Fichier :** `app/routes/api.auth.$.ts` (lignes 5–11)

```typescript
request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
```

nginx transmet le header `X-Forwarded-For` en ajoutant l'IP réelle à la fin (`$proxy_add_x_forwarded_for`), mais ne supprime pas les valeurs fournies par le client. Un attaquant peut envoyer `X-Forwarded-For: 1.2.3.4` pour que la valeur `[0]` lue corresponde à une IP fictive, contournant ainsi le rate limiting sur `/sign-in` (10 tentatives/15 min) et `/sign-up` (5 tentatives/h).

**Correction recommandée :**

Dans nginx, remplacer la valeur du header avant de la transmettre :

```nginx
proxy_set_header X-Real-IP $remote_addr;
# Remplacer, pas ajouter :
proxy_set_header X-Forwarded-For $remote_addr;
```

Côté application, utiliser uniquement `X-Real-IP` pour le rate limiting.

---

## MOYENNE

### M-1 — Validation MIME uniquement pour les uploads (sans vérification du contenu binaire)

**Fichier :** `app/lib/server/upload.ts` (ligne 11)

```typescript
if (!ALLOWED_TYPES.includes(file.type)) { ... }
```

`file.type` est fourni par le client et peut être falsifié. Un fichier `.php` avec le header `Content-Type: image/jpeg` passe la validation. La re-encodage Sharp atténue partiellement le risque (les fichiers corrompus lèvent une exception), mais une exécution de Sharp sur un fichier malformé peut aussi exposer à des vulnérabilités dans la bibliothèque native `libvips`.

**Correction recommandée :**

Vérifier les magic bytes du fichier avant de passer à Sharp :

```typescript
const buffer = Buffer.from(await file.arrayBuffer());
const isJpeg = buffer[0] === 0xFF && buffer[1] === 0xD8;
const isPng  = buffer.toString("hex", 0, 4) === "89504e47";
const isWebp = buffer.toString("ascii", 8, 12) === "WEBP";
if (!isJpeg && !isPng && !isWebp) throw new Error("Format invalide.");
```

---

### M-2 — JSON.parse non protégé sur les options des micro-pronostics

**Fichier :** `app/routes/soiree.server.ts` (ligne ~250)

```typescript
options: m.options ? JSON.parse(m.options) as string[] : [],
```

Si la colonne `options` en base contient une valeur JSON malformée (bug de migration, injection manuelle), `JSON.parse` lève une exception non capturée qui provoque un crash de la page `/soiree/:matchId` pour tous les utilisateurs.

**Correction recommandée :**

```typescript
options: (() => {
  try { return m.options ? JSON.parse(m.options) : []; }
  catch { return []; }
})(),
```

---

### M-3 — Absence de limite sur le nombre d'options des micro-pronostics

**Fichier :** `app/routes/api.micro-predictions.ts` (lignes 22–28)

```typescript
const options = optionsRaw ? JSON.stringify(optionsRaw.split(",").map((o) => o.trim())) : null;
```

Aucune validation du nombre ni de la longueur des options. Un admin peut créer un micro-pronostic avec des centaines d'options ou des chaînes très longues, provoquant une surcharge lors de l'affichage ou du stockage.

**Correction recommandée :**

```typescript
const optionsList = optionsRaw?.split(",").map(o => o.trim()).filter(Boolean) ?? [];
if (optionsList.length > 10) return Response.json({ error: "10 options maximum." }, { status: 400 });
if (optionsList.some(o => o.length > 100)) return Response.json({ error: "Option trop longue." }, { status: 400 });
```

---

## FAIBLE

### F-1 — URL Redis sans authentification si REDIS_PASSWORD absent de REDIS_URL

**Fichier :** `app/lib/server/redis.server.ts`

```typescript
export const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379", {...});
```

Si `REDIS_URL` ne contient pas le mot de passe (ex : `redis://localhost:6379` au lieu de `redis://:password@localhost:6379`), la connexion Redis est non authentifiée même si Redis est configuré avec `--requirepass`. Les sessions Better Auth seraient alors illisibles (erreur `NOAUTH`), mais ce cas peut passer inaperçu en développement.

**Correction recommandée :** Valider le format de `REDIS_URL` dans `env.server.ts` et documenter explicitement la forme attendue en production.

---

### F-2 — Stack trace exposée côté client en mode développement

**Fichier :** `app/root.tsx` (ligne ~95)

```typescript
if (import.meta.env.DEV && error instanceof Error) {
  details = error.message;
  stack = error.stack; // Envoyé au navigateur
}
```

En mode `DEV`, les stack traces complètes (chemins de fichiers, noms de fonctions internes, structure de la DB) sont renvoyées au client. Si un environnement de staging ou de pré-production tourne avec `NODE_ENV=development`, ces informations seraient exposées.

**Correction recommandée :** Limiter l'exposition aux erreurs en vérifiant aussi l'hôte (`localhost`) en plus du flag `DEV`.

---

## Points positifs identifiés

- **SQL Injection** : Drizzle ORM avec requêtes paramétrées — aucune injection SQL possible.
- **Authentification** : Better Auth est une librairie sérieuse, bien configurée (trustedOrigins, secondaryStorage Redis, rôles).
- **Rate limiting** : Implémentation Redis fonctionnelle et testée unitairement sur `/sign-in` et `/sign-up`.
- **Contrôle des rôles** : Vérification `requireAuth(request, ["admin"])` systématique sur les routes admin et API sensibles.
- **Validation des formulaires** : Utilisation de Zod visible sur plusieurs routes.
- **Taille des uploads** : Limite à 2 Mo et re-encodage Sharp → les fichiers valides sont assainis.
- **Secrets hors dépôt** : `.gitignore` couvre correctement `.env`, `uploads/`, et `node_modules/`.

---

## Plan d'action recommandé

### Immédiat (avant prochain déploiement)

1. **[C-1]** Ajouter la vérification de confinement de chemin dans `uploads-files.ts`
2. **[H-1]** Supprimer les fallbacks `:-changeme` dans `docker-compose.prod.yml`
3. **[H-2]** Ajouter les en-têtes de sécurité dans `nginx.conf`

### Court terme (sprint suivant)

4. **[C-2]** Implémenter la protection CSRF sur toutes les actions
5. **[H-3]** Corriger la lecture de l'IP cliente dans nginx et l'application
6. **[M-1]** Ajouter la vérification des magic bytes avant Sharp

### Moyen terme

7. **[M-2]** Sécuriser les `JSON.parse` critiques avec try/catch
8. **[M-3]** Ajouter une validation Zod complète sur les options de micro-pronostics
9. **[F-1]** Valider le format `REDIS_URL` au démarrage
