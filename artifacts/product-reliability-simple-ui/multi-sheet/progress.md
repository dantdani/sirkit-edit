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
| J4 | project-wide outputs (SPICE, native hierarchical KiCad export) and "Organize into sheets" | — | — |
| J5 | sheet-aware generation (blocks become sheets), sheet-aware inspection and the organise proposal tool; fixture multi-sheet journeys | — | — |
| J6 | workload limits stated truthfully, queue proof (J7-1 .. J7-3) | — | — |
| J7 | CI admission, browser evidence, verdict | — | — |

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
