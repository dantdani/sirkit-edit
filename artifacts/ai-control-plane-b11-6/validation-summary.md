# B11.6 — validation summary

> **PARTLY SUPERSEDED BY B11.7.** The verdict below predates the two
> counterexamples the independent verifier reproduced (B11.7 R1–R2). See
> [../ai-control-plane-b11-7/validation-summary.md](../ai-control-plane-b11-7/validation-summary.md).

## Hashes, before and after the entire battery

```
BEFORE  app/lib/pcb/types.ts                              15088 bytes  sha256=72ad7c7758b4441422ba48ccd25c10c649f009b19a7d5167a9d2cdb0c42d19a5
BEFORE  app/lib/agent/generated/pcb-shape-descriptor.ts  213528 bytes  sha256=5501d810e583395de585315ee75b8e32f4a0f82db06a1949495ece836753a44d
AFTER   app/lib/pcb/types.ts                              15088 bytes  sha256=72ad7c7758b4441422ba48ccd25c10c649f009b19a7d5167a9d2cdb0c42d19a5
AFTER   app/lib/agent/generated/pcb-shape-descriptor.ts  213528 bytes  sha256=5501d810e583395de585315ee75b8e32f4a0f82db06a1949495ece836753a44d
```

**Identical.** Neither authoritative file was changed by this correction.

## Static gates

| Gate | Result |
| --- | --- |
| `npx tsc --noEmit` | **clean** |
| `npx eslint` over every changed file (`plain-capture.ts`, `pcb-shape-projection.ts`, `replay-context.ts`, `trace.ts`, and the four touched test suites) | **clean** |
| `npx tsx scripts/generate-pcb-shape-descriptor.ts --check` | **OK** — 81 named types from 8 source files; graph `sha256-34cb69e527ca461d09cb8fdcc95854a0`; sources `sha256-cf412478820e4a9930a88b8c95e9cdbf` |
| `git diff --check` | **clean** (only pre-existing CRLF advisory warnings) |
| `generate-b11-artifacts` twice | all three artifacts byte-identical between runs and to the B11.5 baseline |

## Test battery

| Suite | Result |
| --- | --- |
| **B11.6** `b11-6-projection-ownership` (new) | **17 / 17 passed** |
| B11.5 `b11-5-capture-exactness` | 18 / 18 passed |
| B11.4 `b11-4-capture-ownership` / `b11-4-no-execution` | 17 / 17, 4 / 4 passed |
| B11.3 `b11-3-generated-pcb-shape` | 34 / 34 passed |
| B11.2 `b11-2-replay-context` | 20 / 20 passed |
| B11.1 `b11-1-trace-integrity` / `b11-1-route-finalization` | 30 / 30, 9 / 9 passed |
| B11 `b11-trace-replay-evaluation` | 16 / 16 passed |
| **B11 family total** | **165 / 165 passed** (9 files) |
| Agent runtime + chat route | **303 / 303 passed** (22 files) |
| Engineering + PCB lifecycle (B04–B08 gates) | **470 / 470 passed** (28 files) |
| Evaluation matrix | **19 / 19 cases, 59 / 59 checks** |
| **Full suite** `npx vitest run` | **2359 passed**, 20 skipped, **5 failed** (285 files) |

### The five full-suite failures — classified honestly

```
FAIL app/lib/passive-policy/__tests__/performance-property.test.ts  expected 5583.6 to be less than 5000
FAIL app/lib/pcb/__tests__/auto-place.test.ts                       Test timed out in 5000ms
FAIL app/lib/pcb/__tests__/connectivity-board.test.ts               expected 56.3 to be less than 50
FAIL app/lib/pcb/__tests__/pcb-repair-agent.test.ts                 expected 1635.7 to be less than 250
FAIL app/lib/pcb/__tests__/route-tool.test.ts                       Test timed out in 5000ms
```

Each reproduced in isolation — **all pass**: performance-property 3/3,
auto-place 8/8, connectivity-board 10/10, pcb-repair-agent 8/8, route-tool
25/25. Every failing assertion is a wall-clock budget or a wall-clock timeout;
none is behavioural; all five files are pre-existing members of the documented
flake family; B11.6 changed only `app/lib/agent/*`.

