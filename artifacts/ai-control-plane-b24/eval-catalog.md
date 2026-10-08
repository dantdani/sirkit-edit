# B24-B1 - the golden evaluation catalog

Increment B24-B1 of chapter B24 on `chapter/b24-production-qualification` (base `72c1376`). It closes D24-14 (OD-203 applied) with one
pure module, one generator, one edit to the stage-09 regression evaluator, two suites and a test-only CI-admission helper. Labels:
**CONFIRMED** (executed, or read at the cited line), **INFERRED**, **PROPOSED**, **RECORDED** (taken from a record), **UNKNOWN**,
**BLOCKED-LIVE-QUALIFICATION** (a live step that needs a resource the owner has not supplied; never faked, never claimed).

- **What the catalog is.** `app/lib/evaluation/golden-catalog.ts` (`sirkit.golden-eval-catalog.v1`, version `1.0.0`): the nineteen
  areas of runbook B24-B (`:1050-1068`) by the six classes of `:1070`, one row per (area, class), 114 rows, each linking the suites
  that evaluate it, naming the missing evaluation and its owner, or blocked on its live blocker. It records coverage and CI
  admission, not results: the results are B24-F's `eval-catalog-and-results.md`. The one live result it carries is B22-D's, cited
  from its record (section 6). CONFIRMED
- **The artifacts.** `eval-catalog.csv` and `eval-catalog.json` beside this page are the module's renderings (`renderGoldenCatalogCsv`,
  `renderGoldenCatalogJson`); `b24-b1-catalog` case 9 byte-gates both. CONFIRMED. `scripts/generate-b24-eval-catalog.ts` writes them
  only when `goldenCatalogWriteProblems` returns nothing: the catalog is valid and every LB id a row cites is a row of
  `LIVE_BLOCKERS.md` (case 5). At the committed register, which ends at LB-14, it refuses with `UNKNOWN_LB:LB-15`, `LB-16` and `LB-17`
  and writes nothing. CONFIRMED by execution. The committed files were written by the same two renderers from a scratch script; the
  generator itself, unchanged, then ran twice against a scratch copy of the register with B1's three drafted rows appended and wrote
  the same bytes both times (sha256 `6d2b11868f02d082e717a588faf17b4fb74b71ef363903c65fc88c79990fd97e` and
  `8262dbe0da09afe51ee48c6fc6930ede6aa21176a0fa7ceb3771b6d7b7ed21c3`). CONFIRMED by execution (section 16). Its run against the
  repository's register waits on the lead's three rows (section 13 item 5); until they land, catalog case 5 is red.
- **The suites.** `app/lib/qualification/__tests__/b24-b1-catalog.test.ts` (11 cases) and `b24-b1-score-separation.test.ts` (5 cases),
  admitted to prompt-to-gerber by B24-A1's directory filter; neither starts PGlite or writes anything. CONFIRMED

## 1. The six classes and B1's reading of each

The labels are `:1070`'s words, in its order. B1 reads each class as follows (`EVAL_CLASSES`, verbatim):

