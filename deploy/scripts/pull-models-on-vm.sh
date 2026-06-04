#!/usr/bin/env bash
# On the VM: pull embedding ONNX from R2 into the bind-mount source dir.
# Requires aws-cli configured with R2 HMAC keys.
set -euo pipefail

R2_ENDPOINT="${R2_ENDPOINT:?set R2_ENDPOINT=https://<acct>.r2.cloudflarestorage.com}"
DEST=/opt/dentalab/models/onnx

mkdir -p "$DEST"
aws s3 cp s3://dentalab-models/onnx/ "$DEST/" --recursive --endpoint-url "$R2_ENDPOINT"

[ -f "$DEST/embedding.onnx" ] || { echo "pull failed: $DEST/embedding.onnx missing"; exit 1; }
[ -f "$DEST/model.onnx.data" ] || { echo "pull failed: $DEST/model.onnx.data missing"; exit 1; }
echo "Models present at $DEST ($(du -sh "$DEST" | cut -f1))"
