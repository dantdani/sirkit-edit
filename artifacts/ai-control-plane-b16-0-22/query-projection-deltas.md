# B16.0.22 — the TWO documented supersessions (pinned pre, flipped with notes)

Both were reproduced VERBATIM against the raw handlers first (§A first run),
then superseded at migration with in-test supersession comments. Every other
§A pin (57/59) passed unchanged pre → post.

## 1. pcb-sync GET duplicated query key

- **Historical**: `?boardId=a&boardId=b` (or any duplicated allowed key) →
  422 `PS_API_UNKNOWN_FIELD` (`getAll(key).length > 1` refusal).
- **Canonical**: the bounded query projection (`meta.query`) is deterministic
  FIRST-VALUE-WINS and cannot carry duplicates → the board read uses
  `boardId=a`.
- **Security direction**: parameter-pollution ambiguity is still impossible —
  it is resolved deterministically instead of refused. The UNKNOWN-key
  refusal (`?boardId=x&evil=1` → 422 `PS_API_UNKNOWN_FIELD`) is fully
  preserved and pinned. The legacy Request adapter
  (`createPcbSyncBoardGetHandler`, used by the standing factory tests)
  retains the historical duplicate refusal, gated in the confinement suite.

## 2. assignment-queue POST declared-oversize Content-Length

- **Historical**: `Content-Length: 2000000` with any body → 413
  `{ ok:false, code:"AQ_API_PAYLOAD_TOO_LARGE" }` (family-specific
  pre-read shortcut), zero body pulls.
- **Canonical**: the shared reader's declared-length precheck → 413
  `{ ok:false, code:"AUTH_PAYLOAD_TOO_LARGE", error:… }`, zero body pulls
  (counting-stream pin).
- **Security direction**: identical status, identical zero-read guarantee;
  only the code label is normalized to the ONE shared envelope. The
  `scopedAssignmentJson` helper (and its own `_scope.test.ts`) is retained
  unchanged.

## Related but NOT deltas

- `meta.query` caps (64 keys / 2048-char values) now bound pathological query
  strings on the three query-consuming GETs — canonical hardening, no
  legitimate caller affected. **RECORDED**.
- Replacement-authority lying-oversize Content-Length: see
  [replacement-authority-proof.md](replacement-authority-proof.md) delta 2.
