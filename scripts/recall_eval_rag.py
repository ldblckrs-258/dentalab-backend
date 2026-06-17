#!/usr/bin/env python3
"""Measure retrieval recall@k of the RAG pipeline against the deployed debug endpoint.

Runs every query in a CSV through POST /rag/search/debug, then scores the ranked
child_chunk_id lists each stage returns against hand-labelled gold chunk ids.

One debug call returns dense / bm25 / rrf / final lists at once, so a single pass
yields the whole comparison: dense-only vs bm25-only vs hybrid(rrf) retrieval, and
rrf-pool vs reranked-final (the rerank effect). No extra calls per variant.

Config (token / url / user) resolves in order:
  1. CLI flags (--token --url --user-id --top-k)
  2. env vars (RAG_SERVICE_TOKEN, RAG_API_URL, RAG_DEBUG_USER_ID, RAG_DEBUG_TOP_K)
  3. scripts/debug-rag.env (gitignored)

CSV columns: id, source_doc, query, relevant_child_chunk_ids (';'-separated), note
Usage: ./scripts/recall_eval_rag.py --csv eval/recall_queryset.csv --top-k 10
"""
import argparse
import csv
import json
import os
import sys
import re
import time
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path

UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")

STAGES = ["dense", "bm25", "rrf", "final"]
STAGE_LABEL = {
    "dense": "Dense (vector)",
    "bm25": "BM25 (FTS)",
    "rrf": "Hybrid RRF (pre-rerank)",
    "final": "Final (reranked, top-k)",
}


def load_env_file(path: Path) -> None:
    if not path.is_file():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, val = line.split("=", 1)
        os.environ.setdefault(key.strip(), val.strip().strip('"').strip("'"))


def parse_args() -> argparse.Namespace:
    script_dir = Path(__file__).resolve().parent
    load_env_file(script_dir / "debug-rag.env")
    p = argparse.ArgumentParser(description="RAG recall@k evaluation")
    p.add_argument("--csv", default=str(script_dir.parent / "eval" / "recall_queryset.csv"))
    p.add_argument("--url", default=os.environ.get("RAG_API_URL", "https://api.dentalab.health.vn/api/v1/rag/search/debug"))
    p.add_argument("--user-id", default=os.environ.get("RAG_DEBUG_USER_ID", "dec80edb-c9c1-4e2b-8b77-95a0eade55c5"))
    p.add_argument("--token", default=os.environ.get("RAG_SERVICE_TOKEN", ""))
    p.add_argument("--top-k", type=int, default=int(os.environ.get("RAG_DEBUG_TOP_K", "10")))
    p.add_argument("--ks", default="1,3,5,10", help="comma-separated k values to report")
    p.add_argument("--sleep", type=float, default=3.5, help="seconds between requests (backend limit is 20/60s)")
    p.add_argument("--out", default="", help="markdown report path (default docs/eval/recall-eval-<date>.md)")
    return p.parse_args()


