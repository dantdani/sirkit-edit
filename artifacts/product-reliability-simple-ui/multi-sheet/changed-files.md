# Changed files — section J (multi-sheet schematics and workload limits)

[PR-J7, 2026-11-05] Written from git, not from memory: `git show --numstat` and `--name-status` of each of the 17 commits between
`99a68df8` and `e0372e64` (the head this page was written on) that carry section J's work. The commits interleaved with them that are not J - section
K's `7a47d276`, `3d4e439e`, `bb62b797`, `43893342`, `3294a399`, `e0372e64`, the contributor preparation `41b387ae` and the merges
`71d29f5c`, `2b8a4f51`, `0a8d9fb5` - are left out; none of them touches a J path (no `j1-` … `j7-` file, nothing under `multi-sheet/`, no
path naming a sheet). **363 distinct paths, 124 added (123 still present: `lib/__tests__/j5-build-sheet-layout.test.ts` moved to
`app/lib/__tests__/`), per-commit sums +46,145 / -10,141.** The WIP checkpoints and the commits that completed them are both counted, so
the line sums bound the net change from above. The J7 evidence commit and the coverage-matrix regeneration beside it are not counted.

## By commit

| commit | date | what | files | + / - |
|---|---|---|---|---|
| `99a68df8` | 2026-10-22 | J1 + J2: the sheet document, one project connectivity authority, sheet operations, the consumers on it | 82 | +8691 / -239 |
| `91dd2c3c` | 2026-10-22 | J1 integration: 15 confirmed review findings, the BomView banner race, OD-256, OD-257 | 37 | +984 / -85 |
| `6e60efa0` | 2026-10-22 | J1 review fixes: collision diagnostics order, the prose-proof caller ratchet, direction-aware wording | 5 | +142 / -19 |
| `592c62d1` | 2026-10-23 | J3: the Sheets navigator, the page's carriage of the sheet set, the multi-sheet browser proof | 58 | +10068 / -144 |
| `57acc038` | 2026-10-23 | J3 integration: 9 confirmed review findings, the planner's anchor orientation, a generator drift | 29 | +650 / -67 |
| `290e9e5a` | 2026-10-23 | B23 page citations re-pointed after J3 | 2 | +7 / -3 |
| `7676c10d` | 2026-10-23 | J4: SPICE and KiCad export on the project connectivity, per-sheet Tidy, Organize into sheets, rail-label normalisation | 63 | +6963 / -266 |
| `5993dd68` | 2026-10-23 | J4 integration: 11 confirmed review findings, the route-body matrix | 29 | +501 / -92 |
| `11a3154a` | 2026-10-23 | J5 WIP (three builders cut off by the spend limit) | 147 | +5158 / -421 |
| `ebb9435d` | 2026-10-23 | J5: generated results as sheets, the sealed organise proposal, sheet-aware inspect, open-sheet | 74 | +936 / -353 |
| `ab423853` | 2026-10-26 | J5 integration WIP (cut off by a session end) | 24 | +646 / -156 |
| `7d8ef423` | 2026-11-04 | J5 integration: the twelve confirmed review findings fixed and verified | 41 | +299 / -117 |
| `24beea1e` | 2026-11-04 | numbered dismissal of transient errors (PR #16's `j3-multi-sheet` case 4 failure at `7d8ef423`) | 2 | +11 / -6 |
| `053ebaa8` | 2026-11-04 | J7-2: a block waiting only on siblings' held allowance re-queues | 12 | +618 / -44 |
| `89009036` | 2026-11-04 | J7-2 review (seven findings) and J7-9 | 8 | +726 / -45 |
| `2f00d4b3` | 2026-11-04 | J CI admission WIP (cut off by a session end) | 22 | +9662 / -8078 |
| `22db67c9` | 2026-11-04 | J CI admission (OD-261): every J suite in a CI job, the set-asides retired, the split re-measured | 4 | +83 / -6 |

## By area

| area | files (added) | + / - | main files |
|---|---|---|---|
| sheet model, connectivity, operations, layout | 11 (8) | +3791 / -108 | `app/lib/schematic/{sheets,project-connectivity,sheet-operations,sheet-lens,sheet-organization,sheet-tidy,generated-sheets}.ts` (added), `lib/build-sheet-layout.ts` (added); `lib/schematic-types.ts`, `design-checks.ts`, `build-multi-generation.ts` |
| downstream consumers and routes | 19 (2) | +1504 / -331 | `app/lib/kicad-export-hierarchy.ts`, `app/lib/spice/project-nodes.ts` (added); `app/lib/pcb/netlist-bridge.ts`, `lib/{erc,schematic-to-netlist,validate-netlist,netlist-review}.ts`, `app/lib/bom/build.ts`, `app/lib/pcb-sync/{preflight-read,unresolved-instances}.ts`, `app/lib/spice/ir.ts`, `app/lib/kicad-export.ts`; routes `app/api/{export/kicad,simulate,schematic/layout-critic,schematic/cross-verify}/route.ts` (no route added) |
| project state, persistence, history | 11 (4) | +593 / -53 | `app/lib/project/{sheet-navigation-store,sheet-replace-guard,sheet-organization-events,sheet-organization-reauthorization}.ts` (added); `file.ts`, `history-step-state.ts`, `canonical-adoption.ts`, `generation-task-client.ts`, `lib/persistence.ts` |
| editor components and hooks | 10 (6) | +1795 / -47 | `app/components/schematic/{SheetNavigator,SheetBlocksLayer,ScopedNetLabelGlyph,SheetOrganizationReviewCard}.tsx`, `hooks/{useSchematicSheetLens.tsx,sheet-navigation-controller.ts}` (added); `app/components/bom/BomView.tsx`, `app/components/pcb/{PcbEditor,MissingPartsList,SyncButton}.tsx` |
| the page, in place | 1 (0) | +99 / -99 | `app/page.tsx` (9,156 lines before and after) |
| AI tools, registries, view session | 28 (2) | +1503 / -174 | `app/lib/agent/sheet-organization-proposals.ts`, `app/lib/engineering/sheet-organization-proposal.ts` (added); `tool-catalog.ts`, `action-registry.ts`, `control-registry.ts`, `schematic-read.ts`, `executor.ts`, `operations.ts`, `schematic-gesture-coordinator.ts`, `fixture-agent-adapter.ts`, `app/lib/view-session/schematic.ts` |
| generation task, workload, fixture runtime | 10 (1) | +600 / -104 | `app/lib/fixture-runtime/sheet-organization-groups.ts` (added); `app/lib/generation-task/{contracts,store,snapshot,service,vocabulary}.ts`, `worker/{slices,accounting}.ts`, `fixture-runtime/generation-{recipes,policy}.ts` |
| CI, census, scripts | 4 (0) | +170 / -4 | `.github/workflows/deterministic-manufacturing.yml` (OD-261), `app/lib/qualification/threshold-classification.ts`, `app/lib/deployment/flag-inventory.ts`, `scripts/gen-demo-fixtures.ts` |
| vitest suites, fixtures and harnesses | 118 (74) | +23449 / -458 | the 58 `j1-` … `j7-` suites; `_j1-` … `_j5-` fixtures and harnesses; `fixtures/j1-*`, `j2-dimmer-state.json`, `j3-drone-sheets-{state,project}`, `j4-drone-flat-project`; the KiCad hierarchy oracle `app/lib/__tests__/_kicad-hierarchy-oracle.ts` and `bom-banner-dismissal` (the BomView banner race) added; `_l3-worker-fixtures.ts` (`EIGHT_BLOCKS`); 41 existing suites with dated pin moves (`b04`, `b07-4`, `b09`, `b11`, `b16`, `b17`, `b18`, `b19-d`, `b20`, `b21`, `b22`, `b23-a`, `b24`, `l4`, `l6`, `l7`, `pr-d`, `pr-g`, `sync-button`) |
| browser specs | 4 (3) | +1168 / -38 | `e2e/j3-multi-sheet.spec.ts`, `e2e/j5-generated-sheets.spec.ts`, `e2e/j5-organize-proposal.spec.ts` (added); `e2e/multi-tab.spec.ts` (one line) |
| J evidence and screenshots | 23 (22) | +667 / -132 | `multi-sheet/{progress,j3-editor,j5-generation,workload-limits}.md`, 19 screenshots under `multi-sheet/screenshots/` |
| generated manuals | 65 (1) | +441 / -149 | `manuals/sirkit.schematic.propose-sheet-organization.md` (added), the inspect and canvas-navigation manuals, the manifest |
| other evidence, generated maps, decisions | 59 (0) | +10365 / -8444 | the regenerated B01 / B04 / B09 / B11 / B17 / B20 / B21 / B24 maps and inventories, `threshold-census.csv`, `ci-split.md`, `evidence/d0-ptg-timing.xml`, the coverage matrix, OD-255 … OD-259 and OD-261, the ledger |

## Not changed

No migration and no new dependency (`package.json` and the lockfile untouched); no route added (the four edited routes keep their
methods; the 177-route census holds); `app/page.tsx` stays 9,156 lines; no limit value of the generation task moved (`workload-limits.md`);
`C:\Users\robsa\sirkit` untouched.
