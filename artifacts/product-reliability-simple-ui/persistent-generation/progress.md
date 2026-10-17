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
| 2 | durable task / checkpoint / ownership contracts + isolated persistence tests (L.2) | design DONE (defaults OD-252); implementation next | `task-worker-contract.md` |
| 3 | runnable supervised worker, finite slices, continuation, accounting, fencing (L.3) | not started | — |
| 4 | accepted-job API, real progress, Stop / Resume, reload and project switch (L.4) | not started | — |
| 5 | Build / chat parity and the final review integration (L.5) | not started | — |
| 6 | catalog / subsystem bottleneck fixes, missing-resource recovery, vertical slice (L.6, L.7) | not started | — |
| 7 | regression gates, evidence, integration, handoff | not started | — |

## Exact next step

Implement increment 2 (contracts and persistence, contract section 10 item 1) and, in parallel on disjoint files, the catalog
bottleneck fixes the stall map proves (category names, rerank refusal memo, verified hoisting, the OpenAI incomplete-response defect).