def read_queryset(path: str) -> list[dict]:
    rows, bad = [], []
    with open(path, newline="", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            if r.get(None):
                bad.append(f"{r.get('id')}: unquoted comma split row into extra columns {r[None]}")
                continue
            gold = {x.strip() for x in (r.get("relevant_child_chunk_ids") or "").split(";") if x.strip()}
            nonuuid = [g for g in gold if not UUID_RE.match(g)]
            if nonuuid:
                bad.append(f"{r.get('id')}: gold not a UUID {nonuuid} (likely unquoted comma in query)")
                continue
            if not r["query"].strip() or not gold:
                bad.append(f"{r.get('id')}: empty query or gold")
                continue
            rows.append({"id": r.get("id", ""), "doc": r.get("source_doc", ""),
                         "query": r["query"].strip(), "gold": gold, "note": r.get("note", "")})
    if bad:
        sys.exit("error: malformed query set:\n  " + "\n  ".join(bad))
    return rows


def call_debug(url: str, token: str, user_id: str, query: str, top_k: int, retries: int = 4) -> dict:
    body = json.dumps({"query": query, "userId": user_id, "topK": top_k}).encode("utf-8")
    for attempt in range(retries + 1):
        req = urllib.request.Request(url, data=body, method="POST", headers={
            "Content-Type": "application/json", "X-Internal-Token": token})
        try:
            with urllib.request.urlopen(req, timeout=130) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            if e.code == 429 and attempt < retries:
                wait = 8 * (2 ** attempt)
                print(f"      429 rate-limited; backoff {wait}s (attempt {attempt + 1})", file=sys.stderr)
                time.sleep(wait)
                continue
            raise


def ranked_ids(payload: dict, stage: str) -> list[str]:
    if stage == "final":
        return [c["child_chunk_id"] for c in payload.get("final_chunks", [])]
    key = {"dense": "dense_search", "bm25": "bm25_search", "rrf": "rrf_fusion"}[stage]
    return [h["child_chunk_id"] for h in payload.get("stages", {}).get(key, {}).get("results", [])]


def stage_count(payload: dict, stage: str) -> int:
    if stage == "final":
        return len(payload.get("final_chunks", []))
    key = {"dense": "dense_search", "bm25": "bm25_search", "rrf": "rrf_fusion"}[stage]
    return payload.get("stages", {}).get(key, {}).get("result_count", 0)


def recall_at_k(ranked: list[str], gold: set[str], k: int) -> float:
    return len(gold & set(ranked[:k])) / len(gold)


def first_hit_rank(ranked: list[str], gold: set[str]) -> int | None:
    for i, cid in enumerate(ranked, start=1):
        if cid in gold:
            return i
    return None


def fmt_table(headers: list[str], rows: list[list[str]]) -> str:
    widths = [max(len(headers[i]), *(len(r[i]) for r in rows)) if rows else len(headers[i])
              for i in range(len(headers))]
    line = lambda cells: "  ".join(c.ljust(widths[i]) for i, c in enumerate(cells))
    out = [line(headers), "  ".join("-" * w for w in widths)]
    out += [line(r) for r in rows]
    return "\n".join(out)


def md_table(headers: list[str], rows: list[list[str]]) -> str:
    out = ["| " + " | ".join(headers) + " |", "| " + " | ".join("---" for _ in headers) + " |"]
    out += ["| " + " | ".join(r) + " |" for r in rows]
    return "\n".join(out)


def main() -> int:
    a = parse_args()
    if not a.token:
        sys.exit("error: token missing — set RAG_SERVICE_TOKEN, pass --token, or fill scripts/debug-rag.env")
    if not a.user_id:
        sys.exit("error: user-id missing — set RAG_DEBUG_USER_ID or pass --user-id")
    ks = [int(x) for x in a.ks.split(",")]
    queries = read_queryset(a.csv)
    if not queries:
        sys.exit(f"error: no valid rows in {a.csv}")

    print(f"endpoint : {a.url}")
    print(f"queryset : {a.csv}  ({len(queries)} queries)  top_k={a.top_k}  ks={ks}\n")

    per_query, failures = [], []
    for i, q in enumerate(queries, start=1):
        try:
            payload = call_debug(a.url, a.token, a.user_id, q["query"], a.top_k)
            lists = {s: ranked_ids(payload, s) for s in STAGES}
            rec = {f"{s}@{k}": recall_at_k(lists[s], q["gold"], k) for s in STAGES for k in ks}
            per_query.append({**q, "rec": rec,
                              "bm25_n": stage_count(payload, "bm25"),
                              "final_rank": first_hit_rank(lists["final"], q["gold"]),
                              "rrf_rank": first_hit_rank(lists["rrf"], q["gold"])})
            print(f"  [{i}/{len(queries)}] {q['id']:>3}  final@{a.top_k}={rec[f'final@{a.top_k}']:.2f}  {q['query'][:46]}")
        except (urllib.error.URLError, urllib.error.HTTPError, KeyError, json.JSONDecodeError) as e:
            failures.append((q["id"], str(e)))
            print(f"  [{i}/{len(queries)}] {q['id']:>3}  FAILED: {e}", file=sys.stderr)
        time.sleep(a.sleep)

    n = len(per_query)
    if n == 0:
        sys.exit("error: every query failed — see errors above")

    def mean(key):
        return sum(p["rec"][key] for p in per_query) / n

    def hit_rate(stage, k):
        return sum(1 for p in per_query if p["rec"][f"{stage}@{k}"] > 0) / n

    # aggregate: recall@k (macro) per stage
    agg_rows = [[STAGE_LABEL[s]] + [f"{mean(f'{s}@{k}'):.3f}" for k in ks] for s in STAGES]
    agg_headers = ["stage / recall@k"] + [f"R@{k}" for k in ks]
    # hit-rate@k per stage
    hit_rows = [[STAGE_LABEL[s]] + [f"{hit_rate(s, k):.3f}" for k in ks] for s in STAGES]
    hit_headers = ["stage / hit-rate@k"] + [f"H@{k}" for k in ks]
    # per-query detail
    kmax = max(ks)
    detail_headers = ["id", "doc", "#gold", "bm25 n", f"rrf R@{kmax}", f"final R@{kmax}", "1st hit (final)", "query"]
    detail_rows = [[p["id"], p["doc"][:20], str(len(p["gold"])), str(p["bm25_n"]),
                    f"{p['rec'][f'rrf@{kmax}']:.2f}", f"{p['rec'][f'final@{kmax}']:.2f}",
                    str(p["final_rank"]) if p["final_rank"] else "MISS", p["query"][:44]]
                   for p in per_query]

    print("\n=== Aggregate recall@k (macro-average over queries) ===")
    print(fmt_table(agg_headers, agg_rows))
    print("\n=== Hit-rate@k (share of queries with >=1 gold chunk in top-k) ===")
    print(fmt_table(hit_headers, hit_rows))
    print("\n=== Per-query (final stage) ===")
    print(fmt_table(detail_headers, detail_rows))

    if failures:
        print(f"\n!! {len(failures)} of {len(queries)} queries FAILED (excluded from averages):", file=sys.stderr)
        for qid, err in failures:
            print(f"   {qid}: {err}", file=sys.stderr)
    else:
        print(f"\nok: all {n} queries scored.")

    date = datetime.now().strftime("%Y%m%d")
    out = a.out or str(Path(__file__).resolve().parent.parent / "docs" / "eval" / f"recall-eval-{date}.md")
    Path(out).parent.mkdir(parents=True, exist_ok=True)
    md = [f"# RAG Recall@k Evaluation — {datetime.now():%Y-%m-%d %H:%M}",
          "", f"- Endpoint: `{a.url}`", f"- Query set: `{a.csv}` ({len(queries)} queries, {n} scored, {len(failures)} failed)",
          f"- top_k: {a.top_k} | k values: {ks} | user_id: `{a.user_id}`",
          "", "## Aggregate recall@k (macro-average)", "",
          "Retrieval recall (rrf/dense/bm25) is measured pre-cut on the candidate lists; "
          "final recall is post-rerank, top-k. Do not conflate the two.", "",
          md_table(agg_headers, agg_rows), "", "## Hit-rate@k", "",
          md_table(hit_headers, hit_rows), "", "## Per-query detail (final stage)", "",
          md_table(detail_headers, [[c.replace("|", "\\|") for c in r] for r in detail_rows]),
          "", "## Notes / limitations",
          "- Gold labels assigned by a single annotator (known-item construction: query written from a target chunk); subjective bias acknowledged.",
          "- Corpus frozen during measurement; child_chunk_id UUIDs stable for this run only.",
          ""]
    Path(out).write_text("\n".join(md), encoding="utf-8")
    print(f"\nreport written: {out}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
