# B13.2 — full-scope identity, active abort settlement, real route integration

Corrective stage over B13.1 after independent verification found seven
defects. The valid B13/B13.1 work is preserved intact: production source
construction, the shared board identity, physical-binding digest validation,
atomic asset cross-checking, asset-substitution prevention, provider schema
parity, ten-tool exposure, and replay/trace behaviour all remain in force and
green.

| # | Defect | Closure |
| --- | --- | --- |
| R1 | component identity substitution — component 2's authority relabeled as component 1 WITH exact authority | ONE complete `AuthorityComponentScope`; component id is part of the scope the source receives; the projected id derives from the VALIDATED durable scope — [complete-scope-contract.md](complete-scope-contract.md) |
| R2 | hierarchy substitution accepted (no hierarchy in the request contract) | `hierarchyPath` is part of the requested scope and compared element-wise — [component-hierarchy-variant-isolation.md](component-hierarchy-variant-isolation.md) |
| R3 | variant substitution accepted (`["variant-alt"]` served a `variant-default` request) | variant applicability rule: empty = universal (the repository's existing semantic), otherwise must contain the requested variant |
| R4 | `verified-exact` with `selectedPart.manufacturer` ≠ `exactAuthority.manufacturer` | manufacturer agreement + bounded-identifier validation now required; inspection and grant eligibility agree — [exact-authority-consistency.md](exact-authority-consistency.md) |
| R5 | mid-flight external abort HUNG until the separate deadline | external abort is a terminal member of the settlement race; one settlement, timer cleared, listener removed, late arrivals discarded — [abort-settlement-state-machine.md](abort-settlement-state-machine.md) |
| R6 | `void signal` — production database work not cancelled | a cancellable server-only read adapter invokes postgres.js `query.cancel()` on all six authority reads and starts no query once aborted — [production-query-cancellation.md](production-query-cancellation.md) |
| R7 | "route integration" never invoked the POST handler | an executable suite drives the REAL exported `POST` handler with only the provider adapter and the durable source controlled — [api-chat-integration.md](api-chat-integration.md) |

A mismatched aggregate is never relabeled, projected, folded into a
conflicted record, or used to expose another scope's durable identifiers: the
load fails closed with a bounded reason.

Details: [pre-edit-counterexamples.md](pre-edit-counterexamples.md) ·
[regression-evidence.md](regression-evidence.md) ·
[artifact-and-replay-stability.md](artifact-and-replay-stability.md) ·
[final-verdict.md](final-verdict.md)
