# B11.7 §C — the successful-result JSON invariant

Helper: `assertJsonInvariant` in
[`b11-7-primitive-discipline.test.ts`](../../app/lib/agent/__tests__/b11-7-primitive-discipline.test.ts)
— a reusable assertion applied to every `ok: true` `BoardProjectionResult` and
`ContextProjectionResult`.

## What it asserts

1. `JSON.stringify(result)` does not throw.
2. The `value` property remains **present** after a serialize→parse round trip
   (it cannot vanish the way `undefined`/symbol values do).
3. Parsing the serialized result preserves the value's semantics —
   canonical-JSON equality between `result.value` and
   `JSON.parse(JSON.stringify(result)).value`.
4. A recursive descriptor-based walk over `value` finds only valid JSON
   primitives and plain arrays/objects:
   * every number is finite;
   * no `undefined`, bigint, symbol, or function exists at any depth;
   * no accessor properties, no symbol keys, no foreign prototypes
     (`Object.prototype` or `null` only).

The walk reads through `Object.getOwnPropertyDescriptor` so it is itself exact
for `__proto__`-keyed data.

## What it runs against

| Input class | Cases |
| --- | --- |
| every supported primitive root | `null`, `0`, `1.5`, `"x"`, `true`, `false` — through both projectors |
| valid board | `createEmptyBoard()` |
| invalid board | unknown key + wrong-typed `formatVersion` |
| valid context | `e06c-selection-valid` |
| invalid context | `e03-valid-board` context + an unknown envelope key |
| all committed evaluation contexts | the 19 capsule contexts |
| special keys | a `padNets` Record carrying own `__proto__: 42`, `constructor: 7`, `prototype: 9` — all three survive the round trip as own data properties with the prototype intact |

Non-JSON primitive roots are covered by the complementary §A tests: they must
produce `ok: false`, and the refusal result itself is asserted serializable
and value-free.
