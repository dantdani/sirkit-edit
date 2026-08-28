# B11.6 §A/§D — the projection ownership contract

> **SUPERSEDED IN PART BY B11.7.** The result contract below was not yet
> uniformly true: a primitive fast path bypassed capture, so non-JSON
> primitives reached `ok: true` values (B11.7 R1). The fast path is removed —
> the ONLY capture bypass is registry-proven ownership — and the contract
> table's "capturable" rows now hold for every input. See
> [../ai-control-plane-b11-7/primitive-discipline-contract.md](../ai-control-plane-b11-7/primitive-discipline-contract.md).
> The historical record below is retained unchanged as evidence.

Modules: [`pcb-shape-projection.ts`](../../app/lib/agent/pcb-shape-projection.ts),
[`replay-context.ts`](../../app/lib/agent/replay-context.ts),
[`plain-capture.ts`](../../app/lib/agent/plain-capture.ts)

## The architecture

Three layers, exactly as the stage prescribes:

1. **Public hook-free capture-and-project boundary.**
   `projectBoardForReplay(raw)` and `projectReplayContext(raw)` capture the
   untrusted input first (`capturePlainJson` — descriptor-only reads, no hook
   ever invoked) and project the **owned snapshot**. Not a `try/catch` around
   the old walker: the walker simply never sees caller-owned data.
2. **Trusted captured-data projector.**
   The walkers (`runCapturedProjection`, `projectCapturedContextValue`) operate
   only on data proven ours. `projectCapturedBoard` is the exported trusted
   entry for the cross-module parse-once path.
3. **Explicit failure result.** `{ ok: false, issues }`. Failure is never
   encoded as the original raw input, and no inert sentinel can collide with
   real data.

## The ownership registry

The trusted/trustless split is **runtime-enforced**, not documented-only:

```ts
const OWNED_CAPTURES = new WeakSet<object>();       // module-private
export function isOwnedCapture(value: unknown): boolean
```

Every container the capture produces is registered at deep-freeze time.
Membership is:

* **unforgeable** — a caller cannot insert into a module-private `WeakSet`;
  a caller-frozen plain object is still foreign (asserted);
* **trap-free and total** — `WeakSet.has` is identity-based; it invokes no
  proxy traps and cannot throw, even on a revoked proxy;
* **leak-free** — weak references, so snapshots are collected normally.

Every captured-only entry checks the registry: an owned snapshot takes the
zero-copy fast path; anything else silently routes through capture-first. A
misuse call is therefore total and identity-safe — it can never treat foreign
data as trusted.

## §D — what each projector returns

`BoardProjectionResult` / `ContextProjectionResult`:

| Input | Result |
| --- | --- |
| valid captured JSON | `{ ok: true, value, issues: [] }` — owned, deep-frozen projection; canonical-equivalent to the input |
| structurally invalid but capturable JSON | `{ ok: true, value, issues: [...] }` — `value` is still an owned projection carrying wrong-typed **plain** values as owned copies, for deterministic validation diagnostics only; `issues` says why it is not authoritative |
| input cannot be captured (proxy, accessor, hook, cycle, sparse array, capture bound) | `{ ok: false, issues }` — no value at all |
| traversal bounds exhausted | `{ ok: false, issues }` — a partial projection is never returned as authoritative |
| hostile proxy encountered anywhere | either the capture refuses (`ok: false`) or — for a proxy whose data descriptors are capturable, e.g. a `get`-trap-only proxy — the capture yields an owned copy of what the descriptors reported, and the caller's proxy appears nowhere in the result |

**On every path the result contains only owned data.** The identity-walk
regression recursively compares every object reachable from a projection
against every object reachable from the caller's input and proves the
intersection is empty.

## Replay validation cannot treat a failed projection as authoritative

The discriminated type makes it structural: a consumer must check `ok` before
`value` exists (TypeScript narrowing), and an `ok: true` with non-empty
`issues` is used in exactly one place — the round-trip comparison inside
validation, which compares canonical JSON and then discards it.

## Consumers updated

| Consumer | Change |
| --- | --- |
| `validateReplayContext` step 7 round-trip | calls the internal trusted `projectCapturedContextValue` directly — the snapshot is already owned, so no re-capture (parse-once) |
| `projectCapturedContextValue` board slice | calls `projectCapturedBoard`; the board sub-tree of an owned context is registry-owned, so the fast path applies |
| `b11-2`, `b11-3`, `b11-5` round-trip tests | unwrap the discriminated result (`.ok` asserted, `.value` compared) |
| `b11-5` "hostile caller proxy" test | corrected: a `get`-trap-only proxy is capturable, so the right assertion is *no identity and no executable behaviour*, not `ok: false`; a revoked proxy is the explicit-failure case |

## Semantics preserved

* A valid board/context projects **canonical-equivalent** (asserted, including
  the `__proto__`-preserving cases from B11.5).
* Unknown keys are still dropped by the projector, so the round-trip proof is
  unchanged.
* Wrong-typed plain values are still visible for diagnostics (`stackup: "2"`
  comes back as `"2"`) — as owned frozen copies.
* All 19 replay pins byte-identical; the generator is byte-stable ×2.
