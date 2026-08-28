# B16.0.23 §D — smoke-test truthfulness

`models/smoke-test` (`authenticatedJsonRoute`, WRITE_EDITORS + reviewer, CSRF,
2 MB / 15 s) runs a minimal isolated ngspice fixture and reports EVIDENCE.

- **Evidence, not certification**: a PASS records a `smoke` validation check
  and upgrades status to `"smoke-tested"` ONLY from `"unverified"` /
  `"syntax-checked"`; it NEVER sets `"trusted"`/`"curve-validated"`. Pinned:
  an already-`"trusted"` model stays `"trusted"` (no downgrade, no false
  upgrade); a fresh pass lands exactly on `"smoke-tested"`. **CONFIRMED**.
- **Unavailable/failed runtime is explicit**: a nonzero exit or an error/
  singular-matrix log yields `ok:false` 422 with a RICH evidence envelope
  `{ ok:false, model, check:{status:"fail"}, stdout, stderr, diagnostics }`
  (preserved byte-for-shape so the UI can still update model status on
  failure). Pinned. **CONFIRMED**.
- **Structural refusals precede execution**: `.control` blocks and unresolved
  include dependencies → 422 with ZERO spawns (fake-child call log empty).
  **CONFIRMED**.
- **Server-owned isolated fixture**: exactly one shell-less spawn of
  `NGSPICE_EXECUTABLE` with args `["-b", <server temp path>]`; the caller
  supplies only validated model text embedded in the server-built deck.
  **CONFIRMED**.
- **No model marked verified for merely parsing or smoke-testing**: parsing an
  import leaves status `unverified`/`syntax-checked`; a smoke pass reaches only
  `smoke-tested`. The governance statuses (`trusted`, `curve-validated`) are
  never reachable through these two routes. **CONFIRMED** — see
  [human-truth-contract.md](human-truth-contract.md).
