# Multi-sheet schematics (runbook section J) — progress ledger

Compact, resumable record of section J (`artifacts/astra-guided-pcb/PROMPT_TO_PCB_RELIABILITY_AND_SIMPLE_UI.md` lines 234-392). Decisions:
OD-255 (defaults) in `artifacts/remaining-builder-program/OWNER_DECISIONS.md`. Branch `codex/astra-foundation`.

## Read-only maps (2026-10-22)

Four maps of the current source (the model, the editor and downstream path, the AI path, the workload limits) found:

- `app/lib/schematic-compiler/{types,hierarchy,graph}.ts` hold a sheet / port / binding vocabulary with ZERO production callers; the
  editor's nets have no ids (geometry), so the compiler's id-binding store cannot be reused, its rules can.
- Net identity is computed in two stages with no single authority: one geometric union that joins same-named labels across the whole
  state (`app/lib/connectivity.ts` `buildNetUnionFind`), then each consumer (PCB publication, ERC, SPICE) re-derives naming and merges
  ground kinds differently (AGND / DGND publish as one "GND" today).
- PCB publication hard-codes `hierarchyPath ["root"]`; the canonical schematic `sirkit.schematic.v1` drops absent optional fields from
  its digest, so an optional sheet set keeps old digests identical.
- Generation tasks plan at most 8 blocks with shared nets and merge them into one flat page.

## Increments

