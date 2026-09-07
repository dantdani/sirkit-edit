# B16.1C — Changed files

Baseline `b7bb6d6a46654fab48daf33cb8b3a163ea360432`; branch `integration/b16-1c-prompt-to-gerber`. Counts are `git diff --numstat` (+/−) for modified files and line counts for new files.

## Modified (13)

| File | +/− | What changed |
|---|---|---|
| `app/api/pcb/qualify/route.ts` | +149/−85 | server-owned component authority, schematic authority, idempotent short-circuit, in-flight guard, CAS on the aggregate revision, real evidence digests, bounded envelopes, `jlcpcb-2l` evidence constants |
| `app/api/pcb/release/route.ts` | +85/−31 | human-admin refusal, current-board check, confirmation pin, release-time profile expiry, ledger record, extended headers/manifest response, bounded envelopes |
| `app/api/pcb-sync/handler.ts` | +27/−4 | `include=manufacturing` on the board read (closed query surface), `PcbSyncManufacturingSummary` (+ `snapshot` head) |
| `app/api/pcb-sync/route.ts` | +10/−2 | shared `stage3BindingRepository`, manufacturing summary reader wired into the board read |
| `app/lib/pcb-sync/durable.ts` | +38/−1 | `getBoardHead`, `getSnapshotHead`, DW→PS conflict translation on `publishBoard` |
| `app/lib/pcb-sync/client.ts` | +23/−0 | `loadBoardWithManufacturing`, `PcbSyncManufacturingTruth` |
| `app/lib/pcb/fab/authority-store.ts` | +11/−1 | `getHead`; `save` returns the verified head |
| `app/lib/pcb/fab/release-gate.ts` | +24/−3 | optional `qualificationAuthority`/`schematicAuthority` on the authority; Gerber job file regenerated from the shipped members |
| `app/lib/pcb/board-identity.ts` | +7/−0 | `pcbDesignInstanceId` (one formula) |
| `app/lib/pcb/lifecycle/owned-operations.ts` | +49/−1 | `"release"` operation kind, `runOwnedRelease` |
| `app/components/pcb/PcbEditor.tsx` | +87/−43 | manufacturing workflow hook + panel, snapshot-head reconciliation, gated "Request release", administrator authorization instead of direct release, truth refresh after adoption |
| `app/page.tsx` | +24/−15 | every generated schematic waits in the review dialog; the dialog states what will change (`describeSchematicProposal`) |
| `app/api/__tests__/b16-0-15-tranche-parity.test.ts` | +95/−20 | superseded mocks/assertions (documented in `superseded-claims.md`); 2 new tests |

## New — production modules (11)

`app/lib/pcb/fab/qualification-authority.ts` (237), `app/lib/pcb/fab/qualification-evidence.ts` (73), `app/lib/pcb/fab/manufacturing-errors.ts` (141), `app/lib/pcb/fab/release-ledger.ts` (91), `app/lib/pcb/fab/independent-archive-verifier.ts` (305), `app/api/pcb-sync/manufacturing-summary.ts` (61), `app/lib/workflow/prompt-to-gerber/types.ts` (129), `app/lib/workflow/prompt-to-gerber/machine.ts` (184), `app/lib/workflow/prompt-to-gerber/review-summary.ts` (39), `app/components/pcb/hooks/useManufacturingWorkflow.ts` (218), `app/components/pcb/ManufacturingWorkflowPanel.tsx` (110).

## New — tests and fixtures (25)

Suites: `acceptance-pipeline.test.ts` (353), `recovery-pipeline.test.ts` (393), `blinker-catalog.test.ts` (82), `machine.test.ts` (146), `review-summary.test.ts` (27), `qualification-authority.test.ts` (124), `manufacturing-errors.test.ts` (87), `release-human-only.test.ts` (63), `b16-1c-invariant-tripwires.test.ts` (125), `manufacturing-workflow-panel.test.tsx` (166).

Fixtures (`app/lib/workflow/prompt-to-gerber/__tests__/fixtures/`): `blinker-catalog.ts` (309), `blinker-electrical.ts` (166), `harness.ts` (104), `route-fixture.ts` (115), `evidence.ts` (25), `blinker-route-fixture.json` (267,454 bytes; 2 recorded router executions), `blinker-route-fixture-recovery.json` (533,879 bytes; 4 executions), and the verbatim official KiCad library copies under `kicad/` (CC-BY-SA-4.0 with the KiCad exception): `Timer_NE555.kicad_sym` (NE555D + NE555P), `R.kicad_sym`, `C.kicad_sym`, `LED.kicad_sym`, `Conn_01x02.kicad_sym`, `SOIC-8_3.9x4.9mm_P1.27mm.kicad_mod`, `R_0805_2012Metric.kicad_mod`, `C_0805_2012Metric.kicad_mod`, `LED_0805_2012Metric.kicad_mod`, `PinHeader_1x02_P2.54mm_Vertical.kicad_mod`.

## New — artifacts (19)

`artifacts/ai-control-plane-b16-1c/`: README.md, pre-edit-counterexamples.md, current-prompt-to-gerber-map.md, workflow-state-machine.md, ui-handler-command-authority-matrix.csv, fresh-browser-hydration-proof.md, component-authority-proof.md, qualification-authority-contract.md, fabrication-profile-sources.md, deterministic-release-contract.md, release-file-manifest.csv, independent-gerber-verification.md, failure-and-recovery-matrix.csv, security-and-human-truth-proof.md, changed-files.md, test-and-validation-report.md, superseded-claims.md, unknowns-and-owner-decisions.md, final-verdict.md.

## Deleted

`app/api/__tests__/_b16-1c-probe.test.ts` (disposable §B probe; never committed) and its probe ZIP under `scripts/output/` (gitignored). No production file was deleted; no preset JSON, schema, migration, or `.github` workflow was modified. `C:\Users\robsa\sirkit` untouched.
