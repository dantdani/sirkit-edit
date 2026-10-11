# B24-F - Performance and reliability report

Labels: **CONFIRMED** (read at the cited file:line at `58c0834`, or executed and measured), **INFERRED** (a reading, nothing executed),
**RECORDED** (taken from a record without a claim of our own), **UNKNOWN**, **BLOCKED-LIVE-QUALIFICATION** (needs a live resource the
owner has not supplied; never faked, never claimed). Base: `58c0834`. Written from B24-D1, D2 and D3's records
(`artifacts/ai-control-plane-b24/performance-and-reliability.md:8`, `:507`; `artifacts/ai-control-plane-b24/accessibility.md:1`) and
the lead's CI reading of B24-D4's run.

## 1. BENCHMARK-QUALITY RESULT

**BLOCKED** (`baseline_missing`; never a pass): the latest version of `artifacts/ai-control-plane-b24/latency-baseline.json` is v1,
declared without values, because the owner has not accepted the benchmark job's Actions minutes (OD-212, OD-30). Under lead decision D3,
`baseline_missing` is a recorded, non-blocking BLOCKED state while that v1 is the latest version: it is never counted as a pass and
never as a red. `unmeasured`, `sample_shortfall` and any regression (`block`) always block, D2's memory metrics included; once a version
with runner values is appended, `baseline_missing` blocks too (`artifacts/ai-control-plane-b24/performance-and-reliability.md:118`).

The latency gate's states, as `scripts/b24-latency-gate.ts` evaluates them (`LATENCY_STATES`,
`app/lib/qualification/latency-policy.ts:336`):

| state | blocks | B24-F's reading |
|---|---|---|
| `pass` | no | the metric is within its baseline's budget; no metric can be `pass` while the baseline is v1 without values |
| `block` | yes | a regression beyond the practical regression, the noise band and the floor |
| `baseline_missing` | no while the latest baseline is the declared-without-values v1 (D3); yes after | printed as BLOCKED, never as pass |
| `sample_shortfall` | yes | fewer samples than the metric's count |
| `unmeasured` | yes | a catalogued metric absent from the results |

No run of `benchmark-latency` is recorded since B24-D1 appended it (`NON_LIVE_GATES`, `eval-catalog-and-results.md` section 4): the
CI state of the latency and memory metrics is not exercised, and nothing here is a measured CI latency.

## 2. CI timing (the lead's reading of B24-D4's run, **RECORDED**)

Run 38076687384 on `6e4e1bb` was green in every job: `page-browser-e2e` 21 min 47 s of 30 (headroom 8 min 13 s);
`page-browser-e2e-b24` 6 min 20 s of 20 (headroom 13 min 40 s); `prompt-to-gerber` 9 min 26 s of 25; `agent-boundary-suites` 4 min 55 s
of 20. Each is at least OD-30's five minutes from its limit; no `timeout-minutes` was raised. B24-F adds its four `b24-f-*`
suites to prompt-to-gerber, which runs all of `app/lib/qualification/__tests__`: run together on the workstation they took 21.8 s
(`b24-f-maps` 18.7 s, the other three under 0.6 s each). That is a local reading, not a CI measurement; the job's next run
records its CI duration against the 25-minute limit.

## 3. Latency and the threshold census (B24-D1; D24-27, D24-28)

- A closed metric catalogue (view and read commands, a granted reversible edit, one verified workflow on recordings, the first stream
  event and completion) with fixed warm-ups and samples, `sirkit.latency-results.v1` and the append-only `sirkit.latency-baseline.v1`,
  gated on regression against the runner baseline with a noise band; no absolute target until the owner sets one (OD-212). Measured
  locally only (`performance-and-reliability.md:80`).
- The threshold census (`artifacts/ai-control-plane-b24/threshold-census.csv`, byte-pinned by `b24-d1-threshold-census`): every
  CI-gated real-clock bound classified, deadline-proof bounds kept and performance bounds moved to the benchmark job, each move recorded.

## 4. Reliability (B24-D2, B24-D4; D24-29, D24-30, D24-31)

- **Large boards** (D24-29 in part, OD-213): the bounded paged read `sirkit.pcb.board-page-inspect` reads every recorded routed board
  within 48,000 characters a page (`b24-d2-board-read`); a strict-mode provider cannot call it with its optional arguments unset
  (D24-43, open; OD-236 proposed).
- **Memory** (OD-212's memory half): six memory metrics in `b24-d2-memory`, under the same baseline rule; not exercised in CI.
- **Two tabs, a crash, a restart** (D24-30, OD-214): the working copy is compare-before-write across tabs, a crash mid-commit is named
  on reopen, and a PGlite restart is proven (`b24-d2-working-copy`, `b24-d2-crash-recovery`, `b24-d2-restart-pglite`); the browser
  specs `multi-tab` and `crash-recovery` run in `page-browser-e2e-b24`. OD-214's open item stays: a committing tab stalled past the
  commit window (INFERRED, not run). A real-store restart and database failover are BLOCKED-LIVE-QUALIFICATION (LB-14).
- **Process cleanup** (D24-31's remainder, OD-145): FreeRouting and kicad-cli end the whole tree (`b24-d2-process-cleanup`); the live
  orphan checks are BLOCKED-LIVE-QUALIFICATION (LB-3, LB-17).

## 5. Accessibility and responsive scope (B24-D3; D24-32)

The accessible-name rule over B17-A's control sites with its byte-pinned census (`b24-d3-accessible-names`), the in-scope names and
announcements, the BOM dialogs on the shared dialog (`b24-d3-bom-dialogs`), the keyboard and minimum-width specs in
`page-browser-e2e-b24`; desktop only at 1,280 CSS px with a notice below it (OD-215). WCAG 2.2 AA and an axe dependency stay the
owner's (UNKNOWN; OD-215).

## 6. What is not measured (never estimated)

- Any CI latency figure of the catalogued metrics, and the runner baseline (BLOCKED until OD-212's minutes are accepted).
- Database failover, a replica and a real-store restart (LB-14); the live orphan checks (LB-3, LB-17).
- Latency on a hosted deployment (LB-13).
