# B11.7 — validation summary

## Hashes, before and after the entire battery

```
BEFORE  app/lib/pcb/types.ts                              15088 bytes  sha256=72ad7c7758b4441422ba48ccd25c10c649f009b19a7d5167a9d2cdb0c42d19a5
BEFORE  app/lib/agent/generated/pcb-shape-descriptor.ts  213528 bytes  sha256=5501d810e583395de585315ee75b8e32f4a0f82db06a1949495ece836753a44d
AFTER   app/lib/pcb/types.ts                              15088 bytes  sha256=72ad7c7758b4441422ba48ccd25c10c649f009b19a7d5167a9d2cdb0c42d19a5
AFTER   app/lib/agent/generated/pcb-shape-descriptor.ts  213528 bytes  sha256=5501d810e583395de585315ee75b8e32f4a0f82db06a1949495ece836753a44d
```

**Identical.** Neither authoritative file was changed.

## Static gates

| Gate | Result |
| --- | --- |
| `npx tsc --noEmit` | **clean** |
| `npx eslint` over every changed file (`plain-capture.ts`, `pcb-shape-projection.ts`, `replay-context.ts`, `b11-7-primitive-discipline.test.ts`) | **clean** |
| `npx tsx scripts/generate-pcb-shape-descriptor.ts --check` | **OK** — 81 named types from 8 source files; graph `sha256-34cb69e527ca461d09cb8fdcc95854a0`; sources `sha256-cf412478820e4a9930a88b8c95e9cdbf` |
| `git diff --check` | **clean** (only pre-existing CRLF advisory warnings) |
| `generate-b11-artifacts` twice | all three artifacts byte-identical between runs and to the B11.6 baseline |

## Test battery

| Suite | Result |
| --- | --- |
| **B11.7** `b11-7-primitive-discipline` (new) | **10 / 10 passed** |
| B11.6 `b11-6-projection-ownership` | 17 / 17 passed |
| B11.5 `b11-5-capture-exactness` | 18 / 18 passed |
| B11.4 `b11-4-capture-ownership` / `b11-4-no-execution` | 17 / 17, 4 / 4 passed |
| B11.3 `b11-3-generated-pcb-shape` | 34 / 34 passed |
| B11.2 `b11-2-replay-context` | 20 / 20 passed |
| B11.1 `b11-1-trace-integrity` / `b11-1-route-finalization` | 30 / 30, 9 / 9 passed |
| B11 `b11-trace-replay-evaluation` | 16 / 16 passed |
| **B11 family total** | **175 / 175 passed** (10 files) |
| Agent runtime + chat route | **313 / 313 passed** (23 files) |
| Engineering + PCB lifecycle (B04–B08 gates) | **470 / 470 passed** (28 files) |
| Evaluation matrix | **19 / 19 cases, 59 / 59 checks** |
| **Full suite** `npx vitest run` | **2374 passed, 20 skipped, 0 failed** (286 files) |

**The full suite is completely green** — including every member of the
documented wall-clock flake family, so no failure classification was needed at
all this stage.

## Replay pins — all 19, unchanged

Byte-identical to the B11.6 baseline and stable across two consecutive
generator runs (`e01 eng1-0cbbe78e7b980149` … `e16 eng1-c46cd931ac564baa`,
unchanged since B11.3).

## Versioning — capsule v3 / context v2 remain correct

**No bump.** This is an in-process handling/type-guard correction. What a
conforming serialized document looks like did not change: non-JSON primitives
cannot exist in a serialized document at all, `isCapturedRecord` is a runtime
predicate, and every committed capsule validates unchanged and replays to its
unchanged pin.

## Confidence

### CONFIRMED

| Claim | Evidence |
| --- | --- |
| R1–R2 reproduced against production code before any edit | outputs captured verbatim, including the BigInt `JSON.stringify` throw, the NaN/Infinity→null normalization, the vanishing `value` key, and the empty-issue context acceptances |
| No projection reports `ok: true` for data capture refuses | six non-JSON primitives × three projectors, all `ok: false`, bounded and deterministic |
| Valid-JSON primitive roots are capturable-but-never-authoritative | `must be a plain object` structural issue from both projectors; `validateReplayContext` refuses them |
| Nested non-JSON values cannot be smuggled or normalized | a nested `NaN` refuses the whole board |
| Every `ok: true` result satisfies the recursive JSON invariant | serializable, value-present, meaning-preserving, finite-numbers-only, no undefined/bigint/symbol/function/accessor/symbol-key/foreign-prototype at any depth — over primitives, boards, contexts, all 19 committed contexts, and the special-key cases |
| `isCapturedRecord` runtime test matches its TypeScript claim | all nine required cases, plus both directions of the projected-vs-captured distinction |
| Every B11.6 closure preserved | identity-walk, hostile-proxy totality, ownership registry, parse-once (pins), no-execution probes |
| All 19 pins, both hashes, nine tools unchanged | recorded above |

### INFERRED

| Claim | Why not CONFIRMED |
| --- | --- |
| The JSON invariant holds for all possible capturable inputs | proven over every input class the stage names plus all committed contexts; capture's per-value refusal rules make a violating `ok: true` value unconstructible by argument, not by exhaustive test |
| Totality under all proxy behaviours | unchanged standing from B11.6 (105 probes) re-exercised here on the projection surface |

### PROPOSED

| Item | Note |
| --- | --- |
| `agentRunTraceDigest` capture-first | unchanged from B11.6 — internal/trusted by documentation; no untrusted data reaches it in production |
| A generated projection for a future *generic* PCB type | unchanged from B11.3 |

### UNKNOWN

| Item | Note |
| --- | --- |
| Live model behaviour through a real provider | both provider accounts remain out of credits; every proof here is provider-free by construction. No live call was made; no credits were spent. |

## Verdict

**Ready for independent verification.** The two contract defects are closed:
there is now exactly one JSON discipline — capture — and no projection can
succeed with data capture would refuse; the exported type predicate's runtime
test matches its type claim via the unforgeable ownership registry. Every
prior closure, all 19 pins, both authoritative hashes, and the nine-tool
exposure are unchanged, and the full suite is green with zero failures.