**One failure in the first full run WAS functional and was NOT dismissed:**
the B11.3 EXHAUSTIVE sweep timed out at vitest's default 5 s under parallel
load. That was a real consequence of this stage — capture-first projection
made the ~130-position sweep heavier. It was fixed by giving the two
deliberately exhaustive sweeps explicit 120 s timeouts (matching the suite's
drift gates, assertions untouched), after which the sweep passes in the full
parallel run — verified, not assumed.

## Replay pins — all 19, unchanged

Byte-identical to the B11.5 baseline and stable across two consecutive
generator runs (`e01 eng1-0cbbe78e7b980149` … `e16 eng1-c46cd931ac564baa`,
full table unchanged since B11.3).

## Versioning — capsule v3 / context v2 remain correct

> [superseded 2026-09-29 by the B21 closeout (D21-27, OD-113): true for B11.6's own stage; the capsule is `sirkit.agent-replay-capsule.v4` since B21-F, a v3 document refused explicitly, and the context stays `sirkit.agent-replay-context.v2` - `artifacts/ai-control-plane-b21/evaluation-matrix.md` section 2]

**No bump.** This is a handling/ownership correction: what a conforming
serialized document looks like did not change. Projection results gained a
discriminated envelope, but a projection result is an in-process value, not a
wire document; every committed capsule validates unchanged and replays to its
unchanged pin. A regression pins both version strings.

## Confidence

### CONFIRMED

| Claim | Evidence |
| --- | --- |
| R1–R5 reproduced against production code before any edit | outputs captured verbatim |
| No exported projection returns caller identity — original object, nested object, proxy, accessor-backed object, or executable identity — on success or refusal | explicit failure results; identity-walk over board, context, and accepted-context projections; trap counters unchanged when reading projections |
| `projectReplayContext` and `validateCapturedReplayContext` are total | direct revoked-proxy probes + the 105-probe matrix (7 families × 15 boundaries) |
| The captured-only entries are runtime-ENFORCED, not documented-only | ownership-registry membership: owned → zero-copy (identity-asserted), foreign plain → captured copy, hostile → refusal; the registry is unforgeable (caller-frozen and cloned objects are foreign) |
| The depth parameter is enforced again | `findNonPlainJsonPath({}, "$", 33)` reports exhaustion; starting depth shares the recursion budget |
| Parse-once preserved | fast-path identity assertion + all 19 pins byte-identical |
| Every prior closure held | hooks/accessors zero, mutation-after-replay irrelevant, sparse refusal, descriptor gates, no-execution probes, nine tools, no test writes |
| Both authoritative hashes unchanged | SHA-256 before/after recorded above |

### INFERRED

| Claim | Why not CONFIRMED |
| --- | --- |
| Totality under *all* possible proxy behaviours | 105 + 80 probes across seven/eight families; the guards are per-operation by construction, but a proxy is arbitrarily adversarial |
| The identity-walk generalizes to all inputs | it is proven for representative plain inputs at every depth; for non-plain inputs the capture refusal makes sharing impossible by construction rather than by walk |

### PROPOSED

| Item | Note |
| --- | --- |
| Migrating `agentRunTraceDigest` to capture-first | currently internal/trusted by documentation; capture-first would touch the digest path all 19 pins depend on, for a boundary no untrusted data reaches in production |
| A generated projection for a future *generic* PCB type | unchanged from B11.3; the generator fails closed today |

### UNKNOWN

| Item | Note |
| --- | --- |
| Live model behaviour through a real provider | both provider accounts remain out of credits; every proof here is provider-free by construction. No live call was made; no credits were spent. |

## Verdict

**Ready for independent verification.** The projection surface now satisfies
the B11.5 requirement it violated — no hostile caller proxy, and no
caller-owned identity of any kind, is ever returned as a projection, on any
path — with an explicit discriminated failure contract, runtime-enforced
captured-only entries, a preserved parse-once invariant, and an enforced depth
bound. All 165 B11-family tests, all 19 pins, both authoritative hashes, and
the nine-tool exposure are unchanged. The full battery is green apart from
five isolated-pass wall-clock failures in pre-existing flake-family files, and
the one functional timeout this stage itself caused was fixed and re-verified
rather than dismissed.
