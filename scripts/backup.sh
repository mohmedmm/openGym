#!/usr/bin/env bash
set -e

BACKUP_DIR="/var/www/apps/gym/backups"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
FILENAME="$BACKUP_DIR/gym_nbox_$TIMESTAMP.sql.gz"

mkdir -p "$BACKUP_DIR"

# Dump PostgreSQL database
docker exec gym_postgres pg_dump -U gym_user gym_nbox | gzip > "$FILENAME"

# Also snapshot /data directory if needed
if [ -d "/var/www/apps/gym/data" ]; then
    tar -czf "$BACKUP_DIR/gym_data_$TIMESTAMP.tar.gz" -C /var/www/apps/gym data/ 2>/dev/null || true
fi

# Rotate backups: keep only last 14 days
find "$BACKUP_DIR" -type f -name "*.gz" -mtime +14 -delete

echo "[$(date)] Backup completed: $FILENAME"

