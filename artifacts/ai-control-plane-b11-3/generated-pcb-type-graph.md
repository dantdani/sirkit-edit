# B11.3 §A — the generated PCB type-graph descriptor

Generator: [`scripts/generate-pcb-shape-descriptor.ts`](../../scripts/generate-pcb-shape-descriptor.ts)
Output: [`app/lib/agent/generated/pcb-shape-descriptor.ts`](../../app/lib/agent/generated/pcb-shape-descriptor.ts)
IR: [`app/lib/agent/pcb-shape-types.ts`](../../app/lib/agent/pcb-shape-types.ts)

## Method

The generator uses the **installed TypeScript compiler API and type checker** —
`ts.createProgram`, `checker.getDeclaredTypeOfSymbol`,
`checker.getPropertiesOfType`, `checker.getIndexInfoOfType`,
`checker.getTypeArguments`, `checker.isTupleType` / `isArrayType`. There is no
regex parsing of source text anywhere in it. It starts at
`app/lib/pcb/types.ts:PcbBoard` and follows every reachable local and imported
interface, alias, union, tuple, array, record, literal type, and optional
property.

## Scope and digests

| | |
| --- | --- |
| Entry | `app/lib/pcb/types.ts#PcbBoard` (overridable with `--entry=`) |
| Descriptor schema | `sirkit.pcb-shape-descriptor.v1` |
| Named types | **81** |
| Contributing source files | **8** |
| Graph digest | `sha256-34cb69e527ca461d09cb8fdcc95854a0` |
| Source digest | `sha256-cf412478820e4a9930a88b8c95e9cdbf` |
| Emitted file | 9 105 lines |

Contributing files:

```
app/lib/constraints/types.ts
app/lib/pcb/geometry.ts
app/lib/pcb/layers.ts
app/lib/pcb/netclass.ts
app/lib/pcb/padstack/types.ts
app/lib/pcb/silk/types.ts
app/lib/pcb/stackup.ts
app/lib/pcb/types.ts
```

Structure, counted over one full traversal from the root:

| Node kind | Occurrences |
| --- | --- |
| `object` | 163 |
| `union` | 126 |
| `array` | 119 |
| `tuple` | 4 |
| `ref` | 204 |
| `literal` | 522 |
| `string` / `number` / `boolean` | 214 / 129 / 14 |

Of the 81 named nodes, **51 are objects** and **30 are unions**, of which
**8 carry a detected discriminant**.

`PCB_SHAPE_SOURCE_DIGEST` covers the exact bytes of every contributing file
(CRLF-normalized so the digest is platform-stable);
`PCB_SHAPE_GRAPH_DIGEST` covers the emitted canonical descriptor. Any change to
a reachable PCB type moves both.

## Supported TypeScript shape categories

| Category | Handling |
| --- | --- |
| `interface` / object `type` alias | `object` node with sorted props, each carrying `optional` from `SymbolFlags.Optional` |
| String / number / boolean primitives | `string` / `number` / `boolean` |
| String, number, and boolean **literals** | `literal` with the exact value |
| `null` | `null` |
| Unions | `union`; `boolean`'s internal `true \| false` is collapsed back to `boolean` |
| **Discriminated** unions | `union` with `discriminant`: a property present on every object variant whose type is a single string literal, all values distinct |
| Arrays | `array` with a walked element type |
| **Fixed** tuples | `tuple` with per-position element types (rest and optional elements refuse) |
| Index signatures | `object.index` with `key: "string"` |
| `Record<string, V>` | mapped type → `object.index` `{ key: "string", of: V }` |
| `Record<number, V>` | number index → `object.index` `{ key: "number", of: V }`; the projector requires canonical safe-integer string keys, which is what such a record becomes in JSON |
| Mapped/utility types (`Partial`, `Omit`, …) | resolved by the checker before the walk, so `Partial<Omit<NetClass, …>>` arrives as a plain object with optional props |
| Indexed access (`(typeof DIMENSION_LAYERS)[number]`) | resolved to its literal union |
| Recursive / self-referential types | named nodes are emitted once and referenced by `ref`; an in-progress name short-circuits to a `ref`, so cycles terminate without truncating content |

### Dynamic keys are permitted at exactly seven sites

Nowhere else in the graph may an object carry a key the type does not declare:

