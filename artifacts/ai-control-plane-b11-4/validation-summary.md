# B11.4 — validation summary

> **PARTLY SUPERSEDED BY B11.5.** The verdict below predates the three
> counterexamples an independent verifier reproduced (B11.5 R1–R3). See
> [../ai-control-plane-b11-5/validation-summary.md](../ai-control-plane-b11-5/validation-summary.md)
> for the current battery, the before/after hashes, the 19 pins (all still
> unchanged), and the current verdict.

## Hashes, before and after the entire battery

```
BEFORE  app/lib/pcb/types.ts                              15088 bytes  sha256=72ad7c7758b4441422ba48ccd25c10c649f009b19a7d5167a9d2cdb0c42d19a5
BEFORE  app/lib/agent/generated/pcb-shape-descriptor.ts  213528 bytes  sha256=5501d810e583395de585315ee75b8e32f4a0f82db06a1949495ece836753a44d
AFTER   app/lib/pcb/types.ts                              15088 bytes  sha256=72ad7c7758b4441422ba48ccd25c10c649f009b19a7d5167a9d2cdb0c42d19a5
AFTER   app/lib/agent/generated/pcb-shape-descriptor.ts  213528 bytes  sha256=5501d810e583395de585315ee75b8e32f4a0f82db06a1949495ece836753a44d
```

**Identical.** No test wrote either file.

## Static gates

| Gate | Result |
| --- | --- |
| `npx tsc --noEmit` | **clean** |
| `npx eslint app/lib/agent scripts/pcb-shape-descriptor-build.ts scripts/generate-pcb-shape-descriptor.ts` | **clean** |
| `npx tsx scripts/generate-pcb-shape-descriptor.ts --check` | **OK** — 81 named types from 8 source files; graph `sha256-34cb69e527ca461d09cb8fdcc95854a0`; sources `sha256-cf412478820e4a9930a88b8c95e9cdbf` |
| `generate-b11-artifacts` twice | all three artifacts byte-identical between runs **and** to the B11.3 baseline |
| `generate-agent-artifacts` | 9 statically exposed tools (27 registered) — unchanged |

## Test battery

| Suite | Result |
| --- | --- |
| **B11.4** `b11-4-capture-ownership` (new) | **17 / 17 passed** |
| **B11.4** `b11-4-no-execution` (new) | **4 / 4 passed** |
| B11.3 `b11-3-generated-pcb-shape` | 34 / 34 passed |
| B11.2 `b11-2-replay-context` | 20 / 20 passed |
| B11.1 `b11-1-trace-integrity` | 30 / 30 passed |
| B11.1 `b11-1-route-finalization` | 9 / 9 passed |
| B11 `b11-trace-replay-evaluation` | 16 / 16 passed |
| **B11 family total** | **130 / 130 passed** (7 files) |
| Agent runtime + chat route | **268 / 268 passed** (20 files) |
| Engineering + PCB lifecycle (B04–B08 gates) | **470 / 470 passed** (28 files) |
| Evaluation matrix | **19 / 19 cases, 59 / 59 checks** |
| **Full suite** `npx vitest run` | **2323 passed**, 20 skipped, **6 failed** (283 files) |

### The six full-suite failures

```
FAIL app/components/pcb/__tests__/assignment-queue-panel.test.tsx
FAIL app/lib/pcb/__tests__/auto-place.test.ts            (2 tests)  expected 767 to be less than 500
FAIL app/lib/pcb/__tests__/connectivity-board.test.ts               expected 64.1 to be less than 50
FAIL app/lib/pcb/__tests__/pcb-repair-agent.test.ts                 expected 606.6 to be less than 250
FAIL app/lib/pcb/__tests__/route-tool.test.ts                       expected 80.4 to be less than 50
```

Each reproduced in isolation per protocol — **all pass**:

```
auto-place              8 / 8      connectivity-board  10 / 10
pcb-repair-agent        8 / 8      route-tool          25 / 25
assignment-queue-panel  2 / 2      (re-run three times, green each time)
```

**Classification: timing-only, pre-existing, unrelated.** All five files are
named members of the documented flake family (auto-place, route-tool,
connectivity-board, pcb-repair-agent, compute-fill, arrange, run-drc,
assignment-queue-panel) that misses wall-clock budgets under parallel suite
load. B11.4 changed no placement, routing, DRC, connectivity, or assignment
code. **No threshold was relaxed.**

## Replay pins — all 19, unchanged

Byte-identical to the B11.3 baseline, and stable across two consecutive
generator runs.

