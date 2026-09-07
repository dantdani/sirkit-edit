# B16.1C — Test and validation report (§J)

Machine: local Windows 11 workstation, Node/pnpm as pinned by the repository, `vitest 3.2.6`, bundled FreeRouting 2.2.4 + JRE (local only). Date: 2026-09-07. Every number below is RECORDED from the run outputs kept in the session scratchpad; the deterministic suites are re-runnable by anyone with the repository (no credits, no database, no network).

## 1. New suites (all GREEN)

| Suite | File | Tests | Notes |
|---|---|---|---|
| Acceptance catalog | `app/lib/workflow/prompt-to-gerber/__tests__/blinker-catalog.test.ts` | 4 | published revisions, KiCad geometry, netlist pin existence, determinism |
| State machine | `…/__tests__/machine.test.ts` | 7 | 18 states, legal table, no auto-approval, reconstruction, step keys |
| Review summary | `…/__tests__/review-summary.test.ts` | 2 | what the approval dialog states |
| Fresh-browser acceptance (§G, §H.1/12/14) | `…/__tests__/acceptance-pipeline.test.ts` | 11 | real route handlers; replayed router; §G electrical/parity/routing/archive tables all PASS |
| Recovery (§H.2–7, 11, 13, 15, 16) | `…/__tests__/recovery-pipeline.test.ts` | 9 | refusals, retries, double-submit, invalidation, isolation, agent-loop exclusion |
| Qualification authority | `app/lib/pcb/fab/__tests__/qualification-authority.test.ts` | 18 | closed vocabulary + all nine `QA_*` blockers |
| Bounded manufacturing errors | `app/lib/pcb/fab/__tests__/manufacturing-errors.test.ts` | 5 | closed table, redaction, classification |
| Human-only release | `app/api/pcb/release/__tests__/release-human-only.test.ts` | 5 | ai/automation/migration actors refused before durable reads |
| Invariant tripwires (§I) | `app/api/__tests__/b16-1c-invariant-tripwires.test.ts` | 7 | 153/150/3/0, 12 tools, policy rows, route source pins, gate-code coverage, protected original |
| Manufacturing workflow panel (§F, §H.8–10) | `app/components/pcb/__tests__/manufacturing-workflow-panel.test.tsx` | 6 | jsdom: hydration, states, separate admin authorization, single-flight, retry, refresh truth |
| **Total new** | | **74** | |

Superseded in place: `app/api/__tests__/b16-0-15-tranche-parity.test.ts` 23 → 25 tests (2 added: no-authority refusal before the capability screen; stale authority at release) — see `superseded-claims.md`.

Combined run of the new suites plus the directly affected ones (`b16-0-15-tranche-parity`, `manufacturing-release-gate`, `native-fab`, `b16-0-2-engineering-export`, `b08-3-owned-sync`, `pcb-sync-authority`, `pcb-sync route`, `b16-1b-auth-composition`): 18 files, **166 passed, 2 skipped (opt-in DB/live), 0 failed**, 12.8 s.

## 2. B12–B16 and manufacturing suites

Included in the full runs below (every `b12-*`, `b13-*`, `b14-*`, `b15-*`, `b16-*` suite, `manufacturing-release-gate`, `native-fab`, `fab/*`, `pcb-sync/*`, `physical-binding/*`, `footprint-resolver/*`): 0 failures in either full run.

## 3. Complete bounded Vitest suite (two runs, default vitest config, `pnpm exec vitest run`)

| Run | Files | Tests | Failures | Duration |
|---|---|---|---|---|
| 1 | 417 passed / 2 failed / 3 skipped (422) | 4666 passed / 2 failed / 29 skipped (4697) | (a) `b11-5-capture-exactness` closure 12 — this stage's acceptance suite wrote evidence under `scripts/output` (FIXED: evidence now goes to `SIRKIT_B16_1C_EVIDENCE_DIR` or the OS temp dir, `fixtures/evidence.ts`); (b) `ingest-integrity` "pcb_footprints raw_sexpr round-trip (DB)" — pre-existing dead-database environment failure (B16.1B documented the same) | 132 s |
| 2 (after the fix) | 418 passed / 1 failed / 3 skipped (422) | 4667 passed / 1 failed / 29 skipped (4697) | only (b), the pre-existing DB environment failure; NOT a functional regression of this stage (the test needs the live `DATABASE_URL`, which resolves to nothing — see B16.1B) | 128 s |

Skipped = opt-in live suites (`SIRKIT_LIVE_AUTH_QUALIFICATION`, `R03_B10D_RETRY02_DATABASE_URL`, etc.). No timing-only failure occurred in either run; no test was disabled, weakened or re-classified as a flake.

## 4. TypeScript

