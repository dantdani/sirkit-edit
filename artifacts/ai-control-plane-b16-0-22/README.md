# B16.0.22 — Tranche 15: durable engineering-authority route migration

Stage scope: migrate exactly EIGHT methods to canonical wrappers —
GET+POST `/api/assignment-queue`, POST `/api/footprint-resolution`,
GET `/api/passive-policy`, GET `/api/pcb-sync`, GET+POST
`/api/physical-bindings`, POST `/api/replacement-authority` — with the
verified historical ceilings/deadlines preserved and the
replacement-authority boundary's exact B14.2/B14.3 refusal envelopes kept
byte-identical through a declarative legacy refusal contract.

Worked ONLY in `C:\Users\robsa\Desktop\sirkit-edit`. The protected original
`C:\Users\robsa\sirkit` was NOT touched. Zero providers, subprocesses,
containers, devices, network, or DB writes. B16.1, MCP, multi-agent
orchestration, and provider expansion NOT started.

## Artifact index

| file | content |
|---|---|
| [final-verdict.md](final-verdict.md) | stop-condition, item by item |
| [route-migration-manifest.csv](route-migration-manifest.csv) | the 8 methods: wrapper, options, ceilings |
| [pre-edit-counterexamples.md](pre-edit-counterexamples.md) | observed pre-edit realities that differed from expectation |
| [authorization-and-scope-proof.md](authorization-and-scope-proof.md) | auth/membership/role/trusted-scope pins |
| [csrf-and-zero-pull-proof.md](csrf-and-zero-pull-proof.md) | production CSRF with ZERO body pulls |
| [bounded-read-and-ceiling-proof.md](bounded-read-and-ceiling-proof.md) | per-family byte ceilings + deadlines |
| [replacement-authority-proof.md](replacement-authority-proof.md) | §G highest-risk boundary, item by item |
| [legacy-refusal-contract.md](legacy-refusal-contract.md) | the declarative `replacement-authority-v1` contract |
| [query-projection-deltas.md](query-projection-deltas.md) | the TWO documented supersessions |
| [assignment-queue-authority-proof.md](assignment-queue-authority-proof.md) | commit opt-in header, forbidden keys, scope forcing |
| [footprint-resolution-proof.md](footprint-resolution-proof.md) | signal threading + scope forcing |
| [physical-bindings-proof.md](physical-bindings-proof.md) | redaction gates, scope byte-match, idempotency |
| [pcb-sync-read-proof.md](pcb-sync-read-proof.md) | Request-free board-load core |
| [unreachable-branch-notes.md](unreachable-branch-notes.md) | family 401 kind-guards vs wrapper 403 |
| [ratchet-evidence.md](ratchet-evidence.md) | baseline 29 → 21; TRANCHE_15; floor 132 |
| [test-and-validation-report.md](test-and-validation-report.md) | complete suite + static gates |
| [superseded-claims.md](superseded-claims.md) | claims replaced by this stage |
| [unknowns-and-owner-decisions.md](unknowns-and-owner-decisions.md) | decisions taken + carried unknowns |
| [wrapper-inventory-summary.md](wrapper-inventory-summary.md) | 153 / 132 / 3 / 18 / baseline 21 |
| [safe-header-proof.md](safe-header-proof.md) | the commit opt-in header allowlist mechanics |
| [feature-gate-proof.md](feature-gate-proof.md) | fail-closed rollout gates, three families |
| [changed-files.md](changed-files.md) | this stage's exact edit log |
| [pin-suite-summary.md](pin-suite-summary.md) | the 59 §A pins, categorized |

## Changed files (production)

- `app/lib/auth/route-handlers.ts` — `legacyReaderRefusals?: "replacement-authority-v1"` (closed enum) + fixed envelope table
- `app/api/assignment-queue/{_scope,route}.ts` — projector + forbidden-key helper; GET/POST canonical
- `app/api/footprint-resolution/{_scope,route}.ts` — projector; POST canonical (`exposeAbortSignal`)
- `app/api/passive-policy/{_scope,route}.ts` — projector; GET canonical
- `app/api/pcb-sync/{route,handler}.ts` — GET canonical; `createPcbSyncBoardGetCore` (Request-free) + legacy adapter retained
- `app/api/physical-bindings/{_scope,route}.ts` — projector; GET/POST canonical
- `app/api/replacement-authority/route.ts` — POST canonical with the v1 legacy refusal contract

Tests: `app/api/__tests__/b16-0-22-tranche-parity.test.ts` (59 §A pins),
`app/lib/auth/__tests__/b16-0-22-tranche15-confinement-gate.test.ts` (9 gates),
ratchet TRANCHE_15 + BASELINE_MAX 21 + MIGRATED_FLOOR 132, baseline JSON
regenerated ONLY via `scripts/generate-b16-0-8-baseline.ts` (×2 byte-stable).
