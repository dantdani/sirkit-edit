# B16.0.18 — Superseded claims

## From B16.0.17.2

"Remaining migration: 59 raw methods (baseline 62)" is **superseded**: the ten
`/api/component-selection/*` methods are now canonical-wrapper adopted.

## Inventory supersession

| Claim | Prior (B16.0.17.2) | Now (B16.0.18) |
|---|---|---|
| canonical wrappers | 91 | **101** |
| factories | 3 | 3 |
| raw methods | 59 | **49** |
| baseline | 62 | **52** |

## Intentional contract change (documented, not a parity break)

The propose route's error boundary changed per the §E mandate: previously
malformed provider output or unpinned references surfaced through the broad
provider catch (503 envelope); now they are deterministic local 422s
(`COMPONENT_PROPOSAL_OUTPUT_INVALID` / exact `CD6_*` codes). The §A parity
suite deliberately pins only the pre = post contracts; the new contract is
pinned in the §E suite. This is the B16.0.17.1/.2 lesson applied during the
stage rather than in a later corrective.

## NOT superseded

The exactly-12 tool exposure, manufacturing-release internality, and all
B16.0.1–B16.0.17.2 claims for the other 143 methods remain valid. CD-6 domain
semantics (evaluators, solver, alternatives, sourcing factories, feedback,
transactions) are unchanged.
