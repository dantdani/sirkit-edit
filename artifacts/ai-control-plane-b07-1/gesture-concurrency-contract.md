# B07.1 — Gesture Concurrency Contract

The page-level gesture lifecycle is extracted into the framework-free
`SchematicGestureCoordinator`
(app/lib/engineering/schematic-gesture-coordinator.ts), individually tested
with deferred promises — the B07 suite only exercised
`SchematicEditorSession`; the race lived above it.

## State

| Element | Meaning |
|---|---|
| `projectionEpoch` | Monotonic counter. Bumped by EVERY authoritative projection application (canonical adoption, lifecycle replacement, gesture rollback) and every `invalidate()`. Preview frames never bump it. |
| gesture `token` + `base` | Minted at `begin()`; `base` is the pre-gesture projection snapshot. |
| `active` | The single gesture that owns the preview. Non-null ⇒ history/autosave suppression (`previewActive`). |
| `committing` | Commit-in-flight latch. |
| `disposed` | Terminal (unmount path uses `invalidate` so a StrictMode remount stays usable). |

## Rules (each mapped to a pinning test in §D of the B07.1 suite)

1. Only one gesture may own the preview; `begin()` returns false while a
   gesture is active or a commit is in flight — a new gesture can never
   silently overwrite an active or committing one. Canvas handlers bail
   when refused. *(D1)*
2. `preview(frame)` applies only while the owning gesture is active. Frames
   are non-authoritative, unrecorded, unpersisted.
3. Pointer-up (`commit`) clears ownership, captures `projectionEpoch`, and
   executes ONE `schematic.move-rotate` transaction pinned to the
   pre-gesture base digest through the serialized session queue (other
   canonical commands serialize behind it there). Zero-delta gestures roll
   back preview drift and commit nothing.
4. A late completion may touch the projection ONLY if the captured epoch is
   still current:
   - late success with epoch advanced → result DISCARDED *(D3: project
     switch; also covers cross-project promises — no completion from
     project A can update project B)*;
   - late failure with epoch advanced → NO base restore; the newer
     canonical/hydrated/recovered state stays visible *(D2, D4)* — a
     rejected stale gesture reconciles to the current authoritative
     projection by writing nothing;
   - failure with epoch current → rollback to `base` (which IS the
     authoritative head, since the transaction never committed) + truthful
     toast *(D8: persistence failure)*;
   - success with epoch current → canonical adoption (one history entry)
     *(D9: exactly one transaction end-to-end against a real session)*.
5. `invalidate()` — called by hydrateProject (project switch), canonical
   recovery adoption, checkpoint restore, AI apply, and unmount — bumps the
   epoch and abandons any active preview/commit tracking. Undo/redo and
   every other authoritative application bump the epoch through the
   approved projection appliers. *(D3, D4, D7)*
6. `cancel()` restores ONLY the preview owned by the exact active gesture;
   with no active gesture it is a no-op. *(D5)*
7. Double pointer-up produces at most one command. *(D6)*
8. Suppression (`previewActive`) clears on success, rejection, exception,
   cancellation, invalidation, and disposal. *(D10)*

## Page integration

The coordinator's host applies projections exclusively through the three
approved appliers (see the setter gate): `applyGesturePreviewFrame`
(preview), `applyCanonicalSchematicProjection` (adoption; flushes the
pending history record and labels ONE entry),
`applyLifecycleSchematicProjection` (hydration/undo/redo/recovery/rollback;
history-suppressed). Both canvases (SchematicEditor and the SPICE-view
ProbeSchematic) hold NO schematic state setters — previews flow through
`graph.preview(frame)` — so the coordinator's ownership rules are the only
path to the projection during a gesture.