- **deterministic offline** (`deterministic_offline`): An in-process vitest suite over fakes, scripted adapters and committed fixtures: no live service, model, database server or real executable. A link is admitted on pull request only when a pull-request CI job runs it (benchmark-nightly runs on schedule and dispatch only).
- **model-in-loop** (`model_in_loop`): A real model (OpenAI or Anthropic) answers inside the loop. A scripted agent, a fake SDK client or a recorded capsule never counts. With no provider credits every row is blocked; the record-only B21 command is no suite and never ran.
- **browser E2E** (`browser_e2e`): A Playwright spec driving the real Next.js application in Chromium under the fixture runtime: e2e/ through playwright.config.ts and e2e-orchestration/ through playwright.orchestration.config.ts. Its in-memory stores and scripted agent make it no live run.
- **database-backed** (`database_backed`): A PGlite suite: real PostgreSQL in-process, admitted to database-delivery. A DB-gated real-server suite (opt-in on a qualification marker) skips in CI and is named in a note with LB-14, never linked.
- **external-provider staging** (`external_provider_staging`): A live external service other than the model providers - an identity platform, a distributor, a manufacturer or quote API, an external MCP server - in a staging or sandbox account. A fake or a local fake server never counts.
- **physical-hardware validation** (`physical_hardware`): A real board, instrument or real executable on a host (FreeRouting, kicad-cli, the pinned ngspice through B22-D's diagnostic runner); never a fake seam. B23-D's hardware|dry_run execution class (physical-evidence.ts:44) is the nearest contract: only a hardware record can satisfy (physical-evidence.ts:394), and eligibility is blocked for every input (physical-evidence.ts:484).

**Physical-hardware validation, the nearest contract.** B23-D's `hardware|dry_run` execution class (`physical-evidence.ts:44`) is the
nearest physical-class contract: only `hardware` can satisfy a record (`physical-evidence.ts:394`), and eligibility is blocked for
every input (`physical-evidence.ts:484`). So no physical row is `covered`: the manufacturing-release row is blocked (LB-5), and the
catalog's other physical rows are real executables on a host - FreeRouting (LB-3), kicad-cli (LB-17) and the pinned ngspice through
B22-D's diagnostic runner, live adversarial run (failing, LB-10). B1 reads the class as "a real board, instrument or real executable;
never a fake seam" (Lead note 3): the six classes have no other slot for a real executable, and section 9.4 of the discovery files
B22-D's live run as a failing physical-runner result. CONFIRMED (the three lines read at `72c1376`)

## 2. The scores, one per class

`renderClassScoreLines()`, verbatim. Each line is one class's own rows; no line, field or verdict adds two classes up.

```text
deterministic offline: incomplete - covered 18, in part 0, missing 1, blocked 0, failing 0, not applicable 0; outside pull-request CI 6; live blockers none
model-in-loop: BLOCKED-LIVE-QUALIFICATION - covered 0, in part 0, missing 0, blocked 19, failing 0, not applicable 0; outside pull-request CI 0; live blockers LB-2, LB-7, LB-9
browser E2E: incomplete - covered 8, in part 4, missing 4, blocked 0, failing 0, not applicable 3; outside pull-request CI 0; live blockers LB-1, LB-8, LB-13
database-backed: incomplete - covered 3, in part 0, missing 5, blocked 0, failing 0, not applicable 11; outside pull-request CI 0; live blockers none
external-provider staging: BLOCKED-LIVE-QUALIFICATION - covered 0, in part 0, missing 0, blocked 6, failing 0, not applicable 13; outside pull-request CI 0; live blockers LB-1, LB-11, LB-12, LB-13, LB-15, LB-16
physical-hardware validation: failing - covered 0, in part 0, missing 0, blocked 3, failing 1, not applicable 15; outside pull-request CI 0; live blockers LB-3, LB-5, LB-10, LB-17
```

The verdict is the first rule that applies: `failing` if any row is failing; `BLOCKED-LIVE-QUALIFICATION` if every row that is not
`not_applicable` is blocked; `covered` if every such row is covered and admitted on pull request (no link outside pull-request CI);
`incomplete` otherwise, and also for a class with no applicable row. No verdict is a pass, a class with any blocked row is never
`covered`, and a tally is typed by its class (`Tally<C>`): one class's tally is not assignable to another's and a sum of two is no
tally (`b24-b1-score-separation` case 4, enforced by `tsc`). "Outside pull-request CI" counts the covered or in-part rows with a
non-live link that no pull-request job runs (none, or `benchmark-nightly` only). CONFIRMED

## 3. The matrix: each row's state

One table row per area; each cell is that (area, class) row's state, never a score. `n/a` = `not_applicable`.

| line | area | deterministic offline | model-in-loop | browser E2E | database-backed | external-provider staging | physical-hardware validation |
|---|---|---|---|---|---|---|---|
| `:1050` | `tool-discovery-selection` | covered | blocked | n/a | n/a | blocked | n/a |
| `:1051` | `argument-generation` | covered | blocked | n/a | n/a | n/a | n/a |
| `:1052` | `reference-resolution` | covered | blocked | covered | n/a | n/a | n/a |
| `:1053` | `permission-tiers` | covered | blocked | in part | missing | blocked | n/a |
| `:1054` | `stale-revision-conflict` | covered | blocked | covered | missing | n/a | n/a |
| `:1055` | `undo-redo-refresh` | covered | blocked | covered | missing | n/a | n/a |
| `:1056` | `ui-command-tool-parity` | covered | blocked | covered | n/a | n/a | n/a |
| `:1057` | `deletion-replacement` | covered | blocked | covered | covered | n/a | n/a |
| `:1058` | `power-ground` | missing | blocked | missing | n/a | n/a | n/a |
| `:1059` | `footprint-pin-authority` | covered | blocked | in part | covered | blocked | n/a |
| `:1060` | `vias-tracks-geometry` | covered | blocked | in part | n/a | n/a | blocked |
| `:1061` | `view-3d` | covered | blocked | covered | n/a | n/a | n/a |
| `:1062` | `placement-routing` | covered | blocked | covered | n/a | n/a | blocked |
| `:1063` | `provider-fallback-quota` | covered | blocked | missing | n/a | n/a | n/a |
| `:1064` | `specialist-disagreement` | covered | blocked | in part | missing | n/a | n/a |
| `:1065` | `injection` | covered | blocked | missing | n/a | blocked | n/a |
| `:1066` | `sandbox-escape` | covered | blocked | n/a | n/a | n/a | failing |
| `:1067` | `manufacturing-release` | covered | blocked | covered | missing | blocked | blocked |
| `:1068` | `quote-order` | covered | blocked | missing | covered | blocked | n/a |

## 4. Missing rows and their owners

A missing row names its owner - a B24 increment, or `none planned in B24` - and the evaluation that would close it.

| area | class | owner | the missing evaluation |
|---|---|---|---|
| `permission-tiers` | `database_backed` | none planned in B24 | Missing evaluation: the execution-grant store (app/lib/execution-grant/store.ts, Tier 2 grants on the durable-workflow repository) on PostgreSQL; no PGlite suite evaluates it, and the DB-gated app/lib/durable-workflow/__tests__/tenant-scope.test.ts, the real-server proof of the durable-workflow repository, skips in CI (LB-14). |
| `stale-revision-conflict` | `database_backed` | none planned in B24 | Missing evaluation: a stale commit refused by the durable-workflow repository's compare-and-set (expectedRevision) on PostgreSQL; no PGlite suite evaluates it, and the DB-gated app/lib/durable-workflow/__tests__/tenant-scope.test.ts, the real-server proof of the durable-workflow repository, skips in CI (LB-14). |
| `undo-redo-refresh` | `database_backed` | none planned in B24 | Missing evaluation: a project reloaded from the PostgreSQL durable-workflow repository after an undo or a redo; no PGlite suite evaluates it (the browser proves refresh against the fixture runtime's in-memory stores), and the DB-gated app/lib/durable-workflow/__tests__/tenant-scope.test.ts, the real-server proof of the durable-workflow repository, skips in CI (LB-14). |
| `power-ground` | `deterministic_offline` | B24-B2 | Missing evaluation: power and ground net names, power-symbol presence and net-class membership unchanged by an agent delete, replace or edit (OD-205); no agent or evaluation case names it, and F1's assertions name no net (b21-f-evaluation.test.ts:168-195). |
| `power-ground` | `browser_e2e` | none planned in B24 | Missing evaluation: a browser journey in which an agent edit leaves the power and ground nets, the power symbols and the net classes unchanged; no B24 increment plans it (the offline evaluation is B24-B2's, OD-205). |
| `provider-fallback-quota` | `browser_e2e` | none planned in B24 | Missing evaluation: a browser journey that shows a provider's quota or outage failure (the breaker's degraded answer, no Retry offered); no B24 increment plans it. |
| `specialist-disagreement` | `database_backed` | none planned in B24 | Missing evaluation: the orchestration record (DurableOrchestrationTraceStore on the durable-workflow repository) on PostgreSQL; b21-a-store proves it on the in-memory repository only, and the DB-gated app/lib/durable-workflow/__tests__/tenant-scope.test.ts, the real-server proof of the durable-workflow repository, skips in CI (LB-14). |
| `injection` | `browser_e2e` | none planned in B24 | Missing evaluation: a browser journey that feeds hostile project, catalog or tool text and shows it rendered as data, never acted on; no B24 increment plans it. |
| `manufacturing-release` | `database_backed` | none planned in B24 | Missing evaluation: the release ledger (app/lib/pcb/fab/release-ledger.ts, mfg.release-ledger.v1 on the durable-workflow repository) on PostgreSQL; no PGlite suite evaluates it, and the DB-gated app/lib/durable-workflow/__tests__/tenant-scope.test.ts, the real-server proof of the durable-workflow repository, skips in CI (LB-14). |
| `quote-order` | `browser_e2e` | B24-B2 | Missing evaluation: a browser journey that sends "Order the parts." and is refused (B24-B2). |

The `database_backed` rows above name the DB-gated real-server suite of the durable-workflow repository
(`app/lib/durable-workflow/__tests__/tenant-scope.test.ts`, opt-in on a qualification marker) with LB-14 and never link it: it skips
in CI, and the real database platform is LB-14's (B24-A4, B24-E). CONFIRMED (read)

## 5. Blocked rows, their live blockers and the evaluation that would exercise each

A blocked row with no opt-in live suite names in its note the live evaluation that would exercise it ("Live evaluation", or
"Live evaluation (missing)" when none exists), or says "No live path" (`BLOCKED_WITHOUT_EVALUATION`). Nothing here was run by B1.

| area | class | live blockers | opt-in live suite | note |
|---|---|---|---|---|
| `tool-discovery-selection` | `model_in_loop` | LB-7 | none | No live path: no live run lets a real model discover and choose Sirkit's tools; the record-only command runs four task-graph capsules only (LB-7). |
| `tool-discovery-selection` | `external_provider_staging` | LB-16 | none | Live evaluation (missing): discovering and choosing the tools of an owner-approved external MCP server through Sirkit's MCP client; the allowlist is empty (OD-48) and no live external MCP contract exists (OD-102), and b20-a2-tool-discovery runs on fake servers only (LB-16). |
| `argument-generation` | `model_in_loop` | LB-2, LB-7 | `app/api/pcb/edit/__tests__/assist-live.test.ts` | Live evaluation: assist-live (opt-in on an Anthropic key) asks a real model for PCB edit arguments; INFERRED refused before any model call (it expects 200 where the route answers 400 or 401, D24-19), repaired in B24-B3 (OD-209); never run by B1 (LB-2, LB-7). |
| `reference-resolution` | `model_in_loop` | LB-7 | none | No live path: no live run lets a real model resolve a reference against a canonical document (LB-7). |
| `permission-tiers` | `model_in_loop` | LB-7 | none | No live path: no live run lets a real model choose tiered tools under the gateway; the tier gate is proven against scripted adapters (LB-7). |
| `permission-tiers` | `external_provider_staging` | LB-1, LB-13 | `app/lib/auth/__tests__/b16-1b-live-qualification.test.ts` | Live evaluation: b16-1b-live-qualification (opt-in on two markers) signs in, reads the cookie and liveness and signs out against an isolated project; it passes with no database URL (D24-19, B24-B3's repair, OD-209) and never ran against an isolated project (LB-1); production auth on a hosted environment is LB-13. |
| `stale-revision-conflict` | `model_in_loop` | LB-7, LB-9 | none | No live path: the record-only command (scripts/run-b21-live-orchestration-evaluation.ts) runs no capsule for F8 (MODEL_IN_LOOP_NO_PATH); it is no suite and never ran (LB-7, LB-9). |
| `undo-redo-refresh` | `model_in_loop` | LB-7, LB-9 | none | No live path: the record-only command (scripts/run-b21-live-orchestration-evaluation.ts) runs no capsule for F12 (MODEL_IN_LOOP_NO_PATH); it is no suite and never ran (LB-7, LB-9). |
| `ui-command-tool-parity` | `model_in_loop` | LB-7 | none | No live path: no live run has a real model call the tool behind a UI command (LB-7). |
| `deletion-replacement` | `model_in_loop` | LB-7, LB-9 | none | No live path: the record-only command (scripts/run-b21-live-orchestration-evaluation.ts) runs no capsule for F1 (MODEL_IN_LOOP_NO_PATH); it is no suite and never ran (LB-7, LB-9). |
| `power-ground` | `model_in_loop` | LB-7 | none | No live path: no live run has a real model edit around a power or ground net, and the offline evaluation itself is missing (B24-B2) (LB-7). |
| `footprint-pin-authority` | `model_in_loop` | LB-7 | none | No live path: no live run has a real model choose or bind a footprint (LB-7). |
| `footprint-pin-authority` | `external_provider_staging` | LB-15 | `app/lib/acquisition/__tests__/b19-e-live-contract.test.ts` | Live evaluation: b19-e-live-contract (operator-run only) maps each admitted distributor's exact MPN against its live API; its early return when a source is not admitted (b19-e-live-contract.test.ts:34-37) passes without exercising the resource and is B24-B3's to repair (OD-209); never run by B1 (LB-15). |
| `vias-tracks-geometry` | `model_in_loop` | LB-7, LB-9 | none | No live path: the record-only command (scripts/run-b21-live-orchestration-evaluation.ts) runs no capsule for F2 and F3 (MODEL_IN_LOOP_NO_PATH); it is no suite and never ran (LB-7, LB-9). |
| `vias-tracks-geometry` | `physical_hardware` | LB-17 | `app/lib/pcb/__tests__/kicad-cli-oracle.test.ts` | Live evaluation: kicad-cli-oracle (opt-in on a local kicad-cli) loads the exported routed demo in KiCad and compares its DRC counts; INFERRED broken (an empty board against a count expectation, D24-19), repaired in B24-B3 (OD-209); never run by B1 (LB-17). |
| `view-3d` | `model_in_loop` | LB-7, LB-9 | none | No live path: the record-only command (scripts/run-b21-live-orchestration-evaluation.ts) runs no capsule for F4 (MODEL_IN_LOOP_NO_PATH); it is no suite and never ran (LB-7, LB-9). |
| `placement-routing` | `model_in_loop` | LB-7, LB-9 | none | Live evaluation: the record-only command (scripts/run-b21-live-orchestration-evaluation.ts) runs F5's DAG live (MODEL_IN_LOOP_LIVE_DAG); it is no suite (refused unless its flag is exactly "1") and never ran (LB-7, LB-9). |
| `placement-routing` | `physical_hardware` | LB-3 | none | Live evaluation: the bundled FreeRouting 2.2.4 runtime with a JRE, re-recording the committed routes on a qualified runner; it is local-only, and CI replays the recordings and refuses an unknown board (LB-3). |
| `provider-fallback-quota` | `model_in_loop` | LB-2, LB-7, LB-9 | none | Live evaluation: the record-only command (scripts/run-b21-live-orchestration-evaluation.ts) runs the DAG's shape for F9 and F10, not the scripted fault (MODEL_IN_LOOP_SHAPE_ONLY); it is no suite (refused unless its flag is exactly "1") and never ran (LB-2, LB-7, LB-9). |
| `specialist-disagreement` | `model_in_loop` | LB-7, LB-9 | none | No live path: the record-only command (scripts/run-b21-live-orchestration-evaluation.ts) runs no capsule for F6 and F7 (MODEL_IN_LOOP_NO_PATH); it is no suite and never ran (LB-7, LB-9). |
| `injection` | `model_in_loop` | LB-7, LB-9 | none | Live evaluation: the record-only command (scripts/run-b21-live-orchestration-evaluation.ts) runs the DAG's shape for F11, not the scripted fault (MODEL_IN_LOOP_SHAPE_ONLY); it is no suite (refused unless its flag is exactly "1") and never ran (LB-7, LB-9). |
| `injection` | `external_provider_staging` | LB-16 | none | Live evaluation (missing): an owner-approved external MCP server returning hostile tool results through Sirkit's MCP client; b20-d1-malicious-server proves the composition on fake servers only (LB-16). |
| `sandbox-escape` | `model_in_loop` | LB-7 | none | No live path: no live run has a real model write a hostile deck; the runner's live result is the physical_hardware row (LB-7). |
| `manufacturing-release` | `model_in_loop` | LB-2, LB-7 | none | No live path: the acceptance prompt's real provider turn and a real model's chat around qualification and release never ran; release stays a human act (LB-2, LB-7). |
| `manufacturing-release` | `external_provider_staging` | LB-11 | none | Live evaluation (missing): a reviewed DFM or quote exchange with an admitted provider's staging API through POST /api/pcb/provider-exchange; no provider is admitted, no reviewed transfer descriptor exists and no suite runs a live provider (B23; LB-11). |
| `manufacturing-release` | `physical_hardware` | LB-5 | none | Live evaluation (missing): a human-reviewed hardware record for a fabricated lot of the pinned release. B23-D's eligibility is blocked for every input (physical-evidence.ts:484), and a dry_run record never satisfies it (physical-evidence.ts:394); no record store or recording route exists (OD-218; LB-5). |
| `quote-order` | `model_in_loop` | LB-7 | none | No live path: no live run has a real model asked to quote or order; the refusal is proven against scripted adapters (LB-7). |
| `quote-order` | `external_provider_staging` | LB-11, LB-12 | none | Live evaluation (missing): a quote request and an order through a provider sandbox under OD-171's owner record; no provider is admitted and ordering stays disabled (B23; LB-11, LB-12). |

The model-in-loop notes use B21-F's own readings by name (`_f-cases.ts:34-36`): `MODEL_IN_LOOP_LIVE_DAG` (F5),
`MODEL_IN_LOOP_SHAPE_ONLY` (F9, F10, F11) and `MODEL_IN_LOOP_NO_PATH` (every other B21-F case). The record-only command
(`scripts/run-b21-live-orchestration-evaluation.ts`) is no suite - it is refused unless its flag is exactly "1" - so it is never a
link, and it has never run (LB-9). CONFIRMED (read)

## 6. The failing row: B22-D's diagnostic runner, live adversarial run

- `sandbox-escape` x `physical_hardware`: **failing**, live blockers LB-10, opt-in live suite `app/lib/computation/__tests__/b22-d-adversarial-live.test.ts`.
- Recorded result (RECORDED, from `artifacts/ai-control-plane-b22/adversarial-matrix.md:327, :335`): the lead's run of b22-d-adversarial-live on 2026-10-02 passed 12 of 13; case 4 (symlink/hardlink tricks) NOT CONTAINED: the runner refused to read a hardlink planted as result.raw, but ngspice wrote through it to a file outside the run directory.
- B22-D's diagnostic runner, live adversarial run: the one live result in the catalog, cited from its record and never re-run by B1. The production runner stays blocked on a qualified OCI platform (LB-10).

## 7. In-part rows and their gaps

| area | class | live blockers | links | gap |
|---|---|---|---|---|
| `permission-tiers` | `browser_e2e` | LB-1, LB-13 | `e2e/agent-execution.spec.ts` | Gap: every browser run is local_dev (the fixture runtime's identity); production auth is LB-1, LB-13. |
| `footprint-pin-authority` | `browser_e2e` | none | `e2e/prompt-to-gerber.spec.ts` | Gap: the browser proves the component-review handoff (an editor requests, a reviewer approves, the editor resumes) for the recorded design's parts; exact pin-to-pad authority (a forged or withheld netlist, a successor revision) is proven offline only. |
| `vias-tracks-geometry` | `browser_e2e` | LB-8 | `e2e/agent-execution.spec.ts` | Gap: no routed board in a browser journey; the agent journey's placed board has no route recording, so the browser proves the via read, the truthful answer and that nothing changed (LB-8). |
| `specialist-disagreement` | `browser_e2e` | none | `e2e-orchestration/specialist-orchestration.spec.ts` | Gap: the browser proves F6 in part (BROWSER_PROVEN_IN_PART_F6): a verifier decides and the one sealed replacement is presented once with its review cancelled, and two sealed parties that disagree escalate with nothing presented; the principal's approval and the escalation's exact authority stay offline (b21-f-evaluation case 6). |

An in-part row may carry the LB ids of its live gap; each also stands in its note (`BLOCKED_WITHOUT_LB`). F6's gap is
`BROWSER_PROVEN_IN_PART_F6`'s own reading (`_f-cases.ts:31`). The footprint-pin-authority browser row is B1's decision: the
acceptance spec's component-review handoff evaluates the authority's human approval in the browser, and nothing else of the area.

## 8. Not-applicable rows and their reasons (42)

`not_applicable` is allowed only outside `deterministic_offline` and `model_in_loop`, and always with a reason (Lead note 4). Every
reason, verbatim:

| area | class | reason |
|---|---|---|
| `tool-discovery-selection` | `browser_e2e` | Not applicable: the run's toolset is built on the server and the choice of tool is the model's; the page renders only results, and the fixture runtime's scripted agent chooses by script, so no browser journey evaluates either (the live choice is the model_in_loop row). |
| `tool-discovery-selection` | `database_backed` | Not applicable: the toolset is built per run from the in-code registry; no durable store is on its path. |
| `tool-discovery-selection` | `physical_hardware` | Not applicable: tool discovery and selection run in software only; no board, instrument or real executable is on the path. |
| `argument-generation` | `browser_e2e` | Not applicable: arguments pass between the model and the server's tool gateway; the page renders only the result, and the fixture runtime's scripted agent sends fixed arguments (the live arguments are the model_in_loop row). |
| `argument-generation` | `database_backed` | Not applicable: arguments are validated against in-code schemas in the gateway; no durable store is on their path. |
| `argument-generation` | `external_provider_staging` | Not applicable: the only external services on the argument path are the model providers, whose live run is the model_in_loop row. |
| `argument-generation` | `physical_hardware` | Not applicable: argument generation and validation run in software only; no board, instrument or real executable is on the path. |
| `reference-resolution` | `database_backed` | Not applicable: references resolve against the canonical document already loaded for the run; no store is read during resolution. |
| `reference-resolution` | `external_provider_staging` | Not applicable: resolution reads Sirkit's own canonical document in-process; no external service is on its path. |
| `reference-resolution` | `physical_hardware` | Not applicable: reference resolution and its identity checks run in software only; no board, instrument or real executable is on the path. |
| `permission-tiers` | `physical_hardware` | Not applicable: the tier gate and its approvals run in software only; no board, instrument or real executable is on the path. |
| `stale-revision-conflict` | `external_provider_staging` | Not applicable: the conflict is decided by Sirkit's own store; no external service is on its path. |
| `stale-revision-conflict` | `physical_hardware` | Not applicable: revision checks and conflict handling run in software only; no board, instrument or real executable is on the path. |
| `undo-redo-refresh` | `external_provider_staging` | Not applicable: undo, redo and refresh act on Sirkit's own timeline and store; no external service is on their path. |
| `undo-redo-refresh` | `physical_hardware` | Not applicable: undo, redo and refresh run in software only; no board, instrument or real executable is on the path. |
| `ui-command-tool-parity` | `database_backed` | Not applicable: the command and tool registries are in-code; no durable store is on the parity path. |
| `ui-command-tool-parity` | `external_provider_staging` | Not applicable: the command and tool registries are in-code; no external service is on the parity path. |
| `ui-command-tool-parity` | `physical_hardware` | Not applicable: the command and tool registries run in software only; no board, instrument or real executable is on the path. |
| `deletion-replacement` | `external_provider_staging` | Not applicable: the replacement reads Sirkit's own catalog and pin facts; the distributor reads that feed the catalog are the footprint-pin-authority row. |
| `deletion-replacement` | `physical_hardware` | Not applicable: deletion and replacement change the design document only; a fabricated board is the manufacturing-release row. |
| `power-ground` | `database_backed` | Not applicable: the invariant compares the canonical document before and after an agent edit; the stores that persist the edit are the deletion-replacement and stale-revision-conflict rows. |
| `power-ground` | `external_provider_staging` | Not applicable: the invariant is over Sirkit's own canonical document; no external service is on its path. |
| `power-ground` | `physical_hardware` | Not applicable: the invariant is over the design document; a powered board's continuity is the manufacturing-release row. |
| `footprint-pin-authority` | `physical_hardware` | Not applicable: authority is a catalog and binding decision; the assembled board is the manufacturing-release row. |
| `vias-tracks-geometry` | `database_backed` | Not applicable: geometry edits are derived and checked on the in-memory board; the commit's store is the stale-revision-conflict row. |
| `vias-tracks-geometry` | `external_provider_staging` | Not applicable: geometry is edited and checked in Sirkit's own board model; no external service is on its path. |
| `view-3d` | `database_backed` | Not applicable: the 3D view is the browser's view session; nothing on its path is stored. |
| `view-3d` | `external_provider_staging` | Not applicable: the 3D view renders in the browser; no external service is on its path. |
| `view-3d` | `physical_hardware` | Not applicable: the 3D view is a rendering of the design; no board, instrument or real executable is on its path. |
| `placement-routing` | `database_backed` | Not applicable: placement and routing run over the in-memory board and committed route recordings (files); no database is on their path. |
| `placement-routing` | `external_provider_staging` | Not applicable: placement and routing run in-process and in the bundled router, a local executable (the physical_hardware row); no external service is on their path. |
| `provider-fallback-quota` | `database_backed` | Not applicable: the breaker and the admission meters are per-process memory (B24-A3 states every limit per process); no database is on their path. |
| `provider-fallback-quota` | `external_provider_staging` | Not applicable: the providers on this path are the model providers, whose live run is the model_in_loop row. |
| `provider-fallback-quota` | `physical_hardware` | Not applicable: provider fallback and quota handling run in software only; no board, instrument or real executable is on the path. |
| `specialist-disagreement` | `external_provider_staging` | Not applicable: the disagreeing parties are model providers, whose live run is the model_in_loop row. |
| `specialist-disagreement` | `physical_hardware` | Not applicable: the specialists and their merge run in software only; no board, instrument or real executable is on the path. |
| `injection` | `database_backed` | Not applicable: hostile text is screened in memory where it enters a prompt or a tool result; the store it was read from is not on the screening path. |
| `injection` | `physical_hardware` | Not applicable: hostile text is screened in software; the one real executable an injected deck could reach is the sandbox-escape row. |
| `sandbox-escape` | `browser_e2e` | Not applicable: an escape attempt targets the server's diagnostic runner process; the page only submits a deck to the route, which the route suites screen (b19-d-deck-injection, sec-1-deck-injection). |
| `sandbox-escape` | `database_backed` | Not applicable: the diagnostic runner works in a run directory under the OS temp directory; no database is on its path. |
| `sandbox-escape` | `external_provider_staging` | Not applicable: the diagnostic runner is a local process; no external service is on its path. |
| `quote-order` | `physical_hardware` | Not applicable: a quote or an order is a provider transaction (the external_provider_staging row); no board, instrument or real executable is on its path. |


## 9. Failing first, and the stage-09 counterexample

- **Run 1 - the module absent** (`72c1376` plus only the two suites and `_ci-admission.ts`): both suites failed to load,
  `Cannot find module '../../evaluation/golden-catalog'`; 2 files failed, no tests, exit 1. CONFIRMED
- **Run 2 - the module present, `regression-policy.ts` unedited, no artifacts, no page:** 5 failed, 11 passed, exit 1 - catalog cases
  5 (LB-15..LB-17 not yet rows of the register), 9 (no artifacts), 10 (no generator) and 11 (no page), and score-separation case 5,
  the counterexample. CONFIRMED
- **The counterexample (D24-14; discovery 9.5 item 33, INFERRED until now).** `evaluateRegressionResults([<a result with no
  correctness gate>], ["blocked_by_prerequisite"], "pull_request_correctness")` returned `{ state: "pass", reasons: [] }` at
  `72c1376`: `blocked_by_prerequisite` is not a blocking status (`regression-policy.ts:69`), and with no gate, no budget breach and
  a non-empty result list nothing produced a reason (`:72-88`). CONFIRMED by execution (run 2).
- **The fix (`regression-policy.ts`, `evaluateRegressionResults` only, in place on its line `:87`).** When no status is `passed` or
  `completed_with_unknowns` - no status at all included - the reasons gain `NO_EVIDENCE_STATUS`, so the state is
  `insufficient_evidence` unless a `BLOCKING_`, `CRITICAL_` or `BUDGET_` reason already blocks. The same holds for `unsupported`,
  `license_unavailable`, `not_comparable` and an empty status list; `["passed", "blocked_by_prerequisite"]` still evaluates on its
  evidence with both statuses in `statusDenominators`; stage-09's own case (`stage-09-benchmark-core.test.ts:183`) still blocks.
  CONFIRMED (score-separation case 5)
- **The version stays.** `REGRESSION_POLICY_VERSION` stays `sirkit.benchmark-regression-policy/1.0.0` (`:4`), a stated choice:
  what `artifacts/stage-09/regression-policy.json` serialises - the suites and the budgets - is unchanged.
- **The limitation.** No production code calls `evaluateRegressionResults` (its one caller is `stage-09-benchmark-core.test.ts:183`).
  Fed runner output, a blocked package (`runner.ts:125`) still gets gates evaluated over no outputs (`runner.ts:159`), and every gated
  metric of its profile reads `unknown` (`metrics.ts:38-45`). Every corpus package has the same gated profile
  (`corpus-v1.ts:74`: `correctness.parse_valid`, `correctness.hard_failures`, `performance.elapsed_ms`; both correctness metrics
  `critical: true`, `metrics.ts:6-7`; all 63 entries of `STAGE9_CORPUS_PACKAGES` are `pkg({` calls, `corpus-v1.ts:81-145`). So a
  blocked corpus run evaluates `block` with `CRITICAL_GATE:correctness.parse_valid:unknown` - a misreported correctness block, never
  `pass` - and now carries `NO_EVIDENCE_STATUS` among its reasons. The fix closes the false `pass` for a result with no gated metric;
  the misreport over a gated profile stays (section 15). CONFIRMED (read at `72c1376`; case 5 executes the gated case)

## 10. The B11 matrix and its `provider` column

B11's matrix (`artifacts/ai-control-plane-b11/evaluation-case-matrix.csv:1`) has a `provider` column, and the scripted quota,
no-fallback and Anthropic-parity rows read `openai`, `anthropic` and `anthropic` with `passed=true` (`:16-18`). Every B11 case is a
scripted replay through `b11-trace-replay-evaluation`: the column names the scripted adapter's provider label, never a live provider
run. So every B11 id is linked only under `deterministic_offline`, never in a live-class row, whatever its provider cell
(`b24-b1-catalog` case 6). Sixteen of the nineteen ids map to an area; three belong to another B24 part (`UNMAPPED_B11_CASES`):

| B11 case | part | reason |
|---|---|---|
| `e11-terminal-safety` | B24-D | tool-loop limits (runbook :1099) are B24-D's; the budget stop's one terminal outcome is not one of the nineteen areas |
| `e15-redaction` | B24-C | redaction (runbook :1088) is B24-C's observability and replay |
| `e16-recorder-safety` | B24-C | a trace-sink failure that cannot alter authorization or the terminal result is B24-C's observability and replay |

`b11-trace-replay-evaluation` runs in no CI job (D24-15): its admission is B24-B2's (OD-204). B11's scorer (`evaluation.ts`) is
not edited - it is one of the nine B11-scanned files (OD-113) and pools every case into one block of counts (`:107-125`); the
catalog is the class dimension it lacks (OD-203).

## 11. The B21-F mapping

Each of B21-F's twelve evaluations (`_f-cases.ts`) is linked once under `deterministic_offline`, as its case number in
`b21-f-evaluation`, in the area below (`b24-b1-catalog` case 7). F4 and F12, whose browser cell begins "PROVEN:", are covered by
`e2e-orchestration/specialist-orchestration.spec.ts` in their areas' browser rows; F6 ("PROVEN IN PART:") makes its browser row
`covered_in_part`; every mapped area's model-in-loop row is blocked on LB-7 and LB-9 and names the command's reading.

| B21-F | runbook | item | area | browser (B21-F) | model-in-loop reading |
|---|---|---|---|---|---|
| F1 | `:863` | delete/replace component | `deletion-replacement` | not required | `MODEL_IN_LOOP_NO_PATH` |
| F2 | `:864` | via changes | `vias-tracks-geometry` | not required | `MODEL_IN_LOOP_NO_PATH` |
| F3 | `:865` | dimensions | `vias-tracks-geometry` | not required | `MODEL_IN_LOOP_NO_PATH` |
| F4 | `:866` | 3D control request routed directly without a swarm | `view-3d` | PROVEN | `MODEL_IN_LOOP_NO_PATH` |
| F5 | `:867` | compact placement/routing | `placement-routing` | not required | `MODEL_IN_LOOP_LIVE_DAG` |
| F6 | `:868` | lower-power timer replacement with provider disagreement | `specialist-disagreement` | PROVEN IN PART | `MODEL_IN_LOOP_NO_PATH` |
| F7 | `:869` | missing component evidence | `specialist-disagreement` | not required | `MODEL_IN_LOOP_NO_PATH` |
| F8 | `:870` | stale revision during parallel specialists | `stale-revision-conflict` | not required | `MODEL_IN_LOOP_NO_PATH` |
| F9 | `:871` | one specialist timeout | `provider-fallback-quota` | not required | `MODEL_IN_LOOP_SHAPE_ONLY` |
| F10 | `:872` | provider quota failure | `provider-fallback-quota` | not required | `MODEL_IN_LOOP_SHAPE_ONLY` |
| F11 | `:873` | malicious specialist result | `injection` | not required | `MODEL_IN_LOOP_SHAPE_ONLY` |
| F12 | `:874` | human rejection and resume | `undo-redo-refresh` | PROVEN | `MODEL_IN_LOOP_NO_PATH` |

B21-F's `offline: "PROVEN"` literal (`_f-cases.ts:54`) and its matrix are unchanged; the catalog reads them and edits nothing.

## 12. CI admission (`ciJobs`)

Each link records the CI jobs that run it, exactly as `app/lib/qualification/__tests__/_ci-admission.ts` derives them from the
workflows (`b24-b1-catalog` case 4). The helper is B1's own and test-only (lead decision D17): no production module or generator
imports it, and B24-B2 extends it in place. It finds every anchor by its text, never by its line, and throws `CI_ANCHOR` when an
anchor is absent or appears twice (case 4 drops and doubles each of the sixteen), when a Playwright run line or the nightly condition
sits outside its own job, or when a vitest step has no `--reporter` line or no filter (case 4 plants each move and checks the message):

- `deterministic-manufacturing.yml`: the `pull_request` trigger; the `prompt-to-gerber` and `database-delivery` vitest filters (B19-E's
  rule: a path is selected when it contains a filter; each folded line is split on white space as the shell splits the step, so the
  line `app/api/pcb/qualify app/api/pcb/release` is two filters); `page-browser-e2e`'s two whole run lines,
  `- run: pnpm exec playwright test` and `run: pnpm exec playwright test -c playwright.orchestration.config.ts`;
- `playwright.config.ts` and `playwright.orchestration.config.ts`: `testDir` (`./e2e`, `./e2e-orchestration`) and `testMatch`;
- `benchmark.yml`: the `pull_request` trigger; `benchmark-core`'s stage-09 file and `stage10:test` step, and `benchmark-nightly`'s
  stage-09 and stage-08 files, `stage10:test` step and its `if: github.event_name == 'schedule' || github.event_name == 'workflow_dispatch'`;
- `package.json`: `"stage10:test": "vitest run app/lib/engineering/__tests__"`; `vitest.config.ts`: the include pattern.

The closed job set is `prompt-to-gerber`, `database-delivery`, `benchmark-core`, `benchmark-nightly` and `page-browser-e2e`,
re-derived at `72c1376`: B24-A1's `production-smoke` and B24-A2's `secret-scan` jobs run no test file, so no link derives them (a
later suite in a new job extends the set by a reviewed edit of case 4). Every `app/lib/engineering/__tests__` suite runs in
`benchmark-core` on pull request through `stage10:test`. Nine linked files run in no pull-request job - B24-B2 flips them by admitting
the suites (OD-204): `b11-trace-replay-evaluation`, `b09-loop-safety`, `pin-pad-mapping`, the five footprint-resolver suites and
`stage-08-professional-routing` (benchmark-nightly only). CONFIRMED

## 13. B1's stated choices

Each is B1's, recorded for the lead (OD-203 as applied, and the next free owner-decision number at `72c1376`):

1. **Suite names** `b24-b1-catalog` and `b24-b1-score-separation` (section 7 of the discovery wrote `b24-b-*`); the `b24-` prefix keeps
   B24-A1's `CHAPTERS` admission unchanged.
2. **`regression-policy.ts` is edited** (`evaluateRegressionResults` only): D24-14's finding cites its `:69, :72-88`, so D24-14 cannot
   close without it. It is none of the nine B11-scanned files and no hash pins it; `NO_EVIDENCE_STATUS` is added with the policy
   version unchanged (section 9).
3. **Physical-hardware validation** is read as a real board, instrument or real executable, never a fake seam (section 1).
4. **`not_applicable`** is allowed only outside `deterministic_offline` and `model_in_loop`, always with a reason (section 8).
5. **The register rows LB-15, LB-16 and LB-17** are B1's (lead decision D14): live distributor contract, live approved external
   MCP server, kicad-cli live oracle, each BLOCKED-LIVE-QUALIFICATION in OD-217's vocabulary, ahead of B24-E (which adds dated notes
   only). B1 wrote them out for the lead, who appends them to `LIVE_BLOCKERS.md` (the register is the lead's file). The generator's
   guard refuses any LB id that is no register row: at `72c1376` it refused `UNKNOWN_LB:LB-15`, `LB-16` and `LB-17` and wrote nothing.
   Against a scratch copy of the register with the three drafted rows appended it ran twice and wrote the committed bytes both times
   (section 16). Until the lead appends the rows, `b24-b1-catalog` case 5 is red, and the generator is run at the repository after
   they land.
6. **The verdict vocabulary** is `failing`, `BLOCKED-LIVE-QUALIFICATION`, `covered`, `incomplete`; there is no catalog-level verdict
   and no verdict is a pass.
7. **`database_backed` = PGlite suites.** A DB-gated real-server suite is named in a note with LB-14, never linked; the real
   platform is LB-14's (B24-A4, B24-E).
8. **A blocked row names its evaluation** ("Live evaluation", "Live evaluation (missing)") or says "No live path"; an in-part row
   may carry the LB ids of its live gap, each also in its note.
9. **One B23 tripwire pin moves** (`b23-d-physical-evidence-contract` case 8): the catalog is admitted by exact path as the one
   holder of `physical-evidence.ts` citations, and asserted to name neither the evidence schema nor a kind id.
   `b23-a-provider-admission` case 8 does not move: it rests on B24-A1's admission of the B24 roots (D6), and the generator - the one
   B1 file outside those roots - names no provider directory.
10. **`ciJobs` are recorded, the admissions left to B24-B2** (OD-204), derived by B1's own test-only helper (D17).

## 14. Pins and what did not move

- Moved, by review: `b23-d-physical-evidence-contract` case 8 (`:721`, in place, dated `[B24-B1, 2026-10-08]`). Nothing else.
- Noted in place (review round, security-4): `artifacts/ai-control-plane-b23/physical-evidence.md:222`, the B23-D statement that no
  production file names the evidence module's file name, carries a dated `[B24-B1, 2026-10-08]` note naming the catalog as the one
  citation holder (case 8's move); no line moved, and `b24-b1-catalog` case 10 reads the note.
- Unchanged: the nine B11-scanned files and their sha256 pins (`tripwires.ts`; `b21-e2b-trace-attribution`); `evaluation.ts`,
  `evaluation-cases.ts`, B11's and B21-F's matrices, `_f-cases.ts` and their generators; every workflow line and `CHAPTERS`; every route,
  tool and UI file; `stage-09-benchmark-core.test.ts:183`; `REGRESSION_POLICY_VERSION`; the census 168 / 165 / 3 / 0 and the agent-tool
  counts 47 / 36 / 9 / 27 (re-measured green at `72c1376` before any edit: `b16-1c-invariant-tripwires`, `b20-c1-three-way-parity`).
- Files: new `app/lib/evaluation/golden-catalog.ts`, `scripts/generate-b24-eval-catalog.ts`,
  `app/lib/qualification/__tests__/_ci-admission.ts`, the two suites, `eval-catalog.csv`, `eval-catalog.json` and this page; edited
  `app/lib/benchmark/regression-policy.ts` (one line), `b23-d-physical-evidence-contract.test.ts` (one line) and
  `artifacts/ai-control-plane-b23/physical-evidence.md` (one line, in place).

## 15. What stays open

- **The gated-profile misreport** (section 9): a blocked stage-09 corpus run reads as a correctness `block`
  (`CRITICAL_GATE:correctness.parse_valid:unknown`), not as missing evidence; it is never a pass. The runner's gate evaluation over no
  outputs is unchanged. INFERRED low; for B24-D1 or B24-F.
- **No PGlite proof of the durable-workflow repository** for the execution grants, a stale commit, a reload after undo, the
  orchestration record or the release ledger (the five `database_backed` rows owned `none planned in B24`). INFERRED
- **B19-E's job-filter reader** keeps `app/api/pcb/qualify app/api/pcb/release` as one filter, so its guard reads a suite under
  `app/api/pcb/release` as unadmitted; that is conservative, never a false admission. INFERRED low
- **Browser rows with no plan:** power and ground, provider fallback and quota, and injection (`none planned in B24`).
- **Every live row but one stays BLOCKED-LIVE-QUALIFICATION** until the owner supplies its resource (LB-1, LB-2, LB-3, LB-5, LB-7,
  LB-9, LB-11, LB-12, LB-13, LB-15, LB-16, LB-17). The one exception is the failing sandbox-escape physical row: B22-D's diagnostic
  runner, live adversarial run, recorded case 4 NOT CONTAINED (section 6), and the production runner stays blocked on a qualified OCI
  platform (LB-10). The opt-in suites' repairs (`assist-live`, `b16-1b-live-qualification`, `b19-e-live-contract`,
  `kicad-cli-oracle`) are B24-B3's (OD-209).

## 16. Review round (2026-10-08)

An adversarial review CONFIRMED nine findings (seven distinct). Each was closed test-first. The strengthened suites ran first on the
unfixed tree: 5 failed, 11 passed (catalog cases 2, 5, 10 and 11; score-separation case 2). The test-strength findings were then
shown against deliberate breakages of the module, the helper and this page, each restored by sha256. The suites keep 11 and 5 cases.

- **correctness-1, security-1: the register rows, and the generator never ran.** Case 5 is red at the tree, because the register ends
  at LB-14. The generator refuses (`UNKNOWN_LB:LB-15`, `LB-16`, `LB-17`; exit 1; nothing written to its scratch output folder). The
  register is the lead's file, so B1 does not write the rows; they are drafted for the lead (section 13 item 5). What B1 could execute,
  it did: the generator, unchanged, ran twice with its working directory on a scratch root whose register is the committed one plus
  the three drafted rows, writing to scratch folders. Both runs exited 0, and both runs' CSV and JSON equal the committed files byte
  for byte (the sha256 at the top of this page). The artifacts bullet there now says which run wrote what. CONFIRMED by execution; the
  run at the repository and a green case 5 wait on the lead's rows.
- **correctness-2, security-7: case 4 skipped two anchors and every in-job guard.** Case 4 now drops and doubles all sixteen anchors
  (the vitest steps of both workflows and the two `stage10:test` steps added). It also plants six moves, each of which must throw
  `CI_ANCHOR` with its own message: the nightly condition moved into `benchmark-core`; each Playwright run line moved into another
  job; a folded vitest step without its `--reporter` line; and a folded step and an inline step without a filter. On the unfixed
  helper these probes pass, because the helper was right. Eight guards of `_ci-admission.ts` were then broken at once: the two step
  lookups took the first hit instead of the only one, and the no-`--reporter`, two no-filter, Playwright-placement, `stage10:test`
  and nightly-placement checks were deleted. The reviewed case 4 stayed green; the strengthened one reported all twelve new probes
  silent. The helper was restored by sha256. CONFIRMED
- **correctness-3: score-separation case 1 compared a render with itself.** Case 1 now parses the committed `eval-catalog.json`,
  requires its scores to equal the module's class by class, and pins the browser and database verdicts as `incomplete`. Case 2 adds
  18 covered rows with one missing, and a class whose every row is missing: `incomplete`, never covered. With the verdict's third rule
  changed to count a missing row as covered, the reviewed suite stayed 5 of 5 green and the strengthened one failed cases 1 and 2.
  The module was restored by sha256. CONFIRMED
- **correctness-4: the page's matrix and in-part table were unpinned.** Case 11 now requires section 3's nineteen rows and section
  7's in-part rows to equal the catalog's, cell for cell, and sections 4, 5 and 8 to hold one table row per row of their state. A
  stale matrix cell and a stale in-part gap left the reviewed case 11 green. The strengthened case failed on each, in separate runs.
  The page was restored by sha256. CONFIRMED
- **security-3: a malformed LB id threw.** Catalog case 2 plants `LB-(`, `LB-8)` and `LB-[` on in-part rows, and score-separation case
  2 scores one. Unfixed: `SyntaxError: Invalid regular expression` escaped `goldenCatalogProblems` and `scoreGoldenCatalog`. Fix:
  `rowProblems` passes only an id that matches `LB_ID` to `cites()`, which builds a pattern from it. The answer is
  `BLOCKED_WITHOUT_LB`, the write guard adds `UNKNOWN_LB:LB-(`, and scoring throws `CATALOG_INVALID: BLOCKED_WITHOUT_LB`. Green after.
  The artifacts do not change: the generator's two runs above came after the fix. CONFIRMED
- **security-4: the B23-D page's statement.** Case 10 reads `physical-evidence.md`'s statement that no production file names the
  evidence module's file name, and requires B1's dated note on it. Unfixed: red. Fix: the note, in place on `:222` (section 14).
  Green after. CONFIRMED
- **security-9: section 15 called every live row blocked, LB-10 included.** Case 11 now requires that a block saying rows stay
  BLOCKED-LIVE-QUALIFICATION, and citing an LB id that only a failing row carries (LB-10), also says failing. Unfixed: red on section
  15's bullet. Fix: the bullet names the failing sandbox-escape physical row as the one exception. Green after. CONFIRMED