`pnpm exec tsc --noEmit -p tsconfig.json` → exit 0 (run after every change set; final run inside the validation chain: exit 0).

## 5. Scoped ESLint

`pnpm exec eslint` over every changed/new file (`app/lib/workflow`, `app/lib/pcb/fab`, `app/api/pcb`, `app/api/pcb-sync`, the two parity/tripwire suites, `pcb-sync/client.ts`, `pcb-sync/durable.ts`, `owned-operations.ts`, `board-identity.ts`, `PcbEditor.tsx`, `ManufacturingWorkflowPanel.tsx`, `useManufacturingWorkflow.ts`, the panel test, `app/page.tsx`): **0 new findings**. Two findings raised by this stage's first pass were fixed before commit (`react-hooks/set-state-in-effect` in the hook → `useSyncExternalStore` + deferred hydration tick; an unused helper in the recovery suite). Pre-existing, untouched: 15 `react-hooks/refs` / `set-state-in-effect` / `purity` errors in `app/page.tsx` and `PcbEditor.tsx` on lines this stage did not add (classified by diff-hunk membership), and 1 unused-directive warning in `app/api/pcb/edit/__tests__/assist-live.test.ts`.

## 6. `git diff --check`

Clean (only the advisory CRLF→LF normalization notices for seven files checked out before the `.gitattributes` LF policy; the commit normalizes them, content unchanged).

## 7. Sanctioned generators, twice

`scripts/generate-b16-0-artifacts.ts`, `scripts/generate-b16-0-2-artifacts.ts`, `scripts/generate-action-toolability-matrix.ts` — run 1 and run 2 sha1 identical AND identical to the committed files (git status clean under `artifacts/`):

- `artifacts/ai-control-plane-b16-0/auth-route-coverage.csv` `4d93461b0a1014c507d3207201f7bcc2adea847b`
- `artifacts/ai-control-plane-b16-0-2/route-data-and-resource-classification.csv` `e22ec3a311e0170b5bea502d272dcc2f80f80182`
- `artifacts/ai-control-plane-b01/api-route-coverage.csv` `0599d5e6cc5b268dd50849d7bffa68b4a1f1b34a`
- `artifacts/ai-control-plane-b01/ui-command-toolability-matrix.csv` `49f279fd5436186d49d9ea9490ba9d1baac49d0a`

The release archive itself is the fifth generator: byte-identical across every replay (acceptance step 10 twice in-process; sha256 `23314a7513b3c87fb135caab534e5d6d708b1259508e88d17919d8b7d7acf456` on every run of the day).

## 8. Independent Gerber / ZIP verification

`independent-archive-verifier.ts` 80/80 PASS (in the acceptance suite) and `scripts/verify-release-independent.py` (gerbonara 1.6.3) PASS on the evidence ZIP — see `independent-gerber-verification.md`.

## 9. Benchmark-quality workflow, locally (`.github/workflows/benchmark.yml` steps)

- `pnpm run benchmark:validate` → exit 0, corpus `sirkit-stage9-core`, 63 packages, 0 diagnostics
- `pnpm exec tsc --noEmit` → 0
- `vitest run app/lib/benchmark/__tests__/stage-09-benchmark-core.test.ts app/lib/pcb/__tests__/stage-08-professional-routing.test.ts` → 2 files, 29/29
- `pnpm run stage10:test` → 56 files, 801/801

The GitHub Actions run for the B16.1C branch is recorded in `final-verdict.md` once the PR exists (the workflow runs on push).

## 10. Router recordings (local, real FreeRouting) — RECORDED

- `blinker-route-fixture.json`: 2 executions (one blocked attempt on the smallest fitted outline, one complete on 21 × 21 mm), FreeRouting 2.2.4 on the bundled JRE, ~19 s.
- `blinker-route-fixture-recovery.json`: 4 executions (H.6 retry qualification + H.13 re-qualification), ~37 s.
- Replay: acceptance 11 tests in ~6 s; recovery 9 tests in ~8 s; both deterministic across three consecutive replays.

## 11. Line-ending determinism finding (fixed before the PR) — RECORDED

The first recordings were made while the committed KiCad fixture copies were CRLF in the working tree (git stores them LF under the repository's `.gitattributes`). Because every catalog identity derives from `sha256(source)`, an LF checkout (CI) would have produced different asset ids, bindings and board revisions than the recording keys. Fix: the working copies were normalized to LF and `blinker-catalog.ts` normalizes `
` → `
` before parsing, so identities are the same on either checkout; both router fixtures were re-recorded (2 + 4 executions) and every prompt-to-Gerber suite plus the B11.5 closure replayed green (6 files, 51 tests). All digests in these artifacts are from the re-recorded run.