```
app/lib/pcb/types.ts#FootprintInstance.padNets                       key: string
app/lib/pcb/types.ts#FootprintInstance.footprintPadClassifications   key: string
app/lib/pcb/netclass.ts#BoardNetClassing.assignments                 key: number
app/lib/pcb/netclass.ts#BoardNetClassing.base                        key: number
app/lib/constraints/types.ts#EffectiveConstraintRule.conditionStates key: string
app/lib/constraints/types.ts#ConstraintLowerings.physicalByTarget    key: string
app/lib/constraints/types.ts#SelectorSnapshot.reasons                key: string
```

`PcbBoard` itself has **no** index signature — asserted directly by a
regression.

## Unsupported-shape failure policy

**Fail closed, never guess.** The generator raises `GenerationFailure`, prints
the offending *path*, writes nothing, and exits with status **2** for:

| Shape | Reason |
| --- | --- |
| `any`, `unknown` | not a validatable shape |
| `never` | not inhabitable |
| `symbol`, `bigint`, `void` | not JSON data |
| Function types (call signatures) | not JSON data |
| Class / constructor / enum types | not JSON data |
| Intersection types | no precise adapter exists |
| Rest elements in tuples | variable arity is not a fixed shape |
| Optional tuple elements | ditto |
| Types with **both** string and number index signatures | ambiguous |
| Any type declared in a `.d.ts` (library / `node_modules`) that is not a mapped type and has no index signature | external/opaque to JSON validation |
| An object type with no members and no index signature | nothing to validate |
| Type nesting deeper than 60 | generator depth limit |
| A **local generic** named type | the node id is `<file>#<Name>` and carries no type arguments, so `Foo<A>` and `Foo<B>` would collapse onto one node and the second instantiation would silently be described by the first. Added after adversarial review flagged it as latent (no reachable PCB type is generic today — verified). |

The only library construct admitted is the **documented adapter** for
`Record<K, V>` / index signatures — admitted precisely because its *value* type
is itself walked and validated recursively. `Date`, `Map`, `RegExp` and friends
fail closed: their members are functions, and the function rule rejects them.

Two failures were hit and resolved during this stage, both by widening the
adapter rather than by relaxing the policy:

1. `PcbBoard.footprints[].padNets` — `Record<string, number>` initially tripped
   the external/opaque rule because `Record` is declared in `lib.es5.d.ts`. The
   index-signature check was moved **before** that rule.
2. `PcbBoard.netClassing.assignments` — `Record<number, NetClassAssignment>`
   initially tripped "number-only index signatures are not supported". A
   precise `key: "number"` adapter was added, with canonical-integer-string key
   validation in the projector.

## Determinism and byte stability

* Named nodes are emitted in sorted key order; object props are sorted by name;
  the whole document is canonicalized (recursively key-sorted, `undefined`
  dropped) before rendering.
* The generator's canonicalizer is its own — it does not import app code, so
  the descriptor cannot become circularly dependent on the thing it describes.
* `Date.now()`-style nondeterminism does not appear anywhere in the output.
* Verified by running the generator three times and comparing bytes; and by
  `--check`, which regenerates in memory and compares byte-for-byte.

## Flags

| Flag | Effect |
| --- | --- |
| *(none)* | regenerate and write the checked-in descriptor |
| `--check` | read-only CI gate; byte-for-byte compare; never writes |
| `--entry=<repo-relative path>` | retarget the walk (default `app/lib/pcb/types.ts`) |
| `--emit-to=<path>` | write the descriptor elsewhere, never the checked-in file |

`--entry` / `--emit-to` exist so the drift PROOF can generate from a disposable
copy of the declarations instead of mutating a production source file — see
[drift-gate-results.md](drift-gate-results.md).

## One declared field name is exempt from the credential denylist

Of the **388** field names the graph declares, exactly one is credential-shaped
under the shared classifier: `authorizationPolicyId` (a constraint waiver
policy identifier). Rejecting it would be a denylist rejecting honest data, so
names the authoritative schema declares are exempt from the **name** check —
and only the name check; their **values** are still scanned. A declared name
cannot be attacker-chosen, because the key-exhaustive shape validation refuses
any key the schema does not declare, at its declared position and type. The
exemption set is derived from the descriptor (`PCB_DECLARED_FIELD_NAMES`),
never hand-typed, and a regression pins the tripping set to exactly
`["authorizationPolicyId"]` so a newly declared credential-shaped field fails
CI instead of being silently exempted.
