# Section D — structural schema validation before AND after normalization

> **SUPERSESSION NOTE (B09.3).** The validation described below was CONTAINER-SHAPE only. It did NOT reject semantically invalid schemas: non-object parameter roots, properties on string types, numeric descriptions, object titles, type-incompatible enum values, items on non-arrays, unconstrained `{}` schemas, and multi-non-null type unions all still rendered. B09.3 adds full semantic validation. See artifacts/ai-control-plane-b09-3/provider-schema-semantic-validation.md.

## Defect

`toStrictSchema` normalized whatever it was handed: a nonsense `type`, a
`required` entry naming no property, non-schema `items`, and a non-array
`enum` were all silently rewritten into strict-looking declarations the tool
author never wrote (R5).

## Production changes (`app/lib/agent/provider-tools.ts`)

`validateSchemaStructure(node, path)` — exported, pure, non-mutating — walks a
schema and reports every violation with its path:

- `type` must be one of the JSON-Schema primitive type strings;
- `required` must be an array of strings, each present in `properties`
  (required ⊆ properties);
- `enum` must be a non-empty array of primitives; `const` a primitive;
- `additionalProperties` may only be `false` (never `true`/a schema);
- `type: "array"` requires `items`, and `items` must be a schema object;
- `anyOf` must be a non-empty array of schema objects;
- keywords outside the wire subset (`type, description, properties, required,
  additionalProperties, items, enum, anyOf, const, title`) are refused as
  unknown.

`toStrictSchema` now:

1. validates the SOURCE (catches required-ghost and friends BEFORE any
   rewrite could mask them);
2. converts a `structuredClone` (the caller's object is never mutated);
3. validates the OUTPUT structurally and against the wire subset.

Any violation throws `STRICT_SCHEMA_UNSUPPORTED:<path: reason>`; nothing is
silently repaired.

## Tests (`b09-2-closure.test.ts` §D)

All four R5 schemas plus non-schema `anyOf` entries, `array` without `items`,
and `additionalProperties: true` throw; a valid source schema round-trips with
its JSON representation byte-identical afterwards (no mutation). The eight
exposed tool schemas continue to render for both providers (asserted by the
B09/B09.1 suites, which run in the same battery).
