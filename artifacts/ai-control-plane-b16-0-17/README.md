# B16.0.17 — Schematic-compiler route migration, tranche 10

All ten CD-8 schematic-compiler methods are canonical-wrapper adopted:

`POST /api/schematic-compiler/{compare, diff, export, graph/validate,
kicad/inspect, layout, problem, propose, transaction, variants}` →
`authenticatedJsonRoute({ maxBytes: 32_000_000, deadlineMs: 30_000 })`.

They previously composed `scopedJson` (`scopedTrustedJson(maxBytes: 32M)` +
`flatScopeOf`). That helper is **kept**; a Request-free companion
`schematicCompilerScopeFromContext(context)` was added, delegating to the same
shared `flatScopeOf` and producing the exact `SchematicCompilerApiScope`.

## The deadline (CONFIRMED)

`scopedTrustedJson` passes **no** `deadlineMs`, so the reader's 30 s default
has always applied. The wrapper adopts `deadlineMs: 30_000` — the verified
existing value.

## Results at a glance

| Metric | Value |
|---|---|
| Behavioral pins (pre = post) | **82** ([pre-edit-counterexamples.md](pre-edit-counterexamples.md)) |
| Confinement + human-truth gates | **11** ([callback-and-import-confinement.md](callback-and-import-confinement.md)) |
| Standing `routes.test.ts` (incl. denies-direct-AI-transactions) | unchanged, green |
| Proposal provider | zero on refusal, exactly-once valid; `proposal_only` + null graph/diagram/pcb mutations; prompt/schema byte-identical ([proposal-provider-parity.md](proposal-provider-parity.md)) |
| KiCad | inspection stays `quarantine_inspection_only` + `semanticImport: null`; comparison stays diagnostic 422 uncertified ([kicad-quarantine-proof.md](kicad-quarantine-proof.md), [round-trip-truthfulness.md](round-trip-truthfulness.md)) |
| Layout | `view_only` + graph-digest binding ([layout-view-authority.md](layout-view-authority.md)) |
| Export | human-approved candidate + `approved_for_CD9` + round-trip certificate; `NOT_RELEASED`; explicit non-release handoff ([human-approval-and-export.md](human-approval-and-export.md)) |
| Tool exposure | remains EXACTLY 12; manufacturing release internal-only ([no-misleading-authority-proof.md](no-misleading-authority-proof.md)) |
| Ratchet | 72 → **62** (10 removed, 0 added) |
| Inventory | **153 total · 91 canonical · 3 factories · 59 raw** |
| Full suite | recorded in [test-and-validation-report.md](test-and-validation-report.md); tsc 0; eslint 0; git clean; generators ×2 byte-stable |

## Documents

pre-edit-counterexamples · [schematic-compiler-route-manifest.csv](schematic-compiler-route-manifest.csv) ·
route-behavior-parity · trusted-scope-and-actor-proof · semantic-graph-authority ·
proposal-provider-parity · kicad-quarantine-proof · round-trip-truthfulness ·
layout-view-authority · transaction-security · human-approval-and-export ·
no-misleading-authority-proof · callback-and-import-confinement ·
zero-work-refusal-proof · ratchet-and-inventory-results · changed-files ·
test-and-validation-report · superseded-claims · unknowns-and-owner-decisions ·
[final-verdict.md](final-verdict.md)

## Scope

No provider credits, no live network/DB; no KiCad semantic importer built;
`C:\Users\robsa\sirkit` untouched. B16.0.18 / B16.1 NOT started.
