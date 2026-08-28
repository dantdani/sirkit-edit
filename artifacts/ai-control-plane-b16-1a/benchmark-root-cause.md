# B16.1A §E — benchmark root cause and fix

## Root cause (CONFIRMED)

npm-tooling workflow in a pnpm-only repository. `actions/setup-node@v4` with
`cache: npm` requires `package-lock.json` / `npm-shrinkwrap.json` /
`yarn.lock`; the repo has only `pnpm-lock.yaml`. Step 3 therefore failed with
`##[error]Dependencies lock file is not found…` on EVERY run (#1–#24), before
any install, benchmark, or test executed. Had step 3 somehow passed, `npm ci`
(step 4) would have failed next for the same missing-lockfile reason.

## The fix (root-cause, no shortcuts) — commit `6956e74`

- `pnpm/action-setup@v4` (pnpm 11.2.2, matching the local toolchain) before
  setup-node
- `cache: npm` → `cache: pnpm`
- `npm ci` → `pnpm install --frozen-lockfile` (exact lockfile enforcement)
- `npm run` / `npx` → `pnpm run` / `pnpm exec`

Nothing was disabled, skipped, weakened, threshold-raised, or
exit-code-masked. Every original job, step, command, and assertion still runs
— now under the toolchain the repository actually uses.

## Proof the fix is the root cause

- #24 (pre-fix, PR head `4962703`): failure at the same step.
- #25 (same PR, ONLY the workflow fix added): **success**, all steps green.
- #26 (PR #2) and #27 (main, manual dispatch post-merge): **success** —
  including `benchmark:validate` (63 packages, 0 diagnostics), tsc, the
  stage-09 core suite, stage-08 routing, and the 801-test stage10 suite
  executing fully on the runner.

## §F hardening added this stage — commit `5f28825`

`if: failure()` artifact uploads (validate JSON + junit XMLs, 14-day
retention) on both jobs, and junit reporters alongside dot on the vitest
steps, so any future red run carries machine-readable diagnostics. The
validate output is captured via redirection (`>`), which preserves the exit
code — explicitly no pipes, no `continue-on-error`.

## Threshold statement

NO timing thresholds were changed — none exist: the suite is structural and
statistical (manifest validation, deterministic comparators, bootstrap CIs,
timeout-as-result-state with a deliberately tiny fixed budget to exercise that
path). There was no scheduler-noise threshold to re-evaluate, and the
regression gates are unchanged.
