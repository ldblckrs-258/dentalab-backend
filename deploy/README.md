# DentaLab — GCP Single-VM Deployment Runbook

One GCE VM runs the whole stack via docker-compose: NestJS backend, Python RAG worker, Postgres (pgvector), Redis, RabbitMQ, Caddy (TLS). Storage on Cloudflare R2; DNS on Cloudflare; frontend on Vercel.

> **Status: LIVE.** This stack is deployed and serving. This runbook is the source of truth for day-to-day **redeploys**, **operations**, and **disaster recovery** (rebuild from scratch).
>
> **Secrets live in `plans/cicd/secrets.md`** (private, gitignored — outside any repo). This file contains **no credentials**; fill real values from there.

## Topology

| Thing | Value |
|---|---|
| GCP project | `project-5e55d3e0-646f-498d-bc2` |
| VM | `dentalab-vm` · zone `asia-southeast1-a` · `e2-standard-4` · Ubuntu 22.04 |
| Static IP | `34.21.143.173` |
| Backend | `https://api.dentalab.health.vn` (Caddy → backend:3000, Let's Encrypt) |
| Frontend | `https://app.dentalab.health.vn` (Vercel) |
| Public CDN | `https://cdn.dentalab.health.vn` (R2 custom domain → `dentalab-public`) |
| R2 buckets | `dentalab-public` (avatars), `dentalab-private` (docs/files/backups) |
| RAG inference | **Remote-only — Novita** (OpenAI-compatible): embeddings (BGE-M3) + reranking (BGE-reranker-v2-m3). No local models. |
| App dir (VM) | `/opt/dentalab/app/{dentalab-backend,dentalab-worker}` (siblings) |
| Secrets (VM) | `/opt/dentalab/secrets/*.env` (chmod 600) |
| Compose file | `/opt/dentalab/app/dentalab-backend/docker-compose.prod.yml` |

> **The VM is NOT a git checkout.** Source is shipped by **rsync** from your local machine (no GitHub creds on the VM). The two repos must sit as siblings under `/opt/dentalab/app/` so the worker build context `../dentalab-worker` resolves.

---

## A. Redeploy (day-to-day)

Run from your **local machine** (needs `gcloud` authed + `rsync`), from the dir holding both repos as siblings:

```bash
./dentalab-backend/deploy/scripts/deploy.sh
```

What it does: prep VM (ssh alias + fix ownership) → **rsync** both repos to the VM → **snapshot DB to R2** (`dentalab-private/backups/db-<ts>.sql.gz`) → `docker compose up -d --build` → prune → status.

- Tunable via env: `VM`, `ZONE`, `BACKUP_BUCKET`.
- Excludes `.git`, `node_modules`, `dist`, `.env`, models, `*.onnx`, etc. Secrets and models live outside the repos and are never touched.
- Healthcheck-gated startup → ~30–60s API blip during rebuild.

> ⚠️ **Freeze deploys during the thesis defense.** A rebuild restarts the worker → minutes of RAG downtime.

---

## B. Operations

### Logs (Cloud Logging)
Docker uses the `journald` driver → Google Cloud Ops Agent ships to Cloud Logging. Full query guide: `plans/cicd/cloud-logging-queries.md`.

```bash
# backend errors, last hour
gcloud logging read 'logName="projects/project-5e55d3e0-646f-498d-bc2/logs/docker_journald" AND jsonPayload.CONTAINER_NAME="dentalab-backend-1" AND jsonPayload.MESSAGE:"ERROR"' \
  --project=project-5e55d3e0-646f-498d-bc2 --freshness=1h --limit=50 --format='value(timestamp, jsonPayload.MESSAGE)'
```
`docker compose logs` still works on the VM (journald is local-capable). Filter services by `jsonPayload.CONTAINER_NAME` (`dentalab-backend-1`, `dentalab-worker-1`, …).

### Monitoring & alerts
- Uptime check `dentalab-api-health` → `https://api.dentalab.health.vn/health/live` (HTTPS, 5-min).
- Alert policy `DentaLab API down` → email channel `ldb258204@gmail.com`.

### Backups
- Per-deploy DB snapshot to R2 (automatic, step 3 of `deploy.sh`).
- Manual snapshot any time: `gcloud compute ssh dentalab-vm --zone=asia-southeast1-a --command='/opt/dentalab/app/dentalab-backend/deploy/scripts/snapshot-db.sh'`
- Restore: `gunzip -c db-<ts>.sql.gz | docker compose -f <compose> exec -T postgres psql -U dentalab dentalab`
- ⚠️ No daily cron yet — only per-deploy. No protection against disk loss between deploys.

### SSH / shell
```bash
gcloud compute ssh dentalab-vm --zone=asia-southeast1-a
CF=/opt/dentalab/app/dentalab-backend/docker-compose.prod.yml
docker compose -f $CF ps
docker compose -f $CF restart backend
```

---

## C. Disaster recovery — rebuild from scratch

### 0. Prereqs (local)
- `gcloud` authed, `wrangler` authed, `rsync` available.
- A **Novita** API key for worker inference (embeddings + reranking). Goes in `worker.env` as `INFERENCE_API_KEY`. No local models to build.

### 1. Cloudflare R2
```bash
bash dentalab-backend/deploy/scripts/r2-bootstrap.sh    # only dentalab-public + dentalab-private are used
# Connect custom domain to the public bucket (proxied, auto CNAME + cert):
wrangler r2 bucket domain add dentalab-public --domain cdn.dentalab.health.vn --zone-id <zone-id> --min-tls 1.2 -y
# Create an R2 API token -> S3 HMAC access key + secret. Keep dentalab-private NON-public.
```

### 2. Provision the VM (local)
```bash
PROJECT=project-5e55d3e0-646f-498d-bc2 MY_IP=<your.ip> bash dentalab-backend/deploy/gcp/provision.sh
gcloud compute ssh dentalab-vm --zone=asia-southeast1-a
```

### 3. On the VM — base layout
```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER && newgrp docker
sudo mkdir -p /opt/dentalab/{app,secrets,caddy}
sudo chown -R $USER /opt/dentalab && sudo chmod 700 /opt/dentalab/secrets
cp /opt/dentalab/app/dentalab-backend/deploy/caddy/Caddyfile /opt/dentalab/caddy/Caddyfile   # after first rsync
```

### 4. Secrets (on the VM)
```bash
cd /opt/dentalab/secrets
for f in postgres rabbitmq backend worker; do
  cp /opt/dentalab/app/dentalab-backend/deploy/secrets-templates/$f.env.example $f.env
done
# Fill real values from plans/cicd/secrets.md. Generate any missing with: openssl rand -base64 32
#   backend.env: JWT_SECRET, AI_CONFIG_ENCRYPTION_KEY, AUDIT_REDACTION_HMAC_KEY, BOOKING_TICKET_SECRET, BOOKING_OTP_PEPPER, RAG_SERVICE_TOKEN
#   worker.env:  INFERENCE_BASE_URL=https://api.novita.ai/openai/v1 + INFERENCE_API_KEY (Novita key)
# Cross-file invariants: POSTGRES_PASSWORD matches across files; RAG_SERVICE_TOKEN matches backend<->worker.
chmod 600 *.env
```

### 5. DNS (Cloudflare, zone dentalab.health.vn)
- `A  api.dentalab.health.vn → 34.21.143.173`  — **proxy OFF (grey)** so Caddy can issue Let's Encrypt.
- `A  app.dentalab.health.vn → 76.76.21.21`     — Vercel anycast (grey). Add the domain in the Vercel project too.
- `cdn.dentalab.health.vn` — created automatically by the R2 custom-domain step (proxied/orange).

### 6. First boot (on the VM)
```bash
cd /opt/dentalab/app
docker compose -f dentalab-backend/docker-compose.prod.yml up -d --build   # migrate deploy runs via entrypoint
# Seed admin + roles ONCE (use COMPILED seed — runner has no src/ for ts-node):
docker compose -f dentalab-backend/docker-compose.prod.yml exec backend node dist/prisma/seed.js
```

---

## D. Verify checklist

- `curl https://api.dentalab.health.vn/health/live` → 200, valid cert. ✅ verified
- Login at `app.dentalab.health.vn` → JWT + cross-subdomain cookie round-trips. ✅ verified
- Avatar resolves at `https://cdn.dentalab.health.vn/avatars/...` → 200, `image/webp`. ✅ verified
- Email (Resend) sends; webhook delivery tracked. ✅ verified
- Upload a doc → lands in `dentalab-private`; presigned download in browser → 200 (not 403).
- Upload a Vietnamese PDF → worker calls Novita for embeddings → pgvector rows appear (OCR text in worker logs).
- **RAG chat returns answer + citations** → embeddings/rerank via Novita; answer generation requires the Gemini key set in admin AI settings (⏳ pending).
- Reboot VM → services auto-start (`restart: unless-stopped`); worker only re-caches the small BGE-M3 tokenizer (no large model download).

---

## Notes / known gaps

- No daily cron backup — per-deploy snapshot only.
- Single VM = no HA. `restart: unless-stopped` + uptime alert is the safety net.
- Local commits may be ahead of GitHub; the rsync deploy ships your working tree regardless of push state.
