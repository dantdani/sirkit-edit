# Changed files — section L (persistent generation) and section M (component resolution)

[PR-L7, 2026-10-20] Written from git, not from memory: `git diff --numstat` / `--name-status 84a2f72c^ deaf15ca` on
`codex/astra-foundation` (step 0 through the LR-3 record). **522 files: 240 added, 282 modified, +50,390 / -2,691 lines.** Increment 7's
own uncommitted work (this evidence package, the CI admission) is not in these numbers.

## By commit

| commit | what | files | + / - |
|---|---|---|---|
| `84a2f72c` | step 0: the interim 180 s correction integrated (OD-251), PR #16's three CI failures | 42 | +1285 / -75 |
| `aa8b2512` | increment 1: the stall / limit map, the task and worker contract, OD-252 | 4 | +847 / -0 |
| `c8e53499` | increment 2: the durable task store; the proven catalog defects | 31 | +5009 / -61 |
| `382fd59f` | increment 3: the resumable slice core, plan / block / merge, the worker process | 30 | +6015 / -605 |
| `2e938241` | increment 4: the task API and page; M1 server | 222 | +9161 / -653 |
| `03d473f1` | M1 page; the M2 design | 69 | +2749 / -177 |
| `00d03430` | increment 5 (chat on the durable task); M2 implementation | 270 | +10527 / -1399 |
| `ada0b194` | the orchestration browser spec's renamed Stop-answer line | 1 | +1 / -1 |
| `7bf0fa55` | increment 5 + M2 integration: review fixes | 54 | +1287 / -465 |
| `8b76793f` | OD-253 (increment 6 defaults) | 1 | +25 / -0 |
| `2240363a` | increment 6: engine and fixture slices | 76 | +9417 / -226 |
| `e03c532f` | M4: board impact before approval | 31 | +2728 / -67 |
| `9a42c36b` | increment 6 integration: spend bound, input across slices, review fixes | 46 | +1396 / -83 |
| `0f1c446b` | secret scan: the history-only allowlist entry for a placeholder | 3 | +14 / -5 |
| `2a0e3079` | the post-approval Tidy / Review input bound | 24 | +1079 / -39 |
| `3337f3f3`, `deaf15ca` | LR-3 reservation and result (`live-spend.json`) | 1 each | +12 / -2, +9 / -4 |

## By area

