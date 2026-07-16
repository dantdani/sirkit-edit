# Multilayer FreeRouting and route-aware placement correction

Date: 2026-07-15

## Root cause

FreeRouting 2.2.4 was not the component discarding Sirkit routes. The local
integration flattened every four-layer board into generic signal layers, did
not export autorouter layer policy or plane assignments, and accepted SES
output by silently skipping unknown/disabled layers and unknown via padstacks.
The UI then called any non-empty import "routed", even when schematic pad
connectivity still had open clusters. Placement had a separate geometry-only
pipeline with no generated-outline policy, pin-access metric, congestion score,
or routing-space margin.

## What changed

- Added a canonical board stackup with stable Sirkit/DSN/SES identities,
  physical order, signal/plane/mixed roles, plane-net assignment, per-layer
  preferred direction, routing width, and autoroute enablement.
- Added Simple 2-layer, Signal/plane 4-layer, All-signal 4-layer, and Dense
  4-layer profiles. Legacy `stackup: 2 | 4` boards migrate in memory without a
  format break.
- DSN now emits every enabled layer in physical order, legal full-span via
  padstacks, layer-dependent widths, autoroute settings, preferred directions,
  plane polygons, and protected existing copper. Manual routes are therefore
  preserved while FreeRouting fills missing connectivity.
- A fail-closed DSN preflight checks boundary geometry, layer order/count,
  positive widths and clearances, pin references, via geometry, via references,
  and transition reachability before Java starts.
- SES import now uses the canonical mapping for top, bottom, and both inner
  layers. Unknown nets, disabled/unknown layers, malformed widths, invalid via
  coordinates, and unknown padstacks reject the entire import. The report
  includes per-layer segment count and track length.
- The server constructs a candidate board, runs exact pad/copper connectivity
  and DRC, and marks it complete only when all expected pad groups connect with
  no shorts or route-blocking errors. Otherwise it explicitly returns partial,
  including required/completed/remaining connections and airwires.
- Autoroute UI states are explicit: queued, running, complete, partial, failed,
  and cancelled. A partial result is never presented as complete.
- Successful runs create a local, secret-free debug bundle under the OS temp
  directory with board JSON, DSN, SES, engine log, mapping, layer use,
  connectivity before/after, DRC, and summary.
- Generated placement regions expand width and height exactly 10 percent around
  their center. User-authored outlines never resize without explicit approval.
  Courtyard routing space also grows 10 percent, and two deterministic
  candidates are ranked by overlap, outline fit, pad access, airwire crossings,
  ratsnest length, congestion, and estimated via demand.
- Placement plus generated-outline expansion remains one undoable transaction.
- The right panel now exposes stackup profiles, layer roles, plane nets,
  preferred direction, autoroute participation, layer use, isolate, and show-all
  copper controls.
- Added deterministic read-only AI CAD tools for stackup, routeability, layer
  usage, unrouted connectivity, and DSN preparation/preflight. The LLM can
  reason over measured board state but cannot mutate it directly.

## Safety boundary

The original `C:\Users\robsa\sirkit` directory was not modified. All code,
tests, runtime output, and documentation are in
`C:\Users\robsa\Documents\Codex\2026-07-13\do\work\sirkit-edit`.

## Verification

- 26 focused DSN/SES/API/placement/verification tests passed.
- PCB suite: 460 passed, 2 skipped. Two pre-existing wall-clock performance
  gates missed only during the fully parallel loaded run, then both passed in
  isolation: 4,940-item connectivity 40.8 ms (50 ms gate), 500-track live
  preview p50 14.9 ms and p95 21.8 ms.
- Real FreeRouting 2.2.4 forced multilayer fixture: complete, 2/2 expected
  connections, one 30 mm segment on Inner 1 and one 30 mm segment on Inner 2,
  zero layer loss, 5.8 seconds. Re-run with `npm run pcb:verify-multilayer`.
- Live browser: switched from 2-layer to Signal/plane 4-layer without refresh;
  Inner 1 and Inner 2 appeared with plane roles and inactive autoroute policy.
  Auto-place changed the generated 40 x 30 mm region to exactly 44 x 33 mm;
  one Undo restored 40 x 30 mm. Browser console had no errors.
- TypeScript, touched-file ESLint, and the optimized Next.js production build
  passed. Turbopack retained its existing broad dynamic-process tracing warnings.

## Remaining production-scale work

- Moving large placement jobs to a worker remains desirable; current placement
  is deterministic but synchronous.
- Blind/buried and microvia support needs a padstack/span editor and fab-specific
  validation. Current autoroute uses legal through vias.
- Six-plus-layer stackups require extending the canonical layer table and
  renderer. The required 2-layer and 4-layer paths are implemented and tested.
- The debug bundle is local developer diagnostics; a user-facing Download debug
  bundle control can be added when support workflow requirements are defined.

## References

- FreeRouting routing controls: <https://freerouting.org/freerouting/manual/routing-options>
- FreeRouting manual routing and layer behavior: <https://freerouting.org/freerouting/manual/assist-manual-routing>
- Pinned engine release: <https://github.com/freerouting/freerouting/releases/tag/v2.2.4>
