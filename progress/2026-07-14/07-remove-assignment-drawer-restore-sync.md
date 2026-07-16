# Remove Footprint Assignment Drawer and Restore One-click Sync

## Request

Delete the footprint-assignment surface that was consuming most of the PCB
workspace and restore the obvious schematic-to-PCB action: one click should
place the schematic on the PCB again.

## Root cause

The assignment drawer and its toolbar toggle were mounted even when every
component already had a footprint. At narrow widths the drawer took most of the
editor, and the toolbar placed its Sync action at the far right after a long row
of tools. Demo boards hid Sync entirely. The result matched the reported screen:
a large empty drawer and no visible way back from schematic to PCB.

## Changes and why

- Deleted `AssignmentQueue.tsx` and its responsive test; removed all queue
  state, imports, manual-pick handling, toggle, and drawer mounting from
  `PcbEditor`.
- Kept automatic footprint resolution inside schematic sync. Unresolved parts
  are reported in the sync toast as skipped because their schematic metadata is
  missing; no empty manual drawer is opened.
- Replaced the small `Sync` action with a prominent split control labelled
  **Schematic → PCB**.
- The primary half performs the safe default immediately: center new parts and
  spread courtyard overlaps. This restores the one-click workflow.
- The small arrow opens the already-implemented center/preserve/spread placement
  choices for users who need non-default import behavior.
- Moved this control to the first toolbar position so it remains visible before
  routing, DRC, export, history, stackup, and outline controls.
- The same one-click action is shown in the no-board empty state, with a separate
  unobtrusive **Placement options** link.
- Sync is visible on demo boards too; it is no longer silently hidden by the
  `pcbdemo` flag.

## Verification

- TypeScript and targeted ESLint passed.
- Focused component/netlist tests: 9 passed.
- A new component test proves the primary action calls Sync directly while the
  arrow opens options without syncing.
- In-app browser at the reported **1024 × 1013** viewport: the primary action
  occupied x=57–187 px and was fully visible; **Footprint assignment** had zero
  DOM matches; the arrow opened the centered/spread placement dialog; console
  errors: zero. The temporary viewport override was reset afterward.
- Full repository regression: **499 passed, 9 intentionally skipped** across 83
  files; no failures.
- Production Next.js build succeeded, including all 40 static pages. The same
  five known Turbopack Java/ngspice tracing warnings remain unrelated.
