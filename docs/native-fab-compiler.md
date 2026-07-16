# Sirkit Native Fab Compiler

The native compiler is an additive, opt-in manufacturing path. The existing KiCad-assisted exporter remains the production fallback and migration oracle until Sirkit passes external CAM-viewer, fabricator-ingestion, and manufactured-board acceptance gates.

## What the native beta guarantees

- An immutable, content-addressed manufacturing snapshot is created before emission.
- Sirkit's integer-nanometre board model is lowered into a format-independent manufacturing IR.
- Gerber X2/X3 uses metric absolute 4.6 coordinates, mandatory file attributes, flashed pads, net/pin attributes, deterministic apertures, a machine-readable profile, and component layers.
- Plated/non-plated drill spans produce Gerber drill layers and explicit-decimal XNC files.
- Placement CSV, BOM CSV, Gerber Job, README, and a SHA-256 manifest are packaged with the image files.
- A separately implemented Gerber/XNC reader parses every generated image back. Syntax or geometry differences block the ZIP.
- ZIP paths, file order, timestamps, serialization, names, and compression are deterministic. Identical snapshots produce byte-identical packages.

Native beta is fail-closed. It does not silently refill zones and it does not accept a generic DRC override. Refill stale zones and resolve errors in the editor before compiling.

## UI workflow

1. Open **Send to fab**.
2. Choose **Sirkit native beta**. The default remains **KiCad-assisted fallback** during the migration period.
3. Select the manufacturer profile. Sirkit runs DRC, snapshot validation, MIR compilation, Gerber/XNC emission, and independent parse-back.
4. Inspect the stage checklist, file tree, package ID, and any diagnostics.
5. Generate the verified package when preflight passes.

## CLI

The input JSON contains `board: PcbBoard` and may contain `netlist`, `boardName`, `fabPresetId`, and `drcPresetId`.

```powershell
npm run fab:compile -- --input .\board.json --output .\out\board-fab.zip --fab jlcpcb-2l --mode strict
```

The compiler writes the final ZIP through a temporary sibling and atomic rename. On success it prints the package ID, final archive SHA-256, file count, and native-beta signoff. On failure it prints typed diagnostics and does not write a usable package.

## Trust boundary and deferred release gates

The internal deterministic and round-trip gates are implemented. These larger gates intentionally remain external:

- validate against Ucamco's full official 2026.05 conformance corpus;
- compare independent renders in at least two external CAM viewers;
- compare native output against the KiCad oracle across the full golden-board corpus;
- complete IPC-D-356A electrical-test export and connectivity equivalence;
- obtain successful ingestion from multiple fabrication partners;
- manufacture and electrically inspect representative 2-layer and 4-layer boards;
- only then consider switching the UI/API default away from KiCad-assisted output.

Those are release-evidence gates, not hidden claims. A package is labeled `native-beta-verified` until they pass.
