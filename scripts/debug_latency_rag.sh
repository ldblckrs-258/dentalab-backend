#!/usr/bin/env bash
#
# Probe RAG retrieval latency against the deployed backend debug endpoint.
# Usage: ./scripts/debug_latency_rag.sh --query "nguyên nhân ung thư lưỡi"
#
# Config (token/url/user) is read, in order, from:
#   1. CLI flags  (--token --url --user-id --top-k)
#   2. environment variables (RAG_SERVICE_TOKEN, RAG_API_URL, RAG_DEBUG_USER_ID, RAG_DEBUG_TOP_K)
#   3. scripts/debug-rag.env  (gitignored — put the prod token there once)
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONF="$SCRIPT_DIR/debug-rag.env"
[[ -f "$CONF" ]] && set -a && . "$CONF" && set +a

API_URL="${RAG_API_URL:-https://api.dentalab.health.vn/api/v1/rag/search/debug}"
USER_ID="${RAG_DEBUG_USER_ID:-c637d0e6-8381-4e0e-8e6e-862ae3873b92}"
TOP_K="${RAG_DEBUG_TOP_K:-5}"
TOKEN="${RAG_SERVICE_TOKEN:-}"
QUERY=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --query)   QUERY="$2";   shift 2 ;;
    --user-id) USER_ID="$2"; shift 2 ;;
    --top-k)   TOP_K="$2";   shift 2 ;;
    --token)   TOKEN="$2";   shift 2 ;;
    --url)     API_URL="$2"; shift 2 ;;
    -h|--help)
      echo "usage: $(basename "$0") --query \"<text>\" [--user-id UUID] [--top-k N] [--token T] [--url U]"
      exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

command -v jq >/dev/null || { echo "jq required (brew install jq)" >&2; exit 1; }
[[ -n "$QUERY" ]] || { echo "error: --query is required" >&2; exit 2; }
[[ -n "$TOKEN" ]] || { echo "error: token missing — set RAG_SERVICE_TOKEN, pass --token, or fill scripts/debug-rag.env" >&2; exit 2; }

PAYLOAD="$(jq -nc --arg q "$QUERY" --arg u "$USER_ID" --argjson k "$TOP_K" \
  '{query:$q, userId:$u, topK:$k}')"

BODY="$(mktemp)"
trap 'rm -f "$BODY"' EXIT
META="$(curl -sS -m 130 -o "$BODY" -w '%{http_code} %{time_total}' \
  -X POST "$API_URL" \
  -H 'Content-Type: application/json' \
  -H "X-Internal-Token: $TOKEN" \
  -d "$PAYLOAD")"
HTTP="${META% *}"
ROUNDTRIP="${META##* }"

echo "endpoint : $API_URL"
echo "query    : $QUERY"
echo "http     : $HTTP    round_trip: ${ROUNDTRIP}s"

if [[ "$HTTP" != "200" ]]; then
  echo "--- error body ---"
  cat "$BODY"; echo
  exit 1
fi

echo
jq -r '
  def r(x): (x*100|round)/100;
  .config_applied as $c |
  "config   : top_k=\($c.top_k) pool_mult=\($c.rerank_pool_multiplier) max_len=\($c.rerank_max_length) rerank_timeout_ms=\($c.rerank_timeout_ms) skip_rerank=\($c.skip_rerank)"
' "$BODY"

echo
{
  printf 'STAGE\tTIME_MS\tMETADATA\n'
  jq -r '
    def r(x): (x*100|round)/100;
    .stages as $s |
    [
      ["query_embedding",  (r($s.query_embedding.time_ms)),  "cache_hit=\($s.query_embedding.cache_hit)"],
      ["permission_filter",(r($s.permission_filter.time_ms)),"accessible_docs=\($s.permission_filter.accessible_document_count) filtered_out=\($s.permission_filter.filtered_out_count) is_manager=\($s.permission_filter.is_manager) perm_ids=\($s.permission_filter.permission_id_count)"],
      ["dense_search",     (r($s.dense_search.time_ms)),     "results=\($s.dense_search.result_count)"],
      ["bm25_search",      (r($s.bm25_search.time_ms)),      "results=\($s.bm25_search.result_count)"],
      ["rrf_fusion",       (r($s.rrf_fusion.time_ms)),       "results=\($s.rrf_fusion.result_count)"],
      ["rerank",           (r($s.rerank.time_ms)),           "results=\($s.rerank.result_count) fallback_used=\($s.rerank.fallback_used)"],
      ["parent_expansion", (r($s.parent_expansion.time_ms)), "parents=\($s.parent_expansion.parent_chunk_ids|length)"]
    ][] | @tsv
  ' "$BODY"
} | column -t -s "$(printf '\t')"

echo
jq -r '
  def r(x): (x*100|round)/100;
  .stages as $s |
  ([$s.query_embedding,$s.permission_filter,$s.dense_search,$s.bm25_search,$s.rrf_fusion,$s.rerank,$s.parent_expansion]
    | map(.time_ms) | add) as $sum |
  ([$s.dense_search.time_ms, $s.bm25_search.time_ms] | max) as $retr |
  ($s.query_embedding.time_ms + $s.permission_filter.time_ms + $retr + $s.rrf_fusion.time_ms + $s.rerank.time_ms + $s.parent_expansion.time_ms) as $cp |
  "sum_stages_ms : \(r($sum))   (naive — dense+bm25 run concurrently, double-counted)",
  "critical_path : \(r($cp))   (dense|bm25 → max, models real sequential latency)",
  "total_time_ms : \(r(.total_time_ms))   (unaccounted: \(r(.total_time_ms - $cp)) ms)",
  "final_chunks  : \(.final_chunks|length)"
' "$BODY"
