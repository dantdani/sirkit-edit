# B16.0.10 §E — Schematic behavioral parity results

The 57-pin suite was run GREEN against the PRE-migration handlers, the 8 routes
were migrated, and the suite was re-run GREEN **with zero assertion changes** —
the definition of parity used by B16.0.8/B16.0.9 and preserved here.

## Per-surface behavior pinned and preserved

| Surface | Pinned specifics |
|---|---|
| `/api/schematic` | bare-netlist 200 body (NO `ok` envelope, no no-store header — historical), `{error}` 400 shape, no-tool → 500 `{error:"no schematic returned"}` |
| `/api/schematic/build` | `{ok:true,netlist,explanation}` / failure pass-through `{ok:false,error,code,provider}` with the loop's status |
| `/api/schematic/build-multi` | planner→gate→single-loop path (≤1 block); provider threaded to planner AND loop |
| `/api/schematic/cross-verify` | unconfigured SchGen → 200 `{ok:true,available:false,findings:[],agreement:null,…}` before any part loading or fetch |
| `/api/schematic/edit` | op filtering (unknown target dropped into the note with the exact `(dropped N: …)` format), `needsTopology` passthrough |
| `/api/schematic/edit-build` | part seeding via `getPartsByIds`, historical user-message shape, loop failure pass-through |
| `/api/schematic/layout-critic` | data-URL validation, manifest verification (hallucinated refDes removed), `applied:false` with the ORIGINAL state when nothing actionable |
| `/api/schematic/review` | ground-truth contradiction dropping (`dropped` count), summary passthrough |

## Not merged / not refactored

Per the mandate: the 8 routes remain separate modules with their historical
response shapes; no prompt was moved, no domain logic was "cleaned up", no
error was normalized beyond what the shared boundary already did pre-migration.
The `/api/schematic` bare-response idiosyncrasies (no `ok` field, no no-store)
are historical behavior — preserved, not corrected (recorded in
[unknowns-and-owner-decisions.md](unknowns-and-owner-decisions.md)).

## Also green

- `b16-0-4-bounded-body-behavior` (drives `schematic/build` with counting
  streams) and `b16-0-5-media-type-and-wrapper` — unchanged, passing.
- The full bounded-fork suite — see
  [test-and-validation-report.md](test-and-validation-report.md).
