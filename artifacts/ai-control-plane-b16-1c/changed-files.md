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

`app/api/__tests__/_b16-1c-probe.test.ts` (disposable §B probe; never committed) and its probe ZIP under `scripts/output/` (gitignored). No production file was deleted; no preset JSON, schema, migration, or `.github` workflow was modified by B16.1C. `C:\Users\robsa\sirkit` untouched.

## B16-A additions on the same branch (`git diff --stat c82d1cb..8746b46 -- app`, CONFIRMED: 86 files, +6,175/−3,601; plus `850ee3e`…`7d341ff` below) — [B16-A corrected: the sections above describe B16.1C only]

New production modules: `app/lib/stable-compare.ts` (125), `app/lib/pcb/fab/qualification-commit.ts` (82), `app/lib/pcb/fab/qualification-lease.ts` (114), `app/lib/pcb/fab/snapshot-netlist.ts` (48; created as `app/lib/pcb-sync/snapshot-netlist.ts` in `3231f3f`, moved in `e0efcfb`).

Modified production files (what changed): `app/api/pcb/qualify/route.ts` (closed body, lease, snapshot parity, atomic commit, design-scope binding), `app/api/pcb/release/route.ts` (mandatory pins, closed body), `app/lib/auth/trusted-request-context.ts` (per-request correlation id), `app/api/pcb-sync/manufacturing-summary.ts` / `handler.ts` / `route.ts` (integrity per subject, viewer), `app/lib/pcb-sync/client.ts`, `app/components/pcb/hooks/useManufacturingWorkflow.ts`, `app/components/pcb/ManufacturingWorkflowPanel.tsx`, `app/page.tsx` (Tier-2 edits staged in the dialog), `app/lib/pcb/fab/authority-store.ts`, `manufacturing-errors.ts`, `app/lib/pcb-sync/durable.ts`, and the 51 identity-bearing canonicalizers switched to `stable-compare` (`8746b46` stat: `app/lib/pcb/{revision,integrity,pad-identity,pin-pad-mapping,netlist-bridge,board-netlist,net-reconciliation,electrical-truth,connectivity-board}.ts`, `app/lib/pcb/fab/{release-gate,release-manifest,validate-package,qualification-authority,independent-archive-verifier,emit-bom,emit-position}.ts`, `app/lib/pcb/fab/native/*`, `app/lib/pcb/readiness/*`, `app/lib/pcb/autonomous/*`, `app/lib/pcb/autoplace/*`, `app/lib/pcb-sync/*`, `app/lib/physical-binding/*`, `app/lib/durable-workflow/*`, `app/lib/atomic/stable.ts`).

New tests (10 files): `app/lib/auth/__tests__/b16-a-correlation-id.test.ts`, `app/api/pcb/release/__tests__/b16-a-release-confirmation.test.ts`, `app/lib/pcb/fab/__tests__/b16-a-snapshot-netlist-parity.test.ts` (moved with its module in `e0efcfb`), `app/lib/pcb/fab/__tests__/b16-a-qualification-commit.test.ts`, `app/api/__tests__/b16-a-review-corrections-tripwires.test.ts`, `app/lib/pcb-sync/__tests__/b16-a-durable-heads.test.ts`, `app/lib/pcb/fab/__tests__/b16-a-authority-store.test.ts`, `app/lib/pcb/lifecycle/__tests__/b16-a-owned-release.test.ts`, `app/api/pcb-sync/__tests__/b16-a-manufacturing-summary.test.ts`, `app/lib/pcb/__tests__/b16-a-locale-independent-identities.test.ts`. Updated tests: tranche-parity (+3), `b16-1c-invariant-tripwires` (skipIf + CAS pin), `b16-0-8-migration-ratchet` (sha1 ratchet) + `_raw-route-baseline.json` regenerated, the panel test (+5 cases), acceptance/recovery pipelines. Fixtures re-recorded: `blinker-route-fixture.json`, `blinker-route-fixture-recovery.json`.

Committed after `8746b46` (CONFIRMED from `git show --stat`): `850ee3e` — `.github/workflows/deterministic-manufacturing.yml` (new; the FIRST `.github` change on this branch — the B16.1C statement "no `.github` workflow was modified" holds for B16.1C only), `app/lib/workflow/prompt-to-gerber/__tests__/fixtures/expected-identities.ts` + `expected-identities.json` (new), `acceptance-pipeline.test.ts`, `recovery-pipeline.test.ts`, `route-fixture.ts` (pinned identities, `SIRKIT_B16_1C_LIVE_ROUTER`); `4da76b8` — the workflow's evidence path made literal; `e0efcfb` — `snapshot-netlist` moved to `app/lib/pcb/fab/`, `_raw-route-baseline.json`, and the B05/B06 replay fixtures under `artifacts/ai-control-plane-b05/` and `…-b06/` regenerated under the code-point canonicalization; `7d341ff` — `artifacts/ai-control-plane-b11/{evaluation-results,replay-trace-pins}.json` regenerated. The CI job is PROPOSED-until-merged as a `main` gate.

Artifacts in this directory: the 19 files above corrected in place (each correction marked `[B16-A corrected]`) plus the new `b16-a-review-corrections.md` (20 files); identity values are `IDENTITY` placeholders until the orchestrator substitutes the re-recorded values.
