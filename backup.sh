#!/bin/bash
set -euo pipefail
# Script de sauvegarde automatique de la base PostgreSQL
# Planifier dans DSM > Panneau de configuration > Planificateur de taches

BACKUP_DIR="/volume1/docker/backups/penya"
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/penya_$DATE.sql"

mkdir -p "$BACKUP_DIR"

# Dump de la base
if ! docker compose -f /volume1/docker/penya-barca-nantes/docker-compose.prod.yml \
  exec -T postgres pg_dump -U penya penya_barca_nantes \
  > "$BACKUP_FILE"; then
  echo "ERREUR : backup échoué, suppression du fichier partiel." >&2
  rm -f "$BACKUP_FILE"
  exit 1
fi

# Garder les 30 derniers backups
ls -t "$BACKUP_DIR"/*.sql | tail -n +31 | xargs rm -f 2>/dev/null || true

echo "Backup terminé : penya_$DATE.sql"
