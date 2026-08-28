# B07.2 — Schematic Interaction Interlock

## The two state authorities

| Reference | Owner | Updated by | Never updated by |
|---|---|---|---|
| Visible projection (React `components/wires/kicadComponents/netLabels`) | page | the three approved appliers, including gesture PREVIEW frames | anything else (structural setter gate) |
| AUTHORITATIVE state (`SchematicGestureCoordinator.lastAuthoritative` + the reactive `authoritativeSchematic` mirror) | coordinator/page | `applyCanonicalSchematicProjection`, `applyLifecycleSchematicProjection` (both call `notifyAuthoritativeProjection(state)`) | `applyGesturePreviewFrame` |

Semantic commands, export, simulation, PCB synchronization, autosave, and
checkpoints consume ONLY the authoritative reference. It is scoped to the
active project through `invalidate()` on hydration/project switch, so a
late result from an old project can never update the new one.

## Interaction policy (one shared gateway)

Every mutation entry point — `runSchematicCommand` (rotate, delete,
property/reference, tier-1 apply, replacement/swap, keyboard, inspector),
`schematicGraphApi.run` (wire/junction/label/placement), gesture commit,
undo/redo — obeys:

| Situation | Ordinary command | Gesture begin | Undo/redo |
|---|---|---|---|
| Idle | executes against authoritative base | allowed (base = authoritative) | allowed |
| Gesture preview active | **REFUSED** (truthful toast: finish or cancel the move) | refused (single owner) | **REFUSED** |
| Gesture commit in flight | **SERIALIZED** behind the exact commit, then executes against the resulting head (committed on success, restored base on failure) | refused | **REFUSED** |
| Command in flight | (session queue serializes) | **REFUSED** (no preview may race a pending adoption) | **REFUSED** |
| Completion after epoch advance (project switch, hydration, lifecycle replacement, disposal) | result **DISCARDED**, never adopted | n/a | n/a |

Refusal was chosen over auto-cancel for commands during a preview (the
user's in-progress drag is never thrown away silently); the ONLY implicit
cancellation remains Escape/pointer-up, exactly as before.

Atomicity: the refusal check lives INSIDE `runCanonicalCommand`; the
serialize-wait loop re-checks after every awaited commit; `begin()` refuses
while `commandsInFlight > 0`; `runExclusiveSync` is synchronous. There is
no check-then-execute gap in any direction.

## Session-level fail-safe (beneath the UI)

`SchematicEditorSession.execute` refuses any base that is neither the
canonical head nor a known canonical ancestor:
`stale_revision` / `UNKNOWN_BASE_PROJECTION`. A preview digest can never
qualify as an authoritative interactive base, and NO interactive path can
trigger a lineage rebase.

The typed source/mode distinction:

| Source | Method | Unknown-state behavior |
|---|---|---|
| Interactive command | `execute(base, request)` | REFUSE (UNKNOWN_BASE_PROJECTION) |
| Gesture commit | `execute(base, { expectedBaseDigest })` | refuse (`stale_revision`), plus the pinned base digest re-checked in-queue |
| Lifecycle replacement (AI generation/apply, checkpoint restore, sheet-size change) | `adoptLifecycleProjection(state, reason)` — explicit, validated, quarantine-first, called at application time | rebase EXPLICITLY (event recorded); refused while not ready or for invalid/stale-superseded states |
| Hydration reconciliation | `openForProject` decision table (B06.2/B06.3, unchanged) | per table |
| Undo/redo reconciliation | `reconcileHistoryStep` verified replay (unchanged) | replay or documented reconcile-rebase |
| Explicit recovery | `resolveConflictKeepLocal` / `resolveConflictAdoptCanonical` / `recoverStartFresh` (unchanged + invalid-projection adoption) | per B06.2/B06.3 |

## Pinning tests

`app/lib/engineering/__tests__/b07-2-interaction-interlock.test.ts`:
T1 (exact x=100→preview x=150→Rotate reproduction), T1b (session
fail-safe), T2–T6 (delete/property/graph/tier-1/replace refusals), T7
(undo/redo exclusion across all three busy states), T8+T9 (serialization
behind the exact commit; committed head used), T10 (restored base after a
failed commit), T11 (stale completion discarded), no-rebase assertions in
every scenario (T12), and preview-never-canonical head checks (T13).
