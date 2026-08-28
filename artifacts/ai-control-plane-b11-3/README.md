# B11.3 — Generated, Recursively Exact PCB Replay-Context Projection

> **PARTLY SUPERSEDED BY B11.4.** Three claims here did not survive
> adversarial reproduction: validation invoked `toJSON` hooks and getters
> (`JSON.stringify` on the caller's object), `replayCapsule` kept reading the
> CALLER'S capsule after validating it (so a post-call mutation changed the
> executed run and moved the trace digest), and every public validator THREW on
> a revoked or trap-hostile `Proxy`. The drift proofs below also wrote two
> repository paths. All are closed in
> [../ai-control-plane-b11-4/](../ai-control-plane-b11-4/README.md). The
> generated recursive PCB projection itself is RETAINED and its five
> counterexamples remain closed. Nothing below is deleted — it is the
> historical record of what B11.3 did and claimed.

The final narrow B11 closure. B11.2's replay-context contract was exact only at
the `PcbBoard` **top level**; an innocent unknown field one level deeper still
validated and executed. Five counterexamples were reproduced against production
code **before any edit**, closed, and made permanent regressions.

## Documents

| Document | Content |
| --- | --- |
| [pre-edit-counterexamples.md](pre-edit-counterexamples.md) | Exact R1–R5 pre-edit outputs, root cause, closure |
| [generated-pcb-type-graph.md](generated-pcb-type-graph.md) | §A the compiler-API generator: scope, digests, supported shape categories, unsupported-shape failure policy |
| [recursive-board-projection.md](recursive-board-projection.md) | §B one traversal, two views; the round-trip invariant; per-guarantee evidence |
| [union-and-record-validation.md](union-and-record-validation.md) | Discriminated-union variant selection and the seven declared dynamic-key sites |
| [drift-gate-results.md](drift-gate-results.md) | §E `--check`, the five mutation probes, byte stability, and one stated limitation |
| [adversarial-review-findings.md](adversarial-review-findings.md) | Six further defects found by adversarial review — including an ARRAY blind spot that B11.1 and B11.2 also missed — reproduced, fixed, and regression-tested |
| [regression-matrix.md](regression-matrix.md) | §F every required proof mapped to a test |
| [validation-summary.md](validation-summary.md) | Battery counts, all 19 replay-pin comparisons, adversarial review, confidence, verdict |

## What changed

* **`scripts/generate-pcb-shape-descriptor.ts`** (new) — walks the complete
  type graph reachable from `app/lib/pcb/types.ts:PcbBoard` with the TypeScript
  compiler API and type checker (no regex), emitting a deterministic
  descriptor. `--check` is a read-only CI gate; unsupported shapes fail closed
  with the offending path and write nothing.
* **`app/lib/agent/generated/pcb-shape-descriptor.ts`** (new, generated) —
  81 named types from 8 source files, with a source digest and a graph digest.
* **`app/lib/agent/pcb-shape-types.ts`** (new) — the tiny, PCB-agnostic
  descriptor IR shared by generator and runtime.
* **`app/lib/agent/pcb-shape-projection.ts`** (new) — the recursive projector
  and validator: one traversal, two views, driven only by the descriptor.
* **`app/lib/agent/replay-context.ts`** — the shallow top-level `pick` is
  replaced by `projectBoardForReplay`; the hand-written
  `PCB_BOARD_REQUIRED_KEYS` / `PCB_BOARD_OPTIONAL_KEYS` are **deleted**; schema
  bumped to `sirkit.agent-replay-context.v2`.
* **`app/lib/agent/replay-capsule.ts`** — schema bumped to
  `sirkit.agent-replay-capsule.v3`, with the decision and its counter-argument
  recorded in the source.
* **`app/lib/agent/trace.ts`** — `findNonPlainJsonPath` and
  `findSecretShapedPath` now apply their full discipline to **arrays**, closing
  a bypass that B11.1 and B11.2 also missed (see
  [adversarial-review-findings.md](adversarial-review-findings.md)).
* **`app/lib/agent/__tests__/b11-3-generated-pcb-shape.test.ts`** (new) —
  28 permanent regressions.
* **`app/lib/agent/__tests__/b11-2-replay-context.test.ts`** — the board half
  of its drift gate is retired (the key lists it asserted no longer exist); the
  schematic half is untouched.

## The residual B11.2 stated, now closed

B11.2 said, in its own words, that board content below the top level was *"NOT
key exhaustive, because hand-writing an exhaustive key list for the whole PCB
element type system is precisely the competing PCB definition this stage
forbids"*, and recorded a generated projection as **PROPOSED**. That is what
B11.3 built. The exhaustiveness now comes from the declarations themselves, and
a CI gate fails until the descriptor is regenerated whenever any reachable PCB
type changes.

## What is deliberately unchanged

Structural exactness and **semantic validity remain separate**.
`validatePcbBoardStructure` was not touched and was not weakened.
`e04-invalid-board` is still valid replay *transport* while that validator
classifies it invalid, and its resource/tool withholding behaviour — and its
pinned trace digest — are unchanged.

Static exposure remains exactly **NINE** read/propose tools. No mutation
execution, manufacturing release, MCP, provider expansion, or multi-agent
surface was added. B12 was not started.
