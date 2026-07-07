# Chat activity logs, default-loop cleanup, and full-body drag targets

Date: 2026-07-07 - Status: done (type-checked; netlist validation green)

## Problem
After the composer/review changes, the workflow still had three UI rough edges:
- submissions did not show live progress in chat, unlike Cursor/Claude Code/Codex
  style tool activity
- automatic maintenance passes leaked into chat or repopulated suggestions after
  the user already applied them
- components were easiest to move by grabbing their boundary/strokes instead of
  anywhere inside the component body

## Changes (`app/page.tsx`)
- Added a `log` chat message type:
  - `ActivityLogMessage`
  - `ActivityLogEntry`
  - running/done/error states
  - compact renderer inside `MessageBubble`
- Added activity-log helpers:
  - `startActivityLog`
  - `appendActivityStep`
  - `finishActivityLog`
  - `failActivityLog`
- Wired logs into normal chat submissions:
  - submit message
  - call assistant
  - stream response
  - error state on failure
  - log messages are filtered out of `/api/chat` payloads so the model only sees
    user/assistant conversation
- Wired logs into schematic generation and edit:
  - preparing request
  - generating build netlist / synthesizing theory schematic
  - loading catalog parts
  - layout and validation
  - replacement confirmation, apply, discard, and error states
- Added chat auto-scroll to keep the latest log/result visible.
- Added `suppressChat` to `applySchematic`.
  - Automatic tidy still updates the canvas.
  - Automatic tidy no longer posts "Tidy the schematic layout" into chat.
  - Manual "Re-tidy layout" still reports its result.
- Stopped the apply-suggestions review loop:
  - guarded suggestion applies now pass `skipAutoRun`
  - the suggestion tray is consumed once
  - manual Review remains available for intentional re-checks
- Added full transparent SVG hit targets for movement:
  - Theory components use the full symbol bounding box
  - loaded KiCad components use the computed component bounds
  - KiCad loading placeholders use their placeholder bounds

## Result
The chat now shows live progress for user-submitted work, while automatic
maintenance stays quiet unless it produces the user-facing advisory review.
Applying suggestions no longer immediately reopens the same tray. Components can
be dragged from anywhere inside their visual bounding area.

## Verification
- `.\node_modules\.bin\tsc.cmd --noEmit`
- `.\node_modules\.bin\tsx.cmd scripts\netlist-validation.test.ts`

