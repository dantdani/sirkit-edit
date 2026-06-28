# DB drift fix + generics operational fix

Date: 2026-06-26 · Status: done (DB operations; verified)

Operationalizes `progress/2026-06-25/02-mpn-and-generics-fix.md`, which added the
`is_generic` schema/filter but whose DB migration was never applied.

## Symptom
Build-mode `search_parts` failed on EVERY query (`column parts.is_generic does
not exist`). The model correctly refused to fabricate UUIDs and narrated → the
build loop nudge-looped. Not a model bug.

## Root cause
The live DB was stuck at migration `0000`. `schema.ts` had since added
`parts.is_generic` AND four whole tables (`alternates`, `bom_notifications`,
`bom_snapshots`, `part_offers`) — none of which existed in the DB.

## Fixes applied (DB, additive/non-destructive)
1. Added the missing `is_generic` column + index (matched `schema.ts`).
2. `drizzle-kit push --force` — synced the live DB to the committed schema
   (created the four missing tables + remaining columns). `db:generate` confirmed
   migrations `0001–0004` already captured the schema; the DB was just unsynced.
3. **Generic marking** — marked 197 parts generic, limited to clearly
   NON-component libraries (`power`, `Graphic`, `Mechanical`, `Simulation_SPICE`,
   `Jumper`, `Fiducial`). Deliberately did NOT mark `Device` (it holds the only
   passive symbols — excluding it would leave the AI no resistor/cap to pick).

## Key findings
- **Catalog is symbols-only: only 1/22,756 parts has an MPN** (7 a manufacturer).
  The feature's "buyable parts only" goal is unreachable until the catalog is
  enriched with real orderable parts (Digi-Key path). `is_generic` can currently
  only safely hide non-components.
- **Bulk updates on `parts` are expensive** — the HNSW vector index re-inserts
  all 22k vectors on a full-table UPDATE (timed out twice). Keep mass updates
  targeted by library/id.

## Verified
`search_parts` returns parts again; passives (`R`…) and MCUs (`ESP32-*`) still
surface with `excludeGenerics` on; a full `runBuildToolLoop` produced a valid
ESP32+R+LED netlist end-to-end (~49s).
