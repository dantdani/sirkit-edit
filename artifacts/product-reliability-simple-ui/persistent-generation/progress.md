# Persistent generation (runbook section L) and component resolution (section M) — progress ledger

Compact, resumable record of section L's increments and section M's work (L.8). Read this first after a context reset. Governing text:
`artifacts/astra-guided-pcb/PROMPT_TO_PCB_RELIABILITY_AND_SIMPLE_UI.md` lines 537-698 (L; L.7 at 661-676, L.8 and its stop condition at
678-696) and 700-807 (M; M.5 at 790-807). Working copy: `C:/Users/robsa/Desktop/sirkit-edit`, branch `codex/astra-foundation` at
`deaf15ca`; PR #16's head `codex/product-reliability-g` (at `0f1c446b`) is fast-forwarded by the lead. Decisions: OD-251, OD-252, OD-253
(and the CI builder's OD-254) in `artifacts/remaining-builder-program/OWNER_DECISIONS.md`.

[PR-L7, 2026-10-20] Rewritten for increment 7: every row below carries its real state, its commits and its evidence; row 5 (stale "not
started") and rows 6, 7, M2 are current.

## Ground rules held throughout

- No larger deadline, Infinity, removed AbortSignals or an open HTTP request as the fix (L.0). Finite slices checkpoint and continue.
- The owner's dev server on :3000 is never stopped or restarted by a builder. Fixture browser proofs run on port 3100 under
  `SIRKIT_FIXTURE_RUNTIME=blinker`; section L's one live run (LR-3) used the builder's own server (:3005) and worker, never :3000 or
  `.env.local` (OD-253 item 7).
- US$5 cumulative builder-test allowance; ledger `../live-spend.json`. Worst case reserved before any paid call. Known spend 1.3628 USD
  (LR-1 0.19, LR-2 0.0028, LR-3 1.17); LR-3's unspent reservation 2.66 USD is held for its resume; provable remainder 0.9772 USD.
- Fixture-backed, fake-backed and live evidence are labelled separately everywhere; a fixture success is never presented as live.

## Increments

| # | increment (L.8) | state | commits | evidence |
|---|---|---|---|---|
| 0 | integrate the 180 s correction (interim, OD-251) and fix PR #16's three CI failures | DONE | `84a2f72c` | positional selection 514 files green; stage10 1285; browser 59 + 4 + 13 (OD-251; `../generation-failure-fix-2026-10-17.md` is historical evidence of that narrower fix only) |
| 1 | reproduction and precise stall / limit map (L.1) | DONE | `aa8b2512` | `limit-and-stall-map.md` (limits, per-request records, why each block stalled, root causes beyond the time limit); the deterministic reproduction is the permanent `l6-search-stall-repro` (red on the old code, `c8e53499`) |
| 2 | durable task / checkpoint / ownership contracts + isolated persistence (L.2) | DONE | `aa8b2512` (design), `c8e53499` | `task-worker-contract.md` sections 1-2; `app/lib/generation-task/{vocabulary,contracts,events,checkpoint,store}.ts`; `l2-task-contracts`, `l2-task-store`, `l2-generation-task-pglite` (a fence mutant is killed); the four proven catalog defects fixed with `l6-*` (category vocabulary, reranker refusal memo, verified relevance band, incomplete / `_raw` submissions) |
| 3 | runnable supervised worker, finite slices, continuation, accounting, fencing (L.3) | DONE | `382fd59f` | slice core `app/lib/schematic/build-loop-slice.ts`; plan / block / merge split; worker `app/lib/generation-task/worker/*`, `scripts/generation-worker.ts` (`pnpm run worker:generation`), `scripts/dev-with-worker.mjs`; `worker.md`; `l3-continuation`, `l3-long-task`, `l3-fencing`, `l3-crash-resume`, `l3-strategies`, `l3-worker-process` (a real spawned process), `l3-block-slice`, `l3-plan-merge` |
| 4 | accepted-job API, real progress, Stop / Resume, reload and project switch (L.4) | DONE | `2e938241` | six canonical routes (`/api/generation-tasks` start/attach, list, snapshot, events JSON + SSE, control; `/api/generation-worker` pump behind the worker secret); the page's Build Generate starts or attaches a durable task; `GenerationTaskStatus` (Stop design, Pause, Resume, Retry block, Continue with another allowance, Review saved blocks); `l4-routes`, `l4-task-client`, `e2e/l4-generation-task.spec.ts` (fixture, a real pump worker) |
| 5 | Build / chat parity and the final review integration (L.5) | DONE (fixture-backed) | `00d03430`, `ada0b194`, `7bf0fa55` | `sirkit.schematic.generate-proposal` 2.0.0 starts or attaches the scope's durable task through the same service as the Build route; new `sirkit.generation.task-inspect` (read) and `sirkit.generation.task-control` (a confirm chip the human clicks); Stop answer ends the chat turn, Stop design cancels the task; the in-turn generation path removed from the agent tool; `l5-generation-task-tool`, `e2e/l5-chat-task.spec.ts`; the coverage matrix and manuals state Stop answer vs Stop design; the orchestration browser spec's renamed Stop-answer line fixed (`ada0b194`); review fixes in `7bf0fa55` (activity entry id across reloads, the attach note, the review report's base recipe) |
| 6 | catalog / subsystem bottleneck fixes, missing-resource recovery, vertical slice (L.6, L.7 items 9-10) | DONE offline and fixture-backed; live PARTIAL (LR-3 stopped at the provider's quota) | `8b76793f` (OD-253), `2240363a`, `9a42c36b`, `0f1c446b`, `2a0e3079`, `3337f3f3`, `deaf15ca` | engine: an operator allowance that may only lower the unit, an input-token dimension, a pre-call input admission and `admitCall` across slices (any concurrency), SDK `maxRetries` 0 on every metered call, both planner attempts reserved, `--scope`; plan assumptions and coverage on the card; search: resolved-category keys, a catalog epoch, a per-task embedding cache, cross-turn pin dedup, catalog slots, a repeat detector, `report_unfilled_role`; the post-approval Tidy / Review input bound (`2a0e3079`). Fixture: a request-feature scripted provider over eight published fixture parts; the owner's sentence verbatim reaches 4 saved blocks, 41 published instances, Approve, reload (Missing parts 0) and Prepare PCB to awaiting qualification (`e2e/l7-drone-vertical-slice.spec.ts`); the 555 LED dimmer and the blinker by the same path (`e2e/l7-second-circuit.spec.ts`). Live LR-3: see below |
| M1 | section M: schematic-only inspection, requirement-based candidate search, compatibility proof, unresolved-component resolution, approved batch application, post-change preflight (local alternatives) | DONE (fixture-backed) | `2e938241` (server), `03d473f1` (page) | `app/lib/component-resolution/**`, three tools; `ComponentResolutionReviewDialog`, receiver `component-resolution-events.ts`, `POST /api/component-resolution-authority`; Missing parts "Find a replacement in the library"; `m1-*`; `e2e/m1-resolve-missing-parts.spec.ts` (D1 / D2 -> review -> Approve -> receipt and new revision -> preflight; Discard and a stale base refuse; the chat sentence reaches the same dialog) |
| M2 | section M: no local candidate -> permitted source -> real bytes -> validation -> durable library candidate -> review / publication -> replacement; reopen and reuse | DONE for the fixture source and the bundled KiCad library (zero network); the online KiCad source BLOCKED on owner decisions | `03d473f1` (design), `00d03430`, `7bf0fa55` | `../component-resolution/m2-acquisition-design.md`; CAD source registry (bundled KiCad at `90c39c38` enabled, fixture source, `kicad-gitlab` blocked: OD-M2-3/5/12/13), bounded CAD egress, durable objects and candidates, parser-validated pins and pads, a two-human review / publication handoff, reuse with zero network; `m2-1` … `m2-6`, `m2-acquisitions-route`, `m2-acquisition-panels`, `e2e/m2-acquire-missing-part.spec.ts` |
| M4 | section M.4 / M.5 item 7 (OD-253 item 8): a replacement on a project with a durable PCB | DONE with open items | `e03c532f`, `9a42c36b` (BI-1, BI-2) | `../component-resolution/m4-board-impact.md`; impact before approval, Approve fail closed, bound at Approve, receipt v2, fact-derived drift (notice, journey fact, in-page qualify / release refusals incl. the manufacturing panel's own controls); `m4-*`, `m2-7`, `e2e/m4-existing-board-resolution.spec.ts` (unrouted board). OPEN: rebinding a bound part to another revision from the page (`PB_ACTIVE_SELECTION_CONFLICT`), the server-side currency guard, the B14 dialog as a consumer, net-membership reconciliation |
| 7 | regression gates, concise current evidence, integration and handoff (L.8 item 7) | IN PROGRESS | this package (uncommitted) | `validation.md`, `changed-files.md`, `final-verdict.md`, `../component-resolution/final-verdict.md`, the screenshots; CI admission of the new suites and the split re-measurement: OD-254, see `validation.md` CI section, written by the CI builder; integration, PR #16 fast-forward and the CI read by the lead |

### LR-3, the one bounded live run (OD-252 item 10, OD-253 item 7), told plainly

2026-10-20 00:44-01:02 UTC, the builder's own server (:3005, verification worktree at `2a0e3079`) and worker (`--no-env-file
--concurrency 1 --scope local/21558dad-52cd-473a-9101-e72a16deded6/main`), the owner's OpenAI key and main database, a new synthetic
project, the owner's four-motor sentence through Build in normal mode. Reserved first: 3.83 USD provable worst case (`3337f3f3`).

- The start answered 202 at once; the plan slice planned 3 blocks with disclosed assumptions and requested coverage, shown on the
  task card (`screenshots/lr3-card-plan-assumptions.jpg`).
- Block "Four brushed-motor drivers" was designed and SAVED. Blocks b1 and b2 each ran 4 turns, yielded at the slice allowance and
  were queued again ("continued in the next slice") — no window or turn allowance failed a block.
- Then OpenAI refused: b2 "Flight controller, IMU, and radio" -> blocked `provider_quota` (`insufficient_quota`); b1 "Battery input and
  regulated power" -> waiting for the provider (`rate_limit`, retry scheduled 01:49:36 UTC). The card kept the saved block and said so
  (`screenshots/lr3-card-provider-quota.jpg`); Stop design and Pause design stayed offered.
- Spent 1.17 USD (CONFIRMED from the durable call records: 15 completed calls, 219,005 input / 14,629 output tokens, all input priced
  uncached; 1 refused call with no tokens; 69 embedding calls). Nothing was approved, so no post-approval pass ran.
- The builder stopped the worker and server with no slice in flight. The task (`generation-task:e4b1f4b694a91b011486487a8f3c02b7`) is
  durable in the owner's database and resumable. BLOCKER (owner): the owner's OpenAI account answers `insufficient_quota`.

## Notes

- Timing-only failures under machine load are recorded with their measured numbers in `validation.md`; every one was green alone. No
  functional failure was classified as a flake.
- `e2e/semantic-editor.spec.ts` scenario 3 failed twice on the M4 builder's tree under load and passed 16 later executions; no root
  cause (see `../remaining-blockers.md`).
- The suites added by L and M that no CI job selected are admitted in increment 7 by the CI builder with one re-measurement (OD-254).

## Exact next step

1. The CI builder completes increment 7's CI admission and split (OD-254, the CI section of `validation.md`); the lead commits increment
   7 (this evidence and the CI change), fast-forwards PR #16's head `codex/product-reliability-g`, reads its CI and fixes any red job.
2. When the owner restores the OpenAI quota: resume LR-3's task — the SAME task, never a new one — on the builder's own server and
   worker with the launch contract in `../README.md`, inside LR-3's held reservation (2.66 USD). "Continue with another allowance" is not
   admissible under the provable remainder (0.98 USD) without the owner's further authority.
3. Owner decisions that unblock the rest: OD-M2-1 … OD-M2-14 (the online KiCad source, governance, retention), the rebind of a bound
   part (`PB_ACTIVE_SELECTION_CONFLICT`), the server-side currency guard (`../remaining-blockers.md`).
4. Then runbook section J (multi-sheet schematics), then K — neither started.
