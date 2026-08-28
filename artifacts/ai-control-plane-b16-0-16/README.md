# B16.0.16 — Calculation workbench route migration, tranche 9

All eight CD-7 calculation methods are now canonical-wrapper adopted:

`POST /api/calculation/{corners, evaluate, export, feedback, problem, propose,
report, transaction}` → `authenticatedJsonRoute({ maxBytes: 12_000_000, deadlineMs: 30_000 })`.

They previously composed `scopedJson` (`scopedTrustedJson(maxBytes: 12M)` +
`flatScopeOf`). That helper is **kept** (retained for any other consumer) and
given a Request-free companion `calculationScopeFromContext(context)` that
delegates to the same shared `flatScopeOf`, producing the exact existing
`CalculationApiScope`.

## The deadline (CONFIRMED)

`scopedTrustedJson` passes **no** `deadlineMs`, so the reader's 30 s default
(`DEFAULT_BODY_DEADLINE_MS`) has always applied. The wrapper adopts
`deadlineMs: 30_000` explicitly — the verified existing value.

## Results at a glance

| Metric | Value |
|---|---|
| Behavioral pins (pre = post) | **67** ([pre-edit-counterexamples.md](pre-edit-counterexamples.md)) |
| Confinement + no-misleading-authority gates | **12** ([callback-and-import-confinement.md](callback-and-import-confinement.md)) |
| Calculation domain suite | unchanged, green ([deterministic-evaluator-authority.md](deterministic-evaluator-authority.md)) |
| Role separation | 6 restricted routes deny viewer (403); export/report open to all members ([route-behavior-parity.md](route-behavior-parity.md)) |
| Server-derived scope/actor | body project/branch/actor/role/session never authority; transaction actor built from trusted context ([trusted-scope-and-actor-proof.md](trusted-scope-and-actor-proof.md)) |
| Proposal provider | zero on refusal, exactly-once on valid; proposal_only, empty numeric outputs; prompt/schema byte-identical ([proposal-provider-parity.md](proposal-provider-parity.md)) |
| Export | requires current human-approved report; `NOT_RELEASED`; explicit non-release handoff ([export-authority-and-human-approval.md](export-authority-and-human-approval.md)) |
| Tool exposure | remains EXACTLY 12; no calculation route becomes agent-exposed ([no-misleading-authority-proof.md](no-misleading-authority-proof.md)) |
| Ratchet | 80 → **72** (8 removed, 0 added) |
| Inventory | **153 total · 81 canonical · 3 factories · 69 raw** |
| Full suite | **recorded in [test-and-validation-report.md](test-and-validation-report.md)**; tsc 0; eslint 0; git clean; generators ×2 byte-stable |

## Documents

pre-edit-counterexamples · [calculation-route-migration-manifest.csv](calculation-route-migration-manifest.csv) ·
route-behavior-parity · trusted-scope-and-actor-proof ·
deterministic-evaluator-authority · proposal-provider-parity ·
report-integrity-proof · transaction-semantics · feedback-semantics ·
export-authority-and-human-approval · no-misleading-authority-proof ·
callback-and-import-confinement · zero-work-refusal-proof ·
ratchet-and-inventory-results · changed-files · test-and-validation-report ·
superseded-claims · unknowns-and-owner-decisions · [final-verdict.md](final-verdict.md)

## Scope

No provider credits, no live network/DB; `C:\Users\robsa\sirkit` untouched.
B16.0.17 / B16.1 NOT started.
