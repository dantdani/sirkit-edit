# B17 — Universal semantic editor, UI and 3D control (`chapter/b17-semantic-editor`, PR #7)

Labels: **CONFIRMED** (executed and measured), **INFERRED** (code reading), **PROPOSED** (designed, not exercised), **RECORDED** (written down without a claim), **UNKNOWN**, **BLOCKED-LIVE-QUALIFICATION**.

| checkpoint | artifact | state |
|---|---|---|
| B17-A rebaseline every current action | `control-classification-contract.md`, `ui-control-inventory.csv`, `ui-control-inventory-summary.json`, B01 matrices regenerated in `artifacts/ai-control-plane-b01/` | CONFIRMED — 554 controls / 58 surfaces classified; six CI gates |
| B17-B view-session command bus | `view-command-contract.md` | CONFIRMED — `sirkit.view-command.v1`, `ViewSessionBus`, 12 gates in CI |
| B17-C PCB 3D semantic control | `3d-command-proof.md`, `evidence/pcb-3d-acceptance.png` | CONFIRMED — `pcb3d.*` commands on the bus; browser proof `e2e/semantic-editor.spec.ts` scenario 1 (found and fixed 2 defects) |
| B17-D canvas navigation and selection | `selection-context-proof.md`, `evidence/pcb-canvas-acceptance.png`, `evidence/schematic-canvas-acceptance.png` | CONFIRMED — `pcb.*` / `schematic.*` / `workspace.*` commands on the bus; versioned selection; browser proof `e2e/semantic-editor.spec.ts` scenarios 2–3 and the full suite (found and fixed 5 defects) |
| B17-E placement, routing, history, import/export parity | `placement-routing-parity.md`, `project-history-model.md`, `evidence/project-timeline.png` | CONFIRMED — shared `sirkit.layout-candidate.v1` for placement/routing (editor, agent, route), preview/apply/discard, clear/reroute selected nets, routed-board revision on B16, project operation timeline with delegated undo, import/export outcome declarations; browser proof scenario 4 |
| B17-F tool exposure | `tool-exposure.md`, `evidence/agent-view-tools.png` | CONFIRMED — the ONE reviewed intentional set (22 tools: reads, sealed proposals, the two shared layout candidates, six view-session bus-command tools, the view/timeline reads); 37 gates re-derived from it; contextual discovery by captured surface / board / role; server-validated view commands executed on the user's own bus; browser proof scenario 5 (found and fixed 1 defect) |
| validation | `ui-negative-tripwires.md`, `evidence/*.png` (5 scenarios), `test-and-validation-report.md`, `changed-files.md`, `unknowns-and-owner-decisions.md`, `final-verdict.md` | CONFIRMED — negative tripwires (518 dispatches, zero engineering mutation, human-only mirrors); full suite 4928/4962 passed + 33 opt-in pending (1 load timeout passes alone); generators idempotent; one real B17-E regression found and fixed (`useAutoPlace.apply` generation check), two pre-existing B16-C.1 test debts resolved; browser suite 6 passed |

Program ledger: `artifacts/remaining-builder-program/`.
