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

The release archive itself is the fifth generator: byte-identical across every REPLAY of the committed recording under the frozen clock `2026-09-07T12:00:00.000Z` (acceptance step 10 twice in-process; sha256 `5cd671810e87cfe805a91d83406fe456c2cc802320ba5b6e9a31341b1667ef66` on every replay). [B16-A corrected: F15 — this line said "on every run of the day"; the clock is frozen in the harness, so the claim is about replays, not calendar time; F8 — the sha256 changed with the locale fix `8746b46` and is substituted by the orchestrator.]

## 8. Independent Gerber / ZIP verification

`independent-archive-verifier.ts` 80/80 PASS (in the acceptance suite; 78 unconditional + 2 expectation rows — counted from source in B16-A, CONFIRMED; the H.14 matrix row that said 61 was wrong, F16) and `scripts/verify-release-independent.py` (gerbonara 1.6.3; local only, not in CI; checks layer presence, parseability, outline closure/extent, drill ≥ 0.30 mm and bounding-box containment — not manifest digests, member sha256s, release id or counts, F17) PASS on the evidence ZIP of the pre-F8 recording — see `independent-gerber-verification.md`. The result on the re-recorded (`8746b46`) archive is UNKNOWN in this document pass.

## 9. Benchmark-quality workflow, locally (`.github/workflows/benchmark.yml` steps)

- `pnpm run benchmark:validate` → exit 0, corpus `sirkit-stage9-core`, 63 packages, 0 diagnostics
- `pnpm exec tsc --noEmit` → 0
- `vitest run app/lib/benchmark/__tests__/stage-09-benchmark-core.test.ts app/lib/pcb/__tests__/stage-08-professional-routing.test.ts` → 2 files, 29/29
- `pnpm run stage10:test` → 56 files, 801/801

