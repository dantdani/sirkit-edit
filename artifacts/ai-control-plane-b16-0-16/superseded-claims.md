# B16.0.16 — Superseded claims

## From B16.0.15 (tranche 8)

B16.0.15's "Remaining migration: 77 raw methods (baseline 80) — … calculation …
and other families" is **superseded**: the eight `/api/calculation/*` methods
are now canonical-wrapper adopted and removed from the raw baseline.

## Inventory supersession

| Claim | Prior (B16.0.15) | Now (B16.0.16) |
|---|---|---|
| canonical wrappers | 73 | **81** |
| factories | 3 | 3 |
| raw methods | 77 | **69** |
| baseline | 80 | **72** |

## NOT superseded

- The exactly-12 tool-exposure invariant and the internal-only status of
  `sirkit.manufacturing.release` are UNCHANGED — this stage migrated only the
  calculation request boundaries and added no tool/agent/MCP exposure.
- All B16.0.1–B16.0.15 role, CSRF, release-internality, deterministic-evaluator,
  and ratchet claims for the other 145 methods remain valid.
- The calculation domain's deterministic evaluator / interval / transaction /
  report semantics are unchanged (the standing domain suite still governs them).
