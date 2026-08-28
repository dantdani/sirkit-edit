# Section C — semantic provider-schema validation

## Defect (R2)

B09.2's `validateSchemaStructure` validated container SHAPES only. Eight
semantically invalid schemas passed straight through `toStrictSchema`
(non-object roots, cross-type keyword carriage, non-string annotations,
type-incompatible enum values, unconstrained empty schemas, multi-type
unions).

## Production changes (`app/lib/agent/provider-tools.ts`)

The provider rendering shapes are UNCHANGED (flat OpenAI Responses function
tool; Anthropic `{name, description, input_schema, strict:true}`).
`validateSchemaStructure` gained context-aware semantic checks; `toStrictSchema`
still validates before AND after normalization and never mutates the source.

1. **Parameters root**: `toStrictSchema` requires an explicit
   `type: "object"` root on the source AND on the normalized output.
2. **Keyword value types**: `description`/`title` must be strings;
   `properties` a plain object; `required` unique strings ⊆ properties;
   `enum` a non-empty array of JSON-safe primitives; `const` a JSON-safe
   primitive; numeric enum/const values must be FINITE (NaN/±Infinity
   refuse); `additionalProperties` only `false`.
3. **Type/keyword compatibility**: `properties`/`required`/
   `additionalProperties` are object-only; `items` is array-only; array
   schemas require exactly ONE items schema (tuple arrays refuse); nullable
   object/array schemas carry only their applicable keywords (falls out of
   the non-null-base rule).
4. **Type arrays**: exactly one non-null base type, optionally `"null"`, no
   duplicates, no multiple unrelated non-null types.
5. **Enum/const typing**: values are checked against the declared type set
   when one is declared (e.g. `{type:"integer", enum:[1.5]}` refuses).
6. **Unconstrained schemas refuse**: a schema with none of
   type/enum/const/anyOf/properties (including `{}` and annotation-only
   schemas) is rejected — the previous `string|null` guess in `convert` was
   REMOVED.
7. **anyOf**: every member validated recursively; anyOf combined with
   sibling constraint keywords (type/properties/required/
   additionalProperties/items/enum/const) refuses; `enum`+`const` together
   refuses.

## Test results (`b09-3-closure.test.ts` §C — all pass)

- All eight R2 schemas throw `STRICT_SCHEMA_UNSUPPORTED`.
- Extended hostile set throws: NaN/Infinity enum + const, properties-on-array,
  items-on-object, required-on-non-object, nested multi-non-null union,
  tuple items, enum+const, anyOf-with-sibling-type, enum/const values off
  the declared type, annotation-only property.
- Valid controls pass: nullable object property (`["object","null"]` with
  properties/required/additionalProperties) and nullable array property
  (`["array","null"]` with items); the source object is byte-identical
  after conversion (no mutation).
- All EIGHT exposed schemas render deterministically for BOTH providers
  (canonical-JSON equality across repeated renders, `strict:true`
  everywhere) — additionally re-proven by the untouched B09/B09.1 provider
  contract suites in the same battery.
