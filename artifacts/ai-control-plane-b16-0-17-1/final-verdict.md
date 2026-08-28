# B16.0.17.1 — Final verdict (stop condition, item by item)

| Stop-condition item | Verdict | Evidence |
|---|---|---|
| the test uses the real tool schema | **MET** | schema-checked fixture; validator derives from the schema literal ([real-tool-schema-fixture.md](real-tool-schema-fixture.md)) |
| valid unknown-ID payloads reach semantic-ID validation | **MET** | normalize invoked, structural gate passed first, exact code asserted ([semantic-id-validation-proof.md](semantic-id-validation-proof.md)) |
| unknown IDs return a deterministic local 422 | **MET** | 422 `CD8_AI_PROPOSAL_REFERENCE_INVALID` (referenced + target variants) |
| malformed provider output returns a deterministic local 422 | **MET** | 422 `SCHEMATIC_PROPOSAL_OUTPUT_INVALID` across 11 malformation cases incl. the original flawed fixture ([structural-validation-contract.md](structural-validation-contract.md)) |
| local failures never mislabeled as provider failures | **MET** | local envelope carries no provider/retryable fields; provider envelope (503) never carries the local codes ([provider-vs-local-error-boundary.md](provider-vs-local-error-boundary.md)) |
| valid proposals still succeed | **MET** | 200 proposal_only, digest-bound proposal, null mutations, provider header |
| inventory remains 91/3/59 | **MET** | re-measured; wrapper matrix byte-IDENTICAL to B16.0.17 (`cd4aaee0…`) |
| tool exposure remains 12 | **MET** | gates re-run green |
| full suite exits 0 | **MET** | **3991 passed / 0 failed / exit 0** ([test-and-validation-report.md](test-and-validation-report.md)) |
| artifacts truthfully supersede the incorrect claim | **MET** | supersession notes appended to all four affected B16.0.17 documents; history preserved ([superseded-claims.md](superseded-claims.md)) |
| protected original untouched | **MET** | `C:\Users\robsa\sirkit` unchanged |

## The defect, honestly stated

My B16.0.17 unknown-ID pin was invalid: its fixture did not satisfy the
declared tool schema, the observed failure was an incidental TypeError, and
the pin's `status !== 200` assertion masked that. This stage reproduced the
defect verbatim before editing, repaired the pin against the real contract,
added the missing structural-validation layer, separated the provider/local
error boundaries, and corrected the record.

## Verdict

**B16.0.17.1 is COMPLETE under its stop condition.** Stopping. B16.0.18 and
B16.1 NOT started; awaiting independent verification of this correction.


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
