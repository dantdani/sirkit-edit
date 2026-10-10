# B24-F - Evaluation catalog and results

Labels: **CONFIRMED** (read at the cited file:line at `58c0834`, or executed and measured), **INFERRED** (a reading, nothing executed),
**RECORDED** (taken from a record without a claim of our own), **UNKNOWN**, **BLOCKED-LIVE-QUALIFICATION** (needs a live resource the
owner has not supplied; never faked, never claimed). Base: `58c0834`. Written from B24-B1's catalog (`app/lib/evaluation/golden-catalog.ts`,
`sirkit.golden-eval-catalog.v1` 1.0.0, OD-203), B24-B2's admissions (`artifacts/ai-control-plane-b24/ci-admission.md:1`), B24-B3's
scenario map (`app/lib/evaluation/scenario-map.ts`, OD-206) and B24-B3's live-suite registry (`app/lib/evaluation/live-suites.ts`).

## 1. Scores, one per class, never summed (runbook `:1070`)

`renderClassScoreLines()` at `58c0834`, verbatim (`b24-f-verdict-lines` 10 re-derives each line). Each line is one class's own rows: a
fake-backed pass cannot hide a missing live test, and no line, field or verdict adds two classes up.

```text
deterministic offline: failing - covered 18, in part 0, missing 0, blocked 0, failing 1, not applicable 0; outside pull-request CI 1; live blockers none
model-in-loop: BLOCKED-LIVE-QUALIFICATION - covered 0, in part 0, missing 0, blocked 19, failing 0, not applicable 0; outside pull-request CI 0; live blockers LB-2, LB-7, LB-9
browser E2E: incomplete - covered 8, in part 5, missing 3, blocked 0, failing 0, not applicable 3; outside pull-request CI 0; live blockers LB-1, LB-8, LB-13
database-backed: incomplete - covered 3, in part 0, missing 5, blocked 0, failing 0, not applicable 11; outside pull-request CI 0; live blockers none
external-provider staging: BLOCKED-LIVE-QUALIFICATION - covered 0, in part 0, missing 0, blocked 6, failing 0, not applicable 13; outside pull-request CI 0; live blockers LB-1, LB-11, LB-12, LB-13, LB-15, LB-16
physical-hardware validation: failing - covered 0, in part 0, missing 0, blocked 3, failing 1, not applicable 15; outside pull-request CI 0; live blockers LB-3, LB-5, LB-10, LB-17
```

- **deterministic offline** is `failing` on one row: power and ground, B24-B2's recorded counterexample (D24-42, OD-229 proposed).
- **physical-hardware validation** is `failing` on one row: B22-D's diagnostic live run, class 4 NOT CONTAINED (`sandbox-security-report.md`).
- The three live classes each carry their live blockers: model-in-loop LB-2, LB-7, LB-9; external-provider staging LB-1, LB-11, LB-12,
  LB-13, LB-15, LB-16; physical-hardware validation LB-3, LB-5, LB-10, LB-17. Nothing in B24 exercised a live class.
- No verdict is a pass: the closed four are `failing`, `BLOCKED-LIVE-QUALIFICATION`, `covered` and `incomplete`, and no class is `covered`.

## 2. CI admissions (B24-B2, OD-204; **RECORDED** from its page)

The 33 suites of D24-15 and three catalogued opt-in live suites ride prompt-to-gerber (D0 later moved 25 of them to the appended
`agent-boundary-suites` job, OD-30); the corpus rides `benchmark-nightly` behind `SIRKIT_B24_CORPUS_NIGHTLY`; the power-ground evaluation
and the browser order case were added (`artifacts/ai-control-plane-b24/ci-admission.md:8`). The catalog's CI jobs are derived from the
workflows by the test-only `_ci-admission.ts`.

## 3. The twenty scenarios (B24-B3, OD-206; `artifacts/ai-control-plane-b24/scenario-map.csv`)

| scenario | standing | live blockers |
|---|---|---|
| 1 | demonstrated | none |
| 2 | in part | none |
| 3 | in part | none |
| 4 | demonstrated offline only | LB-15 |
| 5 | demonstrated | none |
| 6 | demonstrated | none |
| 7 | in part | none |
| 8 | by refusal | LB-8 |
| 9 | demonstrated offline only | LB-3, LB-8 |
| 10 | demonstrated | none |
| 11 | demonstrated | none |
| 12 | in part | LB-3, LB-17 |
| 13 | demonstrated | none |
| 14 | demonstrated offline only | LB-15, LB-11 |
| 15 | demonstrated offline only | LB-16 |
| 16 | in part | none |
| 17 | by recorded deviation | LB-9 |
| 18 | blocked | LB-10 |
| 19 | demonstrated | none |
| 20 | by refusal | LB-12 |

Scenario 17 is a recorded deviation (disagreement escalates to the human, never resolved to a winner) and 18 is blocked (B22, LB-10),
as OD-206's default states. The standings are the map's; `scenario-map.md` gives each one's evidence and what it does not cover.

## 4. Non-live gates (`NON_LIVE_GATES`, lead decision D2): listed apart, no class and no LB

Each runs only when its flag is exactly "1" and only in the CI job that sets it; none is a catalog class and none carries a live
blocker. Each is `not exercised` in CI: no run of its job is recorded since the suite was admitted (each entry's own recorded state).

| gate | suite | flag | CI job | kind | in CI |
|---|---|---|---|---|---|
| b24-b2-corpus-nightly | `app/lib/qualification/__tests__/b24-b2-corpus-nightly.test.ts` | `SIRKIT_B24_CORPUS_NIGHTLY` | `benchmark-nightly` (`.github/workflows/benchmark.yml`, schedule and dispatch) | scheduled-benchmark | not exercised |
| b24-d1-latency | `app/lib/qualification/__tests__/b24-d1-latency.test.ts` | `SIRKIT_B24_BENCHMARK` | `benchmark-latency` (`.github/workflows/benchmark.yml`, every trigger) | non-live | not exercised |
| b24-d1-latency-workflow | `app/lib/qualification/__tests__/b24-d1-latency-workflow.test.ts` | `SIRKIT_B24_BENCHMARK` | `benchmark-latency` (`.github/workflows/benchmark.yml`, every trigger) | non-live | not exercised |
| b24-d2-memory | `app/lib/qualification/__tests__/b24-d2-memory.test.ts` | `SIRKIT_B24_BENCHMARK` | `benchmark-latency` (`.github/workflows/benchmark.yml`, every trigger) | non-live | not exercised |

Their local flagged runs are recorded beside them in the registry (RECORDED, never a CI run): the corpus red at B24-B2 (three CD-9
packages) and green since B24-D1's executor (D24-41); the latency and memory suites green at B24-D1 and B24-D2.

## 5. What stays open (INFERRED)

- The model-in-loop and external-provider staging classes stay BLOCKED-LIVE-QUALIFICATION until the owner supplies credits with a cap,
  isolated projects and accounts (OD-216, OD-191); the physical class until OD-218 is answered.
- The power-ground row stays `failing` until the owner decides OD-229 (D24-42).
