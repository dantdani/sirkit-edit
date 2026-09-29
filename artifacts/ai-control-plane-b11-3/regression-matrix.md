# B11.3 §F — regression matrix

> **EXTENDED BY B11.4.** Two proofs in the table below were weaker than
> stated: the no-execution rows relied on a sink-factory assertion that is
> vacuous (B11.4 R6), and the drift rows were satisfied by a test that wrote
> repository paths (B11.4 R7). Both are replaced; see
> [../ai-control-plane-b11-4/regression-matrix.md](../ai-control-plane-b11-4/regression-matrix.md).

All proofs live in
[`app/lib/agent/__tests__/b11-3-generated-pcb-shape.test.ts`](../../app/lib/agent/__tests__/b11-3-generated-pcb-shape.test.ts)
(**33 tests**). Nothing is proven by a helper that bypasses production code:
the replay proofs drive the real `validateReplayCapsule` / `replayCapsule`, the
projection proofs drive the real `projectBoardForReplay` /
`validateBoardShape`, and the drift proofs execute the real generator as a
child process against the real declarations (via a disposable copy).

## Mandatory counterexamples

| Proof | Test |
| --- | --- |
| The five nested unknown-field counterexamples (R1–R5) refuse | §B "R1-R5: the five mandatory nested counterexamples all REFUSE, and nothing executes" |
| An invalid capsule touches no sink, assembler, discovery, gateway, loop or tool | same test — the sink factory, the earliest observable side effect of a run, is instrumented and asserted never called for all five |

## Unknown-field refusal, per object-shaped type

