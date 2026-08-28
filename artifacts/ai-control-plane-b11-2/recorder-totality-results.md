# B11.2 §D — total recorder boundary

> **UNCHANGED BY B11.3, and re-proven.** The total recorder boundary and the
> hard trace bounds are untouched by B11.3; their suites remain green.

Closes **R5**. Module:
[`app/lib/agent/trace-recorder.ts`](../../app/lib/agent/trace-recorder.ts)

## What B11.1 claimed, and why it was false

B11.1's header claimed *"Recording is TOTAL: no recorder method throws"*.
That was true for the inputs B11.1 tested — bad token counts, oversized
identifiers, cyclic payloads, hostile clocks — and **false** for malformed
outer values and hostile accessors, because normalization began only *after*
the fields had already been read. R5 reproduced six throwing call sites.

## The boundary

```ts
private total(work: () => void): void {
  try { work(); } catch { this.diagnostics.add("trace_input_normalized"); }
}

private safeRead(source: unknown, key: string): unknown {
  if (source === null || typeof source !== "object") return undefined;
  try { return (source as Record<string, unknown>)[key]; }
  catch { this.diagnostics.add("trace_input_normalized"); return undefined; }
}
```

Every public method — `recordRunStarted`, `recordWarning`, `recordStep`,
`recordTool`, `recordTerminal`, `finalize` — runs inside `total()`, and every
field of an argument object is read through `safeRead()`.

`finalize` is additionally double-guarded: `finalizeInternal` is wrapped, the
fallback `compose()` is wrapped, and the innermost fallback is
`emergencyTrace()`, built only from frozen construction-time identity so it
has no throwing path. The emergency document is returned to the caller and is
**never handed to a sink** (it is not a valid persisted trace).

`summary` is arbitrary runtime input, so `finalize` reads `outcome` and
`failureReason` through `safeRead` and then re-checks that a terminal was
actually recorded, falling back to `("failed", "internal_error")`.

## One deliberate refusal, not a coercion

`recordWarning` now **refuses** a non-string message instead of coercing it:

```ts
if (typeof message !== "string") { this.diagnostics.add("trace_input_normalized"); return; }
```

`String(x)` invokes a hostile `toString`/`valueOf` — the exact R5 failure —
and the coerced text could carry provider content. Refusal is the only safe
option.

## Probes proven non-throwing

Seventeen probes, each run against a live recorder, each asserted
`not.toThrow()`, each followed by a full `finalize()`:

| Category | Probes |
| --- | --- |
| malformed outer values | `recordStep(null)`, `recordTool(null)`, `recordWarning(null)` |
| hostile getters | throwing accessors on `usage`, `model`, `proposal`, `args` |
| hostile proxies | `recordStep(new Proxy({}, { get / ownKeys throw }))` |
| hostile coercion | object whose `toString` and `valueOf` both throw |
| cyclic payloads | self-referential `args` **and** `output` |
| invalid numerics | `NaN`, `-1.5`, `Infinity` token/tool counts |
| oversized strings | 50 000-character warning |
| secret-shaped strings | synthetic placeholder in a warning |
| unexpected terminal values | `recordTerminal("exploded", <hostile coercion>)` |
| unexpected outcome class | `outcomeClass: "totally-unexpected"` |
| throwing clock | clock that throws on every call |
| throwing sink | `append` and `complete` both throw |
| hostile finalize summary | `Proxy` whose every read throws |

For every probe the regression additionally asserts:

* every emitted diagnostic belongs to `TRACE_RECORDER_DIAGNOSTICS` (the
  closed 10-entry vocabulary — **unchanged** by B11.2);
* the serialized trace contains **none** of `hostile accessor`,
  `hostile toString`, `hostile valueOf`, `hostile proxy`, `hostile ownKeys`,
  `at Object.` (a stack frame marker), or the synthetic placeholder.

No exception message, stack, raw value, or provider content is ever retained.

## Recording failure cannot change run behaviour

A dedicated regression drives a recorder with a sink that throws on every
call, then feeds it `recordWarning(null)` and `recordStep(null)`, and asserts
the finalized terminal is still `completed` with a `null` failure reason.
Trace recording remains observationally inert with respect to tool
authorization, execution outcomes, and terminal semantics.

## One judgement call, stated explicitly

An out-of-vocabulary `outcomeClass` is normalized to `"refused"` and
classified with `trace_input_normalized`. There is no truthful option for
out-of-vocabulary input; `"refused"` is the conservative reading for an
authority record, the real `status` string is preserved alongside it, and the
diagnostic makes the normalization visible rather than silent.
