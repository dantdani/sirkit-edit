# B16.1A §E — benchmark-quality runs #1–#23 analysis (+ #24–#27)

Workflow: `benchmark-quality` (`.github/workflows/benchmark.yml`), triggers:
pull_request, workflow_dispatch, schedule (cron `23 4 * * *`).

## Run ledger

| runs | branch / event | conclusion | failing job → step |
|---|---|---|---|
| #1–#23 (2026-08-06 → 2026-08-28, daily) | main / schedule | **failure** (23/23) | `benchmark-core` AND `benchmark-nightly` → step 3 `actions/setup-node@v4` |
| #24 (2026-08-28T21:03Z) | PR #1 / pull_request | **failure** | `benchmark-core` → step 3 `actions/setup-node@v4` (nightly skipped on PR) |
| #25 (21:12Z) | PR #1 after pnpm fix | **success** | — |
| #26 (21:15Z) | PR #2 (`-clean`) | **success** | — |
| #27 (21:18Z) | main / workflow_dispatch (post-merge) | **success** | — |

## Newest failure (#23, run id 33149678029) — exact evidence

- head SHA: `e67f27a` (pre-integration main)
- failing job/step: both jobs, step 3 "Run actions/setup-node@v4"
- exact command: the action's internal cache resolution (`cache: npm`)
- exit: step failed before ANY dependency install; `npm ci` was never reached
- bounded log excerpt (verbatim):
  `##[error]Dependencies lock file is not found in /home/runner/work/sirkit-edit/sirkit-edit. Supported file patterns: package-lock.json,npm-shrinkwrap.json,yarn.lock`
- runner: ubuntu-24.04.4, runner 2.336.0, Node 24 requested
- artifacts: none produced (failure precedes any artifact step; the workflow
  also had no artifact steps then)

Representative earlier failure #2 (2026-08-07) and PR failure #24
(`4962703`): IDENTICAL failing job/step signature.

## Shared root cause?

**YES — one single root cause across all 24 failures**, and it is
**CONFIGURATION**, not functional, infrastructure, or timing: the workflow was
written for npm (`cache: npm`, `npm ci`, `npx`) but the repository is
pnpm-managed and contains ONLY `pnpm-lock.yaml` (no `package-lock.json`, no
`yarn.lock`). `actions/setup-node@v4` with `cache: npm` hard-fails when no
npm/yarn lockfile exists — before installing anything, before any benchmark
code runs. No benchmark, test, or threshold was ever implicated.
