# B16.0.23 — files changed by THIS stage

## Production

| file | change |
|---|---|
| `app/lib/auth/route-handlers.ts` | + `querySelector?: boolean` option + `selectorFromQuery` (per-request header-less selector parsing inside `authenticatedRoute`) |
| `app/api/spice/compile/route.ts` | POST → `publicJsonRoute` (8 MB / 30 s) |
| `app/api/spice/reports/route.ts` | POST → `publicJsonRoute` (attachment responses preserved) |
| `app/api/spice/run-plans/estimate/route.ts` | POST → `publicJsonRoute` |
| `app/api/spice/models/import/route.ts` | POST → `authenticatedJsonRoute` (4 MB / 20 s) |
| `app/api/spice/models/smoke-test/route.ts` | POST → `authenticatedJsonRoute` (2 MB / 15 s); spawn logic verbatim |
| `app/api/spice/runs/_scope.ts` | + `spiceRunScopeFromContext` projector (helpers retained) |
| `app/api/spice/runs/route.ts` | GET → `authenticatedRoute({query,querySelector})`; POST → `authenticatedJsonRoute` |
| `app/api/spice/runs/[id]/route.ts` | GET/DELETE → `authenticatedRoute` (routeParams id) |
| `app/api/spice/runs/[id]/bundle/route.ts` | GET → `authenticatedRoute` (querySelector + routeParams); zip logic verbatim |
| `app/api/spice/runs/[id]/events/route.ts` | GET → `authenticatedRoute`; SSE stream verbatim |
| `app/api/spice/runs/[id]/waveforms/route.ts` | GET → `authenticatedRoute({query,querySelector,routeParams})` |
| `app/api/spice/ai/route.ts` | POST → `authenticatedJsonRoute`; §G provider/local error split; schemas imported from `_tools.ts` + structural validation |
| `app/api/spice/ai/_tools.ts` | NEW — the 20 tool schemas (frozen) + `validateSpiceToolInput` (schema-node-derived) |
| `app/lib/spice/server/job-store.ts` | §E/§F terminal-record guard on BOTH `executeQueuedRun` settle paths |

## Tests / gates / generated

| file | change |
|---|---|
| `app/api/__tests__/b16-0-23-tranche-parity.test.ts` | NEW — 44 §A pins (42 pre=post + 2 documented supersessions) |
| `app/lib/auth/__tests__/b16-0-23-tranche16-confinement-gate.test.ts` | NEW — 10 gates |
| `app/lib/llm/__tests__/b16-0-23-adapter-schema-parity.test.ts` | NEW — 3 adapter-parity pins |
| `app/lib/auth/__tests__/b16-0-8-migration-ratchet.test.ts` | + TRANCHE_16; BASELINE_MAX 21→8; MIGRATED_FLOOR 132→145 |
| `app/lib/auth/__tests__/_raw-route-baseline.json` | regenerated (sanctioned script): 21 → 8 rows |
| `artifacts/ai-control-plane-b16-0-7/route-wrapper-matrix.csv` | regenerated: 145/3/5 |
| `artifacts/ai-control-plane-b16-0-23/*` | this stage's 23 artifacts |

Nothing was deleted; no security test was weakened or skipped; the
`spiceRunScope` helper and its standing scope-isolation + worker-integration
suites remain intact and green.
