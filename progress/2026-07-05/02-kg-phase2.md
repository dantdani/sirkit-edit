# Phase 2 — Datasheet-derived per-IC knowledge graph (PCBSchemaGen port)

Date: 2026-07-05 · Status: done (type-checked, lint-clean, 12 new tests)

## What
Per-IC datasheet constraints (pin roles + required connections), seeded from
PCBSchemaGen_v2's annotated KG (MIT) and wired into BOTH halves of the loop:
- **Generation grounding** ("unified context assembly"): search results whose
  part matches a KG entry carry a compact `designNotes` field (pin roles +
  "VDD1 must be powered with GND1 as its return; INP, INN must be connected").
  The BUILD + subsystem prompts instruct the model to treat it as authoritative.
- **Verification**: a new KG constraint layer in `runErc` checks the datasheet
  predicates — catches faults the pin-TYPE layer can't (e.g. a symbol whose VDD
  pin is typed `passive`).

## Coverage (measured against the live catalog)
108 of 168 KG ICs match Sirkit part names (64%) — TPS54302, INA226, CP2102N,
ESP-12E, W25Q128JVS, STM32F103C8T6, 74-series, etc. After including MOSFETs:
**188 entries, 187 supply_pair + 129 must_be_connected + 15 driving_pair +
1 differential_distinct.**

## Files
- `scripts/build-kg.ts` — generator: merges the repo's three KG JSONs (open-
  schematics 241 ▸ component 48 ▸ curated 22; richer entry wins), normalizes
  the four predicate types, skips generic passives, emits `lib/kg-data.ts`
  (108kb, checked in — runtime has no dependency on the cloned repo).
  Re-run: `npx tsx scripts/build-kg.ts`.
- `lib/kg.ts` — `kgEntryFor(name)` (exact match, else ≥6-char prefix both ways —
  conservative: false negative = no extra checks; false positive would assert
  another chip's constraints), `kgDesignNotes(name)`, `kgSize()`.
- `lib/erc.ts` — Check 6: per-IC KG constraints.
  - supply_pair → both pins connected (supply_missing) + not shorted together
    (supply_short)
  - must_be_connected → unconnected_pin · driving_pair → gate_floating ·
    differential_distinct → differential_short (all critical)
  - Pin resolution via the part's REAL pins; datasheet/symbol name drift ⇒ that
    check is silently skipped (no false positives). Faults already reported by
    the pin-type layer are deduped by refDes:pin.
  - `ErcPart` gains optional `name` (AiPartResult satisfies it structurally).
- `app/lib/build-loop.ts` — search-result decoration with `designNotes`.
- `app/lib/prompts.ts` — one designNotes line in BUILD + BUILD_SUBSYSTEM prompts.

## Effect
The same bounded ERC gate from Phase 1 now enforces datasheet-level correctness:
a submission that leaves AMC1350's VDD2 floating or shorts a supply pair is
bounced with pin-localized feedback even when the symbol's pin types are
unhelpful. And because designNotes ground generation up front, most violations
never happen — the verifier is the backstop, per the paper's design.

## Tests (12 new — `pnpm test:netlist`, all green)
lookup exact/suffix/unknown/no-false-positive · notes render · datasheet-complete
hookup passes · floating supply + floating must-connect caught via KG (with
passive pin types) · supply pair short → supply_short · name-drift ⇒ skipped.

## Next
- Phase 3: reward-guided best-of-N/bandit refinement consuming `erc.reward`.
- PCBBench harness (measure pass-rate deltas from Phases 1–2).
- Long tail: LLM datasheet-extraction pipeline to grow the KG beyond the seeded
  188 (their 3-stage recipe; needs datasheet PDFs, offline).
