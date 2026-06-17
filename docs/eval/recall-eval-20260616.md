# RAG Recall@k Evaluation — 2026-06-16 17:13

- Endpoint: `https://api.dentalab.health.vn/api/v1/rag/search/debug`
- Query set: `eval/recall_queryset.csv` (22 queries, 22 scored, 0 failed)
- top_k: 10 | k values: [1, 3, 5, 10] | user_id: `dec80edb-c9c1-4e2b-8b77-95a0eade55c5`

## Aggregate recall@k (macro-average)

Retrieval recall (rrf/dense/bm25) is measured pre-cut on the candidate lists; final recall is post-rerank, top-k. Do not conflate the two.

| stage / recall@k | R@1 | R@3 | R@5 | R@10 |
| --- | --- | --- | --- | --- |
| Dense (vector) | 0.841 | 0.955 | 0.955 | 0.955 |
| BM25 (FTS) | 0.636 | 0.727 | 0.727 | 0.841 |
| Hybrid RRF (pre-rerank) | 0.773 | 0.932 | 0.932 | 0.955 |
| Final (reranked, top-k) | 0.886 | 0.955 | 0.955 | 0.955 |

## Hit-rate@k

| stage / hit-rate@k | H@1 | H@3 | H@5 | H@10 |
| --- | --- | --- | --- | --- |
| Dense (vector) | 0.864 | 0.955 | 0.955 | 0.955 |
| BM25 (FTS) | 0.636 | 0.727 | 0.727 | 0.864 |
| Hybrid RRF (pre-rerank) | 0.773 | 0.955 | 0.955 | 0.955 |
| Final (reranked, top-k) | 0.909 | 0.955 | 0.955 | 0.955 |

## Per-query detail (final stage)

| id | doc | #gold | bm25 n | rrf R@10 | final R@10 | 1st hit (final) | query |
| --- | --- | --- | --- | --- | --- | --- | --- |
| S1 | Quy-trinh-khu-khuan- | 1 | 80 | 1.00 | 1.00 | 1 | Trong quy trình khử khuẩn, "làm sạch" dụng c |
| S2 | Quy-trinh-khu-khuan- | 1 | 80 | 1.00 | 1.00 | 1 | Dụng cụ sau khi tiệt khuẩn cần được bảo quản |
| S3 | Quy-trinh-khu-khuan- | 2 | 80 | 1.00 | 1.00 | 1 | Khi làm sạch dụng cụ cần mang phương tiện ph |
| S4 | Quy-trinh-khu-khuan- | 1 | 80 | 1.00 | 1.00 | 1 | Nhược điểm của hóa chất khử khuẩn nhóm amoni |
| R1 | QTKT-RHM-Tap1 | 1 | 80 | 1.00 | 1.00 | 1 | Nang xương hàm là gì và khi phát triển mạnh  |
| R2 | QTKT-RHM-Tap1 | 1 | 80 | 1.00 | 1.00 | 1 | Hẹp hàm (hẹp cung răng) là tình trạng gì? |
| R3 | QTKT-RHM-Tap1 | 1 | 80 | 0.00 | 0.00 | MISS | Điều trị tủy (chụp tủy/nội nha) được chỉ địn |
| R4 | QTKT-RHM-Tap1 | 1 | 80 | 1.00 | 1.00 | 1 | Đặt thuốc điều trị nhạy cảm ngà là kỹ thuật  |
| R5 | QTKT-RHM-Tap1 | 1 | 80 | 1.00 | 1.00 | 1 | Phẫu thuật cắt u tuyến nước bọt mang tai bảo |
| T1 | 2hdrnghmmt | 1 | 80 | 1.00 | 1.00 | 1 | Viêm quanh cuống răng được định nghĩa là gì? |
| T2 | 2hdrnghmmt | 1 | 80 | 1.00 | 1.00 | 1 | Phân biệt áp xe nông quanh hàm trong và phle |
| T3 | 2hdrnghmmt | 1 | 80 | 1.00 | 1.00 | 1 | Các nguyên nhân bên ngoài gây ung thư khoang |
| T4 | 2hdrnghmmt | 1 | 80 | 1.00 | 1.00 | 1 | Phương pháp phá hủy thần kinh ngoại vi để đi |
| T5 | 2hdrnghmmt | 1 | 80 | 1.00 | 1.00 | 3 | Áp xe tuyến nước bọt mang tai có dấu hiệu gì |
| L1 | 26-vbhn-Luat-KCB | 1 | 80 | 1.00 | 1.00 | 1 | Theo Luật Khám bệnh, chữa bệnh, "khám bệnh"  |
| L2 | 26-vbhn-Luat-KCB | 1 | 80 | 1.00 | 1.00 | 1 | Người hành nghề có được đăng ký hành nghề tạ |
| L3 | 26-vbhn-Luat-KCB | 1 | 80 | 1.00 | 1.00 | 1 | Thủ tục cấp mới giấy phép hành nghề cho ngườ |
| L4 | 26-vbhn-Luat-KCB | 1 | 80 | 1.00 | 1.00 | 1 | Chính sách của Nhà nước về khám bệnh, chữa b |
| L5 | 26-vbhn-Luat-KCB | 1 | 80 | 1.00 | 1.00 | 1 | Nhà nước hỗ trợ học phí và chi phí sinh hoạt |
| W1 | so-tay-phap-luat-lao | 1 | 80 | 1.00 | 1.00 | 1 | Người lao động làm việc liên tục 8 giờ được  |
| W2 | so-tay-phap-luat-lao | 1 | 80 | 1.00 | 1.00 | 1 | Người sử dụng lao động được sa thải người la |
| W3 | so-tay-phap-luat-lao | 1 | 80 | 1.00 | 1.00 | 1 | Người sử dụng lao động có được trả lương chậ |

## Notes / limitations
- `bm25 n` is the FTS result count per query. FTS uses `websearch_to_tsquery('simple', unaccent(q))` (AND over all terms incl. function words), so full-sentence queries often return 0 matches and BM25 contributes ~no recall; dense retrieval carries hybrid recall here.
- Gold labels assigned by a single annotator (known-item construction: query written from a target chunk); subjective bias acknowledged.
- Corpus frozen during measurement; child_chunk_id UUIDs stable for this run only.
