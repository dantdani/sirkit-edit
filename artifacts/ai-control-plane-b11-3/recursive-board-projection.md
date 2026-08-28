# B11.3 §B — the recursive board projection

> **EXTENDED BY B11.6.** `projectBoardForReplay` now returns a discriminated
> `BoardProjectionResult` produced by CAPTURE-AND-PROJECT — the walker
> described below operates only on owned snapshots, and a refusal is an
> explicit `{ ok: false, issues }` rather than any form of the caller's input.
> The projection semantics (unknown keys dropped, order preserved, round-trip
> equivalence) are unchanged. See
> [../ai-control-plane-b11-6/projection-ownership-contract.md](../ai-control-plane-b11-6/projection-ownership-contract.md).

> **EXTENDED BY B11.4.** The projection itself is unchanged and its
> counterexamples remain closed. Two statements below were corrected:
> `validateBoardShape` was NOT sound standalone — a sparse array returned `[]`
> from it while the context layer refused the same board (B11.4 R5) — and the
> "nothing executes" claim rested on a sink-factory assertion that could not
> fail (B11.4 R6). See
> [../ai-control-plane-b11-4/total-validator-results.md](../ai-control-plane-b11-4/total-validator-results.md)
> and [../ai-control-plane-b11-4/no-execution-proof.md](../ai-control-plane-b11-4/no-execution-proof.md).

Module: [`app/lib/agent/pcb-shape-projection.ts`](../../app/lib/agent/pcb-shape-projection.ts)

## What replaced what

```diff
- // Board: TOP-LEVEL exhaustive only (see the module header).
- if (isRec(context.board)) context.board = pick(context.board, [...PCB_BOARD_REQUIRED_KEYS, ...PCB_BOARD_OPTIONAL_KEYS]);
+ // [B11.3] Board: RECURSIVELY exhaustive, driven by the generated
+ // descriptor. Nothing below the top level is carried wholesale any more.
+ if (context.board !== null && context.board !== undefined) context.board = projectBoardForReplay(context.board);
```

and

```diff
- exactContextKeys(value, PCB_BOARD_REQUIRED_KEYS, PCB_BOARD_OPTIONAL_KEYS, "context.board", issues);
+ for (const issue of validateBoardAgainstTypeGraph(value)) issues.push(`context.${issue}`);
```

The two hand-written PCB key lists are **deleted**, not moved.

## One traversal, two views

`projectBoardForReplay(raw)` and `validateBoardShape(raw)` are the same walk
read two ways — the projected value and the issue list come from one
`WalkResult`. They cannot disagree about what is authoritative.

| Node kind | Projection | Validation |
| --- | --- | --- |
| scalars / literals | value carried verbatim | type / literal equality |
| `array` | element-wise, **order preserved**, nothing sorted, filtered, or padded | must be an array; bounded length |
| `tuple` | position-wise | must be an array of exactly the declared length |
| `object` | declared props carried; **unknown keys dropped**; index keys carried only where an index signature is declared | unknown key, missing required key, bad record key |
| `union` | the selected variant's projection | discriminant match, else best-variant diagnostics |
| `ref` | resolved through the descriptor | unresolvable ref is an issue |

## The invariant

```
canonicalJson(projectBoardForReplay(raw)) === canonicalJson(raw)
```

holds exactly when the board contains nothing the authoritative type graph
declares. `canonicalJson` sorts keys recursively and drops `undefined`, so the
comparison is insensitive to key order and to explicitly-undefined values —
and sensitive to exactly one thing: content the projector would not carry.

`validateReplayContext` enforces **both** the precise issue list and the
whole-context round-trip. They are complementary rather than redundant:

* A **wrong-typed** value round-trips fine (the projector carries scalars
  verbatim) and is caught by the issue list.
* A **dropped** key produces no issue if the issue cap is already full, and is
  caught by the round-trip.

## Guarantees, and how each is proven