Coverage is **exhaustive by construction**. §B "EXHAUSTIVE: an unknown key at
EVERY nested object position refuses, through PRODUCTION code" synthesizes a
MAXIMAL board from the generated descriptor, enumerates every object position
inside that value, and for each one injects an unknown key and asserts the
production validator refuses it **in its real nested position** while the
production projector genuinely drops it. The sweep asserts its own strength
(≥120 positions, ≥20 of them at depth ≥6) and is guarded by a **mutation test**
(§B "the sweep FAILS against a projector that stops being exact below a depth
cut").

That single sweep covers every type the stage enumerates — and any type added
later:

`BoardOutline` (3 variants) · nested `Vec2` · `PcbNet` · `FootprintInstance` ·
`FootprintDef` · `Pad` (incl. `drill`, `drill.offset`) · `FpGraphic`
(6 variants) · `FootprintModelRef` · `Track` · `RoutingObjectProvenance` ·
`Via` · `Zone` (thermal, `FilledRegion`, `ZoneFillState`, diagnostics, stats) ·
`BoardText` · `BoardDimension` · `RoutingKeepout` · `RoutingHistoryEvent` ·
`RoutingPreferences` · placement policy / preferences ·
`ResolvedPinPadMapping` · `BBox` · `PadShape` · `BoardStackup` / `CopperLayer` ·
`BoardNetClassing` / `NetClassAssignment` / `RuleDelta` / `RuleDeltaChange` ·
`SilkItem` (4 variants) · `Padstack` · the whole `BoardConstraintState`
sub-graph (35 named types).

Targeted proofs sit alongside the sweep for the shapes the stage calls out:

| Proof | Test |
| --- | --- |
| All three `BoardOutline` variants exact; cross-variant fields refuse; nested `Vec2` exact | "every BoardOutline variant is exact, and cross-variant fields REFUSE" |
| All six `FpGraphic` variants exact; cross-variant fields refuse | "every FpGraphic variant is exact, and cross-variant fields REFUSE" |
| Imported stackup, netclass, silk, padstack and constraint structures exact | "imported stackup, netclass, silk, padstack and constraint structures are exact" |

## Records and unions

| Proof | Test |
| --- | --- |
| Legitimate `Record` keys remain accepted | "legitimate Record keys are accepted…" |
| Malformed record **values** refuse | same test, plus the sweep's dynamic-record positions |
| Malformed record **keys** refuse | same test — `"01"`, `"1.5"`, `"abc"`, `" 1"`, `"1e3"`, `""` |
| Cross-variant union fields refuse | both union tests, 8 cross-variant probes plus an undeclared `kind` |
| Dynamic keys exist only where declared | §A "distinguishes discriminated-union variants and permits dynamic keys only where declared" |

## Projection behaviour

| Proof | Test |
| --- | --- |
| Valid rich boards project byte-equivalently | §B "the MAXIMAL board … validates clean and round-trips" |
| A maximal board validates through a real replay context, and one deep unknown key refuses it | §B "a maximal board inside a REAL replay context validates end to end" |
| Array order and tuple structure preserved | §B "array order, tuple structure, and nested values survive projection unchanged" |
| Never mutates the source; never coerces or repairs | §B "the projector never mutates the source and never coerces or repairs a value" |
| Global size, depth, node and secret bounds retained | §B "global size, depth, node and secret bounds are retained" |

## Array containers (adversarial review)

| Proof | Test |
| --- | --- |
| An own property attached to an array refuses at every gate | "an own property attached to an ARRAY is refused at every gate" |
| A credential parked on an array refuses, never echoed | "a credential parked on an ARRAY is refused, and never echoed" |
| An accessor at an array index refuses before it can be re-read | "an ACCESSOR at an array INDEX is refused BEFORE it can be re-read" |
| Function-valued, non-enumerable, symbol-keyed, sparse and foreign-prototype arrays refuse | "function-valued, non-enumerable, symbol-keyed, sparse and foreign-prototype arrays refuse" |
| The fix covers every array in the capsule, not only the board | "the blind spot is closed for EVERY array in the capsule, not only the board" |
| Exhausted traversal bounds refuse rather than validate partially | "exhausted traversal bounds REFUSE rather than validate partially" |
| Honest arrays untouched | "honest arrays are untouched: all 19 capsules still validate and hit their pins" |

## Generator and gates

| Proof | Test |
| --- | --- |
| The descriptor covers the complete reachable graph, from real declarations | §A "covers the complete graph reachable from PcbBoard…" |
| `--check` passes and never writes | §E "--check passes against the checked-in descriptor and never writes" |
| Adding a nested property, changing optionality/type/union membership, or removing a property all move the descriptor — without touching production sources | §E "changing ANY reachable PCB type moves the descriptor, without touching production sources" |
| A moved descriptor fails CI | §E "--check is the byte-for-byte half of that gate: a one-character edit fails it" |
| No second hand-written PCB key table | §A "no second hand-written PCB key table is used by replay validation" |
| …and that gate is not evadable | §A "that gate CATCHES a real key table (mutation test for the test)" |
| The credential denylist does not reject declared PCB field names, and the exemption set is pinned | §B "the credential-name denylist does not reject DECLARED PCB field names" |

## Semantic separation and versioning

| Proof | Test |
| --- | --- |
| `e04-invalid-board` remains valid replay transport while `validatePcbBoardStructure` calls it invalid; withholding unchanged | §C "e04-invalid-board is valid replay TRANSPORT while the PCB validator calls it invalid" |
| The PCB structural validator was not weakened | §C "the PCB structural validator was not weakened to preserve the fixture" |
| Context v2 / capsule v3; older versions refuse explicitly [superseded 2026-09-29 by the B21 closeout (D21-27, OD-113): true for B11.3's own stage; the capsule is `sirkit.agent-replay-capsule.v4` since B21-F, a v3 document refused explicitly, and the context stays `sirkit.agent-replay-context.v2` - `artifacts/ai-control-plane-b21/evaluation-matrix.md` section 2] | §D "the context is v2 and the capsule v4 (v3 when written; B21-F grew the capsule's own field set - a reviewed bump); older versions, v3 among them, refuse EXPLICITLY" (retitled by the B21 closeout, 2026-09-29; assertions unchanged) |
| Every committed capsule carries the current versions and its pinned digest | §D "every committed capsule carries the current versions and its pinned digest" (19 capsules) |

## Surrounding invariants

| Proof | Test |
| --- | --- |
| Static exposure exactly nine read/propose tools; no new surface | §F "static exposure is still exactly NINE read/propose tools" |
| The whole-context round-trip still governs every field | §F "the whole-context projection round-trip still governs every field" |
| Credential scanning, recorder totality and trace bounds intact | the B11.2 suite (20 tests), unchanged and green |
| Every B11 / B11.1 / B11.2 regression remains green | `b11-trace-replay-evaluation` (16), `b11-1-trace-integrity` (30), `b11-1-route-finalization` (9), `b11-2-replay-context` (20) |

## What the B11.2 suite lost, and why that is not a coverage loss

The B11.2 drift gate asserted two hand-written `PcbBoard` key lists against a
regex extraction of `app/lib/pcb/types.ts`. Those lists **no longer exist**, so
the assertion was removed rather than weakened. What replaced it is strictly
stronger: the generated descriptor is compared byte-for-byte against a fresh
compiler-API generation, over the whole reachable graph rather than one
interface's top level. The **schematic** half of that gate is untouched.
