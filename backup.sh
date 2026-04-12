#!/bin/bash
# Script de sauvegarde automatique de la base PostgreSQL
# Planifier dans DSM > Panneau de configuration > Planificateur de taches

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
