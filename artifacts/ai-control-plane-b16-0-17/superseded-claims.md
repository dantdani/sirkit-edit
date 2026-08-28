# B16.0.17 — Superseded claims

## From B16.0.16 (tranche 9)

B16.0.16's "Remaining migration: 69 raw methods (baseline 72) — …
schematic-compiler/full-flow and other families" is **superseded**: the ten
`/api/schematic-compiler/*` methods are now canonical-wrapper adopted and
removed from the raw baseline.

## Inventory supersession

| Claim | Prior (B16.0.16) | Now (B16.0.17) |
|---|---|---|
| canonical wrappers | 81 | **91** |
| factories | 3 | 3 |
| raw methods | 69 | **59** |
| baseline | 72 | **62** |

## NOT superseded

- The exactly-12 tool exposure, manufacturing-release internality, and all
  B16.0.1–B16.0.16 claims for the other 143 methods remain valid.
- The CD-8 domain semantics (semantic graph, KiCad quarantine, uncertified
  comparison, view-only layout, proposal-only provider, human-approval export,
  direct-AI-transaction denial) are UNCHANGED — this stage migrated only the
  request boundaries.
