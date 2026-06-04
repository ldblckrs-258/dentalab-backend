# DentaLab — GCP Single-VM Deployment Runbook

Plan: `plans/260604-1552-gcp-deployment-single-vm/`. Domain `dentalab.health.vn` (Cloudflare). Storage: Cloudflare R2 (2 buckets). One GCE VM runs everything via docker-compose.

> **Repo layout:** `dentalab-backend` and `dentalab-worker` are SEPARATE git repos. On the VM, clone BOTH as siblings under `/opt/dentalab/app/` so the compose worker build context `../dentalab-worker` resolves. This `deploy/` dir lives inside `dentalab-backend`. Local commands below assume both repos are siblings under your working dir.

Artifacts (paths relative to `dentalab-backend/` unless noted):
- `Dockerfile`, `docker-entrypoint.sh`, `.dockerignore`, `docker-compose.prod.yml`
- `dentalab-worker/Dockerfile`, `.dockerignore` (worker repo)
- `deploy/caddy/Caddyfile`
- `deploy/scripts/{deploy,r2-bootstrap,upload-models-to-r2,pull-models-on-vm}.sh`
- `deploy/gcp/provision.sh`
- `deploy/secrets-templates/*.env.example`

> **Run these yourself** — they need your GCP / Cloudflare credentials and spend the trial credit. Nothing below was executed by the assistant.

## 0. Prereqs (local)
- `gcloud` authed (`gcloud auth login`), `wrangler` authed (`wrangler login`), `aws` cli installed.
- `dentalab-worker/models/onnx/` populated locally (`cd dentalab-worker && python scripts/prepare_models.py --model embedding --quantization auto`).

## 1. Cloudflare R2 (local)
```bash
bash dentalab-backend/deploy/scripts/r2-bootstrap.sh
# In Cloudflare dashboard: attach custom domain cdn.dentalab.health.vn -> dentalab-public (public read).
# Create an R2 API token -> S3 HMAC access key + secret. Keep dentalab-private NON-public.
export R2_ENDPOINT=https://<account_id>.r2.cloudflarestorage.com
aws configure   # use the R2 HMAC keys, region: auto
bash dentalab-backend/deploy/scripts/upload-models-to-r2.sh   # run from dir holding both repos as siblings
```

## 2. GCP VM (local)
```bash
PROJECT=<gcp-project-id> MY_IP=<your.ip> bash dentalab-backend/deploy/gcp/provision.sh
gcloud compute ssh dentalab-vm --zone=asia-southeast1-a
```

## 3. On the VM
```bash
# Docker
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER && newgrp docker
# Layout + clone BOTH repos as siblings under app/
sudo mkdir -p /opt/dentalab/{app,models/onnx,secrets,caddy}
sudo chmod 700 /opt/dentalab/secrets && sudo chown -R $USER /opt/dentalab
git clone <backend-repo-url> /opt/dentalab/app/dentalab-backend
git clone <worker-repo-url>  /opt/dentalab/app/dentalab-worker
cp /opt/dentalab/app/dentalab-backend/deploy/caddy/Caddyfile /opt/dentalab/caddy/Caddyfile
# Models
export R2_ENDPOINT=https://<account_id>.r2.cloudflarestorage.com
aws configure   # R2 HMAC keys
bash /opt/dentalab/app/dentalab-backend/deploy/scripts/pull-models-on-vm.sh
```

## 4. Secrets (on the VM)
Copy each template, fill real values, `chmod 600`:
```bash
cd /opt/dentalab/secrets
cp /opt/dentalab/app/dentalab-backend/deploy/secrets-templates/postgres.env.example   postgres.env
cp /opt/dentalab/app/dentalab-backend/deploy/secrets-templates/rabbitmq.env.example   rabbitmq.env
cp /opt/dentalab/app/dentalab-backend/deploy/secrets-templates/backend.env.example    backend.env
cp /opt/dentalab/app/dentalab-backend/deploy/secrets-templates/worker.env.example     worker.env
# Generate: openssl rand -base64 32   (for JWT_SECRET, AI_CONFIG_ENCRYPTION_KEY, AUDIT_REDACTION_HMAC_KEY, BOOKING_*)
chmod 600 *.env
# DB/RabbitMQ passwords must match across files; RAG_SERVICE_TOKEN must match backend<->worker.
```

## 5. DNS (Cloudflare)
- `A api.dentalab.health.vn -> <VM static IP>`  **proxy OFF (grey)**.
- `CNAME app.dentalab.health.vn -> <vercel-target>` (add domain in Vercel project).
- `CNAME cdn.dentalab.health.vn -> <R2 public bucket>` (from step 1).

## 6. First boot (on the VM)
```bash
cd /opt/dentalab/app
docker compose -f dentalab-backend/docker-compose.prod.yml up -d --build
# migrate deploy runs automatically via entrypoint. Then seed admin ONCE:
# Use the COMPILED seed (runner has no src/ for ts-node):
docker compose -f dentalab-backend/docker-compose.prod.yml exec backend node dist/prisma/seed.js
docker compose -f dentalab-backend/docker-compose.prod.yml ps
```

## 7. Verify (Phase 8)
- `curl https://api.dentalab.health.vn/health/live` -> 200, valid cert.
- Login from `app.dentalab.health.vn`; confirm token refresh (cookie round-trips).
- wss connects; upload doc -> appears in `dentalab-private`; avatar -> `cdn.`.
- **Presigned download in a browser -> 200, not 403.** If 403: attach an R2 custom domain to `dentalab-private` OR set `forcePathStyle:false` in `dentalab-backend/src/modules/storage/storage.module.ts` and rebuild.
- Upload a Vietnamese PDF -> worker logs non-empty OCR text + pgvector rows.
- RAG chat returns answer + citations.
- Reboot VM -> services auto-start; worker logs show NO HF re-download.

## 8. Redeploy
```bash
ssh dentalab-vm 'R2_ENDPOINT=https://<account_id>.r2.cloudflarestorage.com /opt/dentalab/app/deploy/scripts/deploy.sh'
```
Snapshots DB to `dentalab-private/backups/` before each deploy.

## Monitoring
- GCP Cloud Monitoring uptime check on `https://api.dentalab.health.vn/health/ready` + email alert.
- Optional Ops Agent for VM memory (worker OOM early warning).

## ⚠️ Freeze deploys during the thesis defense window
Do NOT run `deploy.sh` (rebuilds worker → ~minutes of RAG downtime) while presenting.

## Notes / deferred
- Daily-cron DB backup deferred; mitigated by per-deploy snapshot. No protection against disk loss between deploys.
- Single VM = no HA. `restart: unless-stopped` + uptime alert is the safety net.
