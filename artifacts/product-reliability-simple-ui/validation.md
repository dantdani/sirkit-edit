# Validation — exact commands, results, exit codes

Machine: win32, Node v24.15.0, pnpm; 14 logical CPUs, 15.8 GB RAM with 0.5–2.4 GB free during the runs (other
applications were open). Heavy jobs ran one at a time. Every result below is a real process exit read by the builder;
"live" and "fake" are kept apart.

## Checkpoint A (2026-10-14)

| command | result | exit | kind |
|---|---|---|---|
| `pnpm exec playwright test e2e/prompt-to-gerber.spec.ts --reporter=list` (webServer: `next dev --port 3100` under the fixture runtime, replayed router, scripted agent) | 1 passed (1.4 min) | 0 | fake-backed fixture (recorded design, replayed router, local_dev identity) |
| `pnpm exec vitest run app/lib/qualification/__tests__/pr-a-journey-reproductions.test.ts` | 11 passed (1 ordinary + 10 `it.fails` expected failures) | 0 | deterministic |
| browser reproduction, normal app on :3000 (`pnpm dev`, the owner's `.env.local`): Theory generate | HTTP 400 `AUTH_PROJECT_SELECTOR_REQUIRED`, no provider call | — | live app, zero provider work |

## Checkpoint B (2026-10-14)

| command | result | exit | kind |
|---|---|---|---|
| `pnpm exec vitest run` over the pending tree's 13 new/modified suites (`bom-request-retirement`, `assignment-queue-panel-lifecycle`, `inspector-draft-lifecycle`, `astra-foundation-regressions`, `normalize-tool-arguments`, `b09-loop-safety`, `b14-replacement-proposal`, `b16-0-2-session-identity`, `b24-b2-power-ground`, `b24-c3-recorded-limits`, `b24-d2-board-read`, `b24-d3-accessible-names`, `b24-f-verdict-lines`) | 13 files passed | 0 | deterministic |
| counterexample run: the four B fixes reversed string-exactly (`scratchpad/b/counterexample.py revert`), then `vitest run` on `inspector-selection-identity`, `assignment-commit-result`, `bom-refresh-lifecycle` | 4 failed, 1 passed (the StrictMode pin passed on the pending tree: a review claim refuted, see root-causes B-5) | 1 | deterministic (pre-fix) |
| the same three suites with the fixes restored, plus `inspector-draft-lifecycle`, `assignment-queue-panel-lifecycle`, `assignment-queue-panel`, `bom-request-retirement` | 7 files, 29 tests: 27 passed, 2 failed → the two BOM cases had selected the pricing choice "none", which disables "Refresh prices"; the cases were corrected (choice "digikey"; the plain "Refresh" control asserted) and re-run: 2 passed | 0 (final) | deterministic |
| `pnpm exec tsc --noEmit` (first attempt) | 3 errors, all in the generated `.next/dev/types/validator.ts` (a truncated file the stopped dev server left; `.next` is git-ignored and `tsconfig.json:31` includes it) | 2 | the generated file was removed; re-run recorded below |
| `pnpm exec eslint . -f unix` (first attempt) | the `unix` formatter is not bundled with this ESLint | 2 | re-run with the default formatter recorded below |
| `pnpm exec tsc --noEmit` (after removing the truncated generated file) | 0 errors (50.8 s) | 0 | deterministic |
| `pnpm exec eslint .` (whole repository, default formatter) | 34 problems: 0 errors, 34 warnings (28 `@typescript-eslint/no-unused-vars`, 5 `no-console`, 1 `react-hooks/exhaustive-deps`); the historical 33 errors (B24 at `26dc8b8`) are gone on this tree (3 m 26 s) | 0 | deterministic; prior debt = the 34 warnings, none added by B |
| `pnpm exec tsx scripts/generate-b17-control-inventory.ts` / `scripts/generate-b24-accessible-names.ts` (sanctioned generators; the BOM refresh handler was renamed to `requestAgain` and registered under `bom.workbench`) | 628 classified controls on 63 surfaces; census 628 sites, in scope 168, unnamed 0, structural problems 0, out of scope unnamed 102 (unchanged counts; the CSV rows for the renamed handler changed) | 0, 0 | deterministic |
| `vitest run` gate suites: `b17-a-control-inventory` (6), `b24-d3-accessible-names` (11), `pr-a-journey-reproductions` (11), `inspector-selection-identity` (2), `assignment-commit-result` (1), `bom-refresh-lifecycle` (2), `inspector-draft-lifecycle` (10), `assignment-queue-panel` (2), `assignment-queue-panel-lifecycle` (3), `bom-request-retirement` (9) | first run: 56 passed, 1 failed — `b24-d3` case 10: four BomView citation anchors (C36–C39) had moved by the B edit; refreshed in `accessibility.md` with a dated note; re-run of `b24-d3`: 11 passed | 1 then 0 | deterministic |

Note on durations: one 7-file vitest run reported a 63-minute wall clock for 11 s of test time; the machine was under
memory pressure (another application held several GB). The result was read from the completed process, not inferred.
