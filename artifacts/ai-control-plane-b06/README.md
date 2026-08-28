# AI Control Plane — B06: Canonical Schematic Semantic Mutations

> **Corrected by B06.1** (`artifacts/ai-control-plane-b06-1/`): the original
> B06 record overstated four behaviors. (1) The AI tier-1 apply auto-executed
> provider output and applied theory renames via `setComponents` — both
> replaced by the sealed proposal → explicit-apply boundary; the legacy
> rename path is deleted. (2) `planSchematicReplacement` accepted a
> caller-supplied `verified-atomic` object — verified authority now exists
> only via the internal B05.1 bundle adapter. (3) Replacement counted labels
> as connections but never moved them — label moves are now part of the
> atomic operation with exact inverses. (4) The schematic session used an
> in-memory store in production — it now persists through IndexedDB with a
> reconciled, reload-surviving canonical head. Sections below are kept as
> the B06 record with inline corrections.

B06 establishes ONE reliable, versioned semantic mutation path for the
existing schematic editor and migrates the real UI behavior that was blocking
trustworthy AI control: delete, replace, property edit, and discrete
move/rotate. Agent mutation remains disabled.

Companion documents:

- `schematic-command-contract.md` — the canonical model, operations, command
  bindings, execution path, and invalidation contract.
- `delete-replace-policy.md` — the deterministic delete policy and the
  fail-closed replacement/authority policy.
- `schematic-mutation-migration-matrix.csv` — every schematic mutation path:
  previous behavior → B06 status (canonical / legacy-blocked /
  legacy-out-of-scope) with blockers.
- `schematic-replay-fixtures.json` — kernel-generated operation/inverse/digest
  fixtures with proven exact round-trips; regenerate with
  `npx tsx scripts/generate-b06-schematic-artifacts.ts` (a CI test pins the
  committed file to the implementation).

## Runtime paths migrated (real handlers, no direct-state fallback)

| UI action | Now |
|---|---|
| Canvas delete tool, Delete/Backspace, both properties-panel Delete buttons | `schematic.delete-component` via `SchematicEditorSession` with a pre-computed deterministic impact plan |
| BOM part swap (`handleSwapPart`) | `schematic.replace-component` — one atomic transaction for all instances; fail-closed pin mapping; identity + ALL authority fields replaced together |
| Properties panels: theory value, kicad value/refDes (now commit-on-blur/Enter) | `schematic.set-property` (refDes uniqueness enforced canonically) |
| Ctrl+R, theory rotation buttons, kicad Rotate button | `schematic.move-rotate` |
| AI tier-1 edit apply (`/api/schematic/edit` proposals) | **B06.1**: `schematic.edit-tier1-propose` seals an all-or-nothing compiled proposal (no mutation); `schematic.edit-tier1-apply` executes the exact sealed operations only on explicit human approval |
| Undo/redo | snapshot restore + B03.1 verified-replay reconciliation onto the canonical lineage (forged lineage/reference rejected; divergence rebases deterministically) |

Also fixed in passing: the canvas delete tool previously crashed at runtime —
`SchematicEditor`'s required `onDeleteComponent` prop was never passed; the
legacy panel deletes left dangling wires/labels; the legacy swap retained
stale Stage-5 authority ids across a partId change; the tier-1 AI apply was a
third, direct-state mutation implementation. All four defects are closed by
the migration.

## What remains legacy or UI-only (explicitly marked, with blockers)

- **Theory component id-rename** — the id IS the primary key (netlist,
  pcb-sync, physical-binding scope). Canonical rename is blocked pending
  stable-identity work.
- **Group drag-move / stretch drag / SPICE-view move** — co-move wires and
  labels; they need wire-geometry operations and gesture batching.
- **Add component / wire / junction / label, wire+label delete tools** —
  the `schematic.connect` / `schematic.add-component` graph vocabulary;
  out of B06 scope.
- **Generate / tier-2 topology edit / import / checkpoint restore /
  hydrate** — whole-document lifecycle replacements, not semantic mutations
  of existing entities. The session detects the divergence and rebases
  deterministically.
- **Page size** — sheet metadata, not undoable, unchanged.

See the migration matrix for the full row-by-row inventory.

## Invariants enforced (tested)

- One user action → one transaction → one revision → one `SchematicHistory`
  entry; rejected commands change nothing and surface structured outcomes
  (applied / rejected-by-validation / revision conflict /
  mapping-required / authority-unverified / persistence-failure /
  downstream-invalidated).
- Delete: uniform endpoint-exact incident cleanup; no hidden net merging; no
  dangling references; interior-vertex wires and same-name labels preserved;
  **order-exact indexed restore** makes undo digest-identical.
