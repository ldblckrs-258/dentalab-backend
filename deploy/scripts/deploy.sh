#!/usr/bin/env bash
# Redeploy DentaLab to the GCP VM. RUN FROM YOUR LOCAL MACHINE (needs gcloud + rsync).
#   ./dentalab-backend/deploy/scripts/deploy.sh
#
# The VM is NOT a git checkout — code is shipped by rsync (no GitHub creds needed).
# Steps: sync local source -> VM, snapshot DB -> R2, rebuild + restart containers.
set -euo pipefail

VM="${VM:-dentalab-vm}"
ZONE="${ZONE:-asia-southeast1-a}"
REMOTE_APP=/opt/dentalab/app
COMPOSE="$REMOTE_APP/dentalab-backend/docker-compose.prod.yml"

# DentaLab/ root (3 levels up from this script) holds both repos.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOCAL_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

ssh_vm() { gcloud compute ssh "$VM" --zone="$ZONE" --command="$1"; }

echo "[1/5] prepare VM (ssh alias, rsync, ownership)"
gcloud compute config-ssh --quiet >/dev/null
SSH_ALIAS="$VM.$ZONE.$(gcloud config get-value project 2>/dev/null)"
ssh_vm 'command -v rsync >/dev/null || { sudo apt-get update -qq && sudo apt-get install -y -qq rsync; }; sudo chown -R "$USER" /opt/dentalab/app'

echo "[2/5] rsync source -> VM"
EXCLUDES=(--exclude '.git' --exclude 'node_modules' --exclude 'dist'
  --exclude '.env' --exclude '.env.local' --exclude '__pycache__' --exclude '.venv'
  --exclude '.hf_cache' --exclude 'models/onnx' --exclude '*.onnx' --exclude '*.onnx.data'
  --exclude '.DS_Store' --exclude '._*')
for repo in dentalab-backend dentalab-worker; do
  echo "  -> $repo"
  rsync -az --delete "${EXCLUDES[@]}" -e ssh \
    "$LOCAL_ROOT/$repo/" "$SSH_ALIAS:$REMOTE_APP/$repo/"
done

echo "[3/5] pre-deploy DB snapshot -> R2"
ssh_vm "$REMOTE_APP/dentalab-backend/deploy/scripts/snapshot-db.sh" || echo "  (snapshot failed; continuing)"

echo "[4/5] build + restart on VM"
ssh_vm "docker compose -f $COMPOSE up -d --build && docker image prune -f"

echo "[5/5] status"
ssh_vm "docker compose -f $COMPOSE ps"
echo "[deploy] done."
