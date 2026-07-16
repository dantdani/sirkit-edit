# SPICE Studio — project simulation environment

## Delivered

- Added a typed, versioned simulation-project domain: immutable design
  revisions, test benches, overlays, variables, analyses, sweeps, corners,
  seeded Monte Carlo, measurements/specs, models, jobs, and evidence reports.
- Added deterministic schematic/overlay-to-IR and IR-to-ngspice compilers with
  stable identities, unit normalization, source maps, three netlist views, and
  structured readiness findings.
- Added a governed model importer with dialect/safety inspection, inferred pin
  maps, reversible transforms, assignment ranking, and live smoke tests.
- Added exact run-plan expansion, isolated ngspice workers, bounded resources,
  cancellation, SSE progress, SHA-256 manifests, waveform/scalar persistence,
  ZIP bundles, range/downsample APIs, report generation, and a CI runner.
- Added waveform parsing and analysis for transient and complex AC data,
  spike-preserving downsampling, cursors, run differences, engineering
  measurements, spec evaluation, Monte Carlo statistics, and source-mapped
  diagnostics with a convergence ladder.
- Replaced the SPICE tab with the full studio: setup/readiness, schematic plus
  overlays, models, run monitor, results, exports/reports, command palette,
  undo/redo/autosave, and an AI proposal-review drawer. The old quick scope is
  retained as a compact legacy pane.
- Added typed AI operations for inspection, readiness, model assignment, test
  construction, plan estimation, evidence reading, diagnostics, comparison,
  and explicit design-patch proposals. Approval gates prevent silent changes.

## Verification

- TypeScript: clean.
- Targeted ESLint: clean with zero warnings.
- Deterministic SPICE tests: compiler/IR, model import, run planning,
  waveforms, measurements, specs, and diagnostics pass.
- Live Windows ngspice integration: direct worker, queued lifecycle, waveform
  query, reproducible ZIP bundle, and model smoke test pass.
- Production Next.js build succeeds.
- Browser pass covered readiness blocking, analysis add/undo, models, and the
  AI review surface at the actual development URL.

## Operational notes

- Windows uses the console ngspice executable and a sandbox-relative raw path;
  both avoid GUI invocation and path-quoting failures in common distributions.
- Current jobs are held in a process-global in-memory adapter. The interfaces
  intentionally isolate this seam for a later durable/distributed queue.
- Live AI execution still requires funded provider credentials; deterministic
  tool schemas, validation, evidence binding, and approval paths are present.
