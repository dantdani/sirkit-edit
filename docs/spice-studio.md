# SPICE Studio quickstart

SPICE Studio turns the current Sirkit schematic into reproducible simulation
projects without modifying the design. A simulation project points at an
immutable design revision; test benches add sources, loads, probes, models,
variables, and analyses as reversible overlays.

## Prerequisite

Install ngspice. On Windows the server uses `ngspice_con.exe` by default so it
does not open the graphical shell. Set `NGSPICE_BIN` in `.env.local` when the
binary is not on `PATH` or lives in a custom location.

```text
NGSPICE_BIN=C:\Program Files\ngspice\bin\ngspice_con.exe
```

The editor and compiler remain usable without ngspice; an execution request
then fails with a structured `engine_missing` diagnostic.

## Normal workflow

1. Open **SPICE Studio** and create or duplicate a test in Simulation Setup.
2. Add sources, loads, model bindings, analyses, variables, sweeps, corners,
   Monte Carlo distributions, measurements, and pass/fail specs.
3. Clear the Readiness cockpit. Each blocker links to the responsible design,
   overlay, model, or analysis item and includes a suggested fix.
4. Review the exact run count and cost estimate, then start the plan.
5. Follow progress in Runs. Jobs may be cancelled independently and never
   reuse a mutable output directory.
6. Inspect waveforms, cursors, measurements, diagnostics, and comparisons in
   Results. Download CSV/JSON, an evidence report, or the complete run bundle.

The three netlist views are intentional: **Generated** is source-mapped Sirkit
output, **Normalized** reflects safe model transforms and unit normalization,
and **Executed** is the byte-for-byte input recorded in the run manifest.

## Reproducibility and safety

Every run records project/test/revision IDs, expanded point variables, model
content hashes, compiler and engine versions, options, random seed, generated
files, timestamps, status, and artifact hashes. Job workspaces are unique,
environment variables are restricted, execution and output are bounded, and
the worker never evaluates arbitrary shell commands.

Imported model text is inspected before it can be assigned. Unsupported or
unsafe directives are blocked; inferred pins and dialect transforms require
review. The smoke-test endpoint compiles a tiny deterministic fixture and runs
the selected model through the same worker used for normal jobs.

## Headless CI

Export a project JSON from the studio and run:

```bash
pnpm spice:ci path/to/project.json --out spice-results.json
```

The command exits non-zero when a run fails or a spec fails. The JSON output
includes run IDs, manifests, scalars, evaluated specs, and diagnostics.

## HTTP surface

- `POST /api/spice/compile` — readiness, IR, source maps, and netlist views.
- `POST /api/spice/run-plans/estimate` — deterministic point expansion/cost.
- `POST /api/spice/runs` — enqueue a run plan; `GET` lists batches and jobs.
- `GET/DELETE /api/spice/runs/:id` — inspect or cancel a batch/job.
- `GET /api/spice/runs/:id/events` — server-sent lifecycle/progress events.
- `GET /api/spice/runs/:id/waveforms` — range/downsample signal queries.
- `GET /api/spice/runs/:id/bundle` — reproducible ZIP evidence bundle.
- `POST /api/spice/models/import` and `/smoke-test` — governed models.
- `POST /api/spice/reports` — JSON or self-contained HTML evidence report.
- `POST /api/spice/ai` — typed inspection/proposal tools with evidence refs.

The server stores active job state in-process. A multi-process production
deployment should replace the job-store adapter with a durable queue/object
store while retaining the manifest and API contracts.
