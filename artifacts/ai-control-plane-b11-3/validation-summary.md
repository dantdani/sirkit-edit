# B11.3 — validation summary

> **PARTLY SUPERSEDED BY B11.4.** The verdict below predates the seven
> counterexamples reproduced in B11.4 (R1–R7). See
> [../ai-control-plane-b11-4/validation-summary.md](../ai-control-plane-b11-4/validation-summary.md)
> for the current battery, the 19 pin comparisons (all unchanged), the
> before/after file hashes, and the current verdict.

## Static gates

| Gate | Result |
| --- | --- |
| `npx tsc --noEmit` | **clean** (no output) |
| `npx eslint app/lib/agent scripts/generate-pcb-shape-descriptor.ts` | **clean** (no output) |
| `npx tsx scripts/generate-pcb-shape-descriptor.ts --check` | **OK** — 81 named types from 8 source files; graph `sha256-34cb69e527ca461d09cb8fdcc95854a0`; sources `sha256-cf412478820e4a9930a88b8c95e9cdbf` |

## Test battery

| Suite | Result |
| --- | --- |
| **B11.3** `b11-3-generated-pcb-shape` (new) | **33 / 33 passed** |
| B11.2 `b11-2-replay-context` | 20 / 20 passed |
| B11.1 `b11-1-trace-integrity` | 30 / 30 passed |
| B11.1 `b11-1-route-finalization` (production `POST /api/chat`) | 9 / 9 passed |
| B11 `b11-trace-replay-evaluation` | 16 / 16 passed |
| Agent runtime + chat route (`app/lib/agent`, `app/api/chat`) | **246 / 246 passed** (18 files) |
| Engineering + PCB lifecycle | 470 / 470 (28 files) |
| B04 / B05 / B05.1 control-plane gates | 30 / 33 / 21 |
| B06–B08 gates | 32 + 25 + 20 + 9 + 19 + 38 + 14 + 20 + 18 + 33 + 18 + 2 + 8 + 5 + 7 + 13 |
| B09 / B09.1–B09.3, B10 / B10.1 / B10.2 | 12 + 6 + 8 + 21 + 18 + 5 + 4 + 19, 17 + 5 + 10 + 4 + 9 |
| Evaluation matrix (19 cases) | **19 / 19 cases, 59 / 59 checks** |
| **Full suite** `npx vitest run` | **2302 passed**, 20 skipped, **5 failed** (281 files) |

### The five full-suite failures

```
FAIL app/components/pcb/__tests__/assignment-queue-panel.test.tsx
FAIL app/lib/pcb/__tests__/auto-place.test.ts
FAIL app/lib/pcb/__tests__/connectivity-board.test.ts   expected 73.9 to be less than 50
FAIL app/lib/pcb/__tests__/pcb-repair-agent.test.ts     expected 1068.7 to be less than 250
FAIL app/lib/pcb/__tests__/route-tool.test.ts           expected 60.3 to be less than 50
```

Each reproduced in isolation per protocol — **all five pass**:

```
assignment-queue-panel   2 / 2      auto-place        8 / 8
connectivity-board      10 / 10     pcb-repair-agent  8 / 8
route-tool              25 / 25
```

**Classification: timing-only, pre-existing, unrelated.** All five are named
members of the documented flake family (auto-place, route-tool,
connectivity-board, pcb-repair-agent, compute-fill, arrange, run-drc,
assignment-queue-panel) that misses wall-clock budgets under parallel suite
load. B11.3 changed no placement, routing, DRC, connectivity, or assignment
code. **No threshold was relaxed.**

## Replay pins — all 19 against the B11.2 baseline

Generator run twice; all three artifacts byte-identical between runs **and**
byte-identical to the B11.2 baseline. **Zero pin movement in B11.3.**

| Case | Digest | vs B11.2 baseline |
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

The `e04-invalid-board` digest is the B11.2 baseline value and is unchanged
here, exactly as the stage specified.

## Descriptor byte stability

```
DESCRIPTOR BYTE-STABLE across 3 generations
```

…and a fourth generation after all B11.3 edits produced the same digests.

