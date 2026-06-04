#!/usr/bin/env bash
# One-time: create R2 buckets via wrangler. Run locally where wrangler is authed.
# Public access for dentalab-public is attached via a custom domain (cdn.dentalab.health.vn)
# in the Cloudflare dashboard or `wrangler r2 bucket domain add` (see runbook).
set -euo pipefail

wrangler r2 bucket create dentalab-public
wrangler r2 bucket create dentalab-private
wrangler r2 bucket create dentalab-models

echo "Buckets created. Next:"
echo " - Attach custom domain cdn.dentalab.health.vn to dentalab-public (public read)."
echo " - Create an R2 API token (S3 HMAC access key + secret) for backend/worker + uploads."
echo " - Keep dentalab-private NON-public (presigned access only)."
