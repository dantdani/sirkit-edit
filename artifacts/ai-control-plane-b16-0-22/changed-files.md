# B16.0.22 — files changed by THIS stage

(The repository baseline is a single "first commit", so `git diff` spans all
B16.0.x stages; this list is the stage's own edit log.)

## Production

| file | change |
|---|---|
| `app/lib/auth/route-handlers.ts` | `legacyReaderRefusals?: "replacement-authority-v1"` option (closed enum), frozen envelope table, `readerRefusalResponse` used by `authenticatedJsonRoute` only |
| `app/api/assignment-queue/_scope.ts` | + `ASSIGNMENT_API_DEADLINE_MS`, `ASSIGNMENT_FORBIDDEN_BODY_KEYS`, `assignmentScopeFromContext`, `assignmentForbiddenAuthorityRefusal` (helpers retained) |
| `app/api/assignment-queue/route.ts` | GET → `authenticatedRoute({query:true})`; POST → `authenticatedJsonRoute` (1 MB/30 s, safeHeaders) |
| `app/api/footprint-resolution/_scope.ts` | + `FOOTPRINT_RESOLUTION_API_DEADLINE_MS`, `resolutionScopeFromContext` |
| `app/api/footprint-resolution/route.ts` | POST → `authenticatedJsonRoute` (4 MB/30 s, exposeAbortSignal) |
| `app/api/passive-policy/_scope.ts` | + `passivePolicyScopeFromContext` |
| `app/api/passive-policy/route.ts` | GET → `authenticatedRoute` (static doc); POST factory untouched |
| `app/api/pcb-sync/route.ts` | GET → `authenticatedRoute({query:true})` dispatching to the core; POST factory untouched |
| `app/api/pcb-sync/handler.ts` | + `createPcbSyncBoardGetCore` (Request-free); `createPcbSyncBoardGetHandler` → legacy adapter over the core |
| `app/api/physical-bindings/_scope.ts` | + `PHYSICAL_BINDING_API_DEADLINE_MS`, `bindingScopeFromContext` |
| `app/api/physical-bindings/route.ts` | GET → `authenticatedRoute({query:true})`; POST → `authenticatedJsonRoute` (2 MB/30 s) |
| `app/api/replacement-authority/route.ts` | POST → `authenticatedJsonRoute` (16,384 B/10 s, legacy refusal contract, exposeAbortSignal); callback logic verbatim |

## Tests / gates / generated

| file | change |
|---|---|
| `app/api/__tests__/b16-0-22-tranche-parity.test.ts` | NEW — 59 §A pins (57 pre = post, 2 documented supersessions) |
| `app/lib/auth/__tests__/b16-0-22-tranche15-confinement-gate.test.ts` | NEW — 9 gates |
| `app/lib/auth/__tests__/b16-0-8-migration-ratchet.test.ts` | + TRANCHE_15; BASELINE_MAX 29→21; MIGRATED_FLOOR 124→132 |
| `app/lib/auth/__tests__/_raw-route-baseline.json` | regenerated (sanctioned script): 29 → 21 rows |
| `app/lib/auth/__tests__/b16-0-2-gates.test.ts` | route-specific replacement-authority pin: guard-first → canonical wrapper (supersession note) |
| `app/lib/auth/__tests__/b16-0-3-boundary-gate.test.ts` | same-class pin update + `analyzeMethodBoundary` import |
| `artifacts/ai-control-plane-b16-0-7/route-wrapper-matrix.csv` | regenerated: 132/3/18 |
| `artifacts/ai-control-plane-b16-0-22/*` | this stage's 20 artifacts |

Nothing was deleted; no security test was weakened or skipped; the family
scope helpers and their standing suites remain intact.
