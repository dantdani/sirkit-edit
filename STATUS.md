# Sirkit — Project Status Report

## 1. Overview

Sirkit is a web-based circuit design tool. You describe a circuit in plain English, and an AI draws the schematic for you — placing the parts and wiring them up automatically. You can also draw and edit circuits by hand, and run a real electrical simulation to check that they behave correctly. It's aimed at engineers and hobbyists who want to go from an idea to a working circuit quickly.

The longer-term vision is to carry that circuit all the way to a manufacturable circuit board. **Today, the product delivers the front half of that journey — idea → working schematic → simulation — and the back half (real-part sourcing, the physical board, and manufacturing handoff) is not yet built.**

## 2. How it works (in plain English)

- **You type a description** like *"an LED in series with a 470Ω resistor powered by a 9V battery."* There are two ways in: a free-form **AI chat** panel, and a one-shot **"Generate"** bar above the schematic.
- **The AI designs the circuit.** It returns a structured list of components and how they connect (a "netlist"). It's constrained to a small set of idealized building blocks — resistor, capacitor, inductor, diode, voltage/current source, ground.
- **Sirkit lays it out automatically.** A custom layout engine turns that abstract list into a real drawing — positioning each symbol, routing the wires around obstacles, and adding power/ground rails — and draws it on screen.
- **You can edit it by hand.** A full schematic editor lets you place, move, rotate, wire, and delete parts, with grid-snapping and "magnet" wire connections.
- **You can simulate it.** Sirkit converts your drawing into a SPICE netlist (the industry-standard format for circuit simulation), runs it through **NGSpice** (an open-source simulator), and plots the results — voltages, currents, frequency response, etc.

The remaining intended steps — picking *real* purchasable parts, generating a Bill of Materials, previewing the physical board in 2D/3D, and exporting for manufacturing — exist as **tabs and buttons in the UI but have no working code behind them yet.**

## 3. Current status by pipeline stage

| # | Stage | Status | Evidence |
|---|-------|--------|----------|
| 1 | **Input** (plain-English description) | ✅ **Done** | Chat endpoint streams from Claude (`app/api/chat/route.ts`); the "Generate" bar calls the design endpoint (`app/page.tsx:1436–1463` → `lib/apply-netlist.ts`). |
| 2 | **Component selection** (real parts via DigiKey/web) | ❌ **Not started** | No DigiKey, web-search, or parts-API code anywhere in the source. The AI is limited to 7 *idealized* part types (`app/api/schematic/route.ts:9`). The "Build Library" with part counts (4,823 resistors, etc.) is **hardcoded** (`app/page.tsx:139–149`), and the "Search real parts" box has no logic attached (`:1367`). |
| 3 | **Circuit generation** (build the schematic) | ✅ **Done — works end-to-end** | AI design via Claude tool-use (`app/api/schematic/route.ts`) → automatic layout (`lib/auto-layout.ts`, 535 lines) → on-screen SVG editor (`app/page.tsx`). Full manual editing also works. **Bonus:** real SPICE simulation via NGSpice is built and functional (`app/api/simulate/route.ts`, `app/lib/netlist.ts`) — this is beyond the 6-step plan. |
| 4 | **BOM** (Bill of Materials) | ❌ **Not started** | The BOM tab renders only the placeholder text *"Bill of materials"* (`app/page.tsx:1540`). A design check permanently reads *"BOM not finalized"* (`:1403`). No generation code. |
| 5 | **3D / PCB preview** | ❌ **Not started** | The PCB and 3D tabs render only placeholder text — *"PCB layout canvas"* and *"3D view"* (`app/page.tsx:1538–1539`). Note: `auto-layout.ts` lays out the *schematic diagram*, **not** a physical board. |
| 6 | **Output / handoff** (KiCad autoroute or export to Altium/Cadence) | ❌ **Not started** | No KiCad, Gerber, Altium, or Cadence code exists. The "Export" button has **no action wired to it** (`app/page.tsx:1309–1311`). |

