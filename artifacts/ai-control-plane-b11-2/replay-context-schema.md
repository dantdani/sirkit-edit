# B11.2 §A — `sirkit.agent-replay-context.v1`

> **EXTENDED BY B11.4.** The "refuses before any execution" claim in this
> document was proven with a sink-factory assertion that could not fail
> (B11.4 R6), and validation itself invoked `toJSON` hooks and getters via
> `JSON.stringify` (B11.4 R1/R2). Both are closed; the capsule is now captured
> hook-free and the executed document is an immutable snapshot. See
> [../ai-control-plane-b11-4/](../ai-control-plane-b11-4/README.md).

> **SUPERSEDED IN PART BY B11.3.** The board contract described below was
> exact only at the `PcbBoard` TOP LEVEL. An innocent unknown field one level
> deeper — on `outline`, `outline.origin`, `nets[0]`, `tracks[0]`, or
> `tracks[0].start` — still validated AND executed (reproduced as B11.3
> R1–R5). The "residual gap" this document records, and the *generated
> projection* it lists as PROPOSED, are now BUILT: the hand-written
> `PCB_BOARD_REQUIRED_KEYS` / `PCB_BOARD_OPTIONAL_KEYS` are deleted, the board
> is validated against a descriptor generated from `app/lib/pcb/types.ts` by
> the TypeScript compiler API, and the contract is versioned
> `sirkit.agent-replay-context.v2` (capsule `…capsule.v3`). See
> [../ai-control-plane-b11-3/generated-pcb-type-graph.md](../ai-control-plane-b11-3/generated-pcb-type-graph.md)
> and [../ai-control-plane-b11-3/recursive-board-projection.md](../ai-control-plane-b11-3/recursive-board-projection.md).
> The historical record below is retained unchanged as evidence.

Module: [`app/lib/agent/replay-context.ts`](../../app/lib/agent/replay-context.ts)

Replaces B11's "opaque fixture" validation claim with a real versioned
contract that has **one producer** and **one consumer**.

## Contract

```ts
interface ReplayContextFixture {
  schema: "sirkit.agent-replay-context.v1";
  schematic: SchematicState | null;
  board: PcbBoard | null;
  schematicHeadMark: Tier1ProposalHeadMark | null;
  selection: { refs: SelectionRef[]; primary: SelectionRef | null } | null;
  netlist: AgentNetlistProjection | null;
  editorSchematicDigest: string | null;
}
```

The capsule schema is bumped to **`sirkit.agent-replay-capsule.v2`**: the
context shape changed incompatibly, so the contract is versioned rather than
silently redefined. Capsules are authored in-repo fixtures and are never
persisted from live runs, so no stored document is invalidated.

## Producer / consumer

| Function | Role |
| --- | --- |
| `projectReplayContext(raw)` | **Producer.** Carries only the KNOWN keys of each canonical domain type. Never invents, coerces, or repairs a value. Everything the contract carries is enumerated here. |
| `validateReplayContext(raw)` | **Consumer.** Refuses anything the producer would not carry, then reports each shared authority's verdict. |

## Validation order (all before ANY execution)

1. Plain-JSON shape — `findNonPlainJsonPath` refuses prototype-carried,
   symbol-keyed, accessor-backed, and non-enumerable data.
2. Serialized-size bound (`maxSerializedChars = 1 000 000`) **before**
   traversal.
3. Versioned envelope — exact keys, then `schema` equality.
4. Value discipline and bounds — JSON primitives / arrays / plain objects
   only, finite numbers, bounded strings, arrays, depth, and node count.
5. Recursive credential scan (`findSecretShapedPath`) over ORIGINAL key
   names and string values.
6. Per-resource key exhaustiveness (below).
7. **Projection round-trip** —
   `canonicalJson(projectReplayContext(raw)) === canonicalJson(raw)`.
8. Shared-authority verdicts.

Any failure in 1–7 refuses. `replayCapsule` validates on its first statement,
so an invalid context never reaches context assembly, discovery, gateway
construction, loop execution, sink creation, or a tool invocation — proven by
instrumenting the sink factory (the earliest observable side effect of a run)
and asserting it is never called.

## The round-trip is the proof, not a promise

The stage requires that *"data silently discarded during normalization must
cause refusal"*. Rather than assert that intention, the consumer re-projects
the accepted document through the shared producer and compares canonical
JSON. Because the producer genuinely drops unknown keys, a fixture carrying
one produces two different documents and is refused. The regression proves
both halves: the projection really drops `smuggled`, and the consumer really
refuses it.

