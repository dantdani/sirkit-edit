# AI Control Plane — B07.2: Gesture/Command Interlock, Invalid-Projection Recovery, and Fail-Closed Consumer Ingress

> **ADDENDUM / SUPERSESSION (B07.3, 2026-08-07).** Independent post-stage
> verification found three remaining races, and **B07.3
> (`artifacts/ai-control-plane-b07-3/`) supersedes this stage's readiness
> verdict and its serialization model**: (1) `runCanonicalCommand` ran
> ordinary commands as independent concurrent promises and discarded any
> completion whose projection epoch had advanced — two concurrent commands
> could BOTH commit durably while the second's UI adoption was discarded
> (`statusA: completed, statusB: discarded-stale, durableCommits: [A, B]`),
> splitting the visible state from the durable canonical head; (2)
> lifecycle replacements (AI apply, topology/tidy apply, checkpoint
> restore, sheet-size change) RENDERED their candidate and updated the
> authoritative mirror BEFORE canonical adoption, so an invalid candidate
> could stay visible over a still-ready session holding the old head; (3)
> asynchronous AI/advisory work (chat context, tier-1 summaries, topology
> netlists, review, layout critic + its live-SVG screenshot, cross-verify)
> read the VISIBLE arrays and wrote results without project/base pinning.
> B07.3 replaced the epoch-discard model with one explicit FIFO interaction
> queue, made lifecycle adoption and undo/redo transactional, and pinned
> every async producer/consumer to an immutable invocation context. The
> report below is preserved verbatim as the historical record.

## Executive summary

Independent post-B07.1 verification found that an uncommitted gesture
PREVIEW could still be promoted into canonical history by any ordinary
command that raced a drag, that the `invalid-projection` hydration outcome
added in B07.1 had no UI handling, and that KiCad export silently repaired
duplicate references. B07.2 closes all three: every ordinary canonical
command now routes through an atomic interaction gateway over a recorded
AUTHORITATIVE state (with a session-level UNKNOWN_BASE_PROJECTION fail-safe
beneath it), every hydration outcome has explicit truthful UI (including a
persistent blocking invalid-projection state that gates editing, export,
simulation, PCB sync, autosave, and checkpoints), and KiCad export fails
closed with structured 422s instead of renaming references. No mutation
tool was exposed; no B06/B07 authority, lineage, quarantine, history, or
setter gate was weakened.

## Pre-fix reproductions (all CONFIRMED by execution before fixing)

1. **Preview promotion (A).** Canonical `x=100`; gesture preview rendered
   `x=150`; an ordinary Rotate invoked mid-gesture passed the preview state
   to `SchematicEditorSession.execute()`. The session treated the unknown
   digest as legacy divergence, emitted a `rebased` event, quarantined the
   real history, and made `x=150` (plus the rotation) canonical.
   Reproduced by an automated test before the fix; the corrected behavior
   is pinned by tests T1/T1b (the exact reproduction) and T2–T6 (every
   other command entry point).
2. **Invalid projection without fallback (B).** `openForProject` could
   return `{ status: "invalid-projection" }` (B07.1), but `app/page.tsx`
   handled only recovered-canonical / projection-conflict / corrupt-history
   / unavailable — the outcome fell through silently: no dialog, no
   persistent status, and consumers (export, sim, sync, autosave,
   checkpoints) stayed callable. CONFIRMED by source inspection (no
   `invalid-projection` handling existed in the page).
3. **Export silently repairs (C).** `exportToKicadSch` deterministically
   suffixed colliding Theory references with `_2`, and
   `/api/export/kicad` performed no canonical validation before catalog
   lookup and serialization — canonical corruption was concealed instead of
   rejected. CONFIRMED by source inspection of the `uniqueTheoryRefDes`
   helper and the route.

## Root causes

- `currentSchematicState()` read `liveStateRef` — the VISIBLE React
  projection, which gesture preview frames legitimately overwrite — and
  `runExecute`'s legacy-divergence branch rebased the lineage onto any
  unknown incoming digest. A preview digest therefore qualified as a
  lineage genesis.
- B07.1 added the `invalid-projection` outcome to the session but not to
  the page's outcome handling, and nothing gated authoritative consumers
  on session readiness.
- The B07.1 export dedupe treated reference collisions as a presentation
  problem instead of canonical corruption.

## Implementation

**Authoritative state (never inferred from the visible projection).** The
coordinator records the last authoritatively applied state
(`notifyAuthoritativeProjection(state)` from the two approved appliers;
preview frames never touch it) and serves it via `authoritativeState()`.
The page adds a reactive `authoritativeSchematic` mirror — gate-enforced:
`setAuthoritativeSchematic` joined `RAW_SCHEMATIC_SETTERS` in the
structural setter gate — consumed by the PCB editor, SPICE studio, and BOM;
export/simulation/autosave/checkpoint bodies use `authoritativeState()`.

**Interaction gateway (`SchematicGestureCoordinator.runCanonicalCommand`).**
One atomic policy for every mutation entry point (rotate, delete,
property/reference, graph edits, tier-1 apply, replacement, keyboard,
inspector): refuse while a gesture owns the preview; serialize behind an
in-flight gesture commit and use the resulting head (committed on success,
restored base on failure); execute against the authoritative base; discard
completions whose projection epoch advanced (project switch, hydration,
lifecycle replacement). `begin()` refuses while a command is in flight, so
gesture and command are mutually exclusive rather than check-then-race.
Undo/redo run through the synchronous `runExclusiveSync` gate.

