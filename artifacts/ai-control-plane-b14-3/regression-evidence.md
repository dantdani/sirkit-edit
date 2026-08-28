# B14.3 — regression evidence

## New permanent suite

**`app/lib/project/__tests__/b14-3-stream-lifecycle-and-gates.test.ts`
(19 tests)** — the 13 mandated regressions:

| # | mandated case | test |
| --- | --- | --- |
| 1 | request stream never yields its first chunk (⇒ 408 at the deadline) | §B 8 (+ §A 1 at the primitive) |
| 2 | request abort before the first chunk (⇒ prompt 408) | §B 9 (+ §A 2/3 at the primitive) |
| 3 | request timeout invokes best-effort cancellation | §B 10 (+ §A 1/6) |
| 4 | cancellation never settles but the timeout response still arrives | §B 10, §A 4, §C 13 |
| 5 | oversized stream remains 413 (under the ACTIVE lifecycle) | §B 11 (+ B14.2 §B 9 unchanged) |
| 6 | loader invocation count stays ZERO for incomplete requests | §B 8/9/11 (counting authority + pin-fact factories; §B 12 proves a well-formed request still reaches resolution exactly once) |
| 7 | ACTUAL never-settling response body (a real `ReadableStream`) | §C 13 (+ §C 16 at the PRODUCTION channel over stubbed platform fetch — the direct R2 closure: `canceled === 1`) |
| 8 | the response reader receives cancellation | §C 13/14/16 |
| 9 | late response-body SUCCESS discarded (fully valid, correctly nonce-bound JSON after timeout ⇒ inert; channel stays one-shot) | §C 14 |
| 10 | late response-body REJECTION handled (unhandledRejection trap empty) | §C 15 (+ §A 5 at the primitive) |
| 11 | same-directory import tripwire (`./replacement-reauthorization` — THE R4 bypass) | §E 18 |
| 12 | parent-relative and alias import tripwires (+ dynamic, re-export, mixed-`./..` spellings; controller and intent-module variants) | §E 18 |
| 13 | all B14–B14.2 production integration and mutation guarantees remain green | full B14 (47) + B14.1 (13) + B14.2 (15) suites, unmodified behavior |

Plus: §A 7 proves the B10 DEFAULT is unchanged (no hidden deadline without
opt-in; completion and the ceiling byte-identical); §E 17 runs all four
capability gates against the real tree with the exact approved sets; §E 19
proves gate SOUNDNESS (the endpoint's `canonicalRevision` string literal is
not flagged).

## Corrected suites (strengthened or made truthful, never weakened)

- `b14-2-settlement-and-boundaries` — test 2 re-titled to the transport
  case it actually proves (assertions untouched; R3); gate 15b upgraded to
  the specifier-resolving `moduleImportOffenders` with the SAME approved
  set (R4); one pre-existing unused import removed. 15/15 green.
- The shared `_import-gate-helpers.ts` now backs both the B14.2 and B14.3
  §D/§E gates.

## Results

| battery | result |
| --- | --- |
| b14-3 suite | **19/19** |
| all B14 + B14.1 suites | green — **60 tests** (B14 47: proposal 20, apply 17, route 7, review 3; B14.1 13: approval 10, integration 3) — the R5-corrected figure |
| b14-2 suite | 15/15 |
| B09.2 (closure + recovery) | 23 green |
| B10 / B10.1 / B10.2 (over the extended reader) + B12.7 / B12.8 / B13.2 (both) / project-transition (B12.2/12.3/12.4) | green (16 files / 153 tests in the direct battery, re-confirmed in the full run) |
| **FULL SUITE** | **2733 passed / 20 skipped / 0 failures (2753; 316 files passed / 3 skipped)** |

One prior full-suite invocation flaked on `route-tool.test.ts` ("direct
live preview avoids catastrophic slowdown with 500 tracks") with a vitest
worker-RPC timeout (`Timeout calling "onTaskUpdate"`) under the 5-fork
load — a perf test unrelated to any B14.3 change; it passes 25/25 in
isolation and the clean full run above contains zero failures.

`tsc --noEmit` clean; scoped ESLint clean on every changed file; page.tsx
at its exact 14-problem baseline; `git diff --check` clean. Registry/tool
counts and every deterministic pin UNCHANGED
(`replay-trace-pins.json` = `e66dd9e06f48a658…`,
`composite-replay-fixtures.json` = `f18e47e0f14b2d1d…`,
`app/lib/pcb/types.ts` = `72ad7c7758b44414…`,
`pcb-shape-descriptor.ts` = `5501d810e583395d…`). No provider credits,
dependency changes, provider configuration changes, or secret exposure.

---

> **SUPERSESSION NOTE (B14.4).** Rows 11–12 (the §E import-gate tripwires)
> remain green, but the gate they exercised was regex-based and NOT
> complete: four TypeScript-valid spellings (comment-in-dynamic-import,
> comment-between-tokens, escaped literal, static concatenation) evaded it,
> and the walker inspected only `.ts`/`.tsx`. B14.4 replaced the shared
> helper with TypeScript AST extraction (same `moduleImportOffenders`
> signature, so these suites now run over the AST gate unmodified) and
> added the permanent `b14-4-ast-import-gates` suite (22 tests). §E tests
> 17/18 carry explicit 60 s timeouts for the one-time whole-tree parse.
> See `../ai-control-plane-b14-4/regression-evidence.md`.
