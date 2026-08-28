# B16.0.15 — Superseded claims

## From B16.0.13 (tranche 6)

B16.0.13 excluded `/api/pcb/qualify` and `/api/pcb/release` as
"the manufacturing qualification/release authority chain … untouched" and listed
them among the raw methods remaining. **Superseded**: both are now
canonical-wrapper adopted (`authenticatedJsonRoute`), removed from the raw
baseline, with role separation, forbidden-key contract, zero-work refusals, and
release byte/header parity preserved.

## From B16.0.14 (tranche 7)

B16.0.14's "Remaining migration: 79 raw methods (baseline 82) … including
`/api/pcb/qualify` and `/api/pcb/release`" is **superseded** by this stage's
inventory: **77 raw / baseline 80**; qualify and release are no longer raw.

## Inventory supersession

| Claim | Prior (B16.0.14) | Now (B16.0.15) |
|---|---|---|
| canonical wrappers | 71 | **73** |
| factories | 3 | 3 |
| raw methods | 79 | **77** |
| baseline | 82 | **80** |

## NOT superseded

- The internal-only status of `sirkit.manufacturing.release` and the exact-12
  tool-exposure invariant are UNCHANGED — this stage migrated only the HTTP
  request boundary and added no tool/agent/MCP exposure.
- All B16.0.1–B16.0.14 role, CSRF, release-internality, and ratchet claims for
  the other 151 methods remain valid.
