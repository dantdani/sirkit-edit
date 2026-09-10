# B17-A — Control classification contract (action rebaseline)

Labels: CONFIRMED = executed and measured on this machine; INFERRED = derived from code reading; PROPOSED = designed, not exercised; RECORDED = written down without a claim.

## What is inventoried (CONFIRMED)

`app/lib/engineering/control-surface.ts` reads the application source with the TypeScript compiler API (never a regex over labels) and lists every actionable entry point:

| kind | what | how it is found |
|---|---|---|
| `click`, `double-click`, `context-menu`, `pointer`, `key`, `change`, `dialog`, `submit`, `drop`, `drag` | JSX event handlers (`onClick`, `onDoubleClick`, `onContextMenu`, `onPointerDown`/`onMouseDown`, `onKeyDown`, `onChange`/`onValueChange`, `onOpenChange`, `onSubmit`, `onDrop`, `onDragStart`) | every JSX opening/self-closing element in `app/page.tsx`, `app/components/**` (tests excluded) |
| `shortcut` | keyboard listeners (`addEventListener("keydown" \| "keyup" \| "keypress")`) | the same files, plus hooks |
| `gesture` | pointer/mouse/wheel/dblclick/contextmenu listeners registered outside JSX | the same files and `app/lib/pcb/render/scene.ts` (the PCB canvas listener that every PCB tool subscribes to) |
| `palette` | command-palette actions (`{ id, title, run }` literals) | `PcbEditor.tsx` |

Each site gets a stable key `<surface>|<kind>|<element>|<label>|<handler>[#n]`: the label is `data-testid` > `aria-label` > `title` > text > `placeholder` > `name`, the handler is a summary of what the handler calls (`setAssistOpen`, `drc.run`, `dispatch:toggle-grid`, `onCancelAutoPlace|onAutoPlace`, `noop`, …). Lines are evidence only, never part of the key.

Inventory at this commit: **554 controls on 58 surfaces** — click 313, change 149, pointer 24, palette 21, shortcut 13, gesture 12, dialog 10, key 10, context-menu 1, double-click 1.

## The five classes (CONFIRMED)

`app/lib/engineering/control-registry.ts` classifies every key with an ordered rule list (first match wins):

| class | meaning | count |
|---|---|---|
| `semantic` | dispatches one registered semantic command; `record_ids` names the B01 action-registry record(s) it reaches | 253 |
| `dispatcher` | routes to SEVERAL registered commands or to other classified controls (keyboard dispatchers, the command palette, the chat composer, generic inspector fields, context-menu items, the PCB canvas listener); `record_ids` lists what it reaches | 21 |
| `view` | presentation-only: chrome open/close, tool/tab/pane/mode switches, layer visibility, canvas navigation, form DRAFTS that a later semantic control commits; `record_ids` names the view record when one exists (`view.canvas-navigation`, `view.pcb-3d-control`) | 272 |
| `internal` | explicitly non-callable plumbing: `stopPropagation` shields, the non-dismissable recovery modal backdrop, a static status pill, the custom context menu's `preventDefault` | 8 |
| `unavailable` | intentionally unavailable with a visible reason (none at this commit — every disabled control is rendered with its reason by its own component; see the B01 records with `partial`/`ui-only` status for the product-level gaps) | 0 |

The runbook's four classes map as: "dispatches a registered semantic command" = `semantic` + `dispatcher`; "presentation-only view command" = `view`; "explicitly internal/non-callable" = `internal`; "intentionally unavailable with a visible reason" = `unavailable`.

## Gates (CONFIRMED — `app/lib/engineering/__tests__/b17-a-control-inventory.test.ts`, in the CI `prompt-to-gerber` job)

1. every scanned control matches exactly one rule; a rule that matches nothing is stale → fail;
2. the committed `ui-control-inventory.csv` and `-summary.json` byte-match the render → a new or changed control fails CI until `npx tsx scripts/generate-b17-control-inventory.ts` is run and the diff reviewed;
3. `semantic`/`dispatcher` controls reach existing records; every `implemented` record is reached by a control or an API route (a record without a real handler fails; `project.autosave` is the one effect-driven record, allow-listed with its reason); `ui-only` records are reached by a control, `api-only` by a route, `missing` by neither;
4. no record's sources reference a retired `/api/...` route;
5. a control whose handler does nothing is `internal` or `unavailable` — a silent control fails;
6. `unavailable` controls carry a reason; rule ids are unique.

The B01 gates (`action-registry.test.ts`: route coverage both ways, method drift, labelled-control fingerprint, matrices byte-match) now run in CI as well — they had no CI job before B17-A (RECORDED).

## Reclassified B01 records (CONFIRMED from current code)

| record | was | now | evidence |
|---|---|---|---|
| project.undo-redo | partial | implemented | page undo/redo controls through the B07.2 coordinator gate; PCB undo is `pcb.undo-redo-canonical` |
| schematic.generate | partial | implemented | inert proposal + review dialog (B16.1C §F); composer, approve, retry controls |
| schematic.edit-topology | partial | implemented | composer edits and review suggestions are proposals approved in the review dialog |
| pcb.footprint-resolution | partial | implemented | routes audited by the B16.0 wrapper migration; read-only verification panels; writes via assignment queue / component review |
| pcb.ai-rules-brief | partial | implemented | Suggest → inert proposal → Apply proposal (`netClasses.applyDelta`) |
| manufacturing.release | api-only | implemented | ManufacturingWorkflowPanel request/authorize (B16.1C, browser-proven in B16-C.5) |
| schematic.import-export-kicad | partial | partial (precise blocker) | export implemented; `.kicad_sch` IMPORT has no control and no route |
| placement.auto | partial | partial (precise blocker) | UI candidate apply exists; agent proposals do not share the candidate format — B17-E |
| routing.autoroute | partial | partial (precise blocker) | same — B17-E |
| view.pcb-3d-control | ui-only | ui-only (precise blocker) | 6 component-local controls in PcbPreview3D — B17-C |
| view.canvas-navigation | ui-only | ui-only (precise blocker) | 30+ view-only controls without a shared command — B17-D |
| full-flow.run, project.engineering-effects, placement.preview-api | api-only | api-only (explained) | no UI consumer by design / B17-E |
| manufacturing.assembled-release | missing | missing (explained) | no route, no control; B22–B24 |

New records: `schematic.sheet-size` (canonical lifecycle adoption), `pcb.board-revision` (B16-C.1), `pcb.component-review` (B16-C.2). Registry now 88 records (implemented 79, partial 3, ui-only 2, api-only 3, missing 1); `ui-command-toolability-matrix.csv` regenerated.

## Bounded (RECORDED)

- Keys depend on labels and handler summaries: renaming a label or refactoring a handler changes the key and requires regeneration — that is the intended review point, not a defect.
- Controls rendered by generic components with prop-driven labels (`ActivityBarButton`, `ViewTab`, `PickerField`, `KindToggle`) are inventoried by element + handler, not by their runtime text.
- Pointer gestures inside the PCB tools are reached through the scene listener (one dispatcher site) — the tools' own pointer handling is subscription-based and is covered by their registry records.
- Handler summaries are static; a control whose handler is passed in as a prop (`onClick`) is classified by its owner's rule, which names what the owner supplies.
