# B13.1 — production component-authority activation and durable-source integrity

Corrective stage over B13 after independent verification found eight
defects. B13's resource bridge existed but could not activate in
production (no real source, wrong board identity), trusted unvalidated
durable records, under-checked atomic confirmation, misclassified
facet-clean records, did not cancel timed-out work, and had a vacuous
provider-parity test. All eight are reproduced and closed.

| # | Defect | Closure |
| --- | --- | --- |
| R1 | resolver returns null in normal runtime | real production default source (Postgres bindings + published-atomic confirmer), lazy, fail-closed — [production-runtime-wiring.md](production-runtime-wiring.md) |
| R2 | activation only through test injection | the default path constructs the real source; the setter is test-only with deterministic reset |
| R3 | board identity mismatch (`board:${projectId}` vs `${projectId}:${branchId}`) | ONE shared `pcbBoardInstanceId` + hierarchy/variant defaults used by writer AND reader — [board-and-component-scope-parity.md](board-and-component-scope-parity.md) |
| R4 | invalid durable records accepted | `validatePhysicalBinding` on every binding + `validateBindingSet` on the collection before projection; tampered aggregates fail closed as truthful `conflicted` — [durable-aggregate-validation.md](durable-aggregate-validation.md) |
| R5 | revision-only atomic confirmation | allowlisted projection of the published `PortableAtomicSnapshot`; five-field exact cross-check — [atomic-snapshot-consistency.md](atomic-snapshot-consistency.md) |
| R6 | facet-clean records without exactAuthority classified verified-exact | new truthful `exact-authority-unresolved` state; verified-exact REQUIRES a complete consistent exactAuthority — [authority-state-semantics.md](authority-state-semantics.md) |
| R7 | deadline did not cancel work | internal AbortController linked to req.signal, aborted at deadline, passed to sources; one settlement, late results discarded, no unhandled rejections, pre-aborted = no I/O — [deadline-and-cancellation.md](deadline-and-cancellation.md) |
| R8 | vacuous provider-parity test | real `renderOpenAiResponsesTool`/`renderAnthropicAgentTool` transform comparison — [route-and-provider-integration.md](route-and-provider-integration.md) |

Details: [pre-edit-counterexamples.md](pre-edit-counterexamples.md) ·
[regression-test-evidence.md](regression-test-evidence.md) ·
[artifact-and-replay-stability.md](artifact-and-replay-stability.md) ·
[final-verdict.md](final-verdict.md)
