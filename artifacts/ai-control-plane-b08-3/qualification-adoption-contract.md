# B08.3 — Qualification Revision/Digest Adoption Contract

## Server response (typed)

`POST /api/pcb/qualify` → `{ ok, boardRevision, boardDigest, … }`. The
route has always returned both (`route.ts`: `boardRevision =
result.selectedRevision`, `boardDigest = authoritativeBoardDigest(board)`);
B08.3 adds `boardDigest` to the CLIENT's typed response and requires both.

## Adoption preconditions (ALL must hold)

1. `res.ok && body.ok` — otherwise `commit-failed` (owned failure toast;
   nothing irreversible claimed).
2. `boardRevision` and `boardDigest` non-empty — otherwise
   `verification-failed` ("the server response omitted the committed board
   revision/digest").
3. Scope still current at settlement (`settleServerCommit` → `adopt`) —
   otherwise reconcile notice (same identity) / discard (cross identity).
4. `client.loadBoard()` returns a found record — otherwise
   `verification-failed` ("the authoritative board reload failed").
5. `record.revision === boardRevision` — exact.
6. `record.digest === boardDigest` — exact.
7. `{record.tenantId, projectId, branchId, boardId}` equals the captured
   scope's full identity — exact.

Only then, atomically (the `adopt` bundle):
`saveAuthoritativeBoardCache(record)` → `setAuthoritativeRecord(record)` →
`adoptBoardLifecycle("qualification-adoption", editorBoard)` →
`saveStageEvidence(routedBoardRevision = pcbRevisionId(editorBoard))` →
route-stale notice clear → board checkpoint → success toast (the ONLY
place "Board qualified" is ever said).

## Failure semantics (preconditions 2/4/5/6/7)

- current local board preserved (no adoption, no reseed);
- NO cache write, NO `authoritativeRecord` assignment, NO stage evidence,
  NO checkpoint;
- NO ordinary success toast;
- a truthful same-identity authority-reconciliation notice is recorded
  (`authorityDivergenceNotice` → the B08.2 divergence banner/toast):
  "The board WAS qualified and routed on the server, but the
  authoritative result could not be verified locally (…reason…). The
  local board was kept — reload the server authority to reconcile."
- the server's irreversible qualification is never called canceled or
  unchanged; cross-identity contexts receive NOTHING.

Proof: b08-3 tests 9–12 (missing reload, wrong revision, right revision/
wrong digest, missing keys, foreign record identity, exact adoption with
matching evidence). The identical contract now also governs sync apply
(`committedBoardRevision`/`committedBoardDigest` — tests 5, 7, 8).
