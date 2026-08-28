# B11.3 — pre-edit counterexamples (R1–R5)

All five reproductions were run against **production code, before any B11.3
edit**, through a transient probe
(`app/lib/agent/__tests__/_tmp-b113-repro.test.ts`, deleted after capture),
using the committed `e03-valid-board` capsule with one innocent unknown field
injected at a time.

## Baseline — the unmodified capsule

```json
{
  "validateReplayCapsule()": [],
  "traceDigest": "eng1-54402fed3e12951c",
  "committed pin": "eng1-54402fed3e12951c",
  "trace events": 7,
  "tools discovered": 8,
  "outline kind": {
    "kind": "rect",
    "width": 100000000,
    "height": 80000000,
    "origin": { "x": 0, "y": 0 }
  }
}
```

## R1–R5 — exact captured output

```json
{
  "1. context.board.outline": {
    "validateReplayContext.ok": true,
    "validateReplayCapsule()": [],
    "replayCapsule executed": true,
    "sink factory reached (context assembly + discovery + loop ran)": true,
    "trace events": 7,
    "tool invocations": 2,
    "tools discovered": 8,
    "threw": null
  },
  "2. context.board.outline.origin": {
    "validateReplayContext.ok": true,
    "validateReplayCapsule()": [],
    "replayCapsule executed": true,
    "sink factory reached (context assembly + discovery + loop ran)": true,
    "trace events": 7,
    "tool invocations": 2,
    "tools discovered": 8,
    "threw": null
  },
  "3. context.board.nets[0]": {
    "validateReplayContext.ok": true,
    "validateReplayCapsule()": [],
    "replayCapsule executed": true,
    "sink factory reached (context assembly + discovery + loop ran)": true,
    "trace events": 7,
    "tool invocations": 2,
    "tools discovered": 8,
    "threw": null
  },
  "4. context.board.tracks[0]": {
    "validateReplayContext.ok": true,
    "validateReplayCapsule()": [],
    "replayCapsule executed": true,
    "sink factory reached (context assembly + discovery + loop ran)": true,
    "trace events": 7,
    "tool invocations": 2,
    "tools discovered": 8,
    "threw": null
  },
  "5. context.board.tracks[0].start": {
    "validateReplayContext.ok": true,
    "validateReplayCapsule()": [],
    "replayCapsule executed": true,
    "sink factory reached (context assembly + discovery + loop ran)": true,
    "trace events": 7,
    "tool invocations": 2,
    "tools discovered": 8,
    "threw": null
  }
}
```

Every case: **`validateReplayCapsule` returned `[]`**, `replayCapsule(…, {
computeOnly: true })` **executed**, and the run reached context assembly,
discovery, the gateway, the loop, and two tool invocations — the sink factory
was constructed, which happens only after the capsule has been accepted.

## Root cause

`projectReplayContext` performed a **shallow top-level `pick`** on the board:

```ts
if (isRec(context.board)) context.board = pick(context.board, [...PCB_BOARD_REQUIRED_KEYS, ...PCB_BOARD_OPTIONAL_KEYS]);
```

Everything below the top level was carried **wholesale**, so the projection
round-trip — B11.2's proof mechanism — had nothing to detect: the projector did
not drop the nested unknown field, so re-projecting reproduced it exactly.

`validatePcbBoardStructure` did not compensate. It validates *engineering
semantics* (id uniqueness, net/padstack references, outline/geometry/layer
validity) and has never rejected unknown keys. It is **not** changed by this
stage.

The two hand-written key lists (`PCB_BOARD_REQUIRED_KEYS`,
`PCB_BOARD_OPTIONAL_KEYS`) were themselves the ceiling: extending them downward
by hand would have created the competing PCB definition B11.2 explicitly
refused to write.

## Closure

§A — a **generated** runtime descriptor of the complete type graph reachable
from `app/lib/pcb/types.ts:PcbBoard`, produced with the TypeScript compiler API
and type checker.
§B — a **recursive projector** driven by that descriptor, so the round-trip
invariant `canonicalJson(projectBoardForReplay(raw)) === canonicalJson(raw)`
detects unknown data at every depth.
§E — a `--check` CI gate that fails until the descriptor is regenerated.

All five counterexamples are permanent regressions in
[`b11-3-generated-pcb-shape.test.ts`](../../app/lib/agent/__tests__/b11-3-generated-pcb-shape.test.ts)
§B "R1-R5: the five mandatory nested counterexamples all REFUSE, and nothing
executes".
