# B16.0.19 — Superseded claims

## From B16.0.18

"Remaining migration: 49 raw methods (baseline 52)" is **superseded**: the nine
circuit-knowledge/-verification methods are now canonical.

| Claim | Prior | Now |
|---|---|---|
| canonical wrappers | 101 | **110** |
| raw methods | 49 | **40** |
| baseline | 52 | **43** |

## Intentional contract changes (documented)

Both propose routes' error boundaries changed per §D/§F: local
structural/semantic failures previously surfaced through the broad provider
catch (503 envelope); they are now deterministic local 422s
(`CIRCUIT_CLAIM_OUTPUT_INVALID`, `VERIFICATION_PROPOSAL_OUTPUT_INVALID`, exact
`CD9_*` codes). The knowledge tool's schema moved from the route inline into
the shared agent-tools authority and gained ref-item bounds (≤300); the
verification tool's id items gained ≤4096 bounds. All are mandated
security-boundary tightenings, pinned in the new §D/§F suite.

## NOT superseded

All B16.0.1–B16.0.18 claims for the other 144 methods; both families' domain
semantics (oracle, readiness, applicability, compile/compose, source-evidence
chain) are unchanged.
