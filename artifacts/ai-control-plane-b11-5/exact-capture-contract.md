# B11.5 §A — the exact capture contract

Module: [`app/lib/agent/plain-capture.ts`](../../app/lib/agent/plain-capture.ts)

## What changed

```diff
- const captured: Record<string, PlainJsonValue> = {};
  …
-   captured[key] = child as PlainJsonValue;
+ const captured = Object.create(null) as Record<string, PlainJsonValue>;
  …
+   Object.defineProperty(captured, key, { value: child, enumerable: true, writable: true, configurable: true });
+ Object.setPrototypeOf(captured, Object.prototype);
```

Three properties, each load-bearing:

1. **Null-prototype destination.** While keys are being installed there is no
   inherited `__proto__` accessor to invoke at all.
2. **`Object.defineProperty`, never assignment.** `defineProperty` performs
   `[[DefineOwnProperty]]` and cannot invoke a setter, so every accepted own
   string key becomes an own enumerable data property byte-for-byte —
   `__proto__`, `constructor`, `prototype`, and ordinary `Record<string, V>`
   keys alike.
3. **Prototype restored last.** The captured object ends with the ordinary
   `Object.prototype`, so downstream code that expects a plain object is
   unaffected. An own `__proto__` data property **shadows** the inherited
   accessor, so restoring the prototype cannot undo step 2.

The same rule was applied everywhere a snapshot is built from untrusted keys:

| Site | Change |
| --- | --- |
| `replay-context.ts` `pick()` | `Object.defineProperty` instead of `out[key] = …` |
| `pcb-shape-projection.ts` `walkObject()` | `defineOwn()` for declared props **and** dynamic `Record` keys |

`canonicalJsonValue` needed no change: it rebuilds with `Object.fromEntries`,
which uses `CreateDataProperty` and therefore also cannot invoke the setter.

## Evidence

```
numeric  __proto__ : own=true  value=42   JSON={"keep":1,"__proto__":42}   prototype=Object.prototype
object   __proto__ : own=true  prototype=Object.prototype  child deeply frozen
                     JSON={"keep":1,"__proto__":{"injected":true}}
misc               : {"constructor":1,"prototype":2,"ordinary":3}
```

Through production validation, with `footprint.padNets` carrying own
`"__proto__": 42`:

```
validateBoardShape        []            (Record<string, number> permits the key)
validateReplayContext     ok:true
captured padNets          {"1":1,"__proto__":42}
board  round-trip         canonicalJson(project(board))   === canonicalJson(board)   ✓
context round-trip        canonicalJson(project(context)) === canonicalJson(context) ✓
```

The projection invariant — *no accepted field is silently discarded* — now
holds for this key class, and the round-trip equality that enforces it includes
the key on both sides.

## Why preservation rather than prohibition

The stage was explicit, and the reasoning stands on its own: the authoritative
TypeScript contract for `FootprintInstance.padNets` is
`Record<string, number>`, which admits **any** string key. Forbidding
`__proto__` would mean the replay contract silently disagreed with the
generated type graph — a second, hidden rule of exactly the kind B11.3 removed.
If that key class is ever to be excluded, the exclusion belongs in the PCB type
declarations, and would then flow through the generated descriptor and its
drift gate automatically.

## Safety of preservation

Preserving the key does **not** create a prototype-pollution vector:

* the captured object's prototype is always `Object.prototype` (asserted);
* the value is a captured **copy**, not the caller's object (asserted);
* the whole snapshot, including that child, is deeply frozen (asserted);
* a type-violating value still refuses — an object-valued `__proto__` in a
  `Record<string, number>` is a type error, and the regression additionally
  asserts that neither `{}` nor `Object.prototype` acquired any property.
