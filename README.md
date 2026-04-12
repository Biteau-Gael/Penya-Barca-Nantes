# Penya Blaugrana Nantes

Application communautaire pour la Penya Blaugrana de Nantes. Pronostics, calendrier des matchs du FC Barcelone, classement, fil d'actualité et gestion des membres.

## Stack technique

| Composant | Technologie |
|-----------|-------------|
| Framework | React Router 7 (SSR, full-stack) |
| Runtime | Node.js 20 |
| Langage | TypeScript 5 (strict) |
| Base de donnees | PostgreSQL 16 |
| ORM | Drizzle ORM |
| Cache / Sessions | Redis 7 |
| Authentification | Better Auth |
| Style | Tailwind CSS 4 + shadcn/ui |
| Build | Vite 8 |
| Reverse proxy | Nginx |
| Conteneurisation | Docker + Docker Compose |

## Fonctionnalites

- **Pronostics** : les membres pronostiquent les scores des matchs du Barca, points calcules automatiquement
- **Classement** : leaderboard des pronostiqueurs avec points, taux de reussite
- **Calendrier** : matchs synchronises via l'API RapidAPI (Free API Live Football Data), forme recente
- **Stats enrichies** : compositions, buteurs, cartons, statistiques par match (possession, xG, tirs...)
- **Classement Liga** : classement en temps reel de la Liga
- **Fil communautaire** : posts, reactions, commentaires
- **Profils** : avatar, pseudo, historique des pronostics, stats personnelles
- **Admin** : dashboard, gestion matchs/membres/evenements, moderation, sync API
- **Evenements** : gestion des evenements hors-match de la penya

## Architecture

```
app/
  components/       # Composants UI reutilisables (shadcn/ui, layout)
  config/           # Configuration (env, auth)
  db/
    client.ts       # Connexion PostgreSQL (pg + Drizzle)
    schema/         # Schema Drizzle (users, matches, predictions, posts...)
    migrations/     # Migrations SQL generees par drizzle-kit
  lib/
    server/         # Logique serveur (auth, API Football, logger, upload)
    validation/     # Schemas Zod (partages front/back)
  routes/           # Routes React Router (loaders + actions + UI)
docker/
  nginx/            # Config Nginx
  postgres/         # Script init SQL
```

## Developpement local

### Prerequis

- Node.js 20+
- Docker et Docker Compose (pour PostgreSQL et Redis)

### Installation

```bash
# Cloner le repo
git clone https://github.com/Biteau-Gael/Penya-Barca-Nantes.git
cd Penya-Barca-Nantes

# Installer les dependances
npm install

# Configurer l'environnement
cp .env.example .env
```

### Variables d'environnement

Editer le fichier `.env` :

```env
# App
NODE_ENV=development
PORT=3000
LOG_LEVEL=debug

# Base de donnees
DATABASE_URL=postgresql://penya:penya_secret@localhost:5432/penya_barca_nantes

# Redis
REDIS_URL=redis://localhost:6379

# Auth - generer un secret fort en production
AUTH_SECRET=change-me-in-production-min-16-chars

# API Football (RapidAPI) - optionnel, pour la sync des matchs
API_FOOTBALL_KEY=votre-cle-rapidapi
```

### Demarrer les services

```bash
# Demarrer PostgreSQL + Redis
docker compose up postgres redis -d

# Appliquer les migrations
npx drizzle-kit push

# Demarrer le serveur de dev
npm run dev
```

L'application est disponible sur `http://localhost:5173`.

### Scripts disponibles

| Commande | Description |
|----------|-------------|
| `npm run dev` | Serveur de dev avec HMR |
| `npm run build` | Build de production |
| `npm run start` | Demarrer le serveur de production |
| `npm run typecheck` | Verification TypeScript |
| `npm run test` | Lancer les tests (Vitest) |
| `npx drizzle-kit generate` | Generer une migration |
| `npx drizzle-kit push` | Appliquer les migrations |

---

## Deploiement sur NAS Synology

### Prerequis Synology

1. **DSM 7.2+** installe sur le NAS
2. **Container Manager** (anciennement Docker) installe depuis le Centre de paquets
3. Un **nom de domaine** pointe vers l'IP publique du NAS (ex: `penya.example.com`)
4. Les **ports 80 et 443** rediriges vers le NAS dans la box internet

### Etape 1 : Preparer le projet

