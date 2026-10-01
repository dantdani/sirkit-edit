# B11.5 — validation summary

> **PARTLY SUPERSEDED BY B11.6.** The verdict below predates the five
> counterexamples the independent verifier reproduced (B11.6 R1–R5). See
> [../ai-control-plane-b11-6/validation-summary.md](../ai-control-plane-b11-6/validation-summary.md).

## Hashes, before and after the entire battery

```
BEFORE  app/lib/pcb/types.ts                              15088 bytes  sha256=72ad7c7758b4441422ba48ccd25c10c649f009b19a7d5167a9d2cdb0c42d19a5
BEFORE  app/lib/agent/generated/pcb-shape-descriptor.ts  213528 bytes  sha256=5501d810e583395de585315ee75b8e32f4a0f82db06a1949495ece836753a44d
AFTER   app/lib/pcb/types.ts                              15088 bytes  sha256=72ad7c7758b4441422ba48ccd25c10c649f009b19a7d5167a9d2cdb0c42d19a5
AFTER   app/lib/agent/generated/pcb-shape-descriptor.ts  213528 bytes  sha256=5501d810e583395de585315ee75b8e32f4a0f82db06a1949495ece836753a44d
```

**Identical.** This correction did not require touching the authoritative PCB
type graph, and no test wrote either file.

## Static gates

| Gate | Result |
| --- | --- |
| `npx tsc --noEmit` | **clean** |
| `npx eslint` over every changed file | **clean** — `redaction.ts`, `plain-capture.ts`, `trace.ts`, `replay-capsule.ts`, `replay-context.ts`, `pcb-shape-projection.ts`, `b11-5-capture-exactness.test.ts`, `b11-1-trace-integrity.test.ts` |
| `npx tsx scripts/generate-pcb-shape-descriptor.ts --check` | **OK** — 81 named types from 8 source files; graph `sha256-34cb69e527ca461d09cb8fdcc95854a0`; sources `sha256-cf412478820e4a9930a88b8c95e9cdbf` |
| `git diff --check` | **clean** (only pre-existing CRLF advisory warnings; no whitespace errors) |
| `generate-b11-artifacts` twice | all three artifacts byte-identical between runs and to the B11.4 baseline |

## Test battery

| Suite | Result |
| --- | --- |
| **B11.5** `b11-5-capture-exactness` (new) | **18 / 18 passed** |
| B11.4 `b11-4-capture-ownership` | 17 / 17 passed |
| B11.4 `b11-4-no-execution` | 4 / 4 passed |
| B11.3 `b11-3-generated-pcb-shape` | 34 / 34 passed |
| B11.2 `b11-2-replay-context` | 20 / 20 passed |
| B11.1 `b11-1-trace-integrity` | 30 / 30 passed |
| B11.1 `b11-1-route-finalization` | 9 / 9 passed |
| B11 `b11-trace-replay-evaluation` | 16 / 16 passed |
| **B11 family total** | **148 / 148 passed** (8 files) |
| Agent runtime + chat route | **286 / 286 passed** (21 files) |
| Engineering + PCB lifecycle (B04–B08 gates) | **470 / 470 passed** (28 files) |
| Evaluation matrix | **19 / 19 cases, 59 / 59 checks** |
| **Full suite** `npx vitest run` | **2343 passed**, 20 skipped, **4 failed** (284 files) |

### The four full-suite failures — classified honestly

```
FAIL app/lib/pcb/__tests__/arrange.test.ts           expected 200.83 to be less than 200
FAIL app/lib/pcb/__tests__/auto-place.test.ts
FAIL app/lib/pcb/__tests__/pcb-repair-agent.test.ts  expected 620.9 to be less than 250
FAIL app/lib/pcb/__tests__/route-tool.test.ts
```

Each reproduced in isolation — **all pass**:

```
arrange           7 / 7      auto-place  8 / 8
pcb-repair-agent  8 / 8      route-tool  25 / 25
```

Every failing assertion is a **wall-clock budget**, and every failing file is a
named member of the documented flake family (auto-place, route-tool,
connectivity-board, pcb-repair-agent, compute-fill, arrange, run-drc,
assignment-queue-panel). B11.5 changed only `app/lib/agent/*` — no placement,
routing, DRC, or geometry code — and `arrange` missed its gate by 0.8 ms.

**No functional failure was dismissed as timing noise:** all four failures are
timing assertions, none is a behavioural assertion, and each passes in
isolation.

## Replay pins — all 19, unchanged

