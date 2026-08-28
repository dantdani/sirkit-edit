# B11.2 §F — regression matrix

> **EXTENDED BY B11.3.** Proof 8 in the table below (the hand-written
> `PcbBoard` key drift gate) is RETIRED: those key lists no longer exist. It is
> replaced by a byte-for-byte comparison of the generated descriptor against a
> fresh compiler-API generation, over the whole reachable type graph rather
> than one interface's top level. The schematic half of the gate is unchanged.
> See [../ai-control-plane-b11-3/regression-matrix.md](../ai-control-plane-b11-3/regression-matrix.md).

All thirteen required proofs, mapped to permanent tests in
[`app/lib/agent/__tests__/b11-2-replay-context.test.ts`](../../app/lib/agent/__tests__/b11-2-replay-context.test.ts)
(20 tests). Nothing is proven by a helper that bypasses production code: the
replay proofs run the real `validateReplayCapsule` / `replayCapsule`, and the
recorder proofs drive a real `AgentTraceRecorder`.

| # | Required proof | Test |
| --- | --- | --- |
| 1 | An unknown fixture field is refused before execution (R1) | §A "R1: an unknown field anywhere in the context is REFUSED, and nothing executes" — 7 placements: board top level, schematic top level, schematic component, head mark, selection envelope, selection ref, context envelope |
| 2 | Nothing executes for an invalid context | same test — the sink factory (earliest observable side effect of a run) is instrumented and asserted **never called** for all 7 placements |
| 3 | The context contract is versioned | §A "the context contract is VERSIONED: a missing or wrong schema refuses" |
| 4 | Data the canonical parser would discard causes refusal | §A "the PROJECTION ROUND-TRIP is the proof" — asserts the producer really drops the key **and** the consumer really refuses it |
| 5 | Non-plain data refuses (prototype, symbol, accessor, non-enumerable) | §A "non-plain data … refuses before execution" |
| 6 | Malformed/missing required data refuses | §A "required keys must be present, and values must be JSON data of finite numbers" |
| 7 | Validation goes through the SHARED authorities | §A "the SHARED authorities decide validity, and their verdicts are reported (never invented)" — verdicts pinned for 5 committed fixtures |
| 8 | Key lists cannot drift from the production types | §A "DRIFT GATE" — parses `app/lib/pcb/types.ts` and `lib/schematic-types.ts`; asserts exact equality for `PcbBoard`, `SchematicState`, `SchComponent`, `Wire`, `Point`, `NetLabel`, `KicadComponentInstance` |
| 9 | Compound credential/SDK/provider key names refuse, with object AND string values (R2) | §B "R2: compound credential/SDK/provider key names are refused…" — 11 names × 2 value types, plus 15 legitimate names proven NOT to false-positive |
| 10 | Credential-shaped JSON nested in capsule strings refuses (R3) | §B "R3: credential-shaped JSON nested inside capsule STRINGS is refused" — 5 carriers; refusal never echoes the value or the key |
| 11 | The direct scan is recursive, bounded, and redacting | §B "the direct scan walks ORIGINAL strings and key names, is bounded, and redacts hostile names" |
| 12 | Credential-shaped content in ANY trace field refuses (R4), and a valid trace stays byte-stable | §C "R4: credential-shaped JSON in ANY trace field refuses, in every carrier" (8 carriers) + "a credential-shaped KEY NAME anywhere…" + "a valid recorder-produced trace remains BYTE-STABLE" |
| 13 | Every public recorder method is total (R5); `recorderDiagnostics` and document size are bounded before scanning (R6) | §D "R5: every public method is TOTAL under arbitrary hostile JavaScript input" (17 probes) + "finalize is TOTAL…" + "recording failure never changes run behaviour…"; §E "R6: recorderDiagnostics is length-bounded BEFORE any scanning or Set construction" + "the serialized trace size is bounded and validator output stays bounded" |

## Invariants re-proven

| Invariant | Test |
| --- | --- |
| Every committed capsule validates, carries the versioned context, and replays to its pinned digest | §F "every committed capsule validates, replays to its pinned digest, and carries the versioned context" (19 capsules) |
| Static exposure is exactly NINE read/propose tool ids; no mutation, release, MCP, or multi-agent surface | §F "static exposure is still exactly NINE read/propose tools, and no new surface exists" (source scan now includes `replay-context.ts`) |

## Carried forward unchanged

* B11 — `b11-trace-replay-evaluation` (16 tests)
* B11.1 — `b11-1-trace-integrity` (30 tests), `b11-1-route-finalization` (9 tests)
* The 19-case evaluation matrix (59 checks), all passing

Two B11.1 assertions were **re-worded, not weakened**:

* "R5: forbidden field names nested inside context fixtures are refused" now
  asserts refusal **and** that the offending path is named (`rawResponse`),
  because the refusal now originates from the versioned context contract
  rather than the retired name-only scanner. The proven property is strictly
  stronger: the field is refused for being *unknown to `PcbBoard`* even when
  its name is innocent.
* The secret-content refusal message vocabulary was unified on
  `secret-shaped` across both the direct and serialized scans, so the
  existing B11.1 assertion holds unchanged.
