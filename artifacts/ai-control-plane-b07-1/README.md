# AI Control Plane — B07.1: Identity Integrity, Display-Consumer Consistency, Geometry Validation, and Gesture Race Closure

> **ADDENDUM / CORRECTION (B07.2, 2026-08-07).** Independent post-stage
> verification found three gaps this stage missed, and **B07.2
> (`artifacts/ai-control-plane-b07-2/`) supersedes this stage's readiness
> verdict**: (1) an uncommitted gesture PREVIEW could still be promoted
> into canonical lineage — the epoch-gated coordinator protected the
> gesture's OWN completion, but an ordinary command (Rotate, Delete,
> property edit, graph edit, Tier-1 apply, replacement) invoked mid-gesture
> read the VISIBLE React projection and the session's legacy-divergence
> path rebased history onto the preview digest; (2) the
> `invalid-projection` hydration outcome this stage added to the session
> had NO page-level handling — a project could sit conflicted without a
> truthful blocking dialog or consumer gating; (3) this stage's KiCad
> export dedupe (`_2` suffixes) silently REPAIRED duplicate references,
> concealing canonical corruption instead of failing closed. The sections
> below are preserved verbatim as the historical record; where the
> "Remaining limitations" or "B08 readiness" text conflicts with B07.2,
> B07.2 is the authority.

B07.1 is a corrective stage. Independent verification reproduced four B07
acceptance failures the 19-test B07 suite did not cover; this stage closes
them without expanding agent mutation permissions and corrects the B07
artifacts that overstated the guarantees.

## The four reproduced gaps (and their closures)

| # | Reproduction | Root cause | Closure |
|---|---|---|---|
| 1 | `schematic_add_wire` with vertices `(1,1)→(21,1)` committed | Schematic operations were geometry-checked by an integer walker (`INVALID_NM`) — integers, not grid alignment, and the code lied about units | Shared geometry contract (`schematic-geometry.ts`, sourced from the editor's real `GRID`) enforced per-operation at the canonical executor with truthful `INVALID_PX` codes; the trusted UI still snaps before command construction; the executor never snaps |
| 2 | A `SchematicState` with two components `id: "dup"` opened `fresh`; a rename mutated only the first match | Hydration never validated the projection; operations only checked the touched entity | One shared validating reader (`validateCanonicalSchematic`) used by `parseCanonicalSchematic`, hydration, every operation's model access, AND a whole-schematic post-transaction check; duplicate identity now enters an explicit conflict/invalid-projection lifecycle and an ambiguous target can never execute |
| 3 | `buildNetlist` emitted `[{id:"stable-r",ref:"R1"},{id:"stable-k",ref:"R1"}]` for Theory `RSENSE` + KiCad `R1` | Theory netlist references were positionally synthesized, discarding the displayed reference | All display consumers (netlist `ref`, pcb-sync `referenceDesignator`, SPICE device name/label, KiCad export, BOM refs, plan labels, frontend probe keys) now derive from `schDisplayRef` (normalized); identity fields stay on the immutable stable id; uniqueness is case-normalized across BOTH families |
| 4 | A late `commitGesture` rejection restored its stale base over newer state | `commitGesture` cleared `gestureRef` before awaiting and rolled back unconditionally | The page gesture lifecycle now lives in the extracted, individually tested `SchematicGestureCoordinator`: epoch-gated late completions, single-owner preview, begin-refusal during commit-in-flight, invalidation on project switch/hydration/recovery/undo/redo/checkpoint/unmount |

Plus one structural weakness: the B07 direct-setter tripwire accepted any
line containing a `b07:` comment. It is replaced by a structural gate
(`schematic-setter-gate.ts`): the four raw schematic setters may appear only
in their `useState` declarations and inside the three approved projection
appliers (`applyGesturePreviewFrame`, `applyCanonicalSchematicProjection`,
`applyLifecycleSchematicProjection`); calls, aliases, ref-stashes, and prop
threading anywhere else fail CI, and comments exempt nothing (proved by an
inject→fail→revert test that never touches git).

## Companion documents

- `identity-integrity-contract.md` — the shared validating reader, the
  hydration lifecycle for invalid identity, and post-transaction validation.
- `display-reference-consumer-matrix.csv` — every consumer of component
  identity/display fields, before → after.
- `geometry-validation-contract.md` — the canonical geometry contract,
  bounds derivation, and the legacy off-grid recovery policy.
- `gesture-concurrency-contract.md` — the coordinator state machine and the
  late-result rules, mapped to their tests.
- `b07-1-regression-fixtures.json` — the ten required regression fixtures
  with their pinning tests.

## Verification (2026-08-06, repo root)

See the B07.1 final report for exact outputs:

```
npx vitest run app/lib/engineering/__tests__/b07-1-identity-geometry-gestures.test.ts   # PASS (38 tests)
npx vitest run app/lib/engineering/__tests__/b07-graph-gestures.test.ts                 # PASS (19 tests)
npx vitest run                                                                          # full suite; 3 perf-target tests flake under parallel load and pass in isolation
npx tsc --noEmit                                                                        # PASS
npx eslint <changed files>                                                              # PASS
```

## Boundary statement

No mutation tool was activated; no provider schema, chat execution, MCP
surface, or HTTP mutation route was added; Tier-1 theory rename remains
blocked. `schematic_restore_entities` remains kernel-minted-inverse-only —
no UI command may submit one (pinned by test A4).

## Remaining limitations and owner decisions

- Legacy projects whose saved geometry is off-grid (or whose identity is
  duplicated) now FAIL CLOSED into an explicit recovery state instead of
  opening editable; there is deliberately no silent migration. If such
  records exist in the field, an explicit deterministic repair flow is an
  owner decision (see `geometry-validation-contract.md`).
- For legacy theory components without `refDes`, exported references equal
  their stable ids verbatim (the same string the UI displays). Generated
  ids like `R1` are unchanged; hand-placed legacy UUID ids export as UUIDs
  until the user renames them — truthful, but an owner may prefer a
  one-time explicit re-annotation flow.
- The `invalid-projection` recovery state currently disables canonical
  editing and requires adopting a valid canonical head (when one exists) or
  external repair; a guided in-app repair UI is future scope.
- Tier-1 proposal theory-rename activation remains an explicit owner
  decision (unchanged from B07).
