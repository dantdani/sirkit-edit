# B07 — Stable Theory Identity and Migration

> **CORRECTION (B07.1, 2026-08-06).** Two claims below were false or
> incomplete as shipped: (1) "Malformed legacy identity … fails closed at
> the operation layer" understated the gap — a projection with duplicate
> stable ids HYDRATED as `fresh`, and a duplicate-id operation target
> mutated the first array match; B07.1 added the shared validating reader
> (`validateCanonicalSchematic`), hydration now enters an explicit
> conflict/invalid-projection state, and every transaction validates the
> COMPLETE resulting schematic. (2) The "Consumers" section documented the
> positional theory netlist reference as an accepted limitation; B07.1
> made `buildNetlist`, pcb-sync, SPICE presentation, KiCad export, and BOM
> refs follow the displayed reference (`refDes ?? id`) while identity stays
> on the stable id, and display uniqueness is now case-normalized across
> BOTH component families (`R1`/`r1` collide). See
> `artifacts/ai-control-plane-b07-1/identity-integrity-contract.md` and
> `display-reference-consumer-matrix.csv`.

## Schema

`SchComponent` separates two identities:

- **`id` — immutable stable instance identity.** Collection key, canonical
  operation target, netlist component id, pcb-sync `componentInstanceId`,
  physical-binding scope. NEVER rewritten; no operation exists that can
  change it.
- **`refDes?` — editable display reference.** The user-visible designator.
  Display everywhere is `schDisplayRef(c) = c.refDes ?? c.id`.

KiCad components already separated `id`/`refDes`; their model is unchanged.

## Normalization policy (one rule, enforced canonically)

Display references are trimmed, non-empty, and unique among theory display
values (`refDes ?? id`) — including cross-collisions between one component's
`refDes` and another's id-fallback display. Violations reject the whole
transaction atomically. Authority is never inferred from a display reference
(it is presentation only; every canonical consumer keys on the stable id).

## Stable-id generation

- **New components** (canvas placement): `crypto.randomUUID()` stable id +
  a minted display reference (`nextTheoryDisplayRef` — first free `R1`,
  `C1`, … among current display values).
- **Generated/imported schematics**: the generator's ids ("R1", "C1", …)
  are kept AS the stable ids (deterministic; no rewrite), displaying
  themselves via the fallback rule.
- **Duplicates/collisions**: stable-id reuse rejects at the operation layer
  (`ID_REUSE`); display collisions reject per the normalization policy.
- **Undo/redo/replay**: operations address stable ids only; the rename
  inverse restores the exact prior `refDes` — or field ABSENCE via
  `refDes: null` — so replay digests are exact.

## Legacy migration (deterministic, zero-rewrite)

The migration RULE is the display fallback itself: a legacy component
(no `refDes` field) is already valid — its stable id doubles as its display,
exactly what those records showed before B07. Therefore:

- Component order, coordinates, values, wires, labels, connectivity, and
  every downstream binding are preserved BY CONSTRUCTION (no data transform
  runs at all).
- Reload never re-migrates (there is nothing to rewrite); canonical
  envelopes and SavedProjects load unchanged, and digests are stable across
  reloads (tested).
- B06.3 lineage and quarantine contracts are untouched: no envelope is
  rewritten, browser metadata still never selects lineage.
- Malformed legacy identity (duplicate stable ids in a hand-corrupted
  record) fails closed at the operation layer exactly as before (`ID_REUSE`
  / `OBJECT_NOT_FOUND`); nothing guesses.
- The first RENAME of a legacy component writes `refDes` (persisted through
  the normal canonical commit + autosave path); undo restores absence.

## Consumers

- Canvas rendering, properties panel, and tier-1 targets use
  `schDisplayRef` (the `/api/schematic/edit` summary now sends display
  references; the compiler resolves theory targets by display and compiles
  operations against stable ids).
- Netlist/pcb-sync/physical-binding/SPICE identity continues to key on the
  stable id (unchanged code paths). The theory netlist refdes SYNTHESIS in
  `netlist-bridge` remains positional as before — a documented pre-existing
  limitation, unchanged by B07 (owner decision: whether exported refdes
  should follow display references).
- Tier-1 AI proposals still may NOT rename theory components — the
  interactive canonical rename exists, but proposal activation is an
  explicit owner decision (blocker retained, all-or-nothing).
