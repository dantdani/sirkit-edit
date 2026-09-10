# B17 — Universal semantic editor, UI and 3D control (`chapter/b17-semantic-editor`, PR #7)

Labels: **CONFIRMED** (executed and measured), **INFERRED** (code reading), **PROPOSED** (designed, not exercised), **RECORDED** (written down without a claim), **UNKNOWN**, **BLOCKED-LIVE-QUALIFICATION**.

| checkpoint | artifact | state |
|---|---|---|
| B17-A rebaseline every current action | `control-classification-contract.md`, `ui-control-inventory.csv`, `ui-control-inventory-summary.json`, B01 matrices regenerated in `artifacts/ai-control-plane-b01/` | CONFIRMED — 554 controls / 58 surfaces classified; six CI gates |
| B17-B view-session command bus | `view-command-contract.md` | CONFIRMED — `sirkit.view-command.v1`, `ViewSessionBus`, 12 gates in CI |
| B17-C PCB 3D semantic control | `3d-command-proof.md`, `evidence/pcb-3d-acceptance.png` | CONFIRMED — `pcb3d.*` commands on the bus; browser proof `e2e/semantic-editor.spec.ts` scenario 1 (found and fixed 2 defects) |
| B17-D canvas navigation and selection | `selection-context-proof.md`, `evidence/pcb-canvas-acceptance.png`, `evidence/schematic-canvas-acceptance.png` | CONFIRMED — `pcb.*` / `schematic.*` / `workspace.*` commands on the bus; versioned selection; browser proof `e2e/semantic-editor.spec.ts` scenarios 2–3 and the full suite (found and fixed 5 defects) |
| B17-E placement, routing, history, import/export parity | `placement-routing-parity.md`, `project-history-model.md` | pending |
| B17-F tool exposure | `tool-exposure.md` | pending |
| validation | `ui-negative-tripwires.md`, browser evidence, `test-and-validation-report.md`, `changed-files.md`, `unknowns-and-owner-decisions.md`, `final-verdict.md` | pending |

Program ledger: `artifacts/remaining-builder-program/`.