| area | files (new) | + / - | main files |
|---|---|---|---|
| generation task: store, service, worker | 17 (17) | +5503 / -0 | `app/lib/generation-task/{store,contracts,checkpoint,service,snapshot,vocabulary,events,runtime}.ts`; `worker/{slices,accounting,worker,progress,runtime,cli}.ts` |
| generation-task and worker routes | 5 (5) | +164 / -0 | `app/api/generation-tasks/route.ts`, `[id]/route.ts`, `[id]/events/route.ts`, `[id]/control/route.ts`; `app/api/generation-worker/route.ts` |
| schematic generation engine and catalog search | 10 (3) | +2424 / -615 | `app/lib/schematic/build-loop-slice.ts` (new, the slice core), `build-multi-generation.ts`, `catalog-slots.ts`, `build-boundary.ts`; `app/lib/build-loop.ts`, `parts-search.ts`, `prompts.ts`, `kicad/categories.ts` |
| LLM adapters and the post-approval passes | 11 (3) | +474 / -24 | `app/lib/llm/{request-input-bound,post-apply-admission,post-apply-refusal}.ts` (new), `openai-provider.ts`, `anthropic-provider.ts`, `types.ts`, `errors.ts`; `app/api/schematic/{layout-critic,review}/route.ts` |
| agent tools and chat | 18 (8) | +1651 / -334 | `app/lib/agent/generation-proposals.ts`, `generation-task-tools.ts`, `instance-inspection-reads.ts`, `candidate-search-reads.ts`, `component-resolution-proposals.ts`, `cad-acquisition-reads.ts`, `fixture-agent-adapter.ts`; `app/api/chat/component-resolution-runtime.ts` |
| component resolution and CAD acquisition | 42 (39) | +6353 / -8 | `app/lib/component-resolution/{compatibility,candidate-search,resolution-assembler,approved-resolution-mutations,board-impact}.ts`, `task/store.ts`, `acquisition/handoff.ts`; `app/lib/acquisition/cad-source-registry.ts`; `app/api/component-resolution-authority`, `app/api/parts/acquisitions` |
| PCB sync, workflow and PCB editor (M4) | 6 (1) | +275 / -37 | `app/lib/pcb-sync/schematic-drift.ts` (new), `reconciliation.ts` (exports in place); `app/lib/workflow/journey.ts`; `app/components/pcb/{PcbEditor,ManufacturingWorkflowPanel,MissingPartsList}.tsx` |
| page and other components | 8 (4) | +1029 / -214 | `app/page.tsx`; `app/components/chat/GenerationTaskStatus.tsx`, `schematic/ComponentResolutionReviewDialog.tsx`, `parts/{CadAcquisitionPanel,ComponentReviewInbox}.tsx` (new) |
| project client state | 10 (6) | +984 / -61 | `app/lib/project/generation-task-client.ts`, `component-resolution-events.ts`, `cad-acquisition-client.ts`, `resolution-approval-controller.internal.ts`, `resolution-board-basis.ts`, `history-step-state.ts` (new); `generation-proposal-events.ts` |
| fixture runtime | 34 (32) | +7402 / -2 | `app/lib/fixture-runtime/generation-{policy,recipes,ports}.ts`; `generation-kicad/` (17 files: verbatim KiCad symbols and footprints from the pinned libraries, one composed ATmega328P-A symbol, `LICENSES.md`); `blinker/catalog.ts` (the published fixture parts); `cad-source/` |
| engineering registries and journal | 13 (0) | +543 / -70 | `app/lib/engineering/tool-catalog.ts`, `tool-manual.ts`, `tool-registry.ts`, `schematic-authority.internal.ts`, `approved-mutation-journal.ts` |
| other app code | 15 (0) | +280 / -72 | `app/lib/atomic/{authoring,server-repository,publication-review}.ts`, `app/api/components/atomic/publication/route.ts`, `app/lib/durable-workflow/{types,effects-runtime,server-repository}.ts` |
| deployment census, CI and configuration | 7 (0) | +54 / -12 | `app/lib/deployment/{flag-inventory,environment-names,secret-scan-allowlist}.ts`, `.env.example` (allowance and post-apply names, commented and empty), `.github/workflows/benchmark.yml`, `package.json` (`worker:generation`, `dev:with-worker`), `playwright.config.ts` |
| scripts | 5 (3) | +272 / -4 | `scripts/generation-worker.ts`, `scripts/dev-with-worker.mjs`, `scripts/generate-cad-source-registry.ts` (new) |
| vitest suites and helpers | 158 (90) | +16928 / -459 | 80 new test files (`l2-*`, `l3-*`, `l4-*`, `l5-*`, `l6-*`, `l7-*`, `m1-*`, `m2-*`, `m4-*`, the step-0 suites) plus helpers; 67 existing test files with pin moves, each with its dated note |
| browser specs | 12 (7) | +1411 / -18 | `e2e/l4-generation-task`, `l5-chat-task`, `l7-drone-vertical-slice`, `l7-second-circuit`, `m1-resolve-missing-parts`, `m2-acquire-missing-part`, `m4-existing-board-resolution` (new); the orchestration spec's one line |
| evidence, manuals and records | 151 (22) | +4643 / -761 | `persistent-generation/` (map, contract, worker, progress), `component-resolution/` (M2 design, M4 page, CAD source registry CSV), 7 new and 57 regenerated manuals, the coverage matrix, 15 screenshots (6 new and 8 refreshed under `screenshots/`, 1 new under `persistent-generation/screenshots/`), regenerated B-chapter maps (b24 17, b21 7, b20 7, others), `live-spend.json`, OD-251..253, the owner's runbook (sections L and M as the owner wrote them) |

## Not changed

No migration (OD-252 item 3: generation tasks live in the existing durable tables); no route policy relaxed (the five generation-task methods, the worker
pump, the resolution-authority read and the two acquisition methods are rows of `app/lib/auth/route-policy.ts`, census 168 -> 177); `C:/Users/robsa/sirkit` untouched; no default model, provider or autonomy change.