| Requirement | Regression |
| --- | --- |
| recursively carry only authoritative fields | §B "EXHAUSTIVE: an innocent unknown key on ANY reachable object type refuses" |
| preserve array order and tuple structure | §B "array order, tuple structure, and nested values survive projection unchanged" |
| preserve legitimate dynamic `Record` keys | union/record suite "legitimate Record keys are accepted…" |
| select the correct union variant | union/record suite, all `BoardOutline` and `FpGraphic` variants |
| refuse unknown fields at every object depth | §B R1–R5 + the exhaustive sweep |
| refuse non-plain objects, accessors, symbols, prototype fields, non-enumerable fields | `findNonPlainJsonPath` runs first in `validateReplayContext`; B11.2 §A "non-plain data … refuses before execution" |
| never mutate the source | §B "the projector never mutates the source and never coerces or repairs a value" (`JSON.stringify` before/after equality) |
| never coerce or repair values | same test: `stackup: "2"` is **reported**, and comes back out as `"2"` |
| retain the global size, depth, node and secret bounds | §B "global size, depth, node and secret bounds are retained" — `PCB_PROJECTION_BOUNDS` asserted equal to `REPLAY_CONTEXT_BOUNDS`, oversized arrays short-circuit, and a credential-shaped string buried in `nets[0].name` still refuses without echoing the value |

## Exhaustiveness by construction, not by a list

The unknown-field sweep does **not** enumerate types by hand. It synthesizes a
**MAXIMAL board** from the generated descriptor — every optional slot present,
one element in every array, one entry in every declared record — asserts that
board validates clean and round-trips byte-equivalently, then enumerates every
object **position** inside that value and, for each one, injects an unknown key
and asserts the **production** `validateBoardShape` refuses it *in its real
nested position* while the **production** `projectBoardForReplay` genuinely
drops it. The synthesizer is written independently of the projector so a bug in
one cannot mask a bug in the other.

The sweep asserts its own strength: at least 120 object positions, at least 20
of them at depth ≥ 6, and a maximum depth ≥ 6. A companion **mutation test**
re-runs the deep positions and asserts none survives — a projector that stopped
being exact below a depth cut would fail it.

Positions that are declared `Record` sites are handled differently and
deliberately: an extra key is **legal** there, so the proof is that its
**value** is still validated recursively (a value invalid for every declared
record value type is injected and must refuse).

This covers, by construction and without a maintained list, every type the
stage enumerates: all three `BoardOutline` variants and nested `Vec2` points,
`PcbNet`, `FootprintInstance`, `FootprintDef`, `Pad` (including `drill` and its
`offset`), all six `FpGraphic` variants, `FootprintModelRef`, `Track`,
`RoutingObjectProvenance`, `Via`, `Zone` (thermal settings, `FilledRegion`,
`ZoneFillState`, its diagnostics and stats), `BoardText`, `BoardDimension`,
routing keepouts / history / preferences, placement policy and preferences, and
the imported stackup, netclass, silk, padstack, and constraint structures.

### What the earlier version proved, and did not

Adversarial review showed the first version of this sweep was satisfied by two
**test-local** helpers — a one-level key check and a re-implemented projector —
and passed verbatim against a projector that detected nothing below depth 5.
The "rich board" it validated had empty arrays everywhere, so nothing nested
was exercised at all. Both are fixed above; the mutation test exists so the
weakness cannot silently return.

## Ordering — nothing executes for a bad board

`validateReplayContext` runs, in order: plain-JSON shape → serialized-size
bound → versioned envelope → value/bounds discipline → recursive credential
scan → per-resource exact shape (**including the descriptor-driven board
walk**) → projection round-trip → authority verdicts.

`replayCapsule` calls `validateReplayCapsule` on its **first statement**, so a
refusal precedes sink creation, context assembly, discovery, gateway
construction, loop execution, and every tool invocation. The regression proves
it by instrumenting the sink factory — the earliest observable side effect of a
run — and asserting it is never called for any of the five counterexamples.
