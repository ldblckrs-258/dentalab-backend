#!/usr/bin/env bash
# Helper: provision the GCE VM + networking. Review before running. Needs gcloud authed.
set -euo pipefail

PROJECT="${PROJECT:?set PROJECT=<gcp-project-id>}"
ZONE=asia-southeast1-a
REGION=asia-southeast1
MY_IP="${MY_IP:?set MY_IP=<your.public.ip>}"

gcloud config set project "$PROJECT"
gcloud services enable compute.googleapis.com monitoring.googleapis.com

gcloud compute addresses create dentalab-ip --region="$REGION" || true

gcloud compute instances create dentalab-vm \
  --zone="$ZONE" --machine-type=e2-standard-4 \
  --image-family=ubuntu-2204-lts --image-project=ubuntu-os-cloud \
  --boot-disk-size=50GB --boot-disk-type=pd-balanced \
  --address=dentalab-ip --tags=http-server,https-server

gcloud compute firewall-rules create allow-http-https \
  --allow=tcp:80,tcp:443 --target-tags=https-server --source-ranges=0.0.0.0/0 || true

gcloud compute firewall-rules create allow-ssh-myip \
  --allow=tcp:22 --source-ranges="${MY_IP}/32" || true

echo "VM created. SSH in, install Docker, then:"
echo "  sudo mkdir -p /opt/dentalab/{app,models/onnx,secrets,caddy} && sudo chmod 700 /opt/dentalab/secrets"
echo "  git clone <backend-repo> /opt/dentalab/app/dentalab-backend"
echo "  git clone <worker-repo>  /opt/dentalab/app/dentalab-worker"