## No competing definitions

Semantics come only from existing shared authorities:

| Field | Authority |
| --- | --- |
| `schematic` | `validateSchematicStateIntegrity` (→ `toCanonicalSchematic` + `validateCanonicalSchematic`) |
| `board` | `validatePcbBoardStructure` |
| `schematicHeadMark` | `isWellFormedProposalScope` |
| `selection` | `parseSelectionRef` |
| `netlist` | `proveAgentNetlist` (structural + semantic validation, then server-side re-derivation through `buildNetlist`/`theoryPinContract`) |

This module contributes exactly one thing those authorities do not provide:
**key exhaustiveness**. Its key lists are **drift-gated** — the regression
parses `app/lib/pcb/types.ts` and `lib/schematic-types.ts`, extracts the
declared top-level members of `PcbBoard`, `SchematicState`, `SchComponent`,
`Wire`, `Point`, `NetLabel`, and `KicadComponentInstance`, and asserts exact
equality. A new field on any of them fails CI here instead of silently
widening the fixture surface.

## Exactly what is and is not claimed

| Field | Key exhaustiveness |
| --- | --- |
| envelope | exact |
| `schematicHeadMark` | exact at every depth (3 keys — the assembler's own projection) |
| `selection` | exact at every depth (`parseSelectionRef` already checks exact key counts) |
| `netlist` | exact at every depth (`validateAgentNetlistProjection` refuses unknown keys at netlist, component, pin, net, and node level) |
| `schematic` | exact at every depth (state, components, wires, vertices, net labels, positions, KiCad instances) |
| `board` | **exact at its TOP LEVEL only** |

**The board's residual gap, stated plainly.** Below the top level, board
content is validated by the authoritative whole-board validator and
constrained by the global plain-JSON, credential-name, value-type, and
size/depth disciplines — but it is **not** key exhaustive. Hand-writing an
exhaustive key list for the whole PCB element type system (`Pad`,
`FootprintDef`, `Track`, `Via`, `Zone`, `BoardText`, `BoardDimension`,
`Padstack`, `SilkItem`, `BoardConstraintState`, …) is precisely the
"competing PCB definition" this stage forbids. Closing that gap needs a
projection **generated** from the type declarations. That is recorded as
**PROPOSED**, not silently assumed. The reproduced counterexample (R1) was a
top-level board key and is closed.

## Semantic validity is CARRIED, not refused

A structurally exact board that fails `validatePcbBoardStructure` is a
legitimate fixture: the resource-withholding evaluation cases exist to prove
the **production assembler** withholds on it. Refusing it here would delete
that coverage — a loosening in the opposite direction. Every authority's
verdict is returned in `verdicts` and pinned by a regression, so a fixture
can never change validity unnoticed:

| Case | Verdicts |
| --- | --- |
| `e06c-selection-valid` | schematic `valid`, board `valid`, mark `valid`, selection `valid`, netlist `absent` |
| `e04-invalid-board` | board `invalid` |
| `e07a-netlist-proven` | netlist `valid` |
| `e07b-netlist-forged` | netlist `unproven` |
| `e08-kicad-netlist-withheld` | netlist `unproven` |

`unproven` (not `invalid`) is used when the shared PROOF authority declined —
including the KiCad case, where no trusted server-side pin authority exists
at all. Naming it `invalid` would blame the fixture for a missing authority.

## Two fixtures corrected by this contract

Both changes make the fixture **stricter**, not the test weaker:

1. **`e04-invalid-board`** carried `{ stackup, nets, footprints, tracks,
   vias, zones }` — missing `formatVersion`, `outline`, and `texts`. That is
   malformed *transport*, not a semantically invalid project. It is now a
   complete `PcbBoard` whose track carries an empty identity, so
   `validatePcbBoardStructure` still refuses it and the case's meaning
   (invalid board ⇒ canonical resource and dependent tools withheld) is
   unchanged.
2. **`e06b-selection-malformed`** carried `{ kind: "bogus" }`, which the
   closed `SelectionRef` union no longer permits at the type level. It is now
   `{ kind: "track", id: "" }` — refused by the SAME shared parser
   (`parseSelectionRef`), so the case's meaning is unchanged.

Pin impact: 18 of 19 replay pins are byte-identical. `e04-invalid-board`
changed (`eng1-8cdbebffbe4e24c4` → `eng1-97a8cd4fb3f78a64`) because the
assembler's withholding **warning text** quotes the first structural issue,
and the corrected board reports a different first issue. See
[validation-summary.md](validation-summary.md).
