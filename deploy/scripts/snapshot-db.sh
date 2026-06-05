#!/usr/bin/env bash
# Snapshot the Postgres DB to R2 (dentalab-private/backups/). Runs ON the VM.
# Streams pg_dump | gzip straight to R2 via a containerized aws-cli (no host aws-cli).
# R2 credentials are read from the backend secrets file.
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

TS=$(date +%Y%m%d-%H%M%S)
docker compose -f "$COMPOSE_FILE" exec -T postgres \
  pg_dump -U dentalab dentalab \
  | gzip \
  | docker run --rm -i \
      -e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY \
      "$AWSCLI_IMAGE" \
      s3 cp - "s3://${BACKUP_BUCKET}/backups/db-${TS}.sql.gz" --endpoint-url "$R2_ENDPOINT"
echo "[snapshot] s3://${BACKUP_BUCKET}/backups/db-${TS}.sql.gz"