| # | increment | state | evidence |
|---|---|---|---|
| J1 | sheet contract, one project connectivity authority, canonical sheet operations (library only; single-sheet byte identity) | DONE `99a68df8` + integration fixes (15 confirmed review findings: create-sheet changed a design's nets, delete-last-sheet rejoined distinct grounds, sheet-pin-only net name collisions, lens copies lose the brand, replay-context shape, cross-verify 500 -> 422, degenerate golden pins) | `j1-*`, `j2-*` suites; gates: every CI selection, browser jobs, generators, secret scans green at `99a68df8` |
| J2 | consumers on project connectivity (PCB publication, ERC, design checks, BOM, missing parts) with byte-identity proofs | DONE in round 1 (`99a68df8`); SPICE, KiCad export and tidy refuse multi-sheet documents until J4 | `j2-project-consumers`, `j2-consumers-golden`, `j2-*-refusal` |
| J3 | the Sheets navigator, overview, open / create / rename / delete, ports and sheet pins, follow a signal, move to sheet; persistence and undo | DONE and integrated (9 confirmed review findings fixed, among them the PCB editor's board checkpoint dropping the sheet set, the first-sheet camera, the planner's anchor orientation, keyboard access to overview blocks; gates: every CI selection, 157 targeted suites, the whole repo, generators, secret scans, the three browser jobs with OD-30 headroom): page carriage of `sheets` at eleven sites in place (9,156 lines), import hydrates a multi-sheet file, the lens / navigator / blocks / scoped glyphs wired, the AI replace-result guard at five sites (OD-257); three product defects the browser proof found fixed (StrictMode disposal of the controller, the navigator column swallowing canvas clicks, the move preview's Apply below the fold) | `j3-*` suites (sheet lens, navigation store, hook, navigator, page carriage, history step, coordinator, canonical adoption, fixture); `e2e/j3-multi-sheet.spec.ts` 4 cases green with prompt-to-gerber and journey-contract (0 ROUTE_FIXTURE_MISS); evidence `j3-editor.md` |
| J4 | project-wide outputs (SPICE, native hierarchical KiCad export) and "Organize into sheets" | DONE and integrated (OD-258): SPICE deck and Studio IR on the project connectivity with the strict ground rule and scoped probe keys; the hierarchical KiCad export as one deterministic zip through the same route, pins on the block edge, name shadowing / case ambiguity refused; BOM and Missing parts sheet columns; per-sheet Tidy on leaf sheets (the part read covers the whole project, the critic context is the sheet's; Theory symbols and unresolved parts refused before any model call); Organize into sheets as one move-to-sheet transaction with a preview and "check these"; the rail-named label normalisation. 11 confirmed review findings fixed (two high: a sheet-pin wire over a placed pin would have shorted exported ports; the Tidy proof was vacuous with unloaded far-side parts) | `j4-*` suites (SPICE deck isomorphism and IR goldens, export oracle round trips, tidy, organise, normalisation); `e2e/j3-multi-sheet.spec.ts` cases 4-6 (Tidy, Organize); gates: every CI selection, 157 targeted suites, the whole repo, generators, secret scans, the three browser jobs with OD-30 headroom; screenshots `j4-organize-*.png` |
| J5 | sheet-aware generation (blocks become sheets), sheet-aware inspection and the organise proposal tool; fixture multi-sheet journeys | DONE and integrated (OD-259): `7d8ef423` (the twelve confirmed review findings of the J5 round fixed and verified, completing WIP `ab423853`) and `24beea1e` (numbered dismissal of transient errors, so an earlier message's timer no longer clears the Theory refusal: PR #16's `j3-multi-sheet` case 4 failure at `7d8ef423`). A generated multi-sheet result replaces every sheet in one undoable transaction and the review names the replaced sheets; the sealed organise proposal tool and its review card (Approve as one transaction, Undo, Discard); sheet-aware inspect and `schematic.open-sheet`; typed planner interfaces a fixture-only field; every proof fixture-backed at US$0 | the 18 `j5-*` suites (organise proposal tool, inspect sheets and sheet-aware inspect, open sheet and its wiring, organisation proposal, card and events, result-sheets contract and client, pending proposal, sheeted replace transaction, page intake, build sheet layout, generated sheets, organise port names, fixture recipes, review summary); `e2e/j5-generated-sheets.spec.ts`, `e2e/j5-organize-proposal.spec.ts` and `e2e/j3-multi-sheet.spec.ts` (case 4 re-pointed) green in page-browser-e2e at `24beea1e` (run 41824471402); evidence `j5-generation.md` (sections 9.1 and 9.2), screenshots `j5-*.png` |
| J6 | workload limits stated truthfully, queue proof (J7-1 .. J7-3) | J7-1 DONE (round 1, `99a68df8`, integrated `91dd2c3c`): the plan-limit message, the queue clause on the task card, the durable worker's own slot constant, no limit value changed. J7-2 DONE `053ebaa8`: a block refused only by running siblings' held allowance re-queues instead of parking; its review (seven confirmed findings) DONE `89009036`. J7-9 DONE `89009036`: a sibling's end beside a provider-delayed slice no longer refuses the commit. J7-3 (blocks kept as sheets) delivered by J5. J7-4 .. J7-8 open (`workload-limits.md`, remaining bounds). Fixture proof only, US$0 | `j7-queue-beyond-slots` (7 cases), `j7-allowance-contention` (7), `j7-allowance-review` (12), `j7-provider-wait-sibling-end` (2); evidence `workload-limits.md` |
| J7 | CI admission, browser evidence, verdict | CI admission DONE ([PR-J7, 2026-11-04], OD-261, the commit after WIP `2f00d4b3`): every J vitest suite runs in a CI job - the 54 no job selected as exact-path prompt-to-gerber entries moved to agent-boundary-suites, the four J4/J5 suites in prompt-to-gerber by their directory filters (`J4_SET_ASIDE` and `J5_SET_ASIDE` retired), the three J browser specs in page-browser-e2e; the split re-measured once (643 files, 0 failures, the moved set 43.3 %); agent-boundary-suites' red `b22-closeout-statements` at `24beea1e` fixed in the three J7 suite headers. CI figures: the lead's run after the push. Browser evidence and the J verdict: pending | `ci-split.md` section 11.13; `artifacts/ai-control-plane-b24/evidence/d0-ptg-timing.xml`; OD-261 |

## Open items from the J1 review round (2026-10-22)

- A label typed with the editor's label tool is minted `kind: "label"` whatever its name (`app/page.tsx` commitLabelDraft), so a
  design whose return is a ground symbol plus a typed `GND` label reads as one net under the legacy rule and two under the strict
  rule; organising it into sheets is refused with a sentence that names no label. Not introduced by J1 (the planner refused it at
  `99a68df8` too) but a real obstacle: J3-A or J4 must classify a scope-less label whose `inferNetLabelKind` is ground / power as
  that rail (or mint the kind at the label tool with a one-off normalisation) and name the offending labels in the refusal.
- `SHEET_LOCAL_SHADOWS_PORT` also warns for a parent-side sheet pin beside a same-named local label on another net (refuted as a
  defect: the warning is advisory; wording may be narrowed later).

## Open items from the J3 review round (2026-10-23)

- Several page.tsx carriage edits sit as one-liners appended to existing statements to keep the 9,156-line pin; splitting them is the
  owner's reviewed PAGE_LINES move (OD-257 item 7).
- The planner still places sheet pins at the parent-side cut point inside the circuitry rather than on the child block's edge; J4-B's
  KiCad export places the exported pin on the block edge with a two-point wire (OD-258 item 2), and a later planner increment may
  move the editor's pin too.
- Two committed J3 evidence screenshots show the pre-fix anchor orientation; refresh them in the next browser evidence run.

## Open items from the J4 review round (2026-10-23)

- A simulation in flight when the active sheet switches still lands with the previous sheet's bare probe keys (the lifecycle discards
  on the base digest only); the result is cleared on a sheet switch, so the window is one request.
- The hierarchical export carries three name refusals (`EXPORT_SHADOWED_PORT`, `EXPORT_NAME_SHADOWS_GLOBAL`,
  `EXPORT_NAME_CASE_AMBIGUOUS`); OD-258 item 2 named one; the owner may prefer a single code.
- CI admission of the J1-J4 suites and the one re-measurement (OD-254) are the J CI step; `j4-missing-parts-sheets` is set aside in
  `b24-d0-ci-split` until then. [PR-J7, 2026-11-04] Done: every J suite is admitted (OD-261) and the set-aside is retired, measured
  under its `app/lib/pcb-sync/__tests__` filter (`ci-split.md` section 11.13).
