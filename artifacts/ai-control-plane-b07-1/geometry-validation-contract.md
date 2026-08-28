# B07.1 — Schematic Geometry Validation Contract

## One source of truth

`app/lib/engineering/schematic-geometry.ts` defines the contract; the grid
constant is `GRID` from `app/lib/geometry.ts` (10 px) — the editor's REAL
snap grid, imported, not duplicated. `lib/auto-layout.ts` used to declare
its own `GRID = 10`; it now re-exports the geometry authority. No module
carries an unexplained copy of the number.

A canonical schematic coordinate is valid iff it is:

1. a finite number;
2. a safe integer;
3. within ±1,000,000 px of the origin (±100,000 grid cells);
4. exactly aligned to the 10 px grid (`value % GRID === 0`).

Rotations/orientations must be exactly 0|90|180|270. Wire vertex arrays
must be real arrays with ≥2 vertices, no adjacent duplicate vertices, and
not all-identical (zero-length). Points must be objects with numeric x/y.

## Bounds derivation

The sheet/page model (`PAGE_SIZES_MM`) defines the PRINT/EXPORT area only.
The editor deliberately allows placing geometry outside the sheet (pan is
unbounded; nothing clamps placement), so the sheet is NOT the canonical
bound. The contract bound of ±1,000,000 px is orders of magnitude beyond
any supported sheet (A1 landscape ≈ 6,600 px wide at the KiCad scale) while
staying far inside the safe-integer range — every legitimately placeable
coordinate is preserved; runaway or forged coordinates reject.

## Enforcement points

- **Canonical executor, per operation** (`operations.ts`,
  `validateSchematicOperationGeometry`): add/update/transform/label ops,
  `schematic_replace_component` wire/label moves, and
  `schematic_restore_entities` payloads. Failures throw truthful
  `INVALID_PX:` codes — schematic pixels are never reported as `INVALID_NM`
  (board nanometre) failures.
- **Whole-schematic validation**: the same rules run inside
  `validateCanonicalSchematic`, i.e. at hydration, at every operation's
  model read, and in the post-transaction integrity check.
- **Trusted UI paths snap BEFORE constructing commands** (verified):
  `screenToWorld` snaps; junction points derive from aligned-segment
  crossings; the SPICE-view drag rounds deltas to the grid; auto-layout
  emits `snap()`ed coordinates throughout. The executor still validates
  independently and NEVER silently snaps a provider, replay, forged, or
  stale operation.

## Legacy off-grid data

There is no silent migration and no history rewrite. A stored projection or
envelope containing off-grid geometry fails closed into the explicit
recovery lifecycle (`invalid-projection` / `corrupt-history` — see
`identity-integrity-contract.md`); the data is preserved unchanged. In
practice every write path has snapped to this grid since the editor's
inception, so field exposure is expected to be nil; if off-grid records
surface, the deterministic repair flow (an explicit, quarantine-first
snap-migration the user confirms) is an owner decision.

## Pinned reproduction

`schematic_add_wire` with `vertices: [{x:1,y:1},{x:21,y:1}]` — the exact
independent reproduction — rejects atomically with
`INVALID_PX:…off the 10px schematic grid` and leaves the head digest
unchanged (test C1). The full battery (NaN, ±Infinity, fractional,
safe-integer overflow, 1-px off-grid, ±out-of-bound, adjacent duplicates,
zero-length, malformed arrays, invalid add/transform/label/restore, valid
round-trip) is §C of `b07-1-identity-geometry-gestures.test.ts`.
