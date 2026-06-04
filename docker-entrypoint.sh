#!/bin/sh
set -e

echo "[entrypoint] Applying database migrations..."
node_modules/.bin/prisma migrate deploy

echo "[entrypoint] Starting backend..."
exec node dist/src/main
