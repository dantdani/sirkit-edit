# B16-C.2 — Component-binding review handoff

Labels: CONFIRMED = executed and measured on this machine; INFERRED = derived from code reading; PROPOSED = design not yet exercised; RECORDED = written down without a claim; UNKNOWN = not established.

## Reproduced gap (CONFIRMED)

- Publishing an exact component binding (`POST /api/physical-bindings` `bind_atomic_selection`) is a human reviewer / project-administrator act (`bindAtomicSelection` refuses every other actor). Before this chapter an editor who tried received **422** `PB_ATOMIC_BIND_HUMAN_REVIEWER_REQUIRED` — the status of malformed engineering input — the B16.1C acceptance test pinned that 422 "as-is", and nothing carried the editor's need to a reviewer: the editor's Sync preparation failed with a bare code and the only way forward was an out-of-band conversation.
- Reviewer authority is NOT widened: editors still cannot bind (`b16-c-review-handoff.test.ts` case 1; acceptance step 4). What changed is the status code (403 with `handoff: "request_atomic_review"`) and the existence of a durable, visible request → decision → resume path.

## Contract (CONFIRMED by `app/api/physical-bindings/__tests__/b16-c-review-handoff.test.ts`, 7 cases, and acceptance step 4)

Domain: `app/lib/physical-binding/review-handoff.ts`. Durable aggregate `pb.component-review-request.v1` keyed by (tenant, project, branch, board instance, component instance, atomic part revision), CAS on the aggregate revision, one commit per state change, request digest over the sealed content.

| operation (`POST /api/physical-bindings`) | who | result |
| --- | --- | --- |
| `request_atomic_review {componentInstanceId, boardInstanceId, atomicPartRevisionId, reason?}` | human `pcb_editor` / `reviewer` / `project_admin` | 201 pending request with the server-projected evidence; 200 + `created:false` when a pending or approved request already governs the candidate (idempotent resume); 403 `PB_REVIEW_REQUEST_FORBIDDEN` otherwise; 404 `PB_ATOMIC_REVISION_NOT_FOUND` |
| `list_review_requests {boardInstanceId?, status?}` | every POST-authorized member | `viewer {actorId, role, actorKind, canRequest, canResolve}` (server-derived), `membershipVerified`, the requests; retirement is applied lazily to pending ones |
| `resolve_review_request {requestId, decision: approve\|reject, reason}` | human `reviewer` / `project_admin` | approve: re-projects the evidence, refuses drift (409 `PB_REVIEW_EVIDENCE_CHANGED_CONFLICT`), then runs the ORDINARY binding lifecycle (create → select → revalidate → approve) under the REVIEWER's identity and records `bindingSetId / bindingRevisionId / lifecycleState`; reject: records the reason; 403 `PB_REVIEW_RESOLVE_FORBIDDEN`; 409 `PB_REVIEW_REQUEST_STATE_CONFLICT` when not pending; 409 `PB_REVIEW_REQUEST_RETIRED_CONFLICT` |
| `withdraw_review_request {requestId, reason?}` | the requester, or a project admin | 200 withdrawn; 403 otherwise |
| `bind_atomic_selection` by a non-reviewer | — | **403** `PB_ATOMIC_BIND_HUMAN_REVIEWER_REQUIRED` + `handoff: "request_atomic_review"` (was 422) |

Evidence the reviewer sees (projected verbatim from the PUBLISHED portable snapshot the binding would use, digested as `evidenceDigest`): exact candidate (atomic revision, logical part, exact part id, MPN, manufacturer), symbol (asset/version/content/semantic hashes, name, pin count), footprint (asset/version/hashes, name, library nickname, mounting, electrical/mechanical pad counts), package (canonical name, identity system, pin count), pin-to-pad certificate (id, state, semantic hash, every terminal → symbol pins → pad numbers, missing/ambiguous lists), source revisions (atomic, symbol, footprint, mapping ids, capture time), evidence refs.

Retirement (CONFIRMED, case 5): on every list/resolve the requester's CURRENT membership is loaded; a revoked membership retires the request with `REQUESTER_MEMBERSHIP_REVOKED`, a role outside the requester set or a changed membership revision retires it with `REQUESTER_ROLE_CHANGED`; a retired request cannot be approved (409) and the editor must ask again under the current role. When the runtime cannot verify memberships (`resolveMembershipRepository()` is null) no retirement is inferred and `membershipVerified:false` is reported rather than hidden.

Status codes are truthful: 403 permission, 409 state/drift, 400 malformed (`PB_API_REVIEW_INPUT_INVALID`, `*_REASON_INVALID`), 404 not found. The route's `errorResponse` now maps `FORBIDDEN` / `REVIEWER_REQUIRED` to 403 (previously only `UNAUTHORIZED` / `HUMAN_REQUIRED`).

## Browser (CONFIRMED by `app/components/pcb/__tests__/component-review-panel.test.tsx`, 3 cases; page-level flow in `page-browser-e2e.md`)

`ComponentReviewPanel` + `useComponentReview` (`app/components/pcb/`), mounted beside the manufacturing workflow panel in `PcbEditor` for every non-demo durable scope: every exact candidate on the schematic is listed with its durable review state (`none / pending / approved / rejected / withdrawn / retired`); an editor requests review for one or all and can withdraw their own; a reviewer sees the evidence block and approves / rejects (reject requires a reason); refusals are shown with their bounded code; the viewer block is the server's. The Sync preparation's binding step, when refused 403 with the handoff, tells the editor to use the panel instead of printing a bare code, and refreshes the panel. Nothing is remembered in browser storage; every refresh re-reads the durable requests.

## Test harness change (RECORDED)

`signInAs` in the prompt-to-Gerber harness used to REPLACE the project's membership repository with only the signed-in user, so a reviewer's session would have read as the editor's revocation (and retired the editor's pending requests). It now keeps every fresh-browser user's standing membership and switches the identity only — one project, several users, one browser session each.

## Identities (RECORDED)

The acceptance flow's bindings are now created under the reviewer's identity (previously the administrator's), which changes the component-authority digest and therefore the pinned identities; fixtures and identities were re-recorded and the replay reproduces them (`test-and-validation-report.md`).

## Not done / bounded (RECORDED)

- The assignment-queue (`/api/assignment-queue`) already had its own `request_candidate_approval` action for Stage 1 candidates; this handoff is the atomic-selection path used by the prompt-to-Gerber flow. Unifying both queues into one reviewer inbox is PROPOSED for B17/B19, not done here.
- No e-mail / notification transport: the reviewer sees pending requests when they open the project (the panel lists them; `pendingCount` is exposed for a future badge).
