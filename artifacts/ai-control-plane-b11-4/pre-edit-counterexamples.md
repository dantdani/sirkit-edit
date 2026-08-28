# B11.4 — pre-edit counterexamples (R1–R7)

All seven reproductions were run against **production code, before any B11.4
edit**, through a transient probe
(`app/lib/agent/__tests__/_tmp-b114-repro.test.ts`, deleted after capture).
Synthetic data only.

---

## R1 — a nested `toJSON` hook executes during validation

`e03-valid-board` with a self-deleting `toJSON` at `context.board.outline`:

```json
{
  "hook counter after replayCapsule": 1,
  "hook deleted itself": true,
  "replay executed": true,
  "outcome.ok": true,
  "normalized events produced": 8,
  "threw": null
}
```

The hook ran **once**, removed itself, and the capsule then validated clean and
executed the full control plane.

## R2 — a top-level `toJSON` does the same

```json
{
  "hook counter after validateReplayCapsule": 1,
  "hook deleted itself": true,
  "validateReplayCapsule()": []
}
```

`validateReplayCapsule` invoked the hook and returned **no issues**.

**Root cause (R1/R2).** Both validators called `JSON.stringify` on the
caller-owned document for the size bound and the serialized secret scan.
`JSON.stringify` invokes `toJSON`. Ordinary property access (`value[key]`,
`value.entries()`) invokes getters for the same reason.

## R3 — post-validation mutation changes execution

`e10-proposal-only`, mutated after `replayCapsule` was called but before its
promise resolved:

```json
{
  "steps in capsule": 2,
  "mutated text appears in normalized events": true,
  "traceDigest": "eng1-0711a8a796c5afb0",
  "committed pin": "eng1-2bfd85ba305e5b53",
  "digest differs from committed pin": true,
  "computeOnly returned ok": true,
  "injected net observable in board": true,
  "expected.traceDigest was replaced": "eng1-B114-FORGED"
}
```

The mutated step text reached the normalized events, the trace digest moved off
the committed pin, and `computeOnly` still reported `ok`.

**Root cause.** `replayCapsule` validated the caller's object and then kept
reading **that same object** for scope, context, steps, and expectations.

## R4 — hostile `Proxy` crashes validation

```json
{
  "validateReplayCapsule(revoked)":  { "THREW": "TypeError: Cannot perform 'IsArray' on a proxy that has been revoked" },
  "validateReplayContext(revoked)":  { "THREW": "TypeError: Cannot perform 'IsArray' on a proxy that has been revoked" },
  "validateAgentRunTrace(revoked)":  { "THREW": "TypeError: Cannot perform 'IsArray' on a proxy that has been revoked" },
  "findNonPlainJsonPath(revoked)":   { "THREW": "TypeError: Cannot perform 'IsArray' on a proxy that has been revoked" },
  "validateReplayCapsule(throwing)": { "THREW": "Error: hostile getPrototypeOf" },
  "validateReplayContext(throwing)": { "THREW": "Error: hostile getPrototypeOf" },
  "validateAgentRunTrace(throwing)": { "THREW": "Error: hostile getPrototypeOf" },
  "findNonPlainJsonPath(throwing)":  { "THREW": "Error: hostile getPrototypeOf" }
}
```

Eight for eight: every public validator threw instead of refusing.

## R5 — sparse low-level board validation disagrees

`tracks` with an element only at index 3:

```json
{
  "validateBoardShape(board)": [],
  "validateBoardShape is empty (claims exact)": true,
  "validateReplayContext refuses": true,
  "context issues": ["context.board.tracks: must not be a sparse array"]
}
```

The exported function whose documented contract is *"empty ⇔ structurally
exact"* returned `[]` for a board the context layer refused.

## R6 — the no-execution proof is vacuous

```json
{
  "sink factory calls for a VALID capsule": 0,
  "sink factory calls for an INVALID capsule": 0,
  "replayCapsule constructs InMemoryTraceSink directly": true,
  "replayCapsule calls createAgentTraceSink": false
}
```

`replayCapsule` never calls `setAgentTraceSinkFactory`'s factory at all, so the
counter is **0 for a valid capsule too**. The assertion used since B11.1 could
not distinguish "refused before execution" from "executed completely", and
therefore demonstrated nothing about context assembly, discovery, gateway
construction, loop execution, or tool invocation.

## R7 — the drift tests write runtime paths

```json
{
  "writes the checked-in descriptor (writeFileSync(DESCRIPTOR_FILE, …))": true,
  "creates app/lib/pcb/__b113probe__.types.ts": true,
  "writeFileSync call sites in the suite": 4,
  "paths written under app/": [
    "app/lib/agent/generated/pcb-shape-descriptor.ts",
    "app/lib/pcb/__b113probe__.types.ts"
  ]
}
```

**Interruption/corruption risk, documented before editing.** Both paths are
inside the repository. A run interrupted between a write and its `finally`
leaves the tree modified. This is not hypothetical: during B11.3 the same class
of test left `app/lib/pcb/types.ts` corrupted (`PcbBoard.texts` deleted,
`formatVersion: 1` duplicated, CRLF normalized), and the damage was
self-perpetuating because the next run read the damaged file as its own
restore baseline.

---

## Closures

| # | Closure |
| --- | --- |
| R1, R2 | §A `capturePlainJson` — descriptor-only reads, functions refused without invocation, no `JSON.stringify` on the caller's object |
| R3 | §B `parseReplayCapsule` — parse once, execute the deep-frozen snapshot |
| R4 | §C every reflective operation guarded; validators return bounded issues |
| R5 | §D `validateBoardShape` refuses sparse arrays, foreign prototypes, symbols, non-enumerable indices and index accessors |
| R6 | §E real boundary instrumentation with a control capsule and a mutation test |
| R7 | §F an importable, filesystem-pure builder with an in-memory overlay; no test writes any repository path |
