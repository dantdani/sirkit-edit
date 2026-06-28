# Deterministic netlist validation + placement safety

Date: 2026-06-26 · Status: done (unit-tested — `pnpm test:netlist`)

## What
A deterministic, model-free check that the DRAWN schematic matches the INTENDED
netlist — "trust the netlist, not the picture."

- **`app/lib/validate-netlist.ts`**
  - `validateSchematicNetlist` (build) + `validateTheoryNetlist` (theory):
    compute the actual net partition from geometry (`buildNetUnionFind`, exact
    coordinate coincidence) and compare to the intended netlist's partition.
  - Detects: **self-short**, **unintended-merge** (explicit-nets-only, to avoid
    false positives on shared ground/unaddressed pins), **broken-connection**,
    **floating-pin**, **unanchored-label**, **unresolved-pin**.
  - `rerouteToLabels`: converts broken wire connections to shared-name labels.
- **`autoLayoutBuildValidated`** (`lib/build-auto-layout.ts`) — lay out →
  validate → reroute broken connections → re-validate; surfaces residual issues.
- **Placement collision pass** (`lib/build-auto-layout.ts`) — `footprintBox` +
  `resolveComponentCollisions`: nudges overlapping component bodies apart
  (smaller/passive moves, anchors stay) before routing, so nets are preserved.
- Cross-checking: it's fully deterministic; only the *inputs* (LLM netlist) vary.

## Files
`lib/validate-netlist.ts`, `lib/build-auto-layout.ts`, `scripts/netlist-validation.test.ts`
