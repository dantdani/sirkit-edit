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
pick-and-place bundle that JLCPCB's quote tool accepts.

- **Demo**: open the PCB tab with `?pcbdemo=story` and follow the five-click
  flow (`Ctrl+P` place → `Ctrl+E` route → `Ctrl+D` DRC → `Ctrl+3` 3D →
  `Ctrl+B` fab bundle). Press `?` for all shortcuts.
- **Docs**: [`docs/pcb-quickstart.md`](docs/pcb-quickstart.md) — setup
  (`FREEROUTING_JAR`, `KICAD_CLI`), the workflow, and where to go next.

---

## Getting started

### 1. Prerequisites
- Node + [pnpm](https://pnpm.io/)
- A Postgres database with the `pgvector` extension (e.g. Supabase)

### 2. Environment
Create `.env.local`:

```bash
# Required
DATABASE_URL=postgres://...            # Postgres + pgvector
ANTHROPIC_API_KEY=sk-ant-...           # generation / edit / review
OPENAI_API_KEY=sk-...                  # retrieval embeddings

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
