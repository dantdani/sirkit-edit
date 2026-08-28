# B16.0.8 — Changed files

## Production — wrapper foundation

| File | Change |
|---|---|
| `app/lib/auth/route-handlers.ts` | §B foundation: `publicRoute`, `workerRoute`, `kicadLibraryRoute` (narrow variant, token boundary only — see its TRUTHFUL SCOPE NOTE); SafeMetadataOptions (`query`, `safeHeaders` + construction-time forbidden-name validation, `routeParams` + `resolveDeclaredParams`, `exposeAbortSignal`); worker `unauthorized` declared refusal contract; all wrappers accept the Next ctx and thread opt-in projections; existing four wrappers preserved (B16.0.5 §D input pins unchanged without opt-ins) |

## Production — the 15 migrated route methods (tranche 1)

| Route file | Wrapper |
|---|---|
| `app/api/requirements/capabilities/route.ts` | publicRoute |
| `app/api/parts/categories/route.ts` | publicRoute |
| `app/api/kicad/v1/route.ts`, `…/categories.json/route.ts`, `…/parts/[id]/route.ts` | kicadLibraryRoute (+ routeParams:["id"]) |
| `app/api/constraints/explain/route.ts`, `…/preview/route.ts` | publicJsonRoute (2 MB/15 s) |
| `app/api/parts/search/route.ts` | publicJsonRoute (200 KB/10 s, query:true) |
| `app/api/assignment-queue/materialize/route.ts` | workerJsonRoute (8 MB/30 s, unauthorized AQ_SOURCE_WORKER_UNAUTHORIZED) |
| `app/api/assignment-queue/revalidate/route.ts` | workerRoute (unauthorized AQ_REVALIDATION_WORKER_UNAUTHORIZED + noStore, signal) |
| `app/api/engineering-effects/route.ts` | workerRoute (unauthorized DW_WORKER_UNAUTHORIZED + noStore, signal) |
| `app/api/footprint-resolution/route.ts` (GET only) | authenticatedRoute (POST stays legacy in the baseline) |
| `app/api/mapping-verification/route.ts` (GET only) | authenticatedRoute (POST factory stays legacy) |
| `app/api/requirements/compile/route.ts`, `…/sources/route.ts` | authenticatedJsonRoute (2 MB / 1.6 MB) |

Each migration removed the handwritten `authorizeRequest`/local-secret/bounded-
reader boilerplate and every raw `Request` use from the route module; business
logic moved verbatim into the callback.

## Ratchet / analyzer / tests

| File | Change |
|---|---|
| `scripts/generate-b16-0-8-baseline.ts` | NEW — baseline freeze/update generator (removals only; refusal on additions; guarded main; pure helpers exported) |
| `app/lib/auth/__tests__/_raw-route-baseline.json` | NEW — frozen 138-entry legacy baseline |
| `app/lib/auth/__tests__/b16-0-8-migration-ratchet.test.ts` | NEW — monotonic ratchet gate + 5 tripwires |
| `app/lib/auth/__tests__/b16-0-8-wrapper-capabilities.test.ts` | NEW — unit tests for every new wrapper capability + structural secret-header unavailability |
| `app/api/__tests__/b16-0-8-tranche-parity.test.ts` | NEW — 24 behavioral parity pins (green pre- AND post-migration) |
| `app/lib/auth/__tests__/_boundary-analysis.ts` | APPROVED_ROUTE_WRAPPERS + canonical sink symbols gain publicRoute/workerRoute/kicadLibraryRoute |
| `app/lib/auth/__tests__/b16-0-7-wrapper-adoption-gate.test.ts` | baseline assertion 0 → ≥15 (ratchet supersedes) |
| `app/lib/atomic/__tests__/kicad-http-route.test.ts` | `await` on the now-async GETs (call convention only; pins unchanged) |
| `app/lib/requirements/__tests__/api-persistence.test.ts` | capabilities GET now passed a Request (call convention only) |

## Explicitly NOT changed

Chat, replacement-authority, PCB release, Gerber export, SPICE streaming/events
and every other high-risk route (untouched, still in the baseline).
`C:\Users\robsa\sirkit` untouched. 12 exposed tools / replay pins / hashes /
internal-only release preserved.
