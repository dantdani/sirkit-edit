# UI simplification — checkpoint E (2026-10-16)

The existing workspace was simplified **in place**: no second interface, no new shell, no theme rewrite. Every change is one of
(a) a control that was unnamed, handler-less or a placeholder now does its one real thing, (b) something decorative now computes,
or (c) something that crowded or overlapped the working surface moved to where it belongs. Proof is the real fixture-driven app
in a fresh browser (`e2e/simple-workspace.spec.ts`, Playwright), never a mockup; the screenshots in `screenshots/after-*.png`
are what that spec captured. Fixture-backed means: recorded provider design, scripted agent, in-memory stores — it proves the
page's contract, not live providers (the live journey is `root-causes-and-fixes.md` §C).

## Before → after, per surface

| surface | before (fault) | after | proof |
|---|---|---|---|
| empty sheet | the hint "Describe a circuit above" pointed at a chat that is closed on a fresh load (R4) | one labelled entry action, **Describe a circuit** (`empty-sheet-describe-circuit`): opens the chat and focuses the composer through the journey's `describe_circuit` action | spec step 1; `after-1366x768-empty-sheet-chat-open.png` |
| header Settings gear | handler-less and unnamed (accessibility.md C19) | **Workspace settings** (`aria-label`, `workspace-settings`): a real dialog with the existing settings — Schematic (sheet size), Assistant (AI Brain, model / context / embeddings, agent autonomy, the Tier-3 line), Runtime; Escape closes it and focus returns to the gear | spec step 2; `after-1366x768-settings-dialog.png` |
| chat header | the AI Brain select, the runtime lines and the autonomy control crowded the top of the chat | one line (`chat-settings-summary`: brain · model · confirmation rule) with a "change in Settings" link; the controls live in the dialog | screenshots (chat panel header) |
| 3D tab | a placeholder literal ("3D view") | `PcbEditor presentation="3d"`: without a board an accurate unavailable state with **Open the PCB tab**; with a board the same `PcbPreview3D` renderer the PCB editor's preview sheet uses (one renderer, `pcb-3d-pane`) | spec step 3; `pr-a` E cases (source) |
| Build sidebar design checks | two always-green literals (F-07) — and the whole block sat in the Theory-only JSX branch, so Build mode (the default) never showed it at all (F-30, found by the spec) | `computeDesignChecks` (`app/lib/schematic/design-checks.ts`): "No floating nets" from the drawn schematic's own netlist validation plus unconnected pins / single-member nets, "Supply rails connected" from the ERC's supply findings; states pass / findings (count, bounded messages in the tooltip) / not run (reason); the digest of the schematic it was computed on; rendered as one footer under **both** library panels; a muted informational BOM row | spec step 4 (`not_run` on the empty sheet → `pass`/`findings` after the recorded design); `pr-e-design-checks` (3); `after-1366x768-schematic-applied.png` |
| schematic canvas chrome | a sheet-size select duplicated the Settings control and overlapped the toolbar's rail buttons (+5V / VCC) at 1280–1366 px (F-31, seen in the first E screenshots) | removed from the canvas; Fit and Go to stay; the sheet size is set in Workspace settings | `after-1280x720-*.png`, `after-1366x768-*.png` (rails and Fit / Go to no longer overlap) |
| visual noise | `backdrop-blur-sm` panels and `shadow-lg/xl/2xl` on dialogs, menus and tool panes; a gradient logo square | blur removed and shadows flattened to `shadow-sm` in 15 files; a flat teal logo square; no new colours, spacing scale or component library | `git diff` (class-only changes) |

## Responsive and keyboard evidence

- At 1280×720 (the project's minimum), 1366×768, 1440×900 and 1920×1080, with the chat open and closed: the journey strip and
  its next action, the workspace tabs and the Settings control are visible, and the strip's box ends above the workspace's box
  (no overlap) — asserted by bounding boxes in spec step 5; one screenshot per size with the chat open.
- `e2e/minimum-width.spec.ts` (3) and `e2e/keyboard-and-focus.spec.ts` (5) still pass after the chrome changes.
- The settings dialog is keyboard-complete: labelled selects (`Sheet size`, `AI Brain`), Escape closes, focus returns.

## Accessibility and registry

- Accessible-name census after E: 636 sites on 64 surfaces, in scope 168, unnamed 0 (the canvas select removed; the entry
  action, the Settings control and the 3D "Open the PCB tab" added).
- Control-registry rules added: `view.page-settings` (`setSettingsOpen`), `view.page-journey` (`handleJourneyAction`),
  `view.pcb-3d-open-pcb` (`onOpenPcbTab`); `schematic.sheet-size` accepts `changeSheetSize`.
- accessibility.md: C19 re-anchored to the labelled Settings control (dated note); moved rows re-pointed by content.

## Honest notes (what the screenshots also show)

- "Could not load categories / Retry" in the Build Library: `/api/parts/categories` answers 500 under the fixture runtime (no
  catalog database). The live app loaded the categories in the live run (§C). Not an E change.
- The "OpenAI is currently unavailable — Retry / Use Anthropic instead" card in the 1440×900 and 1920×1080 screenshots: after a
  proposal is applied the page runs two background AI passes (`/api/schematic/layout-critic`, `/api/schematic/review`); the
  fixture has no provider, both answer 503, and the existing provider-failure card appears (chat auto-opens). The card is the
  correct surface for an unavailable provider; whether those automatic post-apply passes should run without the user's action
  (they spend provider budget live) is recorded as an open product question for checkpoint F.
- The BOM row is informational ("not finalized (BOM tab)"); the BOM is built in its own tab.
- Everything here is fixture-backed; it does not claim live-provider behaviour.

## Files

`app/page.tsx` (dialog, entry action, chat summary line, 3D mount, design-checks footer, canvas chrome), `app/components/pcb/PcbEditor.tsx`
(`presentation`, `onOpenPcbTab`, the 3D pane), `app/lib/schematic/design-checks.ts` (new), `app/lib/engineering/control-registry.ts`,
`e2e/simple-workspace.spec.ts` (new), `app/lib/schematic/__tests__/pr-e-design-checks.test.ts` (new),
`app/lib/qualification/__tests__/pr-a-journey-reproductions.test.ts` (E cases flipped to ordinary cases), the styling pass in
`app/components/{bom/BomView,editor/BuildLibraryPanel,pcb/*,spice/SpiceStudio}.tsx`, the regenerated B17 inventory and B24 census.
