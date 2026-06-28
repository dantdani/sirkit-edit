# Diagram-style schematic rendering

Date: 2026-06-26 · Status: done (type-checked, lint-clean; not visually verified)

## What
Made the editor render more like a real EE schematic, driven by the data model
(stays fully editable — no static image).

- **`app/lib/nets.ts`** — `classifyNets`: derives each net's role
  (power/ground/signal/unknown) from the connectivity union-find + pin-name
  heuristics + net-label votes. Recomputed from geometry, so it stays in sync
  with manual edits.
- **Reference designators** on theory parts (R1/C2/V1…) — previously only the
  value was shown.
- **Role-colored wires + net labels** — power rails colored, ground neutral,
  with derived rail-name labels for nets without an explicit label; miter
  (crisp) wire corners.
- **Block-style ICs** — multi-pin KiCad parts get a subtle category-tinted panel
  behind the real symbol art, keeping exact pin geometry so wiring is unchanged.

> Note: this composed with a pulled merge that added a first-class net-label
> system (`SchematicState.netLabels`, label-based nets); `nets.ts` was extended
> to vote from those labels rather than replaced.

## Files
`app/lib/nets.ts`, `app/page.tsx`