## Exposure

Static exposure is **exactly NINE** agent-exposed tool ids, all
`read`/`propose`. Verified by `b11-3-generated-pcb-shape` §F,
`b11-2-replay-context` §F, `b11-1-trace-integrity` §H, and
`b11-trace-replay-evaluation` §E. No mutation execution, manufacturing release,
MCP, provider expansion, or multi-agent surface was added; the source scan for
`modelcontextprotocol|mcpServer|spawnAgent|multiAgent` now covers
`pcb-shape-projection.ts`, `pcb-shape-types.ts`, and the generated descriptor.

## Nothing was loosened

No test, schema, security rule, performance threshold, or exposure gate was
relaxed to obtain green results. Three changes touched existing expectations,
and all three are strengthenings:

1. The B11.2 drift gate's **board** half was removed because the key lists it
   asserted **no longer exist** — replaced by a byte-for-byte comparison over
   the whole reachable type graph.
2. The B11.3 key-table gate moved from a 10-name double-quoted grep to a
   density measure over all 21 names in four spellings, with a mutation test.
3. The credential **name** denylist now exempts names the authoritative schema
   declares. That is not a loosening of secret detection: values are still
   scanned, the exemption set is derived from the descriptor rather than
   hand-typed, and the tripping set is pinned to exactly
   `["authorizationPolicyId"]` so a new credential-shaped declared field fails
   CI.

## Confidence

| Claim | Status |
| --- | --- |
| R1–R5 reproduced against production code before any edit | **CONFIRMED** (outputs captured verbatim) |
| R1–R5 closed, each a permanent regression | **CONFIRMED** (33 passing tests) |
| An invalid board executes nothing | **CONFIRMED** (instrumented sink factory never called) |
| The descriptor is generated from the real type graph by the compiler API | **CONFIRMED** (no regex; `--check` byte-compares against a fresh generation) |
| Unknown keys refuse at every object position of a maximal board | **CONFIRMED** (production validator, ≥120 positions, ≥20 at depth ≥6, guarded by a mutation test) |
| Union variants and dynamic records are exact | **CONFIRMED** |
| Array containers carry only index properties | **CONFIRMED** (7 regressions; the defect was live in B11.1/B11.2) |
| Changing any reachable PCB type fails CI until regeneration | **CONFIRMED** (mutation ⇒ descriptor moves; descriptor differs ⇒ `--check` fails) |
| No second hand-written PCB key table | **CONFIRMED** (density gate + its own mutation test) |
| The projector is exact for shapes the generator ACCEPTS | **CONFIRMED** |
| The projector is exact for shapes the generator would REFUSE | **N/A by construction** — an unsupported shape is a generation failure that writes nothing, so no descriptor exists to be exact against |
| Semantic validity is unchanged and `validatePcbBoardStructure` was not weakened | **CONFIRMED** |
| All 19 replay pins unchanged | **CONFIRMED** (byte-identical, twice) |
| Exposure remains exactly nine read/propose tools | **CONFIRMED** |
| Correctness under a future *generic* PCB type | **PROPOSED** — the generator fails closed today; extending node ids with type arguments is the follow-up if one is ever introduced |
| A copy-on-write generation harness (temporary program root) | **PROPOSED** — the disposable-sibling approach removes the corruption risk; a fully isolated root would also remove the stray-file residue |
| Live model behaviour through a real provider | **UNKNOWN** — both provider accounts remain out of credits; every proof here is provider-free by construction |

## Verdict

**Ready for independent verification.** The five reproduced counterexamples are
closed in production code with permanent regressions; the board is now
key-exhaustive at every depth of a type graph that is *generated from the
declarations* rather than hand-maintained; the CI gate fails until
regeneration and is proven in both directions; all 19 replay pins are
byte-identical to the B11.2 baseline; and the adversarial review's twelve
findings — including a bypass that B11.1 and B11.2 also missed, and four of
B11.3's own tests that proved less than they claimed — are each reproduced,
fixed, and regression-tested. The full battery is green apart from five
isolated-pass timing flakes in unrelated subsystems.