**Session fail-safe (defense beneath the UI).** `runExecute` REFUSES an
unknown base projection (`stale_revision` / `UNKNOWN_BASE_PROJECTION`) —
the lazy legacy-divergence rebase is gone. Lifecycle replacements that
legitimately rebase (AI generation/apply, checkpoint restore, sheet-size
change) go through the new EXPLICIT typed
`adoptLifecycleProjection(state, reason)` (validated, quarantine-first,
no-op for known states, refused while not ready) called at APPLICATION
time. The contract now distinguishes: interactive command (refuse unknown
base) / gesture commit (pinned base digest) / lifecycle reconciliation
(openForProject + reconcileHistoryStep, unchanged) / explicit recovery
(B06.2/B06.3 choices, unchanged).

**Invalid-projection recovery UI.** The hydration outcome handler is an
exhaustive `switch` with a compile-time `never` guard. With a valid
canonical fallback: conflict dialog offers ADOPTION ONLY (keep-local hidden
for `invalid-projection-identity`; `resolveConflictAdoptCanonical` now
accepts the invalid-projection conflict kind). Without a fallback: a
persistent, non-dismissable blocking dialog shows sanitized issues,
explains that editing/export/simulation/sync/autosave/release are blocked
until repair, and offers only a read-only raw JSON backup download. No
repair is claimed — none is implemented. Reload reproduces the state
(pinned by test T16).

**Consumer gating.** `evaluateSchematicConsumerGate` (pure, unit-tested)
gates export, simulation, PCB sync (via the PcbEditor `gateSchematicSync`
prop checked inside `handleSync`), checkpoint creation, and autosave.
Autosave is blocked only while conflicted/recovery-pending (the SavedProject
record must keep saving when only the canonical IndexedDB store is
unavailable); everything else requires `ready`.

**Fail-closed export.** `/api/export/kicad` validates the complete state
with `validateSchematicStateIntegrity` BEFORE catalog lookup → structured
sanitized `422 { code: "SCHEMATIC_STATE_INVALID", issues, issueCount }`.
`exportToKicadSch` performs the same validation at entry and throws the
typed `SchematicExportValidationError`; the `_2` dedupe was removed; valid
output is unchanged byte-for-byte (deterministic, pinned by T22).

## Changed files and symbols

- `app/lib/engineering/schematic-gesture-coordinator.ts` — authoritative
  snapshot, `authoritativeState`, `runCanonicalCommand`,
  `runExclusiveSync`, `commandInFlight`, commit settlement tracking,
  `begin()` mutual exclusion, `CanonicalCommandGateOutcome`.
- `app/lib/engineering/schematic-session.ts` — UNKNOWN_BASE_PROJECTION
  refusal replaces the lazy rebase; `adoptLifecycleProjection`;
  `resolveConflictAdoptCanonical` accepts invalid-projection conflicts.
- `app/lib/engineering/schematic-consumer-gate.ts` (new) —
  `evaluateSchematicConsumerGate`.
- `app/lib/engineering/schematic-setter-gate.ts` —
  `setAuthoritativeSchematic` gated.
- `app/lib/kicad-export.ts` — `SchematicExportValidationError`, entry
  validation, `_2` fallback removed.
- `app/api/export/kicad/route.ts` — pre-catalog validation → 422; typed
  error mapping.
- `app/components/pcb/PcbEditor.tsx` — `gateSchematicSync` prop checked in
  `handleSync`.
- `app/page.tsx` — authoritative mirror + appliers carry state;
  `runSchematicCommand` through the gateway; undo/redo exclusivity;
  exhaustive hydration switch; invalid-projection dialog + backup
  download; `changeSheetSize`; consumer gating in
  `handleExportKicad`/`handleRunSim`/`addCheckpoint`/`persistProject`;
  authoritative props for PcbEditor/SpiceStudio/BomView;
  adoptLifecycleProjection calls in `applySchematic`/`restoreCheckpoint`.
- `app/lib/engineering/action-registry.ts` — schematic.move-rotate,
  schematic.import-export-kicad, project.undo-redo rows updated; B01/B04
  matrices regenerated via their generators.

## State-transition policy (exact)

See `schematic-interaction-interlock.md` for the full table. In one line:
**gesture XOR command; commands wait for commits; everything executes
against the recorded authoritative base; unknown bases refuse; lifecycle
rebases are explicit and typed; stale completions are discarded.**

## Tests and results (2026-08-07, repo root)

```
npx vitest run app/lib/engineering/__tests__/b07-2-interaction-interlock.test.ts \
               app/api/export/kicad/__tests__/route-fail-closed.test.ts   # PASS (20 tests)
npx vitest run app/lib/engineering app/lib/pcb app/lib/spice app/lib/project lib
                                                                          # PASS (1783 passed, 14 skipped)
npx vitest run                                                            # see final report (perf-trio isolation reruns included)
npx tsc --noEmit                                                          # PASS
npx eslint <changed files>                                                # PASS (page.tsx: 14 pre-existing react-hooks/refs findings, none introduced)
```

## Remaining UNKNOWN items

- Whether any real user project in the field contains a stored state that
  will now surface the blocking invalid-projection recovery (expected nil —
  every write path has validated/snapped since inception).
- The Build-mode tier-2 topology route (`schematic.edit-topology`,
  status "partial") applies route responses through the page's lifecycle
  appliers; it now requires explicit adoption like other lifecycle
  replacements — its own end-to-end flow was not exercised in this stage
  beyond the shared appliers (INFERRED safe; UNKNOWN untested end-to-end).

## B08 readiness

With the preview→lineage race closed at both the UI and session layers,
recovery outcomes handled exhaustively, and consumer ingress fail-closed,
B07.2 supersedes B07.1's readiness verdict: B08 (canonical PCB mutation
parity) is safe to begin once the owner authorizes it.
