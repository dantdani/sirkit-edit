# B07.1 — Canonical Identity Integrity Contract

## The shared validating reader

`validateCanonicalSchematic(value)` (app/lib/engineering/schematic-model.ts)
is THE canonical schematic validator. It is not scattered per-operation: the
same function backs

- `parseCanonicalSchematic` — the executor's opaque-slot reader, used by
  `requireCanonicalSchematic` at EVERY schematic operation application and
  by hydration/change-set derivation;
- `validateSchematicStateIntegrity` — the UI-state form (via canonical
  normalization), used by the session at every lineage-genesis point;
- the whole-schematic POST-TRANSACTION check in
  `applyEngineeringOperations` (see below).

It rejects, with named issues:

- wrong `schemaVersion`; non-array `components`/`kicadComponents`/`wires`/
  `netLabels` (a malformed legacy object can never be silently cast);
- duplicate stable ids WITHIN Theory, WITHIN KiCad, and ACROSS the two
  families — stable-id uniqueness spans the entire schematic component
  namespace, so no canonical operation target can be ambiguous;
- duplicate wire ids and net-label ids;
- invalid component types and rotations (0|90|180|270), invalid label
  orientations, empty label names;
- invalid display references: theory `refDes` (when present) must be a
  non-empty string; kicad `refDes` must be non-empty; the display key
  (`refDesKey` = trimmed, upper-cased) must be UNIQUE across the whole
  exported namespace (theory `refDes ?? id` AND kicad `refDes` together);
- off-contract geometry via the shared geometry contract (see
  `geometry-validation-contract.md`).

`parseCanonicalSchematic` returns `null` for ANY violation — it never
returns an identity-ambiguous model, so `requireCanonicalSchematic` fails
closed with `SCHEMATIC_MODEL_UNAVAILABLE` before any operation could touch
a first-match target. This is what pins reproduction 2's second half: a
`schematic_set_component_properties` against `componentId: "dup"` can no
longer rename "only the first matching component" — it cannot execute at
all (test A2).

## Hydration lifecycle (SchematicEditorSession.openForProject)

The projection is validated BEFORE any lineage decision:

| Situation | Outcome | Lifecycle | What is written |
|---|---|---|---|
| Projection valid, no envelope | `fresh` | ready | new lineage from projection |
| Projection valid, envelope valid | B06.2 decision table (resume / rebase / recover / conflict) | per table | per table (quarantine-first) |
| Projection INVALID, envelope valid | `projection-conflict` (`reason: "invalid-projection-identity"`, canonical head offered) | conflicted | NOTHING |
| Projection INVALID, no/invalid envelope | `invalid-projection` (new explicit outcome with the named issues) | conflicted | NOTHING |
| Envelope identity-invalid (integrity digests fine, duplicate ids inside) | `corrupt-history` | conflicted | NOTHING |

Explicit-recovery rules (all validated, quarantine-first preserved):

- `resolveConflictKeepLocal(projection)` re-validates; an invalid
  projection returns `invalid-projection` and replaces nothing.
- `recoverStartFresh(projection)` re-validates; an invalid replacement is
  refused before any quarantine/overwrite.
- `openLineage` (every lineage-genesis path, including legacy rebase and
  reconcile-rebase) throws `SCHEMATIC_IDENTITY_INVALID` on an invalid
  state — defense in depth beneath the caller checks.
- `runExecute`'s legacy-divergence rebase validates the incoming snapshot
  first and rejects the command (`SCHEMATIC_IDENTITY_INVALID` diagnostics)
  instead of rebasing onto invalid identity.
- `reconcileHistoryStep` refuses to rebase onto an identity-invalid
  restored snapshot (event recorded; head untouched).

Browser metadata still never selects or repairs canonical lineage; nothing
renames, deletes, reorders, or re-identifies ambiguous components.

## Post-transaction validation

`applyEngineeringOperations` validates the COMPLETE resulting schematic
after any batch that touched a schematic operation and throws
`SCHEMATIC_INTEGRITY:<first issue>` — the executor's normal rejection path
then rolls back the whole transaction. This catches cross-operation net
effects that per-operation checks cannot (e.g. two adds whose displays
collide only case-normalized, test A7).

## Identity vs presentation (authoritative field table)

| Field | Class | Rule |
|---|---|---|
| `SchComponent.id` / `KicadComponentInstance.id` | IMMUTABLE identity | collection key, operation target, netlist `id`, pcb-sync `componentInstanceId`, SPICE device `id`/bindings/`componentPinNodes`/`SourceRef.id`, physical-binding scope, BOM `componentInstanceIds`, export UUID seed. No operation can rewrite it. |
| `SchComponent.refDes` / `KicadComponentInstance.refDes` | EDITABLE presentation | display everywhere is `schDisplayRef` (`refDes ?? id`); normalization: `normalizeRefDes` (trim) for storage, `refDesKey` (trim+uppercase) for uniqueness. Renames write ONLY this field. |

Pinned by tests: `b07-1-identity-geometry-gestures.test.ts` §A (A1–A8) and
§B, plus the B07 §1 suite which still passes unchanged.
