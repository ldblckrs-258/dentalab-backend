# RAG Hardening and Document Access Permissions

**Date**: 2026-06-17 23:00
**Severity**: High
**Component**: RAG search, RBAC, document access control (backend + worker + frontend)
**Status**: Resolved (code complete; migrations and deploy pending)

## What Happened

Five phases of work across three repos to close two real security gaps in the RAG pipeline: (1) published-status bypass — managers and non-managers received identical result sets because the worker never knew whether a requester was a manager; (2) access gating over-broad — `rag-search` forwarded the user's entire resolved permission set to the worker instead of the subset that actually gates document access, inflating the filter universe with irrelevant permission IDs.

On top of that, the `documents:access` permission layer was missing CRUD endpoints, the `setAccess` endpoint accepted any permission (not just `documents:access`-scoped ones), and there were two dead RAG permissions (`rag_patient_notes`, `rag_internal_docs`) polluting the seed, default-role-permissions, and frontend i18n with no guard or worker ever having evaluated them.

## The Brutal Truth

The published-status filter was the most embarrassing gap. The backend was forwarding queries to the worker but had no mechanism to tell it "this user is a manager; show unpublished docs." The worker's `PERMISSION_CTE` only joined `internal_documents` against `document_access.permission_id` — it had no knowledge of published state at all. Unpublished documents were reachable by any authenticated user who held the right permission, regardless of their role. That sat undetected because the integration test suite tested the happy path (published doc, matching permission) and nothing else.

The dead `rag_patient_notes` / `rag_internal_docs` permissions were the other embarrassment. They were seeded, assigned to roles, and rendered in the frontend permission picker — but no guard, no worker CTE, and no query ever evaluated them. They were UI placeholders that had survived multiple refactors. Removing them required a data migration to clean role_permissions rows before the schema-level seed diff could land cleanly.

## Technical Details

**Phase 1A — gating universe narrowing.**
`DocumentService.getRagAccessPermissionIds` introduced: intersects the user's resolved permission IDs with the IDs whose `code` matches `documents:access:*` via a Redis-cached query (`rag:access-perms:universe`, 5-min TTL). `rag-search` forwards only this subset. No worker change required; the worker was already correct — it matched `permission_ids` against `document_access.permission_id`, so sending fewer IDs was strictly result-preserving.

**Phase 1B — published-status gate.**
Backend sends `include_unpublished: isManager` (boolean derived from resolved roles). Worker's `QueryRequest` Pydantic model gains the field (`include_unpublished: bool = False`). `PERMISSION_CTE` grows a conditional join: when `include_unpublished` is false, `internal_documents` is inner-joined against `is_published = true`; otherwise the join is dropped. Deploy order is critical: worker must go first (or simultaneously) because Pydantic has `extra='ignore'` — an old worker silently discards the field, leaving the published filter absent rather than erroring. A new backend sending the field to an old worker would fail open, not fail closed. This was caught by red-team review; original draft had the deploy order backwards.

**Phase 2 — documents:access CRUD.**
Four endpoints in `RbacController`: `POST /rbac/document-access-permissions`, `GET`, `PATCH /:id`, `DELETE /:id`. Backed by `standalone rbac.constants.ts` with `DOCUMENTS_ACCESS_PERMISSION_PREFIX = 'documents:access'`. System-scope scopes (`hr`, `finance`, `clinical`, `operations`) are seeded and protected — edit/delete returns 403. Delete runs in a transaction: checks for referencing `document_access` rows, returns 409 if any exist (with i18n message), then deletes, then invalidates Redis for cascaded roles AND direct-override users. Three new `RBAC_PERMISSION_*` audit codes (`DOCUMENT_ACCESS_PERMISSION_CREATED`, `_UPDATED`, `_DELETED`) were missing from the original draft — the build would have failed. Added before any test run.

**Phase 3 — setAccess constraint.**
`setAccess` now validates that every `permissionId` in the request resolves to a `documents:access:*`-scoped permission. Non-conforming IDs return 422. A cleanup migration strips legacy non-`documents:access` rows from `document_access` before the constraint is enforced at runtime.

**Phase 4 — dead permission removal.**
`rag_patient_notes` and `rag_internal_docs` removed from seed, default role assignments, and frontend i18n (`en.json` / `vi.json`). Data migration deletes their `role_permissions` rows before the seed diff runs. The real gates — `internal_documents:read` and `clinical_notes:read` — were already in place in the worker CTE and NestJS guards; these dead entries were purely noise.

