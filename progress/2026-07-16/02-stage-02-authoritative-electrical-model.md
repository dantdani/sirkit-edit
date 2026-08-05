# Stage 2 authoritative electrical model

Date: 2026-07-16

## Outcome

Sirkit now computes one revision-bound electrical truth report that keeps intended schematic connectivity, physical pin-to-pad assignment, and realized native copper connectivity separate. Proven, failed, and unknown states are preserved instead of being converted into optimistic completion.

## Main changes

- Added stable physical-pad instances and terminal groups, including repeated-pad and one-pin-to-many-pad handling without inflated connection counts.
- Moved DRC, autoroute verification, AI snapshots/tools, editor airwires, DSN export, and manufacturing snapshots/bundles onto the shared report.
- Kept placement MST ratsnest logic only as an explicitly named placement proxy.
- Added order-independent PCB semantic revision v2 covering routing, electrical, placement, stackup, rule, keepout, zone, footprint, and effective via state.
- Added DSN v2 conservation manifests for source revision, stable nets, endpoints, terminal groups, physical pads, layers, and via padstacks.
- Made SES import strict and all-or-nothing: empty/malformed output, missing or unknown units, stale revisions, unknown nets/layers/padstacks, unsupported arcs, unsafe coordinates, and conflicting duplicates are rejected. Exact and reversed duplicate segments are deduplicated.
- Added deterministic route-attempt IDs and explicit process/file/parse/candidate/acceptance provenance. Best accepted and last attempted artifacts are stored separately.
- Prevented stackup plane intent from fabricating full-board conductive geometry; unresolved native plane intent remains unknown.
- Added electrical truth to native and KiCad-based manufacturing output traceability.

## Verification

- Full repository suite: 597 passed, 9 external/live cases skipped; no Stage 1 or Stage 2 test skipped.
- Netlist validation: all pass.
- TypeScript: pass.
- Changed-file ESLint: pass.
- Optimized Next.js production build: pass (existing broad dynamic-spawn tracing warnings remain).