Sur votre machine locale, builder et pousser le projet :

```bash
# S'assurer que le build passe
npm run build
```

### Etape 2 : Transferer les fichiers sur le NAS

Methode recommandee : **Git** directement sur le NAS.

Via SSH sur le NAS :
```bash
# Se connecter en SSH
ssh admin@ip-du-nas

# Creer le dossier du projet
mkdir -p /volume1/docker/penya-barca-nantes
cd /volume1/docker/penya-barca-nantes

# Cloner le repo
git clone https://github.com/Biteau-Gael/Penya-Barca-Nantes.git .
```

Alternative : transferer via **File Station** dans le dossier partage `docker`.

### Etape 3 : Configurer l'environnement de production

Creer le fichier `.env` sur le NAS :

```bash
cat > .env << 'EOF'
NODE_ENV=production
PORT=3000
LOG_LEVEL=info

DATABASE_URL=postgresql://penya:VOTRE_MOT_DE_PASSE_FORT@postgres:5432/penya_barca_nantes

REDIS_URL=redis://redis:6379

# Generer avec : openssl rand -base64 32
AUTH_SECRET=VOTRE_SECRET_AUTH_GENERE

# Cle RapidAPI
API_FOOTBALL_KEY=votre-cle-rapidapi
EOF
```

**Important** : changer les valeurs par defaut :
- `VOTRE_MOT_DE_PASSE_FORT` : mot de passe PostgreSQL fort
- `VOTRE_SECRET_AUTH_GENERE` : generer avec `openssl rand -base64 32`
- `API_FOOTBALL_KEY` : votre cle RapidAPI

Mettre a jour le mot de passe dans `docker-compose.yml` egalement :

```yaml
# Dans la section postgres > environment
- POSTGRES_PASSWORD=VOTRE_MOT_DE_PASSE_FORT
```

### Etape 4 : Adapter docker-compose.yml pour la production

Creer un fichier `docker-compose.prod.yml` :

```yaml
services:
  app:
    build: .
    ports:
      - "3000:3000"
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    env_file: .env
    restart: unless-stopped

  postgres:
    image: postgres:16-alpine
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./docker/postgres/init.sql:/docker-entrypoint-initdb.d/init.sql
    environment:
      - POSTGRES_DB=penya_barca_nantes
      - POSTGRES_USER=penya
      - POSTGRES_PASSWORD=VOTRE_MOT_DE_PASSE_FORT
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U penya -d penya_barca_nantes"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    command: redis-server --requirepass VOTRE_MOT_DE_PASSE_REDIS
    healthcheck:
      test: ["CMD", "redis-cli", "-a", "VOTRE_MOT_DE_PASSE_REDIS", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: unless-stopped

volumes:
  pgdata:
```

> Note : en production sur Synology, Nginx n'est pas necessaire dans Docker car le **Reverse Proxy** integre a DSM remplace cette fonction.

Si vous utilisez un mot de passe Redis, mettre a jour `REDIS_URL` dans `.env` :
```
REDIS_URL=redis://:VOTRE_MOT_DE_PASSE_REDIS@redis:6379
```

### Etape 5 : Builder et lancer

Via SSH sur le NAS :

```bash
cd /volume1/docker/penya-barca-nantes

# Builder et demarrer
docker compose -f docker-compose.prod.yml up -d --build

# Verifier que les conteneurs tournent
docker compose -f docker-compose.prod.yml ps

# Voir les logs
docker compose -f docker-compose.prod.yml logs -f app
```

### Etape 6 : Appliquer les migrations de base de donnees

```bash
# Executer les migrations dans le conteneur app
docker compose -f docker-compose.prod.yml exec app npx drizzle-kit push
```

### Etape 7 : Configurer le Reverse Proxy Synology

Dans **DSM > Panneau de configuration > Portail de connexion > Avance > Proxy inverse** :

1. Cliquer **Creer**
2. Configurer :
   - **Nom** : `Penya Barca Nantes`
   - **Source** :
     - Protocole : `HTTPS`
     - Nom d'hote : `penya.example.com` (votre domaine)
     - Port : `443`
     - Activer HSTS : oui
   - **Destination** :
     - Protocole : `HTTP`
     - Nom d'hote : `localhost`
     - Port : `3000`
3. Onglet **En-tetes personnalises** > cliquer **Creer** > **WebSocket** (active les headers Upgrade pour le temps reel)
4. Sauvegarder

