# Phase 1 — Deterministic ERC gate (PCBSchemaGen port)

Date: 2026-07-05 · Status: done (type-checked, lint-clean, 12 new tests)

## Why
Sirkit's validator proved the DRAWING implements the intended netlist — nothing
deterministic checked the intended netlist was electrically sane (that lived in
the advisory LLM Review). Phase 1 of the PCBSchemaGen methodology
(arXiv:2602.00510, repo cloned at ./PCBSchemaGen_v2) closes that gap: a
deterministic, design-level electrical oracle with continuous reward +
pin-localized feedback, wired into the build loop's self-correction.

## What was ported vs built
- PORTED (from framework/topo/error_types.py, MIT): the error taxonomy
  (phase/severity/category + refDes/pin/net/suggestion), fingerprinting, the
  reward-shaping scheme (layered base rewards + error-count interpolation), and
  the to_feedback format.
- NOT ported: their benchmark-specific rule hacks (task15, buck_en skips,
  UCC-part special cases), the SKiDL extraction layer (we verify
  BuildLogicalNetlist directly), and the per-IC KG (that's Phase 2).
- BUILT: the checks re-based on KiCad pin electrical types Sirkit's catalog
  already carries (power_in/power_out/output/input/no_connect/…) — no new data
  needed.

## `lib/erc.ts` (pure, deterministic)
`runErc(netlist, partsById)` → `{errors, criticalCount, warningCount, reward, ok}`
- supply_missing (critical): power_in pin unconnected, or on a net with no power
  source. "Driven" = power/ground label, GND, a power_out pin, or a pin of a
  source/connector/regulator-role component (avoids false positives when power
  enters via a USB connector's passive pins).
- erc_conflict (critical): ≥2 push-pull drivers (output/power_out) on one net.
- supply_short (critical): two different power rails joined, or rail↔ground.
- nc_connected / input_floating / no_ground (warnings, never block).
- Nets built by union-find: wires join endpoints; same-name labels are one net;
  GND is a shared sentinel. labelKind falls back to inferNetLabelKind.
- `computeErcReward`: criticals → [0.5,0.7), warnings-only → [0.7,1.0), clean 1.0
  (sub-0.5 layers = structural validation, guaranteed upstream).
- `formatErcFeedback`: pin-localized [CRITICAL] lines + suggestions for the LLM.

## Wiring
- `app/lib/build-loop.ts`: after `finalizeSubmission` succeeds, run ERC. Critical
  errors bounce back as a tool_result error (self-correction) at most
  MAX_ERC_REJECTIONS=2 times (mirrors their retry cap); then accept WITH the
  report. `BuildLoopResult` gains optional `erc` — all loop users (build,
  edit-build, build-multi blocks) get the gate for free.
- `app/api/schematic/build-multi/route.ts`: post-merge advisory ERC (cross-block
  faults — e.g. two blocks driving one shared net — only exist after the merge).
  Criticals are console.warned + appended to the explanation, never bounced.

## Tests (12, in scripts/netlist-validation.test.ts)
healthy passes at reward 1.0 · unconnected power_in localized to U1.VDD ·
undriven power net flagged · connector-role driver accepted (no false positive) ·
output-output conflict · rail-rail and rail-ground shorts · NC-wired, floating
input, no-ground warnings · warnings don't fail the gate · reward monotonicity.

## Next (from the roadmap)
- Phase 2: datasheet-induced KG (adopt kg.json schema; seed with their 480 ICs
  where names match the catalog) → richer roles (buck_fb, sense_plus) + per-IC
  constraint predicates (supply_pair, must_be_connected, C_DIRECT/R_PATH).
- Phase 3: reward-guided best-of-N/bandit refinement using `erc.reward`.
- Benchmark harness: run Sirkit against PCBBench, score with their verifier.