**What genuinely works end-to-end today:** plain-English description → AI-generated schematic → automatic layout on a canvas → manual editing → SPICE simulation with plotted results. That's a real, functioning loop.

**Two notable "built but not connected" pieces:** there's a complete project save/load + JSON import/export module (`lib/persistence.ts`) and a library of example circuits (`lib/example-circuits.ts`), but **neither is imported or used anywhere in the UI** — the Projects panel currently shows hardcoded sample names ("USB-C charger," "Audio preamp," "Solar charger"). These are quick wins waiting to be wired up.

## 4. Tech stack & architecture

- **Framework:** Next.js 16 (App Router) with React 19 and TypeScript. Styling via Tailwind CSS v4; UI components from Radix / Base UI; icons from Lucide.
- **AI:** Anthropic's Claude, via the official `@anthropic-ai/sdk`. The chat uses streaming text; the schematic generator uses "tool calling" to force Claude to return a strictly-structured netlist (`app/api/schematic/route.ts`).
- **Schematic rendering & editing:** hand-built with SVG inside `app/page.tsx` (a large single file, ~2,970 lines). *Note: `@xyflow/react`, a graph-canvas library, is listed as a dependency but doesn't appear to be used — the editor is custom.*
- **Simulation:** the server writes a SPICE netlist to a temp file and runs the **NGSpice** command-line tool, then parses its raw output. This means **NGSpice must be installed on whatever server runs Sirkit** — it's an external system dependency, not a bundled library.
- **Persistence:** browser `localStorage` only (no database, no backend storage). Settings like the last simulation config are saved client-side.
- **External APIs in use today:** only the Anthropic (Claude) API. **DigiKey, KiCad, and any PCB/manufacturing tools are referenced in the product vision but absent from the code.**

## 5. Risks, open questions, and next steps

**Risks / things to watch**

- **The hard half is unbuilt.** Stages 2, 4, 5, and 6 — real-part sourcing, BOM, board layout/3D, and manufacturing export — are the parts that make output *manufacturable*, and they're greenfield. The schematic→PCB layout problem in particular (auto-placement and auto-routing of a physical board) is a genuinely hard engineering effort, not a quick integration.
- **NGSpice as a server dependency.** Simulation depends on an external binary being installed and on `PATH`. This complicates deployment (it won't "just work" on a standard serverless host) and is a scaling consideration.
- **Idealized vs. real parts.** The current AI only knows abstract components (a "10k resistor"), not orderable parts with part numbers, footprints, and prices. Bridging to real parts (Stage 2) is also the prerequisite for a meaningful BOM (Stage 4) and an accurate PCB footprint (Stage 5) — so these stages are dependent, not independent.
- **No real persistence or accounts.** Everything lives in the browser; there's no database, user accounts, or server-side project storage yet.

**Open questions for us**

- For Stage 6, is the priority the **KiCad auto-route path**, the **export-to-other-tools path**, or both? They're quite different efforts.
- Is the AI's idealized-component model a stepping stone, or do we need to jump straight to real, sourceable parts?

**Suggested next steps (roughly in dependency order)**

1. **Wire up what already exists** — the project save/load and example-circuit modules are written but disconnected. Low-effort, immediate polish.
2. **Stage 2 (real parts):** integrate the DigiKey API so the AI selects orderable components. This unlocks Stages 4 and 5.
3. **Stage 4 (BOM):** straightforward once parts carry real metadata.
4. **Stage 5 / 6 (board layout, routing, export):** the largest body of work — likely best approached by leaning on KiCad's existing engine rather than rebuilding it.

## 6. The goal

The destination for Sirkit is to **collapse the entire distance from idea to fabricated circuit board** — so that anyone can go from a plain-English description to either a fully routed board or an export-ready design file. The aim is to make designing real hardware as fast and effortless as simply describing what you want. Today Sirkit convincingly proves the front of that path (idea → schematic → simulation); the work ahead is building the bridge from a working schematic to a manufacturable board.
