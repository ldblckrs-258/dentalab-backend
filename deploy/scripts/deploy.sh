#!/usr/bin/env bash
# Manual deploy: snapshot DB to R2, pull both repos, rebuild, restart.
# Run from your machine: ssh dentalab-vm '/opt/dentalab/app/dentalab-backend/deploy/scripts/deploy.sh'
set -euo pipefail

APP_DIR=/opt/dentalab/app
COMPOSE_FILE="$APP_DIR/dentalab-backend/docker-compose.prod.yml"
R2_ENDPOINT="${R2_ENDPOINT:?set R2_ENDPOINT=https://<acct>.r2.cloudflarestorage.com}"
BACKUP_BUCKET="${BACKUP_BUCKET:-dentalab-private}"

echo "[deploy] 1/4 Pre-deploy DB snapshot -> R2"
TS=$(date +%Y%m%d-%H%M%S)
docker compose -f "$COMPOSE_FILE" exec -T postgres \
  pg_dump -U dentalab dentalab \
  | gzip \
  | aws s3 cp - "s3://${BACKUP_BUCKET}/backups/db-${TS}.sql.gz" --endpoint-url "$R2_ENDPOINT"
echo "[deploy]     snapshot: s3://${BACKUP_BUCKET}/backups/db-${TS}.sql.gz"

echo "[deploy] 2/4 git pull (both repos)"
git -C "$APP_DIR/dentalab-backend" pull --ff-only
git -C "$APP_DIR/dentalab-worker" pull --ff-only

echo "[deploy] 3/4 build + restart"
docker compose -f "$COMPOSE_FILE" up -d --build

echo "[deploy] 4/4 prune dangling images"
docker image prune -f

echo "[deploy] done. Status:"
docker compose -f "$COMPOSE_FILE" ps
