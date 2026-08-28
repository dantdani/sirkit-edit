# B16.1A §E/§F — benchmark local reproduction

The workflow's exact commands, run locally (Windows, pnpm 11.2.2, Node 24
toolchain) on the integrated tree — all green:

| workflow step | local result |
|---|---|
| `pnpm install --frozen-lockfile` | "Already up to date" (exit 0) |
| `pnpm run benchmark:validate` | `{ "version": 1, "packages": 63, "diagnostics": [] }` (exit 0) |
| `pnpm exec tsc --noEmit` | 0 errors |
| `pnpm exec vitest run app/lib/benchmark/__tests__/stage-09-benchmark-core.test.ts` | **18/18** |
| `pnpm run stage10:test` | **801/801** (56 files) |
| nightly extra: `…stage-08-professional-routing.test.ts` | **11/11** |
| junit dual-reporter probe (`--reporter=dot --reporter=junit --outputFile`) | XML produced, dot output intact, 18/18 |

Historical note: the pre-fix failure is trivially reproducible by design —
`npm ci` in this repo fails immediately (no `package-lock.json`), and
setup-node `cache: npm` fails its lockfile search; the repository contains
only `pnpm-lock.yaml`.

## §F stability review

| property | finding |
|---|---|
| deterministic where expected | yes — manifest validation, comparators, statistics, and digests are pure; the timeout path uses a fixed tiny budget on a deliberately slow fake |
| warmup/measured iterations explicit | N/A — no wall-clock measurement gates exist; the statistical plan (paired bootstrap, seeds) is declared in the package metadata |
| shared-runner variance resistance | yes — no wall-clock thresholds to flip |
| still strict on regressions | yes — correctness/guardrail assertions and the corpus/digest gates unchanged |
| bounded by timeouts | yes — 20 min core / 90 min nightly job timeouts |
| artifact-producing on failure | **added this stage** (was missing): junit XMLs + validate JSON on `failure()` |
| hidden network/provider deps | none — no fetch/http in the suite (the one URL is a string-prefix metadata assertion); no provider credits |
| locally reproducible, documented | yes — the table above is the documented command list |
