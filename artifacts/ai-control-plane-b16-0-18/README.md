# B16.0.18 — Component-selection route migration, tranche 11

All ten CD-6 component-selection methods are canonical-wrapper adopted:

`POST /api/component-selection/{alternative, catalog, evaluate, export,
feedback, problem, propose, solve, sourcing, transaction}` →
`authenticatedJsonRoute({ maxBytes: 12_000_000, deadlineMs: 30_000 })` (the
deadline verified as the `scopedTrustedJson` reader default). `scopedJson` is
retained; a Request-free `componentSelectionScopeFromContext(context)` was
added (delegates to the shared `flatScopeOf`, exact
`ComponentSelectionApiScope`).

## §E applied UP FRONT (the B16.0.17.1/.2 lesson)

The propose route no longer casts arbitrary provider output into the domain
type or funnels local errors through the provider catch:

- NEW `validateComponentSearchProposalToolInput` beside the tool in
  `agent-tools.ts` — every constraint READ FROM the schema nodes;
- structural failures → deterministic 422 `COMPONENT_PROPOSAL_OUTPUT_INVALID`;
- unpinned role/revision/cap → deterministic 422 with the exact `CD6_*` codes;
- provider invocation failures alone → `providerErrorResponse` (503 envelope);
- provider-adapter parity: both SDK payloads carry the schema
  **reference-identically** with `strict: true`.

## Results at a glance

| Metric | Value |
|---|---|
| §A behavioral pins (pre = post) | **79** ([pre-edit-counterexamples.md](pre-edit-counterexamples.md)) |
| §E adversarial + adapter tests | **15** ([provider-output-schema-validation.md](provider-output-schema-validation.md), [provider-adapter-schema-parity.md](provider-adapter-schema-parity.md)) |
| Confinement + human-truth gates | **11** ([callback-and-import-confinement.md](callback-and-import-confinement.md), [no-purchase-no-mutation-proof.md](no-purchase-no-mutation-proof.md)) |
| Standing routes.test + domain suites | unchanged, green |
| Sourcing | refresh stays fail-closed 503 + `Retry-After: 300`; zero live calls ([sourcing-fail-closed-proof.md](sourcing-fail-closed-proof.md)) |
| Export | `PRELIMINARY_NOT_RELEASED` preserved ([preliminary-export-truthfulness.md](preliminary-export-truthfulness.md)) |
| Ratchet | 62 → **52** (10 removed, 0 added) |
| Inventory | **153 total · 101 canonical · 3 factories · 49 raw** |
| Full suite | recorded in [test-and-validation-report.md](test-and-validation-report.md); tsc 0; eslint 0; git clean; generators ×2 byte-stable |

## Scope

No provider credits, live distributor calls, network, purchasing, catalog
ingestion, or DB writes; tool exposure stays 12; `C:\Users\robsa\sirkit`
untouched. B16.0.19 / B16.1 NOT started.
