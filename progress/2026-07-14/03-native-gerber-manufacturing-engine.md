# Native Gerber Manufacturing Engine

Date: 2026-07-14
Specification: `Sirkit_Native_Gerber_Manufacturing_Engine_Specification.md`
Posture: additive native beta; KiCad-assisted production path preserved

## Why this change

The previous fab exporter was a useful packaging layer around `kicad-cli`, but it was not a native manufacturing compiler. It also inserted current timestamps, allowed a broad DRC override, and silently recomputed stale zone fills during export. Those behaviours prevent byte-for-byte reproducibility and weaken the audit boundary between the reviewed design and the package sent to a fabricator.

The native path therefore starts from a content-addressed snapshot, never mutates the board, and treats validation and independent read-back as package gates.

## Implemented

### Immutable snapshot and manufacturing IR

- Added a canonical, deeply frozen manufacturing snapshot containing board, netlist, selected manufacturer/DRC profiles, recipe, content hash, revision ID, coordinate-system ID, and board-lower-left transform.
- Array ordering is canonicalized so irrelevant source ordering does not alter output bytes.
- Non-finite values, invalid outlines, stale/absent zone fills, and DRC errors emit typed diagnostics.
- Stale pours are not recomputed inside export. The user must refill and review them in the editor.
- Added a format-independent MIR for flashes, strokes, regions with holes, drill hits/slots, layer functions, attributes, and source provenance.

### Native Gerber X2/X3

- Metric, absolute `%FSLAX46Y46*%` output gives 1 nm coordinate resolution without floating-point coordinate drift.
- Emits mandatory `.FileFunction`, `.FilePolarity`, and `.SameCoordinates` plus deterministic `.ProjectId`/generator provenance.
- Pads remain flashes, including rotated rectangular/oval/round-rect/polygon pads through deterministic aperture macros.
- Tracks, vias, filled zones, solder-mask openings, paste, vectorized silkscreen, and a closed machine-readable profile are emitted from MIR.
- Copper objects carry `.N` and component pads carry `.P` attributes.
- X3 top/bottom component layers carry `ComponentMain`/`ComponentPin`, reference, footprint, rotation, pin, and net information known by Sirkit.
- Apertures and D-codes are assigned from stable semantic keys.

### Drill and assembly deliverables

- Partitions plated/non-plated data by layer span.
- Produces both Gerber drill images and Ucamco XNC 2021.11 files with metric explicit-decimal coordinates, file/tool attributes, finished diameters, drill hits, and routed slots.
- Produces placement CSV in the exact same lower-left/+Y-up coordinate system as the images.
- Reuses the governed BOM grouping logic.
- Produces a partial Gerber Job 2020.08 file containing only known values: project identity, board size, layer count, and file attributes. Material, thickness, finish, and commercial data are deliberately not invented.

### Independent verification and deterministic packaging

- Added separate Gerber and XNC parsers that do not call the writers.
- Every generated image is parsed back and compared with MIR object geometry, polarity, aperture semantics, file functions, and object attributes.
- A syntax error, undefined tool/aperture, missing mandatory attribute, or geometry mismatch blocks packaging.
- ZIP ordering, timestamps, permissions, serialization, naming, and compression are fixed. Identical snapshots generate byte-identical ZIP bytes and hashes.
- `manifest.json` records the snapshot, recipe, standards revisions, package ID, per-file sizes/SHA-256 values, diagnostics counts, and the explicit `native-beta-verified` signoff.
- Filenames are content-derived instead of date-derived.

### API, UI, and CLI

- Extended the existing export endpoint with explicit `engine: "native-beta" | "kicad"` and native `preflight`/`package` actions; omitted engine still selects the existing KiCad path.
- Native requests reject the generic DRC override.
- Expanded **Send to fab** into an engine-aware workspace with a migration/fallback explanation, automatic native preflight, stage checklist, file tree, package ID, and hard gate.
- Kept **KiCad-assisted fallback** selected by default until external evidence gates pass.
- Added `npm run fab:compile -- --input ...` with typed diagnostics and atomic final-file replacement.
- Added `docs/native-fab-compiler.md` and updated the PCB quickstart.

## Verification added

- deterministic repeated compilation and fixed ZIP timestamps;
- source-array-order invariance;
- rotated flashed-pad aperture macro and X3 component-data checks;
- stale-pour and DRC fail-closed tests;
- deliberate post-write Gerber coordinate corruption caught by independent parse-back;
- API native preflight, override rejection, and typed blocked-response tests.

Final verification result: **474 tests passed, 9 intentionally skipped** across
the full repository. `npx tsc --noEmit`, the scoped ESLint run, and the Next.js
production build all passed. The production build retained five pre-existing
Turbopack warnings about dynamic executable paths. Live browser verification
confirmed a successful native preflight, complete stage/file display, and no
browser console warnings or errors.

## Intentionally deferred release gates

The specification correctly separates an implemented native engine from a proven production default. These gates require external data, tools, partners, or physical boards and are not marked complete:

1. Full Ucamco 2026.05 official conformance/test corpus.
2. Pixel/geometry comparison in at least two independent external CAM viewers.
3. A broad golden-board differential suite against the KiCad oracle, including dense 4-layer, polygon-pad, zone-hole, slot, and bottom-assembly cases.
4. IPC-D-356A electrical-test export and connectivity equivalence.
5. Multiple fabricator ingestion reports and DFM feedback loops.
6. Manufactured 2-layer and 4-layer boards with dimensional and electrical inspection.
7. Default-engine promotion only after those results are recorded.

This is why the new output is labeled **native beta**, not “fabrication certified” or “better than Cadence” yet. The implemented evidence is strong internal determinism and self-verification; the remaining claims need independent acceptance evidence.
