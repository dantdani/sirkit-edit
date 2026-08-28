# B11.7 §A — one primitive discipline

Modules: [`pcb-shape-projection.ts`](../../app/lib/agent/pcb-shape-projection.ts),
[`replay-context.ts`](../../app/lib/agent/replay-context.ts)

## The rule

> A public projection must never report `ok: true` with data that
> `capturePlainJson` would refuse.

B11.6's projections carved out a shortcut — "non-object primitives skip
capture" — on the reasoning that primitives carry no identity. That reasoning
was true and still insufficient: identity is not the only thing capture
enforces. Capture also enforces **JSON validity**, and the shortcut let five
non-JSON primitives (`undefined`, symbols, bigints, `NaN`, `±Infinity`)
into `ok: true` results, where a bigint made `JSON.stringify` throw,
non-finite numbers silently became `null`, and `undefined`/symbol values
vanished from serialization.

## The fix

The **only** capture bypass is now registry-proven ownership:

```diff
- if (isOwnedCapture(raw) || raw === null || (typeof raw !== "object" && typeof raw !== "function")) {
-   return runCapturedProjection(raw);
- }
+ if (isOwnedCapture(raw)) return runCapturedProjection(raw);
  const captured = capturePlainJson(raw, "board");
  if (!captured.ok) return { ok: false, issues: captured.issues };
  return runCapturedProjection(captured.value);
```

Applied identically to `projectBoardForReplay`, `projectCapturedBoard` (whose
misuse path routes here), and `projectReplayContext`. Primitives can never be
registry-owned — the registry holds only containers we created — so every
primitive root goes through capture.

`projectCapturedContextValue` additionally gained an explicit refusal channel
(`{ refused: true, issues } | { refused: false, value, issues }`) and now
attaches the deterministic structural issue `context: must be a plain object`
to any non-record root — closing the `ok: true, issues: []` case for
`projectReplayContext("x")` and `projectReplayContext(null)`. The previous
code inferred refusal from `value === null`, which would have misclassified a
legitimate `null` root; refusal is now carried explicitly.

## The discriminated semantics, unchanged and now uniformly true

| Result | Meaning |
| --- | --- |
| `ok: false` | not capturable, or traversal could not complete |
| `ok: true` + issues | capturable JSON but structurally invalid — never authoritative |
| `ok: true` + no issues | structurally exact projection |

With capture-first everywhere:

* `undefined` / symbol / bigint / `NaN` / `±Infinity` → **`ok: false`** with
  bounded, deterministic capture issues (`undefined is not JSON data`,
  `must be a finite number`, …) — asserted identical across repeated calls;
* `null`, finite numbers, booleans, strings → capture succeeds, the walker
  reports `must be a plain object` → **`ok: true` + issues**, and the value
  survives serialization with its meaning intact;
* nested non-finite numbers, nested `undefined`, nested symbols/bigints/
  functions → capture refuses the whole document, so none of them can be
  smuggled inside an otherwise-plain board and silently normalized.

## Consequences proven

* No successful projection result contains a value `JSON.stringify` cannot
  serialize, and none changes meaning under serialization — the reusable
  §C invariant runs over every supported primitive root, valid and invalid
  boards and contexts, all 19 committed evaluation contexts, and the
  `__proto__`/`constructor`/`prototype` special-key cases.
* Refusal results are themselves serializable and value-free
  (`{"ok":false,"issues":[…]}` — no `value` key to lose or corrupt).
* The owned-snapshot zero-copy path is preserved exactly where `isOwnedCapture`
  proves ownership — the parse-once chain is untouched, and all 19 pins are
  byte-identical.
