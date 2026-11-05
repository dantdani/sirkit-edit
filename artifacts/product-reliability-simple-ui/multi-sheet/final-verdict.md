# Final verdict — section J, multi-sheet schematics and workload limits (2026-11-05)

[PR-J7, 2026-11-05] Branch `codex/astra-foundation` at `e0372e64` plus this evidence; governing text
`artifacts/astra-guided-pcb/PROMPT_TO_PCB_RELIABILITY_AND_SIMPLE_UI.md` section J (`:234-392`), its completion sentence at `:389`.
Proof map: `validation.md`; files: `changed-files.md`; ledger: `progress.md`; decisions OD-255 … OD-259 and OD-261. This verdict covers
section J only; it does not claim the application or the program complete.

## Verdict: PARTIAL

The completion sentence - "the user can navigate and edit actual connected subsystem sheets and obtain one correct project-wide
circuit/PCB" - holds for the editor and the project-wide circuit and PCB sync, proven by permanent tests and in the fixture browser:
a project holds real sheets (overview blocks, ports, sheet pins, scoped labels) in ONE document with ONE connectivity authority; the
Sheets navigator opens, creates, renames, reorders and deletes sheets; parts and connections move between sheets as one previewed,
undoable transaction with every identity and the pin-to-net partition kept; Organize into sheets and the assistant's sealed organise
proposal refactor a flat design; a generated multi-sheet result arrives as sheets; Follow signal crosses sheets; and ERC, design checks,
BOM, Missing parts, SPICE, the hierarchical KiCad export and the PCB sync read the whole project whatever sheet is open (41 footprints
with the IMU sheet active). Section J stays PARTIAL because:

1. **No live-model proof.** Every J proof is fixture-backed (scripted provider and agent, committed catalog); no live multi-sheet
   generation or organisation ran (OD-259 item 7). The live planner prompt is unchanged, so a live plan carries no typed interfaces
   (OD-259 item 6).
2. **Part of J.6 is deferred.** "Change the filter in Analog front end" (sheet-scoped regeneration, J5-6) is not built (OD-259 item 1); a
   generated result replaces every sheet as one undoable transaction. The assistant inspects, navigates and proposes an organisation;
   creating, renaming and connecting sheets stays a human action (`schematic.sheet-structure`, human-admin-only).
3. **Refusals where J asks for support.** Bus / bundle ports and one package's units on different sheets are refused with named
   diagnostics, not implemented (OD-255 item 8); repeated sheet instances are refused, as J.5 allows.
4. **Proof gaps named in `validation.md`.** Invalidation after a circuit edit rides the existing digest and drift rules with no J
   end-to-end case (row 7); same-selection draft preservation across a sheet switch has no J case (row 8); no design-check or ERC row
   opens the sheet it concerns (J.3 item 6: Go to opens a part's sheet and Follow signal a net's destinations; the BOM and Missing parts
   rows name the sheet as text); no schematic print / SVG / PDF exporter exists to extend
   (J.8 item 5), and the hierarchical KiCad export is checked by the repository's own oracle, not by a KiCad round trip (LB-17).
5. **Workload items J7-4 … J7-8 are open** (below).

## Remaining bounded limitations

- **Workload (`workload-limits.md`).** J7-4: more than 8 blocks per design task needs the task head shrunk first, then every bound
  `j7-queue-beyond-slots` case 7 pins moved together (today a 9-block plan is designed as one circuit with the limit message). J7-5: the
  orchestration specialist cap (4 + coordinator; OD-107). J7-6: an editor-chosen workload size (an owner cost decision). J7-7: a workload
  view in the task card from the snapshot. J7-8: more than 3 worker slots only after measuring the pool, the catalog slots and the
  provider's rate. Remaining J7-2 bounds: allowance waits 5 s doubling to 60 s, at most 12 re-queues without a sibling's end; a lapsed
  sibling's reservation still counts as committed spend.
- **The export's three name refusals.** `EXPORT_SHADOWED_PORT`, `EXPORT_NAME_SHADOWS_GLOBAL`, `EXPORT_NAME_CASE_AMBIGUOUS`; OD-258 item 2
  named one; the owner may prefer a single code.
