# B16.0.19 — Circuit-knowledge & circuit-verification migration, tranche 12

Nine routes across two families are canonical-wrapper adopted:

- `POST /api/circuit-knowledge/{applicability, compile, compose, problem, propose}` → `authenticatedJsonRoute({ maxBytes: 8_000_000, deadlineMs: 30_000 })`
- `POST /api/circuit-verification/{problem, propose, readiness, run}` → `authenticatedJsonRoute({ maxBytes: 32_000_000, deadlineMs: 30_000 })`

Deadlines verified as the `scopedTrustedJson` reader default. Both `scopedJson`
helpers retained; Request-free `circuitKnowledgeScopeFromContext` /
`circuitVerificationScopeFromContext` added (delegate to `flatScopeOf`).

## Both provider boundaries hardened (§D/§F, the B16.0.17.x lesson up front)

- **circuit-knowledge/propose** — the inline tool name + schema MOVED into the
  new shared authority `app/lib/circuit-knowledge/agent-tools.ts`
  (`CIRCUIT_RECIPE_CLAIM_TOOL`) beside its schema-derived validator; the three
  previously UNBOUNDED ref-array items now declare `minLength: 1, maxLength: 300`
  in the schema itself; local failures → 422 `CIRCUIT_CLAIM_OUTPUT_INVALID`.
- **circuit-verification/propose** — id items gained schema `maxLength: 4096`;
  new schema-derived `validateCircuitVerificationProposalToolInput` runs before
  `normalizeVerificationRemediationProposal`; local failures → 422 with the
  exact `CD9_AI_PROPOSAL_FINDING_REFERENCE_INVALID` /
  `CD9_REMEDIATION_PROPOSAL_INPUT_INVALID` / `VERIFICATION_PROPOSAL_OUTPUT_INVALID`
  codes. Provider invocation failures alone → 503 envelope.
- Adapter parity: both SDK payloads carry BOTH schemas reference-identically
  with `strict: true`.

## Results at a glance

| Metric | Value |
|---|---|
| §A pins (pre = post) | **77** ([pre-edit-counterexamples.md](pre-edit-counterexamples.md)) |
| §D/§F adversarial + adapter tests | **11 + 5** |
| Confinement + human-truth gates | **8** |
| Standing routes/domain suites | unchanged, green |
| Ratchet | 52 → **43** (9 removed, 0 added) |
| Inventory | **153 total · 110 canonical · 3 factories · 40 raw** |
| Full suite | recorded in [test-and-validation-report.md](test-and-validation-report.md); tsc 0; eslint 0; git clean; generators ×2 byte-stable |

## Scope

No new circuit rules, knowledge claims, waivers, approvals, safety claims,
verification claims, or schematic/PCB mutations; zero credits/network/DB;
tools stay 12; `C:\Users\robsa\sirkit` untouched. B16.0.20 / B16.1 NOT started.
