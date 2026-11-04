# J3 — the Sheets editor increment (evidence page)

Runbook section J increment 3 (`artifacts/astra-guided-pcb/PROMPT_TO_PCB_RELIABILITY_AND_SIMPLE_UI.md` J.3, J.8, J.9); decisions
OD-255 / OD-257 (`artifacts/remaining-builder-program/OWNER_DECISIONS.md`). Branch `codex/astra-foundation`. Build plan
`scratchpad/j/j3-plan.md`: A (page carriage, persistence flip, AI-refusal call sites), B (navigator, lens hook, control rules,
registry flip), C (fixture, browser spec, pure guard, this page).

Status legend: **fixture** = proven against the fixture runtime (committed catalog, scripted provider, no router recording, US$0);
**live** = proven against the authorized live model (none planned for J3; OD-257 item 9); **unit** = a vitest suite; **pending** =
awaits another builder's increment. Nothing below is claimed beyond its label.

## 1. What was built

| piece | files | state |
|---|---|---|
| Pure AI replace-result guard (OD-255 item 6, OD-257 item 3) | `app/lib/project/sheet-replace-guard.ts`; `app/lib/project/__tests__/j3-sheet-replace-guard.test.ts` | unit: DONE (C). Page call sites (Build start, offer, edit, Tidy, final apply): DONE (A, in place; `j3-page-carriage` case 4 pins the five sites and their order). [PR-J5 integration, 2026-10-26] since J5 (OD-259 item 2) the Build start ADVISES instead (`multiSheetReplaceAdvisory`); the THEORY start still refuses (review B-2: a Theory result is always one page; `multiSheetReplaceRefusal(base, "theory")`), so `j3-page-carriage` case 4 counts two result-less refusals (Theory start, edit) |
| Multi-sheet fixture: the four-motor drone organised into Power / Motor drivers / IMU (three planner moves, deterministic ids) | `app/lib/schematic/__tests__/_j3-fixtures.ts`; `fixtures/j3-drone-sheets-state.json`; `fixtures/j3-drone-sheets-project.sirkit.json`; `app/lib/schematic/__tests__/j3-fixture-readability.test.ts` | unit: DONE (C) |
| Browser spec (J.9 fresh-browser item) | `e2e/j3-multi-sheet.spec.ts` | GREEN against A + B (section 3: every case passed under the fixture runtime; three spec steps re-pointed by A, each noted in the spec) |
| Sheets navigator, lens hook, blocks layer, scoped glyphs, control rules, registry flip, regenerated inventories | `app/components/schematic/**`, `app/lib/schematic/sheet-lens.ts`, `app/lib/engineering/{control,action}-registry.ts`, `artifacts/ai-control-plane-*` | DONE (B; two layout fixes by A: the navigator's column takes no pointer events, every dialog scrolls inside 90vh - `j3-sheet-navigator-layout`; one StrictMode fix by A: the controller is revived on remount - `j3-sheet-lens-strict-mode`) |
| Carriage of `sheets` through the page, history, coordinator, canonical adoption; `MULTI_SHEET_EDITOR_AVAILABLE` flip | `app/page.tsx` (in place, 9156 lines), `history-step-state.ts`, `schematic-gesture-coordinator.ts`, `canonical-adoption.ts`, `file.ts`, `lib/persistence.ts` | DONE (A): eleven in-place spreads on the page (`j3-page-carriage` names them; page still 9156 lines), `historyStepState` carries the tree from the snapshot (`j3-history-step-sheets`), the coordinator's commit `final` keeps it (`j3-coordinator-sheets`), `normalizeAuthoritative` keeps it (`j3-canonical-adoption-sheets`), `MULTI_SHEET_EDITOR_AVAILABLE = true` (`j1-sheets-persistence` pin moved: import -> hydrate -> re-export byte for byte), `deleteProject` clears `sirkit:sheet-view:<id>` |

## 2. Exact validation results (fixture / unit)

A's final run (2026-10-23, working tree on `codex/astra-foundation` 6e60efa0 + the J3 files), then C's results at the time of writing:

- A's unit gates: `npx tsc --noEmit -p tsconfig.json` exit 0 (after `rm .next/dev/types/validator.ts`); eslint clean on every touched file (page.tsx, the five carriage modules, the hook and controller, SheetNavigator.tsx, the six new suites, the spec); `npx vitest run --maxWorkers=4` over the 52 page.tsx-reading suites + the inventory gates (b17-a-control-inventory, pr-d-coverage-matrix, b04-tool-registry, b24-a1-readiness, b23-a-tier3-vocabulary, b24-f-verdict-lines, b24-f-maps, b24-d3-accessible-names, j1-sheet-operations, action-registry) + the persistence / history / file suites (project-state, checkpoints, schematic-history, autosave, b19-d-project-import-bounds, j1-sheets-persistence) + the section J suites (j2-project-consumers, j2-consumers-golden, j3-fixture-readability, j3-sheet-replace-guard, j3-sheet-lens, j3-sheet-navigation-store, j3-sheet-lens-hook, j3-sheet-navigator) + b24-d2 (board-read, crash-recovery, memory, process-cleanup, working-copy) + b07-1 / b07-2 / b07-3 / b07-4 / b07-5: 79 files, 910 tests passed (4 skipped) once the `j1-connectivity-caller-ratchet` pin was moved for the lens's one sheet-aware call (first batch: 78 passed, that one failing on the unclassified caller). New A suites: `j3-page-carriage` 8/8, `j3-history-step-sheets` 4/4, `j3-coordinator-sheets` 4/4, `j3-canonical-adoption-sheets` 3/3, `j3-sheet-lens-strict-mode` 2/2, `j3-sheet-navigator-layout` 2/2. Inventories regenerated after the page wiring: B17 708 classified controls on 73 surfaces (0 unclassified, 0 stale rules; the page's `ScopedNetLabelGlyph` pointer-down joined `schematic.drag-gesture`), PR-D 1014 rows, B01 113 records, B24 maps byte-identical across two renders, census 708 sites / in scope 175 / unnamed 0 / out of scope unnamed 102 (unchanged); D9 pin `control-sites` 707 -> 708 and the executive summary's count line moved with dated notes.
- `j3-sheet-replace-guard`: 6/6 passed (`npx vitest run --maxWorkers=4 app/lib/project/__tests__/j3-sheet-replace-guard.test.ts`, 2026-10-22, C's run on 91dd2c3c + C's files).
- `j3-fixture-readability`: 11/11 passed (same command on `app/lib/schematic/__tests__/j3-fixture-readability.test.ts`; its import case takes the SHEETS_EDITOR_PENDING branch while `MULTI_SHEET_EDITOR_AVAILABLE` is false and the byte-for-byte branch once A flips it). `npx tsc --noEmit -p tsconfig.json` exit 0; eslint on the five new files exit 0. Facts the suite pins: 4 sheets (Overview; Power 5 parts; Motor drivers 20 parts; IMU 5
  parts; 11 MCU parts stay on the overview); 7 ports (PWM1-4; I2C_SCL, I2C_SDA, IMU_INT1), each with one sheet pin on the overview
  and one hierarchical label inside; `validateSheetHierarchy` = `[]`; `resolveProjectConnectivity` ok, multi-sheet, 42 nets,
  `partitionDigest` equal to the flat drone's; the PCB netlist's 41 components and its endpoint partition equal the flat drone's;
  BOM rows equal; `Sheet connections` passes; the A3 page holds every sheet's content with a 40 px margin; blocks at
  (400,1640) (1100,1640) (1800,1640), 500 x 200, disjoint from each other and from the overview's circuitry; the project file is
  formatVersion 2 with a verified sha256 over the canonical payload.
- `e2e/j3-multi-sheet.spec.ts` (A, 2026-10-23, port 3137, `--reporter=list`, output in the scratchpad, no reporter folder in the repo): every case GREEN under the fixture runtime - case 1 (run 3: `1 passed`), case 2 (run 4: `ok` - New sheet MCU with a non-randomUUID id, Go to U2, the previewed move with PWM1-4 / I2C_SDA / I2C_SCL / IMU_INT1 / RESET, Apply as ONE transaction, 41 instances with identities unchanged, the fourth block, Follow I2C_SCL into IMU with `schematic-highlight` data-net I2C_SCL, Undo / Redo, reload keeping 5 sheets), cases 3 and 4 (run 5: `2 passed` - the binding review of 41 refs, sync and apply to awaiting_qualification with 41 footprints while IMU is active, Sheet connections listed; the Build sentence refused with the guard's exact text, 0 generation tasks, 0 provider-bound requests, state unchanged), case 5 (run 6: `1 passed` at 1280 x 720). The three runs before them found three real defects, each fixed with a permanent test: (1) the navigator's right-aligned column was as wide as its chip row, so with the tree open its empty area sat over the canvas and swallowed the +3V3 placement click (`elementFromPoint` -> sheets-navigator; fixed: the column is `pointer-events-none`, each child `pointer-events-auto`; `j3-sheet-navigator-layout`); (2) the Move preview for U2 (15 crossings) was taller than the viewport and its Apply button sat below the fold with no scrollable ancestor (fixed: every DialogContent is `max-h-[90vh] overflow-y-auto`; pinned in the same suite); (3) under React StrictMode (Next's dev default) the hook's effect cleanup disposed the controller on the simulated unmount and nothing revived it, so the navigator would have been dead in `next dev` while every jsdom test passed (fixed: `revive()` on (re)mount; `j3-sheet-lens-strict-mode`). Three spec steps were re-pointed by A, each with a dated note in the spec: the Follow step clicks the hierarchical label glyph (the signal's own anchor; the moved local label of the same name sits under it and intercepted the first `<text>`), the final tab switch of case 3 is a DOM click (at 1366 x 768 the PCB tab's component review panel with 41 rows extends over the workspace tabs - a pre-existing PCB-tab layout, reported), and case 5 holds the chip to the canvas box (under the fixture identity banner the workspace is a few px taller than a 720 px viewport; the status bar is clipped the same way - pre-existing). A final single invocation of the whole spec together with the guard specs is recorded on the next line.
- Earlier, C's pre-A run (port 3137, `-g` cases 1 and 4, 2026-10-22): case 1 FAILED at `openFixture` line 82 as predicted (the import was refused SHEETS_EDITOR_PENDING before A's flip).
- Guard replay (A, 2026-10-23, port 3137, ONE Playwright invocation, `--reporter=list`, output in the scratchpad, no reporter folder left in the repo): `e2e/j3-multi-sheet.spec.ts` (5) + `journey-contract` (1) + `l4-generation-task` (4) + `l5-chat-task` (3) + `l7-drone-vertical-slice` (1) + `m1-resolve-missing-parts` (2) + `m4-existing-board-resolution` (1) + `prompt-to-gerber` (1) + `simple-workspace` (1): **19 passed, 0 failed** (4.7 min), zero ROUTE_FIXTURE_MISS in the server log (the fixture router replay key did not move: no new browser uuid draw on the generate -> approve -> placement path). Committed evidence PNGs rewritten by those specs were restored from HEAD (`git show HEAD:<path>`); the eight screenshots under `screenshots/` are this increment's own evidence.
- (C's earlier attempt: `e2e/prompt-to-gerber.spec.ts` + `e2e/journey-contract.spec.ts` were started by C on port 3137 but not completed
  when the workflow forced C's report; exit 127, no verdict then.)

## 3. Browser evidence (fixture)

Screenshots (1366 x 768 unless named otherwise) in `screenshots/`, written by the spec:

| file | shows | state |
|---|---|---|
| `j3-overview-1366x768.png` | the overview with the three blocks, the Sheets chip and tree | fixture (run 3) |
| `j3-imu-sheet-1366x768.png` | the IMU sheet open (U3, R11, R12, C9, C10 only) | fixture (run 3) |
| `j3-move-preview-1366x768.png` | Move to sheet preview for U2 -> MCU with its crossings | fixture (run 4) |
| `j3-overview-four-blocks-1366x768.png` | the overview after the move (four blocks) | fixture (run 4) |
| `j3-follow-signal-imu-1366x768.png` | Follow I2C_SCL landing on IMU with the highlight | fixture (run 4) |
| `j3-pcb-awaiting-qualification-1366x768.png` | the complete PCB sync applied with IMU active (41 footprints) | fixture (run 5) |
| `j3-ai-refusal-1366x768.png` | the Build sentence refused with the guard's message | fixture (run 5); [PR-J5 integration, 2026-10-26] SUPERSEDED - no spec writes it any more (case 4 now proves the J5 advisory and the sheeted review: `j5-multisheet-build-review-1366x768.png`, J5 evidence); the committed PNG is the J3 record |
| `j3-chip-layout-1280x720.png` | the chip clear of Go to, the status bar and the workspace tabs at 1280 x 720 | fixture (run 6) |

[PR-J5 integration, 2026-10-26] case 4 re-pointed (review B-1; OD-259 item 2 revises OD-257 item 3): the Build sentence on this
multi-sheet project now shows the guard's ADVISORY step, starts ONE durable task, and offers the planned drone laid out as sheets in
the ONE review dialog, whose summary names every replaced sheet once ("Every existing sheet (Overview, Power, Motor drivers, IMU) is
replaced by the apply") and never "on this sheet" (review B-3); Cancel records the discard and changes nothing; the J4 Tidy steps
follow unchanged; then the THEORY composer is refused at its start with no POST /api/schematic (review B-2). Its screenshot is
`j5-multisheet-build-review-1366x768.png` (J5 evidence, written by this spec); the browser result is recorded in `j5-generation.md`.

Which spec assertions awaited which increment (recorded by C before A and B landed; all now hold):

- every case: the import itself (`openFixture`) awaits A's `MULTI_SHEET_EDITOR_AVAILABLE` flip and the page carriage (until then the
  page answers `Open project failed: SHEETS_EDITOR_PENDING: ...` and the header never shows the project);
- cases 1, 2, 3, 5: the chip, tree, breadcrumb, Back, blocks, New, Move, preview, Apply, Follow and destination controls await B
  (control ids in the spec's `T` table; the PROPOSED ones - `sheets-new-name`, `sheets-move-target` - are C's additions for B);
- case 1's placed +3V3 port carrying `sheetId: "sheet-imu"` awaits B's lens hook (the merge stamps new ids with the active sheet);
- case 4 awaits A's Build-start call site of `multiSheetReplaceRefusal` / `flatReplacementRefusal` and the message's rendering
  (the spec locates the exact text, whether it is a toast or the chat panel's alert);
- case 3's `Sheet connections` row and the 41-footprint sync are round-1 facts and need only the import.

## 4. Bounded limitations (honest list)

- No "Organize into sheets" (J.3 item 4) in J3: a design is organised one previewed move at a time (J4).
- No hierarchical KiCad export, no SPICE and no Tidy on a multi-sheet document (each refuses with a typed reason; J4).
- No bus / bundle ports, no repeated sheet instances, no package with units on different sheets (refused with a diagnostic;
  OD-255 item 8).
- Deleting a populated sheet is two previewed transactions (move its contents to the parent, then delete; OD-257 item 2).
- A port created for an unnamed crossing net is named `SIG<n>`; it is renamed afterwards through the port's Rename action.
- [PR-J5 integration, 2026-10-26] superseded for Build by J5 (OD-259 item 2: a planned result replaces every sheet as one undoable
  transaction after review; a FLAT result is still refused at the offer and the apply; Theory still refuses at its start). As written for J3: the AI replace-result refusal is a refusal, not sheet-aware generation (J5-2): a generated, edited or tidied result over a
  multi-sheet project is never applied and never silently flattened.
- Fixture proof only: no live-model proof is produced or claimed for J3 (OD-257 item 9; US$0 spent).

## 5. Proposed ledger row (progress.md is lead-owned)

| J3 | the Sheets navigator, overview, open / create / rename / delete, ports and sheet pins, follow a signal, move to sheet;
persistence and undo | DONE in the tree (uncommitted; A + B + C): the page carries the tree at every rebuild site in place (9156 lines),
import hydrates a multi-sheet file, the lens / navigator / blocks / scoped glyphs are wired, the AI replace-result guard sits at five
call sites, both sheet records are implemented (B17 708/73, census 0 unnamed), the fixture browser proof is green (5 cases) | `j3-*`
suites (lens, store, hook, navigator, layout, strict-mode, page-carriage, history-step, coordinator, canonical-adoption, guard,
fixture-readability), the moved pins (`j1-sheets-persistence`, `j1-sheet-operations`, `j1-connectivity-caller-ratchet`, `b24-f-maps` D9),
`e2e/j3-multi-sheet.spec.ts`, `multi-sheet/j3-editor.md` + screenshots |

CI admission notes for the lead: the new spec runs in `page-browser-e2e` by default (`_ci-admission.ts` jobsOf: every `e2e/*.spec.ts`
the skip globs leave in); re-measure OD-30's headroom with it (b24-d4-browser-split, b24-d0-ci-split); the two new vitest suites
need exact-path positional entries in `deterministic-manufacturing.yml` (OD-254); the workflow file is lead-integrated.
