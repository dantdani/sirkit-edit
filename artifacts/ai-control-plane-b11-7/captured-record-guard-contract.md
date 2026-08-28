# B11.7 §B — the truthful captured-record guard

Module: [`plain-capture.ts`](../../app/lib/agent/plain-capture.ts)

## The defect

```ts
// before: "any non-array object"
export function isCapturedRecord(value: unknown): value is Record<string, PlainJsonValue> {
  if (typeof value !== "object" || value === null) return false;
  try { return !Array.isArray(value); } catch { return false; }
}
```

The TypeScript claim — `value is Record<string, PlainJsonValue>` — asserts the
value is plain captured JSON. The runtime test accepted **any** non-array
object: `{}`, a frozen caller object, a `Date`, a benign proxy. An exported
type predicate whose runtime test is weaker than its type claim silently
launders arbitrary caller data into the captured type.

No production consumer imported it (verified by grep — definition and tests
only), so removal was on the table; it is **retained and made truthful**
instead, because the ownership registry makes truthfulness one line:

```ts
export function isCapturedRecord(value: unknown): value is Record<string, PlainJsonValue> {
  if (!isOwnedCapture(value)) return false;
  try { return !Array.isArray(value); } catch { return false; }
}
```

`isOwnedCapture` is the unforgeable, trap-free WeakSet membership check from
B11.6, so the predicate is total and cannot be satisfied by anything capture
did not produce. The `Array.isArray` guard is kept as defence in depth even
though owned values are our own plain containers.

## Proven, case by case

| Input | Result |
| --- | --- |
| ordinary `{}` | **false** |
| frozen caller object | **false** |
| `Date` / class instance | **false** |
| benign proxy | **false** |
| revoked proxy | **false**, without throwing |
| captured object | **true** |
| nested captured object | **true** (every container is registered at freeze time) |
| captured array | **false** |
| projected-but-not-captured containers | **false** — see below |

## The documented distinction

"Captured" means *produced and registered by `capturePlainJson`*. Projection
outputs are owned and frozen but are **not** captures: the projector builds new
containers for every valid node, so a projection's root and its valid children
report `false`. The one place captured identity flows into a projection is a
**wrong-typed carried subtree** (kept for diagnostics) — that subtree is the
captured snapshot's own child, and it reports `true`. Both directions are
asserted by the regression.
