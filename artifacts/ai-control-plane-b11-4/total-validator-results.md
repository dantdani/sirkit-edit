# B11.4 §C/§D — validator totality and board alignment

> **SUPERSEDED IN PART BY B11.5.** The totality claim here was incomplete:
> `findNonPlainJsonPath` guarded ONE preliminary `Reflect.ownKeys` and then
> repeated reflective work through unguarded `Object.getOwnPropertyNames` /
> `Object.getOwnPropertySymbols` and `Object.entries` (which performs property
> reads). Five STATEFUL proxy families threw straight out of it (B11.5 R3). A
> proxy is not safe because one preliminary trap invocation succeeded. See
> [../ai-control-plane-b11-5/validator-totality-matrix.md](../ai-control-plane-b11-5/validator-totality-matrix.md).
> The historical record below is retained unchanged as evidence.

## §C — every public validator is total

B11.4 R4 reproduced eight throws: `validateReplayCapsule`,
`validateReplayContext`, `validateAgentRunTrace`, and `findNonPlainJsonPath`
each threw for both a **revoked** `Proxy` (`TypeError: Cannot perform 'IsArray'
on a proxy that has been revoked`) and a **trap-throwing** `Proxy`
(`Error: hostile getPrototypeOf`).

All four now capture or guard first. Every reflective operation — `Array.isArray`,
`Reflect.ownKeys`, `Reflect.getPrototypeOf`, `Reflect.getOwnPropertyDescriptor` —
runs inside a guard that converts failure into a bounded structured issue.

Observed after the fix:

```
capsule(revoked)   ["capsule: is not reflectable (revoked or hostile proxy)"]
context(revoked)   {"ok":false,"issues":["context: is not reflectable (revoked or hostile proxy)"]}
trace(revoked)     ["trace: is not reflectable (revoked or hostile proxy)"]
nonPlain(revoked)  "$: is not reflectable (revoked or hostile proxy)"
capsule(throwing)  ["capsule: its prototype is not reflectable (hostile trap)"]
context(throwing)  {"ok":false,"issues":["context: its prototype is not reflectable (hostile trap)"]}
trace(throwing)    ["trace: its prototype is not reflectable (hostile trap)"]
nonPlain(throwing) "$: its own keys are not reflectable (hostile trap)"
```

`validateBoardShape` and `projectBoardForReplay` were also made total: their
walkers guard `Array.isArray` (even `isRec` does — it is the first thing a
revoked proxy breaks) and the public entry points wrap the walk.

The regression covers three proxy families — **revoked**, **throwing traps**,
and **lying `ownKeys`** (a trap that reports a key whose descriptor is then
`undefined`) — across six functions, asserting both `not.toThrow()` and a
bounded non-empty refusal.

## Stable descriptors are captured once

> If a Proxy reports a stable set of data descriptors, capture those descriptor
> values once into the independent snapshot. Later Proxy behavior must be
> irrelevant.

Proven directly: a proxy whose `getOwnPropertyDescriptor` returns
`"captured-value"` in phase 0 and `"changed-later"` in phase 1 is captured in
phase 0; after flipping the phase, the snapshot still reads `"captured-value"`
and is frozen. Time-of-check/time-of-use is closed by construction, not by
re-reading.

## Cycles and non-JSON values

`capturePlainJson` refuses a self-referential object and refuses a field whose
value is a function, a symbol, a bigint, `undefined`, or `NaN` — each with a
bounded issue, never an exception.

## §D — `validateBoardShape` aligned

B11.4 R5 reproduced the disagreement: a sparse `tracks` array made
`validateBoardShape` return `[]` — its documented contract is *"empty ⇔
structurally exact"* — while `validateReplayContext` refused the same board.

The low-level walker now independently refuses, at every array it visits:

| Refusal | Message |
| --- | --- |
| sparse arrays | `must not be a sparse array` |
| non-index properties | `an array must carry only index properties` |
| accessors at indices | `must be a data property, not an accessor` |
| non-enumerable indices | `must not carry non-enumerable properties` |
| foreign array prototypes | `must be a plain array (unexpected prototype)` |
| symbol keys | `must not carry symbol keys` |
| exhausted traversal | `traversal bounds were exhausted, so the board is refused rather than partially validated` (B11.3) |
| non-reflectable values | `is not reflectable (revoked or hostile proxy)` |

The exported function was kept public rather than hidden, because its contract
is now true: a regression drives all six malformed-array shapes through it
directly, and the sparse case additionally asserts the context layer agrees.
