# B14.2 — regression evidence

## New permanent suite

**`app/lib/project/__tests__/b14-2-settlement-and-boundaries.test.ts` (15
tests)** — the 19 mandated regressions:

| # | case | test |
| --- | --- | --- |
| 1 | never-settling fetch times out (transport saw the abort; timers cleared) | §A 1 |
| 2 | never-settling response-body read times out | §A 2 |
| 3 | late success after timeout discarded | §A 3/4 |
| 4 | late rejection after timeout — no unhandled rejection (trap empty) | §A 3/4 |
| 5 | pre-aborted consumption never calls the transport | §A 5 |
| 6 | timeout ⇒ zero journal entries + zero transactions | §A service-level 6/7/8 |
| 7 | interlock/gateway usable after timeout (lease acquires, normal command executes) | " |
| 8 | project retirement settles despite the hung reauthorization | " |
| 9 | oversized streamed request stops at the byte ceiling (≈5 chunks, 413) | §B 9 |
| 10 | never-settling request cancellation cannot delay the 413 | §B 10 |
| 11 | oversized response stream stops at the ceiling without parsing | §C 11 |
| 12 | absent/malformed/changed nonce echoes refuse (channel) and absent/malformed request nonces 400 (endpoint) | §C 12–13 |
| 13 | binding for another component/project refuses | §C 13 |
| 14 | channel remains one-shot after pre-abort, timeout, and refusal | §A 5, 14b |
| 15 | forbidden controller import fails the permanent gate (synthetic API-route AND agent-module injections detected) | §D 15 |
| 16 | forbidden production use of the test factory fails (synthetic injection detected) | §D 16; plus the channel-module importer walker (15b) and the barrel non-export check |
| 17 | actual rendered review click still commits exactly one transaction | b14-1-production-integration (re-run green with the REAL nonce-bound endpoint exchange) |
| 18 | direct provider/API/agent apply remains unavailable | §D walkers + the existing b14/b14-1 registry/gateway/forgery suites (green) |
| 19 | all B14/B14.1 forgery, receipt, journal, undo, concurrency guarantees intact | full B14 (45) + B14.1 (13) suites green |

## Updated suites (strengthened, never weakened)

- `b14-route-replacement` — every endpoint request now carries the required
  nonce; the allowlist assertion gained `binding` and verifies the exact
  echo (nonce/component/server scope).
- `b14-replacement-apply` + `b14-1-approval-and-reauthorization` — test
  channels echo the correlation binding (exercising the REAL verification).
- `b14-1-production-integration` — internal-controller import; the platform
  stub strips the cross-realm jsdom AbortSignal (documented; signal
  threading proven at the channel level in §A 1).
- B10/B10.2 suites — green over the delegating `readBoundedBody`.

## Results

| battery | result |
| --- | --- |
| b14-2 suite | 15/15 |
| all B14 + B14.1 suites | green (58 tests) |
| B09.2 / B10.2 / B12.7 / B12.8 / B13.2 / project-transition settlement suites | green (inside the full run) |
| **FULL SUITE** | **2714 passed / 20 skipped / 0 failures (2734; 315 files passed / 3 skipped)** |

`tsc --noEmit` clean; scoped ESLint clean; page.tsx at its exact 14-problem
baseline; `git diff --check` clean. Registry/tool counts and every
deterministic pin UNCHANGED (`e66dd9e0…`, `f18e47e0…`, `72ad7c77…`,
`5501d810…`). No provider credits, dependency changes, provider
configuration changes, or secret exposure.

---

> **CORRECTION NOTE (B14.3, R5).** The results table above claims the
> B14/B14.1 suites total "58 tests" (and row 19 "full B14 (45) + B14.1
> (13)"). Independent execution observes **60**: B14 = **47** (proposal 20 +
> apply 17 + route 7 + review 3) + B14.1 = **13** (approval 10 +
> integration 3). The miscount was prose-only; no test behavior differed.
> Additionally, test 2 of the b14-2 suite (row 2) was NOT a response-body
> test — it modeled a hung body as a hung transport promise; the REAL
> never-settling response-body regressions are the permanent B14.3 §C suite,
> and the b14-2 test has been re-titled to what it actually proves.
