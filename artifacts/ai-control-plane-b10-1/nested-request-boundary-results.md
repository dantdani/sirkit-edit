# B10.1 §B — exact nested request shapes

## Contract (`app/api/chat/route.ts`)

Reusable `exactObjectShape(value, label, required, optional?)`: every key
outside the allowed set refuses — authority-shaped keys (`actor`,
`actorId`, `actorRole`, `role`, `capability`, `capabilities`, `authority`,
`authoritySource`, `approvals`, `approval`, `release`, `durableBoard`,
`idempotency`, `idempotencyKey`) refuse BY NAME; other unknown keys refuse
as unexpected. Required keys must be present. Messages are bounded and
redacted (40-char key echo; bodies never echoed).

Applied to:

- **`body.scope`** (when present): exactly `tenantId`, `projectId`,
  `branchId` — all strings. `scope.actor`, `scope.capabilities`, etc.
  refuse explicitly (pre-fix: silently ignored).
- **Each message**: exactly `role` + `content`, role ∈ {user, assistant},
  content string — extra keys refuse instead of lenient dropping.
- **`editorContext`** (when present): the COMPLETE contract is required —
  all eight keys present (`schema`, `scope`, `board`, `pcbRevisionId`,
  `selection`, `netlist` nullable, `schematicDigest` nullable,
  `authoritySource`); exact schema `sirkit.editor-context.v1`;
  `authoritySource` exactly `local-working-copy`.
- **`editorContext.scope`**: exactly the three identifiers AND equal to the
  request scope.
- **`selection`**: exactly `refs` (+ optional `primary`).

## Revision hint fail-closed

`pcbRevisionId` must be a bounded string; after assembly validates the
board, the server RECOMPUTES `pcbRevisionId(canonicalState.pcb)` — a
mismatch returns 400 "corrupt or non-atomic editor context" (never
silently ignored). An invalid board never reaches the check (canonical
state is withheld first, so the hint has nothing verified to disagree
with).

## Tests (`b10-1-request-boundary.test.ts` §B — all pass)

scope.actor / scope.capabilities / scope.role / scope.authority refuse by
name; unknown scope key refuses; incomplete scope refuses;
editorContext.scope role-claim refuses; incomplete editor-context contract
refuses (missing `selection`); selection `approvals` claim refuses;
message `authority` key refuses; message unknown key refuses; mismatched
revision hint refuses. The b10-chat-boundary valid-path suite continues to
pass with a truthful (matching) revision hint.
