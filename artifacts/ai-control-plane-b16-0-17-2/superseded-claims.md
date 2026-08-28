# B16.0.17.2 — Superseded claims

## The overstated B16.0.17.1 claim (retired)

B16.0.17.1's `README.md`, `real-tool-schema-fixture.md`,
`structural-validation-contract.md` and `final-verdict.md` claimed the
validator "derives its enums, item caps and length limits FROM the
`SCHEMATIC_PROPOSAL_TOOL.schema` literal, so there is exactly one source of
truth".

**That was overstated for two limits.** The 4,096-char item length for
`referencedSemanticObjectIds` and `targetObjectIds` was hard-coded in the
validator while the schema declared no `maxLength` — the provider-facing strict
schema permitted strings the local validator refused. Supersession notes are
now APPENDED to all four documents (historical text preserved).

## What replaces it

- The schema itself now declares `maxLength: 4096` on both id-item nodes (an
  intentional tightening of provider-declared output);
- the validator reads min/max/maxItems from the nodes — zero hard-coded
  limits, gated by a source scan;
- a 10-test executable parity gate + a live-mutation tripwire keep the two
  contracts in lockstep;
- both provider adapters are proven to carry the schema reference-identically.

## What is NOT superseded

Everything else in B16.0.17.1 stands and was re-verified: the defect
reproduction, the corrected unknown-ID pin, the structural-validation layer
(all its NON-length checks were already schema-derived), the provider/local
error-boundary separation, and the 19-test adversarial suite — all green in
this stage's runs.
