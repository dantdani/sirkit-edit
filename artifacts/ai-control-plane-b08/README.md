# AI Control Plane — B08: Canonical PCB Mutation Parity and Exact Replay

## Executive summary

Every ordinary PCB semantic mutation now executes through the canonical
transaction authority (`CanonicalExecutor` + `EngineeringTransactionService`
via `CanonicalEditorSession`): one UI action = one canonical transaction =
one `PcbHistory` entry, with deterministic validation, kernel-minted EXACT
inverses, durable revision evidence, project/base ownership, and truthful
structured refusals. `PcbHistory` remains the UI projection and undo
presentation layer — never a second authority.

The migration cornerstone is the **board-delta compiler**
(`app/lib/engineering/pcb-delta.ts`): each surface keeps its shipped
domain mutator (route commands, zone/silk commands, placement candidates,
autoroute imports, repair candidates, net-class reclassification,
stackup-plane reconciliation) and produces a CANDIDATE board; the ONE
commit gateway (`app/lib/engineering/pcb-commit-gateway.ts`) delta-compiles
(base → candidate) into exact operations at serialized execution time and
commits one transaction. Unrepresentable differences fail CLOSED
(`PCB_DELTA_UNSUPPORTED`) — a registered semantic action can never
silently escape the executor.

## Confirmed defects fixed (all reproduced by tests first)

- **A — order-exact collection inverses**: removing the middle
  track/via/zone (and now text/silk/padstack/keepout/dimension) recorded
  an appending add inverse — replaying yielded `[a,c,b]` and a different
  `semanticStateDigest`. Adds now carry `atIndex`; every kernel-minted
  remove inverse restores the EXACT array position (b08 §1 T1).
- **B — absent-field restoration**: patch inverses were `Object.assign`
  merges of full snapshots, so a patch that ADDED `padstackId` undid to a
  via still carrying it. Updates now take `patch` (forward) or an exact
  `replace` snapshot; kernel inverses are ALWAYS `replace` snapshots, and
  optional-collection removes carry `pruneEmptyCollection` so undo of the
  first add restores collection ABSENCE. `update_routing_preferences` and
  `set_footprint_protection` gained the same exact presence/absence
  semantics (§1 T2/T3/T4).
- **C — self-blocking protection inverses**: `locked` is structurally
  excluded from generic patches (and `PROTECTION_VIA_UPDATE` refuses a
  replace that flips it); protection is its own operation family
  (`set_footprint_protection`, `set_copper_protection`) under
  `manage_protection`, exempt from the locked-object guard — inverses
  never self-block, undo never bypasses authorization (§1 T4).
- **D — silent legacy fallback**: `applyEditsCanonical` covers EVERY
  `EditCommand` op for session-bound histories; unclassifiable mixed
  batches refuse with zero mutation unless a DECLARED compound command
  (pcb.assist-edit) compiles them atomically. [B08.1] Bare histories
  mutate ONLY under explicit authorization; retired histories refuse
  permanently (§3, editor-adapter test 17; b08-1 suite). [B08.2] That
  authorization is now an INTERNAL test-only capability
  (`pcb-bare-authority.internal.ts`, CI import gate) — no runtime grants
  it (the repair route is a pure planning pass), and unauthorized bare
  refusals are `canonical_authority_missing`.
- **E — raw history.execute product paths**: routing, zones, silk, plane
  dialog, rules (classify/AI-delta/manual), outline (toolbar + handle
  gestures + enlarge-to-fit), stackup (toolbar + autoroute setup),
  placement preferences, auto-place apply, autoroute import, repair
  apply, autonomous-layout commit, AssistBox apply, and PadstackPanel all
  commit through the gateway/funnel. A CI tripwire
  (`b08-pcb-mutation-gate.test.ts`) pins the classified remainder.

## Highlights

- **Whole-board structural validation** (`pcb-board-structure.ts`) runs
  after every board-touching batch: global id uniqueness, net/padstack
  referential integrity (padstack deletion with live via references fails
  atomically), positive dimensions, annular ring, layer/span validity,
  safe-integer geometry, outline/polygon well-formedness, dimension
  validity. Change sets carry the new collections and settings
  singletons; derived evidence invalidates deterministically (existing
  dependency graph).
