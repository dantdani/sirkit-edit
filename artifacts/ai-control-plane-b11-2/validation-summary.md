# B11.2 — validation summary

> **PARTLY SUPERSEDED BY B11.3.** The confidence table below records
> "Key exhaustiveness for the board **below** its top level — NOT CLAIMED" and
> a PROPOSED generated projection. That gap is now closed; see
> [../ai-control-plane-b11-3/validation-summary.md](../ai-control-plane-b11-3/validation-summary.md)
> for the current battery, the 19 replay-pin comparisons, and the current
> verdict. The `e04-invalid-board` pin recorded here is the B11.3 baseline and
> is unchanged.

## Static gates

| Gate | Result |
| --- | --- |
| `npx tsc --noEmit` | **clean** (no output) |
| `npx eslint` over every changed source and test file | **clean** (no output) |

## Test battery

| Suite | Result |
| --- | --- |
| **B11.2** `b11-2-replay-context` (new) | **20 / 20 passed** |
| B11.1 `b11-1-trace-integrity` | 30 / 30 passed |
| B11.1 `b11-1-route-finalization` (production `POST /api/chat`) | 9 / 9 passed |
| B11 `b11-trace-replay-evaluation` | 16 / 16 passed |
| Agent runtime + chat route (`app/lib/agent`, `app/api/chat`) | **213 / 213 passed** (17 files) |
| B04 tool registry | 30 / 30 |
| B05 read invocation + B05.1 resource pinning | 33 / 33 + 21 / 21 |
| B06 / B06.1–B06.3 schematic mutation, authority, lineage | 32 + 25 + 20 + 9 |
| B07 / B07.1–B07.5 identity, interlock, serialization, async scope | 19 + 38 + 14 + 20 + 18 + 33 |
| B08 / B08.1–B08.3 canonical PCB, lifecycle, owned sync | 18 + 2 + 8 + 5 + 7 + 13 |
| Engineering + PCB lifecycle (aggregate) | **470 / 470 passed** (28 files) |
| B09 / B09.1–B09.3 | 12 + 6 + 8 + 21 + 18 + 5 + 4 + 19 |
| B10 / B10.1 / B10.2 | 17 + 5 + 10 + 4 + 9 |
| Evaluation matrix (19 cases) | **19 / 19 cases, 59 / 59 checks** |
| **Full suite** `npx vitest run` | **2273 passed**, 20 skipped, **1 failed** (280 files) |

### The one full-suite failure

```
FAIL app/lib/pcb/__tests__/pcb-repair-agent.test.ts
  > builds a versioned all-layer snapshot … under the performance target
  AssertionError: expected 330.1 to be less than 250
```

Reproduced in isolation per protocol:

```
npx vitest run app/lib/pcb/__tests__/pcb-repair-agent.test.ts
 ✓ app/lib/pcb/__tests__/pcb-repair-agent.test.ts (8 tests) 569ms
 Test Files  1 passed (1)
      Tests  8 passed (8)
```

**Classification: timing-only, pre-existing, unrelated.** `pcb-repair-agent`
is a member of the documented flake family (auto-place, route-tool,
connectivity-board, pcb-repair-agent, compute-fill, arrange, run-drc,
assignment-queue-panel) that misses wall-clock budgets under parallel suite
load. B11.2 changed no PCB repair, DRC, routing, or geometry code. **The
threshold was not relaxed.**

## Replay-pin comparison

Generator run twice; all three artifacts byte-identical between runs:

```
BYTE-IDENTICAL replay-trace-pins.json
BYTE-IDENTICAL evaluation-results.json
BYTE-IDENTICAL evaluation-case-matrix.csv
```

Against the pre-B11.2 committed pins:

```
total: 19 | identical: 18 | changed: 1
  CHANGED e04-invalid-board  eng1-8cdbebffbe4e24c4 -> eng1-97a8cd4fb3f78a64
new keys: []
```

**The one change is explained and intended.** `e04-invalid-board`'s fixture
board was `{ stackup, nets, footprints, tracks, vias, zones }` — missing the
required `PcbBoard` keys `formatVersion`, `outline`, and `texts`. That is
malformed *transport*, which the versioned context contract now refuses. The
fixture is now a complete `PcbBoard` whose track carries an empty identity,
so `validatePcbBoardStructure` still refuses it and the case's meaning is
unchanged (invalid board ⇒ canonical resource and dependent tools withheld,
same discovered-tool set, same withholding warning). The digest moved because
the assembler's withholding warning quotes the first structural issue, and a
different board reports a different first issue. All 18 other pins are
byte-identical.

## Exposure

Static exposure is **exactly NINE** agent-exposed tool ids, all
`read`/`propose`. Verified by `b11-2-replay-context` §F, `b11-1-trace-integrity`
§H, and `b11-trace-replay-evaluation` §E. No mutation execution, manufacturing
release, MCP, provider expansion, or multi-agent surface was added; the source
scan for `modelcontextprotocol|mcpServer|spawnAgent|multiAgent` now covers
`replay-context.ts` as well.

## Nothing was loosened

No test, schema, security rule, performance threshold, or exposure gate was
relaxed to obtain green results. Two changes touched existing expectations,
and both are strengthenings:

1. Two evaluation fixtures were corrected to satisfy the **new, stricter**
   transport contract while preserving each case's meaning exactly (see
   [replay-context-schema.md](replay-context-schema.md)).
2. One B11.1 assertion was re-worded because the refusal now originates from
   the versioned context contract rather than the retired name-only scanner;
   the re-worded assertion proves strictly more (the field is refused for
   being *unknown*, even when its name is innocent).

## Confidence

| Claim | Status |
| --- | --- |
| R1–R6 reproduced against production code before any edit | **CONFIRMED** (outputs captured verbatim) |
| R1–R6 closed, each with a permanent regression | **CONFIRMED** (20 passing tests) |
| An invalid replay context executes nothing | **CONFIRMED** (instrumented sink factory never called) |
| Key exhaustiveness for envelope, schematic, mark, selection, netlist at every depth | **CONFIRMED** |
| Key exhaustiveness for the board **below** its top level | **NOT CLAIMED** — see the residual gap in [replay-context-schema.md](replay-context-schema.md); a generated projection is **PROPOSED** |
| Every public recorder method is total under the tested hostile-input classes | **CONFIRMED** (17 probes) |
| Every public recorder method is total under *all* possible JS inputs | **INFERRED** — the `total()`/`safeRead()` boundary makes it structural, but exhaustive proof is not possible by testing |
| A valid recorder-produced trace is byte-stable | **CONFIRMED** (digest + `JSON.stringify` equality, plus 18/19 unchanged pins) |
| Exposure remains exactly nine read/propose tools | **CONFIRMED** |
| Live model behaviour through a real provider | **UNKNOWN** — both provider accounts remain out of credits; every proof here is provider-free by construction |

## Verdict

**Ready for independent verification.** The six reproduced counterexamples
are closed in production code with permanent regressions, the full battery is
green apart from one isolated-pass timing flake in an unrelated subsystem, the
generator is byte-stable, 18 of 19 replay pins are unchanged with the
nineteenth explained, and the residual board-depth gap is stated explicitly
rather than papered over.