- **The label-tool kind.** The editor's label tool still mints `kind: "label"` whatever the name (`app/page.tsx` `commitLabelDraft`). Since
  J4 the first-sheet refusal names the offending labels and offers the previewed, undoable "Normalise N rail-named labels" transaction
  (OD-258 item 3); the tool itself is unchanged.
- **The planner's sheet-pin placement.** The move and organise planners anchor a sheet pin at the parent-side cut point inside the
  circuitry, not on the child block's edge (the KiCad export places it on the edge, OD-258 item 2); on the organised dimmer the label-joined
  crossing's pin pair sits where the label was, away from the blocks.
- **The simulation-in-flight window.** A simulation requested before an active-sheet switch lands with the previous sheet's bare probe
  keys (the lifecycle discards on the base digest only); the result is cleared on the switch, so the window is one request.
- **Smaller open items.** `SHEET_LOCAL_SHADOWS_PORT` also warns for a parent-side sheet pin beside a same-named local label (advisory);
  several page carriage edits are one-liners appended to existing statements to keep the 9,156-line pin (a reviewed PAGE_LINES move is
  the owner's, OD-257 item 7); J3's one-selection Move keeps its one-hop attachment and is not covered by the organise drawing check;
  the typed planner interfaces are read by nobody on the server.
- **Found by this J7 run's screenshot review (not fixed here).** After a multi-sheet project file is imported, the overview opens at the
  camera of the page shown before the import, so the A3 overview's blocks start below the fold until Fit (INFERRED cause: J3N-1's live
  camera across the single-sheet -> multi-sheet remount; no spec asserts the camera). Label density on generated and moved sheets (the
  motor-stage sheet's VBAT / M3_DRAIN / M4_DRAIN overlap; the IMU sheet's I2C_SCL text against the I2C_SDA anchor) is a drawing issue,
  not a connectivity one (`validation.md` section 2).
- **Pre-existing, outside J.** At 1366 x 768 the PCB tab's component review panel (41 rows) extends over the workspace tabs (`j3-editor.md`).

## Owner decisions pending

Each of OD-255, OD-257, OD-258, OD-259 and OD-261 applied a default the owner may change item by item. The ones that gate further J work:
a live multi-sheet run (OD-259 item 7: spend approval under the cumulative US$5 allowance, after the owner's OpenAI quota is restored);
editing the live planner prompt to carry typed interfaces (OD-259 item 6); a reviewed PAGE_LINES move (OD-257 item 7); one export refusal
code or three (OD-258 item 2); raising the block limit, the specialist cap or adding an editor-chosen workload size (OD-255 item 10,
J7-4 … J7-6); a retroactive ground split with a board re-sync or real sheet paths in PCB publication (OD-255 items 3 and 5); and, before a
required-status-check list exists on `main`, naming `agent-boundary-suites` in it (OD-261: the 54 J suites it runs fail only there).

## Spend

Section J: **US$0** - the ledger has no J entry; every J proof ran in vitest or under the fixture runtime, and this J7 run had the
provider keys unset (the post-apply passes logged `missing_credentials` and answered 503, `validation.md` section 2). The cumulative ledger
(`../live-spend.json`) is unchanged since `deaf15ca` (2026-10-19): 1.3628 USD known of 5.00 (LR-1 0.19, LR-2 0.0028, LR-3 1.17), LR-3's
2.66 USD held for its resume, 0.9772 USD provable remainder.

## CI and browser

PR #16's run at its head `2b8a4f51` (every J commit an ancestor) passed every job; the smallest OD-30 headroom is database-delivery's
11 min 35 s (computed) and agent-boundary-suites' 14 min 25 s (its own line); the J browser cases ran in page-browser-e2e
(`validation.md` section 3). Locally on `e0372e64` the five J browser specs passed in one fresh run, 11 of 11 in 7.5 min, with 0
`ROUTE_FIXTURE_MISS` (section 2).
