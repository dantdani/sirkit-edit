# B11.4 §A — the hook-free capture contract

> **SUPERSEDED IN PART BY B11.5.** Two claims in this document did not hold:
> the capture was NOT exact — `captured[key] = child` invokes the legacy
> `__proto__` setter, discarding a numeric value and replacing the prototype
> for an object value (B11.5 R1) — and the diagnostics were NOT redacted, since
> this module carried its own ASCII-only `safeKeyName` rather than the shared
> classifier (B11.5 R2). See
> [../ai-control-plane-b11-5/exact-capture-contract.md](../ai-control-plane-b11-5/exact-capture-contract.md)
> and [../ai-control-plane-b11-5/diagnostic-redaction-proof.md](../ai-control-plane-b11-5/diagnostic-redaction-proof.md).
> The historical record below is retained unchanged as evidence.

Module: [`app/lib/agent/plain-capture.ts`](../../app/lib/agent/plain-capture.ts)

One shared bounded capture/parser for every untrusted document — trace,
capsule, and context.

```ts
capturePlainJson(root: unknown, label = "$", maxSerializedChars = 1_000_000): CaptureResult
```

## How it reads

It never touches a property. Every read goes through the reflective triple:

```ts
Reflect.ownKeys(target)                      // enumerate
Reflect.getOwnPropertyDescriptor(target, k)  // inspect
descriptor.value                             // take
```

That is the whole mechanism: a value is taken from a **descriptor**, not from a
property access, so a getter never runs and a `toJSON` is seen as a
function-valued own property rather than being invoked.

`Array.isArray` and `Reflect.getPrototypeOf` are themselves wrapped, because
both throw on a revoked `Proxy` (B11.4 R4).

## What it refuses

| Refusal | Why |
| --- | --- |
| accessor descriptors (`get`/`set`) | reading them is the attack — refused before invocation |
| function values | a `toJSON` hook is exactly this; refused **without invoking it** |
| `undefined`, `symbol`, `bigint` values | not JSON data |
| non-finite numbers | not JSON data |
| cycles | ancestors on the current path are tracked in a `Set` |
| foreign prototypes | objects must be `Object.prototype` or `null`; arrays must be `Array.prototype` |
| symbol keys | invisible to `Object.keys` and `JSON.stringify` |
| non-enumerable own properties | same invisibility |
| sparse arrays | holes are not own properties and would serialize as `null` |
| non-index array properties | invisible to index iteration, `JSON.stringify`, and `canonicalJson` |
| oversized keys, strings, arrays, depth, node count | bounded during capture, not after |
| reflective failure of any kind | one bounded structured issue |

## What it produces

An **independent, plain-data, deep-frozen** snapshot. The caller's object is
never referenced again — so later mutation (R3), later proxy behaviour (R4),
and later hook installation (R1/R2) are all irrelevant by construction.

## The serialization rule

> Do not call `JSON.stringify` or `canonicalJson` on the caller-owned object
> before this capture succeeds. Serialization of the captured snapshot is
> allowed.

This is enforced by ordering. Every serialized bound and serialized scan now
runs on the capture:

| Call site | Before | After |
| --- | --- | --- |
| `validateAgentRunTrace` | `JSON.stringify(trace)` for the size bound and the secret scan | capture first, then serialize the snapshot |
| `validateReplayCapsule` | `JSON.stringify(capsule)` for the size bound | `parseReplayCapsule` captures, then serializes the snapshot |
| `validateReplayContext` | `JSON.stringify(raw)` for the size bound | capture first, then `validateCapturedReplayContext` |

The serialized-size bound itself is applied to the captured snapshot, inside
`capturePlainJson`.

## Bounds

```ts
CAPTURE_BOUNDS = {
  maxDepth: 32, maxNodes: 200_000, maxArrayEntries: 20_000,
  maxStringChars: 100_000, maxKeyChars: 200, maxIssues: 12,
}
```

Every bound is checked **during** capture, so a hostile document cannot buy
work before being refused. Callers additionally pass their own
`maxSerializedChars` (1 MB for traces and contexts, 2 MB for capsules).

## Proof that hooks are never invoked

The regressions do not assert "no hook fired" indirectly — they use a
**self-deleting** hook, so the counter and the hook's own continued existence
are two independent witnesses:

```ts
outline.toJSON = function selfDeleting(this: Rec) { calls += 1; delete this.toJSON; return this; };
…
expect(calls).toBe(0);                    // it never ran
expect(outline.toJSON).not.toBeUndefined(); // …and it never deleted itself
```

Both hold for `validateReplayCapsule`, for `replayCapsule`, for
`validateAgentRunTrace`, and for `validateReplayContext`. The accessor case is
proven the same way, with a read counter on a getter installed at
`board.outline.origin`.
