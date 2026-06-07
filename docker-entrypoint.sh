#!/bin/sh
set -e

echo "[entrypoint] Applying database migrations..."
node_modules/.bin/prisma migrate deploy

echo "[entrypoint] Seeding database..."
node dist/prisma/seed.js

echo "[entrypoint] Starting backend..."
exec node dist/src/main