Byte-identical to the B11.4 baseline and stable across two consecutive
generator runs: `e01 eng1-0cbbe78e7b980149`, `e02 eng1-1f1ff2fab230d7c9`,
`e03 eng1-54402fed3e12951c`, `e04 eng1-97a8cd4fb3f78a64`,
`e05 eng1-29e7d5746329de75`, `e06a eng1-76d3efc6c0e646dd`,
`e06b eng1-b8edda63ec3a30aa`, `e06c eng1-82a4ff34df4fc391`,
`e07a eng1-8776aa4dbe5aa66e`, `e07b eng1-3fc4a39c53a509c5`,
`e08 eng1-9c4bb64d7487c822`, `e09 eng1-3644277af61264c9`,
`e10 eng1-2bfd85ba305e5b53`, `e11 eng1-3e3d8852e8248885`,
`e12 eng1-903b550f607ff13c`, `e13 eng1-ef28bfd55ae2cfb4`,
`e14 eng1-dd5115630c07df34`, `e15 eng1-6db9f46afddc5b6d`,
`e16 eng1-c46cd931ac564baa`.

## Versioning — capsule v3 / context v2 remain correct

> [superseded 2026-09-29 by the B21 closeout (D21-27, OD-113): true for B11.5's own stage; the capsule is `sirkit.agent-replay-capsule.v4` since B21-F, a v3 document refused explicitly, and the context stays `sirkit.agent-replay-context.v2` - `artifacts/ai-control-plane-b21/evaluation-matrix.md` section 2]

**No bump.** This is a handling correction, and it does not narrow the accepted
document set:

* `__proto__` preservation **widens** what survives capture — a key the
  authoritative `Record<string, number>` always permitted is no longer
  discarded. No previously-valid document becomes invalid.
* Diagnostic redaction changes the text of refusals, not which documents are
  refused.
* Totality converts throws into refusals. A document that made a validator
  throw was never *accepted*, so nothing that previously validated now fails.

Bumping would force every conforming document to be rewritten for no change in
what conformance means. The stage's own rule — do not bump merely to count
stages — points the same way. A regression pins both version strings.

## Nothing was weakened

Two B11.1 message-shape assertions were re-worded because redaction became
stronger; both now prove strictly more (refused **and** not leaked). No test,
schema, security rule, performance threshold, or exposure gate was relaxed.

## Confidence

### CONFIRMED

| Claim | Evidence |
| --- | --- |
| R1–R3 reproduced against production code before any edit | outputs captured verbatim in [pre-edit-counterexamples.md](pre-edit-counterexamples.md) |
| Numeric and object-valued `__proto__` are retained as own data properties | `{"keep":1,"__proto__":42}`; prototype stays `Object.prototype` |
| The captured `__proto__` child is a deeply frozen copy | 4 `Object.isFrozen` assertions; identity assertion against the caller's object |
| `constructor` / `prototype` / ordinary Record keys round-trip | `JSON.parse(JSON.stringify(snapshot))` deep-equals the source |
| The production `padNets` case survives `validateReplayContext` exactly | `{"1":1,"__proto__":42}`, both round-trips equal |
| No untrusted value or credential-shaped key content reaches any diagnostic or thrown message | marker absent from capture, capsule, context, trace, board, secret-scan issues and from `ReplayCapsuleInvalidError.message` |
| Redaction is deterministic, bounded, and preserves ordinary keys | asserted per property |
| 80 stateful/hostile-proxy probes across 10 boundaries never throw | 8 families × 10 functions |
| Every B11.4 closure is preserved | hooks uninvoked, mutation irrelevant, sparse refuses, 19 pins, nine tools |
| Both file hashes unchanged before and after the battery | SHA-256 recorded above |

### INFERRED

| Claim | Why not CONFIRMED |
| --- | --- |
| Capture is exact for *all* possible own string keys | every key class named by the stage is asserted, and `defineProperty` is setter-free by specification, but exhaustive proof over all strings is not possible by testing |
| Every reflective path is guarded for *all* proxy behaviours | eight families are exercised; the guard is per-operation by construction, but a proxy can be arbitrarily adversarial |
| No production read path mutates a board it is handed | deep-freezing left all 19 digests unchanged — strong evidence, not proof over unexercised paths |

### PROPOSED

| Item | Note |
| --- | --- |
| Excluding `__proto__` at the type level | if that key class should not exist in `padNets`, the exclusion belongs in `app/lib/pcb/types.ts` so the generated descriptor and its drift gate carry it — not in a hidden replay-only rule |
| A generated projection for a future *generic* PCB type | the generator fails closed today |
| Migrating `kicad-write-pcb.test.ts`'s golden update off a repository path | pre-existing, env-gated, outside B11 scope; currently admitted with its guard asserted |

### UNKNOWN

| Item | Note |
| --- | --- |
| Live model behaviour through a real provider | both provider accounts remain out of credits; every proof here is provider-free by construction. No live provider call was made and no credits were spent. |

## Verdict

**Ready for independent verification.** All three reproduced counterexamples
are closed in production code with permanent regressions; every accepted own
key — including `__proto__` — is now preserved byte-for-byte without any
prototype ever being altered; no untrusted key content reaches a diagnostic or
a thrown message; and eighty stateful-proxy probes across ten public boundaries
produce refusals rather than exceptions. Every B11.4 closure, all 19 replay
pins, both file hashes, and the nine-tool exposure are unchanged. The battery
is green apart from four isolated-pass wall-clock budgets in unrelated
subsystems.
