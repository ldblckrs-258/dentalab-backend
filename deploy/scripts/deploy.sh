#!/usr/bin/env bash
# Manual deploy: snapshot DB to R2, pull both repos, rebuild, restart.
# Run from your machine: gcloud compute ssh dentalab-vm --zone=asia-southeast1-a --command='/opt/dentalab/app/dentalab-backend/deploy/scripts/deploy.sh'
set -euo pipefail

APP_DIR=/opt/dentalab/app
COMPOSE_FILE="$APP_DIR/dentalab-backend/docker-compose.prod.yml"
SECRETS_FILE="${SECRETS_FILE:-/opt/dentalab/secrets/backend.env}"
BACKUP_BUCKET="${BACKUP_BUCKET:-dentalab-private}"
AWSCLI_IMAGE="${AWSCLI_IMAGE:-amazon/aws-cli:2.17.0}"

read_secret() { sudo sed -n "s/^$1=//p" "$SECRETS_FILE" | tr -d '\r'; }
export AWS_ACCESS_KEY_ID="$(read_secret S3_ACCESS_KEY)"
export AWS_SECRET_ACCESS_KEY="$(read_secret S3_SECRET_KEY)"
R2_ENDPOINT="${R2_ENDPOINT:-$(read_secret S3_ENDPOINT)}"
: "${AWS_ACCESS_KEY_ID:?missing S3_ACCESS_KEY in $SECRETS_FILE}"
: "${R2_ENDPOINT:?missing S3_ENDPOINT in $SECRETS_FILE}"

echo "[deploy] 1/4 Pre-deploy DB snapshot -> R2"
TS=$(date +%Y%m%d-%H%M%S)
docker compose -f "$COMPOSE_FILE" exec -T postgres \
  pg_dump -U dentalab dentalab \
  | gzip \
  | docker run --rm -i \
      -e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY \
      "$AWSCLI_IMAGE" \
      s3 cp - "s3://${BACKUP_BUCKET}/backups/db-${TS}.sql.gz" --endpoint-url "$R2_ENDPOINT"
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