### Etape 8 : Certificat SSL (Let's Encrypt)

Dans **DSM > Panneau de configuration > Securite > Certificat** :

1. Cliquer **Ajouter**
2. Choisir **Ajouter un nouveau certificat**
3. Selectionner **Obtenir un certificat aupres de Let's Encrypt**
4. Renseigner :
   - Nom de domaine : `penya.example.com`
   - Email : votre email
5. Valider
6. Dans **Configurer**, assigner ce certificat au reverse proxy `Penya Barca Nantes`

### Etape 9 : Verifier le deploiement

```bash
# Tester en local sur le NAS
curl http://localhost:3000/api/health

# Tester depuis l'exterieur
curl https://penya.example.com/api/health
```

---

## Mise a jour de l'application

Pour deployer une nouvelle version :

```bash
# Sur le NAS via SSH
cd /volume1/docker/penya-barca-nantes

# Recuperer les changements
git pull origin main

# Rebuilder et redemarrer
docker compose -f docker-compose.prod.yml up -d --build

# Appliquer les nouvelles migrations si necessaire
docker compose -f docker-compose.prod.yml exec app npx drizzle-kit push
```

## Sauvegardes

### Base de donnees PostgreSQL

Creer un script de backup automatise :

```bash
#!/bin/bash
# /volume1/docker/penya-barca-nantes/backup.sh

BACKUP_DIR="/volume1/docker/backups/penya"
DATE=$(date +%Y%m%d_%H%M%S)

mkdir -p "$BACKUP_DIR"

# Dump de la base
docker compose -f /volume1/docker/penya-barca-nantes/docker-compose.prod.yml \
  exec -T postgres pg_dump -U penya penya_barca_nantes \
  > "$BACKUP_DIR/penya_$DATE.sql"

# Garder les 30 derniers backups
ls -t "$BACKUP_DIR"/*.sql | tail -n +31 | xargs rm -f 2>/dev/null

echo "Backup termine : penya_$DATE.sql"
```

Planifier dans **DSM > Panneau de configuration > Planificateur de taches** :
- Type : Script defini par l'utilisateur
- Frequence : quotidienne a 3h du matin
- Script : `bash /volume1/docker/penya-barca-nantes/backup.sh`

### Restauration

```bash
# Restaurer un backup
cat backup_file.sql | docker compose -f docker-compose.prod.yml \
  exec -T postgres psql -U penya penya_barca_nantes
```

## Monitoring

### Logs

```bash
# Tous les logs
docker compose -f docker-compose.prod.yml logs -f

# Logs de l'app seulement
docker compose -f docker-compose.prod.yml logs -f app

# Logs structures (JSON Pino) - utiliser pino-pretty pour la lisibilite
docker compose -f docker-compose.prod.yml logs app | npx pino-pretty
```

### Sante des services

```bash
# Statut des conteneurs
docker compose -f docker-compose.prod.yml ps

# Health check
curl http://localhost:3000/api/health
```

## API Football (RapidAPI)

L'app utilise l'API **Free API Live Football Data** via RapidAPI pour synchroniser les matchs du Barca.

### Obtenir une cle API

1. Creer un compte sur [rapidapi.com](https://rapidapi.com)
2. S'abonner a [Free API Live Football Data](https://rapidapi.com/Suspended/api/free-api-live-football-data)
3. Copier la cle `X-RapidAPI-Key` dans la variable `API_FOOTBALL_KEY`

### Synchronisation des matchs

La synchronisation se lance depuis le panneau admin (`/admin/matchs` > bouton "Synchroniser"). Elle :
- Recupere les matchs du Barca dans 4 competitions (Liga, Champions League, Copa del Rey, Supercoupe)
- Cree ou met a jour les matchs en base
- Calcule automatiquement les points des pronostics quand un score final arrive
- Fixe la deadline des pronostics a 1h avant le coup d'envoi
- Invalide le cache du classement Liga

### Donnees enrichies

Quand un utilisateur consulte un match termine, l'app recupere automatiquement (et met en cache) :
- Compositions des deux equipes (formation, titulaires, remplacants, entraineur)
- Evenements (buts, passes decisives, cartons, remplacements)
- Statistiques completes (possession, xG, tirs, passes, corners, fautes...)
- Lien vers le resume video YouTube

---

Construit pour la communaute Blaugrana de Nantes.
