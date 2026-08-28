# B07 — Gesture Transaction Contract

> **CORRECTION (B07.1, 2026-08-06).** Step 5 below ("the pre-gesture
> projection is restored") was UNCONDITIONAL in the shipped implementation:
> `commitGesture` cleared its gesture ref before awaiting the session, so a
> rejection that resolved late could restore an obsolete base over a newer
> command result, hydration, canonical recovery, undo/redo, or another
> project's state. Additionally, "the kernel additionally enforces integer
> coordinates" was integers only — off-grid geometry committed. B07.1
> extracted the lifecycle into the epoch-gated
> `SchematicGestureCoordinator` (late completions are discarded unless
> their captured projection epoch is still current; `begin` refuses while
> another gesture owns the preview or a commit is in flight) and the kernel
> now rejects off-grid/out-of-bound geometry with `INVALID_PX`. See
> `artifacts/ai-control-plane-b07-1/gesture-concurrency-contract.md`.

One completed pointer gesture = one atomic canonical transaction = one
undo/history entry. Implemented in `page.tsx` (`beginGesture` /
`cancelGesture` / `commitGesture` + the canvas and SPICE-view drag handlers)
over the B06 `SchematicEditorSession`.

## Lifecycle

1. **Begin** (mousedown on a draggable): `graph.begin()` snapshots the
   pre-gesture projection (`gestureRef.base`).
2. **Frames** (mousemove): the handler computes the full next arrays ONCE,
   renders them as a non-authoritative preview (`/* b07:preview */`-tagged
   setters), and remembers them in `dragRef.preview`. While a gesture is
   active the design-state watcher is suppressed — **no history entries and
   no autosave writes for intermediate frames** (frames are never persisted).
3. **Commit** (mouseup): the final preview (stretch: consolidated exactly as
   the legacy mouseup did) goes through `commitGesture`:
   - zero-delta gestures restore the base and commit NOTHING;
   - otherwise ONE `schematic.move-rotate` transaction executes with
     `expectedBaseDigest` pinned to the pre-gesture digest, containing every
     component transform, attached-wire geometry update, and label move
     together (compiled by the graph diff, simulation-verified);
   - on success the canonical result is adopted (one labeled history entry).
4. **Cancel** (Escape while dragging): the exact pre-gesture projection is
   restored; no transaction, no history, no persistence.
5. **Rejection** (stale/superseded base, validation, persistence failure):
   the pre-gesture projection is restored and a truthful toast shows — a
   stale gesture can NEVER rebase canonical history backward (the pinned
   base digest rejects inside the serialized queue; tested with two
   concurrent gestures from one base: the first lands, the second rejects
   with `stale_revision`, zero rebase events).

Snapping/coordinate normalization happens in the existing deterministic
geometry math BEFORE the command boundary (grid-snapped world coordinates);
the kernel additionally enforces integer coordinates.

## Covered gestures

- Rigid group drag (component/kicad seed → connected group of components,
  wires, labels) — commits all of them together.
- Stretch drag (double-click) — the lone element + L-bend re-routed attached
  wires, consolidated at commit.
- Label-only drag.
- SPICE-view "move" mode drag (ProbeSchematic) — same begin/preview/commit
  contract via the shared gesture API.

## Non-gesture clicks

Wire draw/split, junction, label add/delete, wire delete, and placement are
single-click semantic edits: each recomputes its result from the canonical
head INSIDE the serialized queue (`graph.run`) and commits one atomic
transaction; a no-effect click (e.g. junction on a non-crossing) compiles to
zero operations and commits nothing.
