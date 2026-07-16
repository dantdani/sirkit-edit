# Footprint Assignment Drawer — Close/Reopen Fix

Date: 2026-07-14

## Reported problem

At a narrow editor width, the **Footprint assignment** drawer appeared over the
right-side layer inspector without a usable close button. Once closed, it could
not be opened again when there were no unresolved footprints or when the PCB
demo was active.

## Root cause

The drawer was absolutely positioned inside the canvas column. The inspector is
a fixed 240px sibling, so on a narrow window the canvas could collapse to only a
few pixels. The drawer's `max-w-full` then inherited that collapsed width while
its text overflowed visually into the inspector; the close control was laid out
outside the usable width. The toolbar toggle was separately rendered only for
non-demo boards with one or more unresolved footprint assignments.

## Changes

- Moved the assignment drawer to the editor-level positioned container so its
  width is based on the complete editor, not the collapsible canvas column.
- Capped it with `min(24rem, 100%)` for narrow screens.
- Made the close control fixed-size, non-shrinking, higher contrast, and titled.
- Added Escape-key close behavior while focus is inside the drawer.
- Made the translated-away drawer inert and non-interactive while closed.
- Added a persistent toolbar toggle in demo and project modes, including when
  the assignment list is empty; unresolved counts remain visible when present.
- Added accessible open/close labels and pressed state.

## Verification

- Added a regression test covering open → close-button → reopen → Escape close
  with an empty queue in a narrow container.
- TypeScript passed.
- Focused component tests passed.
- Full repository result: **475 passed, 9 intentionally skipped**.
- The running Next.js page returned HTTP 200 after hot reload.