**Phase 5 — frontend access control sheet.**
Document access control panel: `+` icon opens a Sheet (shadcn) for CRUD of custom `documents:access` scopes. Scope picker and badge list source from a dedicated `useDocumentAccessPermissions` query returning objects with `{ id, code, name }`. Dropped the previous flat `permLookup` map (which was derived from the full permission list and broke once the endpoint returned nested objects); replaced with direct `.permission.name` access on each `document_access` row.

**Verification numbers:** backend `tsc` + `eslint` clean; 157 unit tests green — rbac 48, document 73, rag 33, new rag-search spec 3 (access-gating narrowing). Frontend `tsc` + `eslint` clean. Worker `py_compile` clean across modified files.

## What We Tried

**Rejected: backend post-filter for published status.** Would have filtered reranked results after the worker returned them, wasting the rerank pass and producing incorrect top-k counts. Worker-contract change was the only clean option.

**Rejected: generic permission CRUD reuse for documents:access.** The existing permission CRUD operates on the full permission namespace. Reusing it would have required scope-filtering logic sprinkled across multiple controllers and broken the system-scope protection invariant. Standalone constrained endpoints were lower blast radius.

**Rejected: gating cache invalidation on delete (red-team finding).** The reviewer flagged that deleting a `documents:access` permission should also invalidate `rag:access-perms:universe`. Verified no-op: the 409 guard guarantees a deletable permission has zero `document_access` rows, so its ID is absent from the gating set by definition. Invalidation would be dead code. Documented and rejected rather than applied blindly. This is the canonical example of validating an audit finding against the actual invariant before touching code.

## Root Cause Analysis

The published-status gap was architectural: the RAG query contract was designed as a one-way permission filter with no session-context pass-through. There was no slot in `QueryRequest` for caller context beyond permission IDs. The feature was added incrementally (permission gating first, published state deferred), and no one revisited the contract when published state became load-bearing.

The dead permissions were accumulated technical debt from an earlier design where RAG access was gated by dedicated RAG-specific permissions rather than reusing the existing `internal_documents:read` / `clinical_notes:read` gates. The refactor happened in the worker but the seed and role assignments were never cleaned up.

The `setAccess` lack of constraint and the absent `documents:access` CRUD were gaps from the original implementation that assumed manual DB management was sufficient. It was, until the frontend needed to surface the controls.

## Lessons Learned

- **Define the worker contract before implementing the feature.** The `QueryRequest` schema should have had an `include_unpublished` field from day one, not retrofitted. Any backend-to-worker RPC call that carries session context should have an explicit extensible envelope.
- **Fail-open vs fail-closed asymmetry matters most at deploy time, not at runtime.** Pydantic `extra='ignore'` is a safe default for forward compatibility but it means a new-backend / old-worker configuration silently downgrades security. Always identify which direction of partial rollout is the dangerous one and make it the harder path (worker deploys first).
- **Audit findings need to be validated against invariants, not just applied.** The gating-cache-invalidation-on-delete finding was structurally plausible but operationally a no-op given the 409 guard. Three minutes reading the delete handler would have confirmed it. Blindly applying the finding would have added dead code and muddied the intent of the cache invalidation path.
- **Seed cleanup migrations must precede constraint enforcement.** Adding a validation that `document_access` rows must reference `documents:access`-scoped permissions is safe only after the legacy rows are gone. Migration ordering is not optional.
- **Dead permissions in seed/role-assignments are not harmless.** They consume space in the permission picker, confuse operators, and make permission audits misleading. Kill them with a migration when the refactor happens, not three iterations later.

## Next Steps

1. **Run PRE-AUDIT queries before applying either migration.** Both the Phase 3 cleanup migration (legacy `document_access` rows) and the Phase 4 dead-permission migration (role_permissions rows) can cascade. Verify row counts match expectations before committing.
2. **Deploy worker first.** `dentalab-worker` must be on the new `QueryRequest` schema before or simultaneously with `dentalab-backend`. No exceptions — partial rollout with new backend / old worker is fail-open on published status.
3. **Apply backend migrations after worker is live.** `prisma migrate deploy` in staging, verify 0 rows affected by cleanup migrations (if counts are non-zero, investigate before production).
4. **Smoke test the published-status gate explicitly.** Create an unpublished internal document, query as non-manager (expect 0 results), query as manager (expect result). This test does not currently exist in the e2e suite and must be added.
5. **Nothing is committed yet.** All changes are on master working tree. Review diff, then commit in logical units: worker contract, backend phases 1-4, frontend phase 5, migrations separately with explicit pre-audit sign-off.
