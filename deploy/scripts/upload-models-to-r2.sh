#!/usr/bin/env bash
# One-time: upload locally-built embedding ONNX to R2 (dentalab-models).
# Run from repo root on the machine that has dentalab-worker/models/onnx/ populated.
# Requires aws-cli configured with R2 HMAC keys.
set -euo pipefail

R2_ENDPOINT="${R2_ENDPOINT:?set R2_ENDPOINT=https://<acct>.r2.cloudflarestorage.com}"
SRC=dentalab-worker/models/onnx
DEST=s3://dentalab-models/onnx

[ -f "$SRC/embedding.onnx" ] || { echo "missing $SRC/embedding.onnx — build models first"; exit 1; }

aws s3 cp "$SRC/" "$DEST/" --recursive --endpoint-url "$R2_ENDPOINT"
echo "Uploaded $(du -sh "$SRC" | cut -f1) to $DEST"
