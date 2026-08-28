# B16.0.17.1 — Corrective stage: schematic proposal input & semantic-ID validation

Independent verification of B16.0.17 confirmed ONE defect: the
unknown-semantic-ID pin used a tool input that did NOT satisfy the
`SCHEMATIC_PROPOSAL_TOOL` schema, so the observed failure was an incidental
`TypeError` — the claimed `CD8_AI_PROPOSAL_REFERENCE_INVALID` proof was
invalid. This stage reproduces, repairs, and hardens.

## What was done

| Section | Delivery |
|---|---|
| §A | Defect reproduced verbatim BEFORE editing: `TypeError: Cannot read properties of undefined (reading 'map')` ([pre-edit-counterexample.md](pre-edit-counterexample.md)) |
| §B | The pin now uses the REAL tool contract (schema-checked fixture) and asserts the exact `CD8_AI_PROPOSAL_REFERENCE_INVALID` code at 422 — never mere `status !== 200` ([real-tool-schema-fixture.md](real-tool-schema-fixture.md)) |
| §C | NEW `validateSchematicProposalToolInput` beside the tool in `agent-tools.ts`, deriving enums/caps/lengths from the ONE schema literal; runs before normalization; malformed output → deterministic 422 `SCHEMATIC_PROPOSAL_OUTPUT_INVALID` ([structural-validation-contract.md](structural-validation-contract.md)) |
| §D | Provider invocation and local validation are now SEPARATE boundaries: only `generate()` maps to `providerErrorResponse` (503); local failures are deterministic 422s with bounded codes, never provider-availability mislabels ([provider-vs-local-error-boundary.md](provider-vs-local-error-boundary.md)) |
| §E | 19-test permanent adversarial suite `b16-0-17-1-proposal-validation.test.ts` covering all 16 mandated cases ([semantic-id-validation-proof.md](semantic-id-validation-proof.md)) |
| §F | Supersession notes appended to every B16.0.17 artifact carrying the invalid claim (pre-edit-counterexamples, proposal-provider-parity, unknowns-and-owner-decisions, final-verdict) — history corrected, not erased |

## Invariants held (§G, re-measured)

Inventory **91 canonical / 3 factories / 59 raw**, baseline **62** — the
regenerated wrapper matrix is byte-IDENTICAL to B16.0.17's (`cd4aaee0…`).
Tools exactly **12**. Prompt, provider routing, `maxTokens: 4096`,
`temperature: 0`, toolChoice, tool schema, graph semantics, transaction
authority, KiCad quarantine, layout view-only, export approval chain,
manufacturing-release internality, hashes and replay pins: all unchanged.

## Validation

Full suite **recorded in [test-and-validation-report.md](test-and-validation-report.md)**;
tsc 0; eslint 0; git clean; generators ×2 byte-stable.

B16.0.18 / B16.1 NOT started. `C:\Users\robsa\sirkit` untouched.


---

## ⚠️ SUPERSESSION NOTE (B16.0.17.2)

The one-source-of-truth claim in THIS document was **overstated**. Independent
verification found that `validateSchematicProposalToolInput` hard-coded a
4,096-character limit for `referencedSemanticObjectIds` and
`proposedActions[*].targetObjectIds` items while the declared tool schema
carried only `minLength: 1` (no `maxLength`) — so the provider-facing strict
schema permitted strings the local validator refused, and those two limits were
NOT schema-derived. B16.0.17.2 closed the drift: `maxLength: 4096` now lives in
the schema nodes themselves, the validator reads min/max from the nodes (no
hard-coded limits remain — gated), and an executable schema-parity gate plus
provider-adapter parity tests prove agreement at the 4,096/4,097 boundaries.
See `artifacts/ai-control-plane-b16-0-17-2/`. The historical text above is
retained as evidence.
