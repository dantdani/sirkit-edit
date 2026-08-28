# B16.0.22 — safe-header proof (assignment commit opt-in)

The ONLY header any tranche-15 callback consumes is
`x-sirkit-assignment-commit` on assignment-queue POST.

- Declared via `safeHeaders: ["x-sirkit-assignment-commit"]` — the wrapper's
  `validateSafeHeaderAllowlist` screens every declared name against
  `FORBIDDEN_SAFE_HEADER_PATTERN`
  (`/(secret|token|cookie|auth|credential|session|password|key)/i`) and the
  fixed forbidden set; the commit header matches neither, so the declaration
  is legal BY CONSTRUCTION and a future credential-bearing name would throw at
  module load.
- The callback reads it exclusively from the frozen, value-truncated
  projection: `meta.headers?.["x-sirkit-assignment-commit"] !==
  "apply_exact_plan"` → 403 `AQ_COMMIT_OPT_IN_REQUIRED`. Exact-match only —
  no prefix/ci tricks.
- §A pins: header absent (opt_in state) → 403; header present in `observe`
  → 403; the `commit` service spy uncalled in both. Confinement gate pins the
  declaration string and the `meta.headers` consumption in source.
- No other tranche-15 route declares `safeHeaders` (source-scanned).

**CONFIRMED** (pre = post; the historical `request.headers.get(...)` read had
identical semantics for the exact-match comparison).