- Replace: atomic single operation; `expectedCurrentPartId` precondition;
  fail-closed on ambiguous identity, authority, or pin mapping; pin-count /
  display-text / provider-text are never compatibility evidence; stale atomic
  authority is cleared, never silently retained (B05.1 integrity-vs-authority
  distinction preserved).
- Executor: expected-revision conflict detection, atomic commit-or-rollback
  (validation and persistence failures leave byte-identical state),
  idempotent retry replay, durable lineage, exact-head persistence and
  rehydration, legacy opaque schematics fail closed
  (`SCHEMATIC_MODEL_UNAVAILABLE`), legacy UI states normalize through the
  adapter.
- Undo/redo execute only through the B03.1 verified-replay contract — forged
  lineage ids, unknown references, spoofed digests, and caller-supplied
  operations are all rejected pre-mutation.

## Operations unavailable to agents

ALL of them. No schematic mutation command or operation kind is provider-
callable, discoverable, in any OpenAI/Anthropic tool schema, reachable from
chat, or exposed via MCP (tested across every discovery channel at the
maximum risk ceiling). `edit_components` is categorically refused for AI
actors at the authorization layer; destructive-tier execution additionally
requires the branded interactive channel that only editor-session
composition can create (CI-enforced import boundary). `/api/schematic/edit`
and `/api/schematic/edit-build` remain proposal/advisory routes.

## Known limitations and owner decisions

1. **Tier-1 apply is all-or-nothing** — strengthened in B06.1: any blocker
   (unknown target, theory rename, missing pin data) now refuses the WHOLE
   sealed proposal at compilation; no valid subset ever executes. Per-op
   partial apply remains an owner decision.
2. **BOM swap replaces ALL instances of a part in one transaction** (legacy
   behavior preserved); per-instance swap UI is an owner decision.
3. **Property inputs now commit on blur/Enter** (previously per-keystroke
   with a debounced history merge) — required for one-edit-one-transaction.
4. **Replacement pin mapping is currently identity-only in the UI.** The
   planner supports explicit mappings and acknowledged drops, but no
   pin-mapping dialog exists yet; an unmappable swap refuses with the exact
   pins needing a decision.
5. ~~Undo of an AI batch that included legacy theory renames rebases the
   canonical lineage.~~ **Removed in B06.1**: the legacy theory-rename
   mutation path no longer exists; a proposed theory rename blocks the whole
   proposal.
6. **Physical-binding orphan transition** on delete remains an explicit
   owner action (no runtime transition exists; durable publication already
   fails closed) — carried forward from B05.1.
7. **17 pre-existing `react-hooks` ESLint findings in `app/page.tsx`** sit in
   unmigrated legacy regions (canvas drag ref-mirrors, SPICE probe view,
   part-cache panel effect). B06-introduced code lints clean; fixing those
   regions belongs to the drag/wire-geometry migration stage.

## Verification

Commands run from the repo root (results at completion of B06, 2026-08-05):

```
npx tsc --noEmit                                              # PASS (0 errors)
npx eslint <all B06-changed files>                            # PASS for all B06 code (page.tsx: 17 pre-existing findings in untouched legacy regions, see above)
npx tsx scripts/generate-action-toolability-matrix.ts         # regenerated B01 matrices + fingerprint (71 actions, 137 routes)
npx tsx scripts/generate-b06-schematic-artifacts.ts           # regenerated replay fixtures (5 fixtures, all inverse round-trips exact; 4 refusals)
npx vitest run app/lib/engineering/__tests__/b06-schematic-mutations.test.ts   # PASS (32 tests)
npx vitest run app/lib/engineering app/lib/project \
  app/lib/physical-binding app/lib/pcb-sync app/lib/schematic-compiler        # PASS (32 files, 395 tests, 6 skipped)
npx vitest run                                                # full suite: 1784 passed / 17 failed under parallel load
```

Full-suite triage: all 17 parallel-run failures are explicit machine-speed
performance gates ("< 200 ms", "< 50 ms", 5 s timeouts on repo-walking scans)
in non-schematic areas — the known perf-flake set documented since B04. Every
one was re-run in isolation and passed (including `b03-2-boundary` test 10,
whose repo-wide import scan simply exceeded 5 s under full parallel load).
Zero non-performance failures; zero failures in schematic, engineering,
project, physical-binding, pcb-sync, or schematic-compiler suites.

Runtime verification (dev server, in-browser): place → select → canonical
rotate (panel 90° button) → canonical value edit (commit-on-Enter) →
canonical panel delete → Ctrl+Z undo restored the deleted component exactly;
zero console errors.

## Recommended B07 scope

**Canonical schematic graph operations** — formalize wire/junction/label
add/delete/geometry as versioned operations, migrate the wire tools and the
group-drag/stretch gestures (with gesture batching), and introduce stable
theory-component identity so rename becomes canonical. That unblocks the last
legacy schematic mutation paths and is the prerequisite for ever exposing any
schematic mutation to agents behind approvals.