| Case | Digest | vs B11.3 |
| --- | --- | --- |
| e01-no-canonical-state | `eng1-0cbbe78e7b980149` | unchanged |
| e02-schematic-only | `eng1-1f1ff2fab230d7c9` | unchanged |
| e03-valid-board | `eng1-54402fed3e12951c` | unchanged |
| e04-invalid-board | `eng1-97a8cd4fb3f78a64` | unchanged |
| e05-resource-fail-closed | `eng1-29e7d5746329de75` | unchanged |
| e06a-selection-absent | `eng1-76d3efc6c0e646dd` | unchanged |
| e06b-selection-malformed | `eng1-b8edda63ec3a30aa` | unchanged |
| e06c-selection-valid | `eng1-82a4ff34df4fc391` | unchanged |
| e07a-netlist-proven | `eng1-8776aa4dbe5aa66e` | unchanged |
| e07b-netlist-forged | `eng1-3fc4a39c53a509c5` | unchanged |
| e08-kicad-netlist-withheld | `eng1-9c4bb64d7487c822` | unchanged |
| e09-mutation-not-exposed | `eng1-3644277af61264c9` | unchanged |
| e10-proposal-only | `eng1-2bfd85ba305e5b53` | unchanged |
| e11-terminal-safety | `eng1-3e3d8852e8248885` | unchanged |
| e12-provider-quota | `eng1-903b550f607ff13c` | unchanged |
| e13-no-fallback | `eng1-ef28bfd55ae2cfb4` | unchanged |
| e14-parity-anthropic | `eng1-dd5115630c07df34` | unchanged |
| e15-redaction | `eng1-6db9f46afddc5b6d` | unchanged |
| e16-recorder-safety | `eng1-c46cd931ac564baa` | unchanged |

Deep-freezing the captured board did not perturb any digest — which is itself
evidence that no production read path mutates the board it is handed.

## Exposure

**Exactly NINE** agent-exposed tool ids, all `read`/`propose`. No mutation
execution, manufacturing release, MCP, provider expansion, or multi-agent
surface was added.

## Nothing was loosened

One earlier assertion was re-layered rather than weakened: B11.2's R6 bound
test now proves **both** the diagnostics-length bound (5 000-entry array) and
the new capture-layer array bound (50 000-entry array). Strictly more coverage.
No test, schema, security rule, performance threshold, or exposure gate was
relaxed.

## Confidence

| Claim | Status |
| --- | --- |
| R1–R7 reproduced against production code before any edit | **CONFIRMED** (outputs captured verbatim) |
| `toJSON` hooks and accessors are never invoked | **CONFIRMED** (self-deleting hook + read counter, two independent witnesses) |
| Capture reads only through descriptors and never throws | **CONFIRMED** (3 proxy families × 6 functions) |
| The executed capsule is snapshot-owned; caller mutation has no effect | **CONFIRMED** (6 markers, digest = committed pin) |
| Captured documents are deeply immutable | **CONFIRMED** (8 per-container `Object.isFrozen` assertions) |
| An invalid capsule reaches no execution boundary | **CONFIRMED** (8 real boundaries, control capsule, mutation test) |
| `validateBoardShape` refuses every malformed-array shape | **CONFIRMED** (6 shapes, driven through it directly) |
| Drift proofs write nothing under `app/`, `lib/`, `scripts/`, `artifacts/` | **CONFIRMED** (hashes before/after + repo-wide scan) |
| All 19 pins and nine-tool exposure unchanged | **CONFIRMED** |
| Capture is total for *all* possible JS inputs | **INFERRED** — every reflective call is guarded and every value kind is enumerated, but exhaustive proof is not possible by testing |
| No production read path mutates a board it is handed | **INFERRED** — deep-freezing the captured board left all 19 digests unchanged, which is strong evidence but not a proof over unexercised paths |
| A generated projection for a future *generic* PCB type | **PROPOSED** — the generator fails closed today |
| Live model behaviour through a real provider | **UNKNOWN** — both provider accounts remain out of credits; every proof here is provider-free by construction |

## Verdict

**Ready for independent verification.** All seven reproduced counterexamples are
closed in production code with permanent regressions; hooks are provably never
invoked; the executed capsule is an independent deep-frozen snapshot; every
public validator is total against revoked, trap-throwing, and lying proxies;
the low-level board validator's contract is now true; the no-execution proof
instruments eight real boundaries and carries its own mutation test; and no
test writes a repository path — verified by identical file hashes before and
after the full battery. The battery is green apart from five isolated-pass
timing flakes in unrelated subsystems.
