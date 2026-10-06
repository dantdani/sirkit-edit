# Sirkit

AI-assisted circuit design. Describe a circuit in natural language and Sirkit generates an editable schematic from **real KiCad catalog parts** — then validates, reviews, and lets you refine it, all the way to a KiCad export.

Built with Next.js 16 / React 19 / TypeScript, Postgres + pgvector (Supabase/Drizzle), and the Anthropic + OpenAI APIs.

---

## Design philosophy: agents propose, deterministic code disposes

LLMs are used where judgment helps (choosing parts, proposing topology, spotting design smells) and **never** for load-bearing geometry or equivalence checks. Every generated design passes through a deterministic spine:

- **Netlist validation** — the actual electrical net partition is computed from geometry (coordinate-coincidence union-find) and compared against the intended netlist. Shorts, floating pins, and unintended merges are hard errors.
- **Deterministic auto-layout** — role-based placement, collision resolution, and a **pin-coincidence guard** that prevents residual layout shorts.
- **LLM passes are advisory + verified** — design review and second-opinion findings are cross-checked against ground truth and never block or silently mutate the design.

The result: LLM flexibility with deterministic correctness guarantees.

---

## Features

- **Generate** — natural language → schematic. A multi-agent flow (planner → parallel subsystem designers → deterministic merge) builds the netlist, then a validated auto-layout draws it.
- **Two modes** — *Theory* (ideal components for analysis) and *Build* (real KiCad catalog parts, ~22k symbols).
- **Edit** — text-based edits: Tier 1 (attributes: values, rename, delete) and Tier 2 (topology: add / rewire / swap parts, re-validated).
- **Review** — a grounded, verified Layer-2 design review (missing decoupling caps, pull-ups, floating power pins, polarity hazards).
- **Tidy** — screenshots the schematic, an AI critic flags crowded regions, and a deterministic pass re-spaces them (with a regression guard so it never crowds elsewhere).
- **Apply suggestions** — integrate Review / second-opinion findings through the *validated edit pipeline* (never a blind merge).
- **Check with SchGen** — an optional independent domain model ([microsoft/SchGen](https://huggingface.co/microsoft/SchGen)) designs the same request; its netlist is diffed against yours to surface likely-missing parts. See [`schgen-endpoint/`](schgen-endpoint/).
- **BOM** — grouped bill of materials with distributor sourcing (Digi-Key, Mouser).
- **KiCad export** — download a KiCad 8 `.kicad_sch`, with deterministic footprint assignment.
- **Retrieval** — hybrid vector (HNSW) + lexical search fused via reciprocal-rank fusion, then reranked with Haiku.

---

## PCB module

The PCB module ships schematic-to-fab: sync footprints from the schematic,
auto-place, autoroute (Freerouting), zones, DRC against real fab presets,
silkscreen, 3D preview, KiCad export, and a one-click Gerber/drill/BOM/
pick-and-place bundle that JLCPCB's quote tool accepts. [superseded 2026-10-05 by the B23 closeout (D23-16, OD-178): a bundle prepared for a provider's quote upload; no upload has been recorded, and no provider has accepted, quoted, DFM-checked or ordered a Sirkit bundle (no stored acknowledged receipt; LB-11)]

- **Demo**: open the PCB tab with `?pcbdemo=story` and follow the five-click
  flow (`Ctrl+P` place → `Ctrl+E` route → `Ctrl+D` DRC → `Ctrl+3` 3D →
  `Ctrl+B` fab bundle). Press `?` for all shortcuts.
- **Docs**: [`docs/pcb-quickstart.md`](docs/pcb-quickstart.md) — local Freerouting
  setup (no hosted API key), `KICAD_CLI`, the workflow, and where to go next.

---

## SPICE Studio

The SPICE tab is a project-based simulation environment rather than a single
"run" button. It compiles the immutable schematic revision plus reversible
simulation overlays into a canonical circuit IR, audits readiness, and only
then emits source-mapped ngspice input.

- Versioned tests with variables, operating point/DC/AC/transient and advanced
  directives, sweeps, corners, seeded Monte Carlo, measurements, and specs.
- Governed model registry with dialect inspection, pin-map review, reversible
  transforms, assignment, and a real ngspice smoke test.
- Isolated queued jobs with manifests, hashes, progress events, cancellation,
  bounded logs/artifacts, waveform range queries, and reproducible ZIP bundles. [superseded 2026-10-02 by the B22 closeout (D22-14, OD-144): runs are diagnostic local processes with no isolation boundary; a bundle carries the raw file's digest only, and results are environment_dependent]
- Interactive signal browser with zoom/pan, A/B cursors, scalar measurements,
  diagnostics, run comparison, CSV/JSON export, and report generation.
- Typed AI tools inspect evidence and propose reviewable project changes; they
  do not silently rewrite the schematic or generated netlist.

See [`docs/spice-studio.md`](docs/spice-studio.md) for setup, workflow, API, and
headless CI usage.

---

## Getting started

### 1. Prerequisites
- Node + [pnpm](https://pnpm.io/)
- A Postgres database with the `pgvector` extension (e.g. Supabase)
- For one-click PCB autorouting, run `npm run setup:freerouting` once. This
  installs Sirkit's pinned local engine and private Java runtime; no Freerouting
  API key is required.

### 2. Environment
Create `.env.local`:

```bash
# Required
DATABASE_URL=postgres://...            # Postgres + pgvector
ANTHROPIC_API_KEY=sk-ant-...           # optional Anthropic reasoning brain
OPENAI_API_KEY=sk-...                  # OpenAI brain + fixed retrieval embeddings
# Optional brain model overrides:
# SIRKIT_ANTHROPIC_MODEL=claude-opus-4-7
# SIRKIT_OPENAI_MODEL=gpt-5.4

# Optional — distributor sourcing (BOM)
DIGIKEY_CLIENT_ID=...
DIGIKEY_CLIENT_SECRET=...
MOUSER_API_KEY=...

# Optional — SchGen second opinion (see schgen-endpoint/)
SCHGEN_ENDPOINT_URL=https://<your-endpoint>.endpoints.huggingface.cloud
SCHGEN_ENDPOINT_TOKEN=hf_...
```

### 3. Database
```bash
pnpm drizzle-kit push       # sync schema
# then ingest the KiCad symbol catalog (see scripts/)
```

### 4. Run
```bash
pnpm dev
```
Open [http://localhost:3000](http://localhost:3000).

### AI Brain selection

Open **AI Chat** and choose **OpenAI** or **Anthropic** under **AI Brain**. The
choice takes effect immediately for chat, schematic generation/edit/review, PCB
assistance, and SPICE proposals. It is saved globally and in the active project;
provider switches are metadata-only history events. OpenAI remains the fixed
embeddings provider for catalog retrieval regardless of this selection. API keys
stay in `.env.local` and are used only by server routes.

---

## Testing

Deterministic core (netlist validation, extractor, merge, layout guards, footprint assignment, cross-check):

```bash
pnpm test:netlist
```

---

## Project structure

| Path | What |
|------|------|
| `app/page.tsx` | Editor UI + chat (Ask / Edit / Generate / Review / Tidy / Check with SchGen) |
| `app/api/schematic/` | Generation, edit, review, layout-critic, cross-verify routes |
| `app/lib/prompts.ts` | Central registry of all system prompts + tool schemas |
| `app/lib/build-loop.ts` | Shared agentic build tool-loop (search_parts → submit_schematic) |
| `lib/build-auto-layout.ts` | Deterministic auto-layout, collision + pin-coincidence guards |
| `lib/validate-netlist.ts` | Deterministic netlist validation + reroute |
| `lib/schematic-to-netlist.ts` | Inverse: geometry → netlist |
| `lib/footprint-assign.ts` | Symbol → KiCad footprint mapping (PCB seam) |
| `lib/netlist-crosscheck.ts` · `lib/schgen-netlist.ts` | SchGen second-opinion diff |
| `app/lib/kicad-export.ts` | `SchematicState` → `.kicad_sch` |
| `schgen-endpoint/` | HF Inference Endpoint handler for the SchGen model |
| `progress/` | Dated development notes |

---

## Licensing note

Sirkit uses KiCad symbol/footprint libraries (CC-BY-SA 4.0 **with the library exception**), which exempts generated designs from share-alike — so the schematics you create are yours. Attribution for the bundled library data is the only obligation.