- **Dimensions end-to-end** (`pcb.dimension`): native
  `BoardDimension` model (H/V/aligned, integer-nm endpoints, layer/unit/
  precision metadata), canonical ops with exact inverses, whole-board
  validation, 2D render (`render/dimensions.ts` from the shared pure
  geometry), picking + selection + inspector + delete, three-click
  creation tool, `.sirkit.json`/checkpoint persistence (opaque board
  JSON), semantic revision/digest participation (conditional so pre-B08
  revisions stay verifiable), and a TRUTHFUL KiCad export diagnostic
  (`X-Sirkit-Export-Unsupported` header → toast) — dimensions are never
  silently omitted. No Gerber/manufacturing inclusion is claimed.
- **Pinned candidates**: auto-place (source revision + problem hash +
  constraint program hash), autoroute (base + server sourceRevision +
  candidate projection digest), repair (plan base revision re-verified at
  apply), autonomous layout (expectedSourceRevision) — all re-verified
  inside `buildCandidate` at serialized execution time; a changed base
  refuses with zero board/history/persistence mutation.
- **[CORRECTED BY B08.1]** The paragraph below OVERSTATED lifecycle
  safety as originally shipped: independent verification proved that a
  disposed session's history fell through to the legacy whole-board
  fallback, an in-flight commit could publish after retirement,
  `adoptBoardLifecycle` did not retire synchronously, and stale sync/
  qualification responses could overwrite a checkpoint restoration.
  B08.1 (`artifacts/ai-control-plane-b08-1/`) implements the real
  boundary: retired-history tombstones, explicit bare-history authority,
  linearizable in-flight retirement, a lifecycle-generation owner, and
  scoped sync/qualification/hydration side effects with reconcile-required
  semantics for stale server commits.
- **Typed lifecycle boundary** (`adoptBoardLifecycle` in PcbEditor):
  initial hydration, working-copy restore, server-authority adoption,
  sync adoption, qualification adoption, and checkpoint restore are
  declared lifecycle replacements — new history + freshly bound canonical
  session (verified head claims only), undo cannot cross, never an
  ordinary edit. Server PCB-sync CAS authority is untouched. The repair
  service refuses against a replaced history
  (`serviceCurrent` guard in usePcbRepair).
- **Tool boundary unchanged**: no generic tool/chat/MCP mutation
  execution; destructive tiers keep independent-approval semantics
  (trusted interactive channel for human+ui only); AI actors remain
  categorically refused protection/stackup/component authority;
  manufacturing release stays categorically blocked (§7 T19/T20).
  The interactive editor session actor is now the local human OWNER
  (project_admin) — the composition that already holds the trusted UI
  channel; every other caller keeps least privilege.

## Verification (observed on this tree)

- `b08-canonical-pcb.test.ts` — 18 passed; `b08-pcb-mutation-gate.test.ts`
  — 2 passed.
- Kernel/adapter/registry gates: executor-kernel 17, editor-adapter 19,
  transaction-foundation 8, b03-1 20, action-registry + b04 40 — all
  passed after truthful updates (pcb.dimension/create-via now
  implemented; adapter test 17 rewritten to the no-fallback contract).
- PCB domain sweep (`app/lib/pcb` + `app/components/pcb`): 755+ passed.
- Full suite: 2048 tests — 2009 passed, 20 skipped, 19 timing/jsdom
  failures under parallel load; ALL 19 pass in isolation (documented
  flaky set; two needed a single retry: pcb-repair-agent perf,
  assignment-queue-panel jsdom).
- `npx tsc --noEmit` clean; ESLint clean on changed files except the
  pre-existing baseline (14 app/page.tsx errors; 1 pre-existing
  useSilkTool set-state-in-effect error in untouched code).
- B01/B04 artifacts regenerated (79 action records, 137 routes); drift
  gates green.

## Files

See `pcb-mutation-coverage.csv` (every discovered PCB semantic write),
`pcb-operation-inverse-fixtures.json`, `pcb-lifecycle-ownership.md`,
`pcb-validation-invalidation-matrix.csv`, `pcb-tool-boundary.md`, and
`b08-regression-fixtures.json`.

## Truthfully partial / out of scope

- Routing keepouts: full canonical operations + validation, no dedicated
  creation UI yet (registry notes this).
- Board cutout/mounting geometry beyond the outline model: unrepresented.
- KiCad dimension emission: explicit unsupported diagnostic (no emitter).
- select-move legacy branches and `applyEdits` remain for UNBOUND
  histories only (tests/server planning) — classified in the tripwire.
- No agent/chat/MCP mutation activation, no provider work, no 3D control.