The GitHub Actions `benchmark` workflow runs on the pushed branch (PR https://github.com/dantdani/sirkit-edit/pull/5); its status at report time is stated in the closing report and in `final-verdict.md`.

## 10. Router recordings (local, real FreeRouting) — RECORDED

- `blinker-route-fixture.json`: 2 executions (one blocked attempt on the smallest fitted outline, one complete on 21 × 21 mm), FreeRouting 2.2.4 on the bundled JRE, ~19 s.
- `blinker-route-fixture-recovery.json`: 4 executions (H.6 retry qualification + H.13 re-qualification), ~37 s.
- Replay: acceptance 11 tests in ~6 s; recovery 9 tests in ~8 s; both deterministic across three consecutive replays.

## 11. Line-ending determinism finding (fixed before the PR) — RECORDED

The first recordings were made while the committed KiCad fixture copies were CRLF in the working tree (git stores them LF under the repository's `.gitattributes`). Because every catalog identity derives from `sha256(source)`, an LF checkout (CI) would have produced different asset ids, bindings and board revisions than the recording keys. Fix: the working copies were normalized to LF and `blinker-catalog.ts` normalizes `
` → `
` before parsing, so identities are the same on either checkout; both router fixtures were re-recorded (2 + 4 executions) and every prompt-to-Gerber suite plus the B11.5 closure replayed green (6 files, 51 tests). All digests in these artifacts were from that re-recorded run until B16-A; the F8 locale fix (`8746b46`) re-recorded them again, and the identity values are now shown as `IDENTITY` placeholders substituted by the orchestrator.

## 12. B16-A test-integrity corrections — RECORDED from the commits, files CONFIRMED present

Every number in §1–§11 above is from the B16.1C run at `c82d1cb`. The B16-A adversarial review (ledger `artifacts/remaining-builder-program/EXECUTION_LEDGER.md`, "B16-A adversarial review") found the following test-integrity defects; each is corrected on the branch. This document pass ran NO tests: the files below are CONFIRMED to exist with the named cases (read from source); their pass status after `8746b46` is UNKNOWN here.

| # | Defect (CONFIRMED by the review) | Correction | Commit | Test file(s) now covering it |
|---|---|---|---|---|
| F19 | the panel "stale confirmation → retry" test was tautological: the hook re-sent the same stale pin | retry after `MFG_AUTHORITY_CONFIRMATION_MISMATCH` / `MFG_AUTHORITY_STALE` re-hydrates and asks for a NEW confirmation; the test asserts the fresh pin and that the refused pins are never resent; a transport failure retries the same pins | `92c9601` | `app/components/pcb/__tests__/manufacturing-workflow-panel.test.tsx` ("F19 stale confirmation…", "F19 stale authority…", "F19 transport failure…") |
| F20 | no positive route test for MATCHING confirmation pins; no type-contract negative | positive 200 through the real route with the ledger naming the confirmed head; `it.each` negatives for missing / mistyped / wrong-value pins; closed-body test; 404 before the confirmation is demanded | `3231f3f` | `app/api/pcb/release/__tests__/b16-a-release-confirmation.test.ts`; `app/api/__tests__/b16-0-15-tranche-parity.test.ts` (3 added `it(` blocks: F3 undeclared key refused with zero durable work; F5 `MFG_DESIGN_SCOPE_MISMATCH`; F6 client locator REFUSED, not ignored) |
| F21 | recorded fixtures replace the whole production router, masking TS routing-integration regressions | opt-in live run `SIRKIT_B16_1C_LIVE_ROUTER=1` (real executor, no recording, no replay; identities not asserted); limitation recorded in `unknowns-and-owner-decisions.md` #3 | `850ee3e` | `…/__tests__/fixtures/route-fixture.ts` (`liveRouterRequested`), `…/__tests__/acceptance-pipeline.test.ts` + `recovery-pipeline.test.ts` (live branch) |
| F22 | tranche-parity helper hard-coded `verifiedAt: "2026-09-07"` without a fake clock (would fail after 2027-09-08) | `VERIFIED_TODAY = new Date().toISOString().slice(0, 10)` | `3231f3f` | `app/api/__tests__/b16-0-15-tranche-parity.test.ts` line 86 |
| F23 | `getSnapshotHead`, authority `getHead`/`save` digest branches and the summary reader untested | behavioural tests: absent / valid / tampered heads (record digest rewritten OR payload rewritten under an intact digest), idempotent save, `MFG_AUTHORITY_SAVE_UNVERIFIED`, stale-head `DW_OPTIMISTIC_REVISION_CONFLICT`; summary reader integrity per subject | `f69178a`, `92c9601` | `app/lib/pcb-sync/__tests__/b16-a-durable-heads.test.ts`; `app/lib/pcb/fab/__tests__/b16-a-authority-store.test.ts`; `app/api/pcb-sync/__tests__/b16-a-manufacturing-summary.test.ts` |
| F24 | `runOwnedRelease` stale / thrown branches untested | refused-busy, completed, failed, stale, error, thrown-while-stale, zombie-generation cases against the production registry + lifecycle owner | `f69178a` | `app/lib/pcb/lifecycle/__tests__/b16-a-owned-release.test.ts` |
| F25 | `include=<other>` refusal and reader-absent untested | `include=foo` → 422 `PS_API_UNKNOWN_FIELD` with or without a reader; `include=manufacturing` without a configured reader → 422; no `include` → no manufacturing block; viewer passthrough; corrupt head → HTTP 200 + `integrity.authority: corrupt`; client round trip | `92c9601` | `app/api/pcb-sync/__tests__/b16-a-manufacturing-summary.test.ts` ("B16-A F25 — board read `include` surface…") |
| F26/F27 | the protected-original tripwire passed VACUOUSLY on any machine without `C:\Users\robsa\sirkit` | `it.skipIf(!existsSync(PROTECTED_ORIGINAL))` — reported SKIPPED, never a vacuous pass; path overridable with `SIRKIT_PROTECTED_ORIGINAL_PATH` | `f69178a` | `app/api/__tests__/b16-1c-invariant-tripwires.test.ts` lines 121–125 |
| F28 | raw-route baseline sha1 for `POST /api/pcb-sync` was stale (B16.1C edited the route; the baseline kept the `b7bb6d6` sha1) and the sha1 was informational only | baseline regenerated by the sanctioned generator; the ratchet compares every baseline entry's sha1 with the route source on disk ("no drift: same keys AND the same per-route source sha1") | `f69178a` | `app/lib/auth/__tests__/b16-0-8-migration-ratchet.test.ts`; `app/lib/auth/__tests__/_raw-route-baseline.json` |
| F1 | (code) per-route constant correlation id | per-request id | `cee3b04` | `app/lib/auth/__tests__/b16-a-correlation-id.test.ts` (3 cases) |
| F2/F7 | (code) non-atomic board publish; process-local guard | one durable commit; durable lease | `3231f3f`, `fba0e1e` | `app/lib/pcb/fab/__tests__/b16-a-qualification-commit.test.ts` (F2 ×7, F7 ×4 cases); tripwire |
| F4 | (code) board-vs-board parity | snapshot-derived parity | `3231f3f` (module moved to `app/lib/pcb/fab/` in `e0efcfb`) | `app/lib/pcb/fab/__tests__/b16-a-snapshot-netlist-parity.test.ts` (5 cases incl. 3 reproductions) |
| F8 | (code) locale-dependent identities | `stable-compare` | `8746b46` (+ `e0efcfb`, `7d341ff`: B05/B06/B11 replay fixtures, pins and the raw-route baseline regenerated under the new canonicalization) | `app/lib/pcb/__tests__/b16-a-locale-independent-identities.test.ts` |
| F9 | no test asserted the recorded identities; no CI workflow ran the suites | pinned identities asserted on every replay (`EXPECTED_IDENTITIES_MISSING` if the JSON is absent; skipped only under the live router); deterministic-manufacturing workflow on every `pull_request` and push to `main` | `850ee3e`, `4da76b8` (committed; PROPOSED-until-merged as a `main` gate — the ledger RECORDS a green ubuntu-latest run) | `…/fixtures/expected-identities.{ts,json}`; `.github/workflows/deterministic-manufacturing.yml` |
| F11 | (code) hidden auto-apply of provider output | staged in the review dialog | `d795aba` | `app/api/__tests__/b16-a-review-corrections-tripwires.test.ts` (4 F11 cases + 2 F3/F6 cases) |
| F12–F14, F18 | (code/UI) corrupt heads swallowed; idle label after failed hydration; any member saw the release dialog; "independently read back" text | integrity per subject; `hydration_failed`; `viewer.canRelease`; corrected text | `92c9601` | panel test cases "F12", "F13", "F14"; panel test asserts the exact new result text and `not.toMatch(/independently read back/)` |

Counts in §1 that B16-A changed: the panel suite has 11 `it(` blocks (was 6), tranche-parity gained 3 `it(` blocks (`3231f3f`), acceptance/recovery gained the pinned-identity assertions and the live-router branch (working tree). No test was disabled, weakened or re-classified.

## 13. Router env switches (RECORDED from source)

- `SIRKIT_B16_1C_RECORD_ROUTES=1` — record with the REAL bundled FreeRouting (local runtime required); re-writes `blinker-route-fixture.json`, `blinker-route-fixture-recovery.json` and `expected-identities.json`. CONFIRMED (`route-fixture.ts` `RECORD_ROUTES_ENV`).
- `SIRKIT_B16_1C_LIVE_ROUTER=1` — run the REAL executor without recording or replaying; every gate asserted, pinned identities NOT asserted; ignored when recording is also requested. CONFIRMED present (`route-fixture.ts` `LIVE_ROUTER_ENV`, `850ee3e`, F21); never run in this pass (UNKNOWN outcome).
- Neither switch is set in CI; the deterministic-manufacturing workflow (`850ee3e`/`4da76b8`; PROPOSED-until-merged as a `main` gate) replays only.

Counts, tokens and labels in this file: the `IDENTITY` placeholder stands for the re-recorded identity the orchestrator substitutes; every B16-A count above (80, 26, 11, 3; 8 `DATABASE_URL` occurrences in `git diff b7bb6d6..adda8e5`, none a value) was counted from source or `git` in this pass (CONFIRMED); every "green" statement about B16-A suites is RECORDED from the ledger or UNKNOWN, never observed here.
