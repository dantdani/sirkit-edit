# B11.3 — union variants and dynamic records

## Discriminated unions

The generator marks a union with a `discriminant` when a property is present on
**every** object variant, its type in each variant is a **single string
literal**, and all values are **distinct**. Eight named unions in the graph
qualify, including:

| Union | Discriminant | Variants |
| --- | --- | --- |
| `app/lib/pcb/types.ts#BoardOutline` | `kind` | 3 (`rect`, `roundrect`, `polygon`) |
| `app/lib/pcb/types.ts#FpGraphic` | `kind` | 6 (`line`, `arc`, `circle`, `rect`, `poly`, `text`) |
| `app/lib/pcb/geometry.ts#PadShape` | `kind` | 5 |
| `app/lib/pcb/silk/types.ts#SilkItem` | `kind` | 4 |

At runtime the projector reads the tag and walks **only that variant**. A field
belonging to another variant is therefore an unknown key on the selected one
and refuses — which is exactly the property the stage asks for.

Proven by execution:

* every declared variant of `BoardOutline` and `FpGraphic` validates clean and
  round-trips byte-equivalently;
* `rect + cornerRadius`, `rect + points`, `polygon + width`,
  `roundrect + points` all refuse;
* `{ kind: "hexagon", … }` refuses with an explicit
  *"is not a declared variant of this union"*;
* on `FpGraphic`: `line + mid` (arc's field), `line + center` (circle's), and
  `line + textKind` (text's) all refuse;
* nested `Vec2` is exact too — `{ kind: "polygon", points: [{x,y,z}] }` and
  `{ kind: "rect", origin: {x,y,z} }` both refuse.

## Non-discriminated unions

Where no discriminant exists (literal unions such as `LayerId`, and structural
unions in the constraint graph), the projector evaluates every variant in
descriptor order and takes the **first clean** one. If none is clean, the
variant with the fewest issues supplies the diagnostics, with descriptor order
breaking ties — so the outcome is deterministic. Each attempt runs on its own
copy of the traversal budget, so a failed variant cannot consume the node
allowance of the one that actually matches.

## Dynamic records

Dynamic keys are legal at exactly the **seven** declared sites listed in
[generated-pcb-type-graph.md](generated-pcb-type-graph.md), and nowhere else.

### `Record<string, V>` — e.g. `FootprintInstance.padNets`

Any string key is legitimate; the **value** is walked recursively against `V`.

* `{ "1": 4, "A1": 7, "weird key": 0 }` — accepted, round-trips exactly.
* `{ "1": "four" }` — refuses (value must be a number).
* `{ "1": { nested: 1 } }` — refuses.

### `Record<number, V>` — e.g. `BoardNetClassing.assignments`

In JSON these keys are **canonical integer strings**, and that is enforced
exactly:

```ts
function isCanonicalIntegerKey(key: string): boolean {
  if (key.length === 0 || key.length > 20) return false;
  const parsed = Number(key);
  return Number.isSafeInteger(parsed) && String(parsed) === key;
}
```

* `{ "1": …, "42": … }` — accepted.
* `"01"`, `"1.5"`, `"abc"`, `" 1"`, `"1e3"`, `""` — each refuses.
* A malformed record **value** (`{ classId, explanation, innocent: 1 }`)
  refuses, because the value type is walked like any other node.

This is a documented adapter, not a guess: the `key: "number"` marker comes
from the type checker's number index signature, and the canonical-integer rule
is the exact JSON image of `Record<number, V>`.

## Why this is not a competing definition

Every fact above — which unions have discriminants, which variants exist, where
index signatures live and with which key kind — is **read out of the generated
descriptor**, which is read out of the TypeScript declarations. A regression
asserts that neither `replay-context.ts` nor `pcb-shape-projection.ts` contains
any `PcbBoard` field-name literal, and that the projector's only PCB import is
`./generated/pcb-shape-descriptor`.
