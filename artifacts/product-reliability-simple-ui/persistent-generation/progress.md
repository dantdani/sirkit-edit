# Persistent generation (runbook section L) — progress ledger

Compact, resumable record of section L's increments (L.8). Read this first after a context reset; the governing text is
`artifacts/astra-guided-pcb/PROMPT_TO_PCB_RELIABILITY_AND_SIMPLE_UI.md` lines 534-696. Working copy: `C:/Users/robsa/Desktop/sirkit-edit`,
branch `codex/astra-foundation` (PR #16's commits fast-forwarded in on 2026-10-17; PR #16's head `codex/product-reliability-g` follows it).

## Ground rules held throughout

- No larger deadline, Infinity, removed AbortSignals or an open HTTP request as the fix (L.0). Finite slices checkpoint and continue.
- The owner's dev server on :3000 is never stopped or restarted. Fixture browser proofs run in the verification worktree
  `C:/Users/robsa/Desktop/.claude/worktrees/pr-g-side` (own node_modules), restored to its branch after each run.
- US$5 cumulative builder-test allowance; ledger `../live-spend.json` (0.1928 USD spent before L). Reserve worst case before any live call.
- Snapshot of the shared checkout before integration: `refs/backup/main-checkout-20261017-0845` (`cfa8ae35`, local ref).

## Increments

| # | increment (L.8) | state | evidence |
|---|---|---|---|
| 0 | integrate the 180 s correction (interim, OD-251) and fix PR #16's three CI failures | DONE `84a2f72c` | positional selection 514 files green; stage10 1285; browser 59 + 4 + 13 |
| 1 | reproduction and precise stall / limit map (L.1) | DONE (map); the deterministic reproduction becomes a permanent test in increment 6 | `limit-and-stall-map.md` |
| 2 | durable task / checkpoint / ownership contracts + isolated persistence tests (L.2) | DONE | `app/lib/generation-task/{vocabulary,contracts,events,checkpoint,store}.ts`; S1 scheduled availability + S2 fenced lease renewal on the durable store; `l2-task-contracts` 9, `l2-task-store` 17, `l2-generation-task-pglite` 10 (a fence mutant is killed) |
| 3 | runnable supervised worker, finite slices, continuation, accounting, fencing (L.3) | DONE | slice core `app/lib/schematic/build-loop-slice.ts` (a window or turn allowance yields a checkpoint, never a failed block; planner truncation refused); plan / block / merge split in `build-multi-generation.ts`; worker `app/lib/generation-task/worker/*` + `scripts/generation-worker.ts` (`pnpm worker:generation`, `--once`) + `scripts/dev-with-worker.mjs`; `worker.md`; `l3-*` 64 tests incl. L.7 items 1-5 and a spawned-process test |
| 4 | accepted-job API, real progress, Stop / Resume, reload and project switch (L.4) | not started | — |
| 5 | Build / chat parity and the final review integration (L.5) | not started | — |
| 6 | catalog / subsystem bottleneck fixes, missing-resource recovery, vertical slice (L.6, L.7) | PART 1 DONE: the four proven defects | real category vocabulary + normalization (`MAIN_CATEGORIES`, `resolveMainCategory`), reranker refusal memo, verified parts as a tie-break in a relevance band, OpenAI incomplete responses and `_raw` submissions refused; `l6-*` 101 tests incl. a PGlite reproduction that is red on the old code |
| M1 | section M: schematic-only instance inspection, requirement-based candidate search, compatibility proof, unresolved-component resolution proposal, approved batch application, post-change preflight (local alternatives first) | not started | — |
| M2 | section M: no local candidate → permitted source → real assets → validation → durable library candidate → review / publication → replacement; reopen and reuse | not started | — |
| 7 | regression gates, evidence, integration, handoff | not started | — |

## Notes

- A combined run of the increment's 28 files once failed `b24-f-registers` case 7 and `b24-f-verdict-lines` case 8 right after the
  B24 maps were regenerated; both passed alone and the identical combined run passed (389/389). Cause not identified; watched in the
  full runs of increment 7.
- Not yet in any CI job: the `l2-*`, `l6-*` suites and the three suites of the interim correction (two of them start PGlite and need the
  database-delivery job). Admitted together in increment 7 with one re-measurement.
- Carried to increment 3: the planner reads a truncated `submit_plan` as "zero blocks" (the same defect class, in `plan()`); S3 (the
  generic effects pump must not claim the slice topic); `retryAfterMs` on provider errors.

## Exact next step

Increment 4 (accepted-job API, real progress, Stop / Resume, reload / project switch; the fixture pump route) in parallel with M1's
server-side services (new modules and the agent registries; page work for M1 follows increment 4's page edits).
