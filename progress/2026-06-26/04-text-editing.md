# Text-based editing (Tier 1 + Tier 2)

Date: 2026-06-26 · Status: done (type-checked, lint-clean)

## What
Edit an existing schematic from a chat instruction, via an **Edit** button.

- **Tier 1 — attribute edits** (`/api/schematic/edit`): set-value / rename /
  delete applied DIRECTLY to state — no re-layout, preserves manual placement,
  no validator needed (delete cleans up its dangling wires/labels). Returns a
  `needsTopology` flag.
- **Tier 2 — topology edits** (`/api/schematic/edit-build`): for
  add / rewire / swap. Round-trips the current schematic →
  `schematicToBuildNetlist` (inverse of auto-layout; connections derived from
  the real net partition) → model returns the full modified netlist (existing
  parts seeded valid via `getPartsByIds`) → `autoLayoutBuildValidated`.
- **`app/lib/build-loop.ts`** — extracted the shared `runBuildToolLoop`
  (search → submit → finalize) so build + edit-build don't duplicate ~250 lines.

Rotate is deferred (moves pins → needs re-routing). Theory topology edits not
yet supported (surfaced as a message).

## Files
`app/api/schematic/edit/route.ts`, `app/api/schematic/edit-build/route.ts`,
`app/lib/build-loop.ts`, `lib/schematic-to-netlist.ts`,
`lib/schematic-types.ts` (`SchematicEditOp`), `app/page.tsx`
