# B10 — Entry Gate 0: the carried B09.3 schema edge

## Defect (reproduced pre-edit)

`toStrictSchema` accepted a NESTED schema carrying `properties`/`required`
WITHOUT an explicit `type` and silently added `type: "object"` during
normalization:

```
ACCEPTED; nested a became: {"properties":{…},"required":["x"],
                            "additionalProperties":false,"type":"object"}
```

B09.3's object-only compatibility check fired only when `type` was
declared, and `convert()` carried an explicit properties-without-type →
object inference branch.

## Closure (`app/lib/agent/provider-tools.ts`)

1. Object-only keywords (`properties`, `required`, `additionalProperties`)
   now require an EXPLICIT object base type — a schema with those keywords
   and no `type` refuses `STRICT_SCHEMA_UNSUPPORTED`.
2. `items` now requires an EXPLICIT array base type (the
   `type !== undefined` guard removed).
3. The `convert()` inference branch (`properties !== undefined && type ===
   undefined` → object) is REMOVED: only `type: "object"` schemas are
   normalized as objects.

## Provider shapes preserved

The rendering shapes are untouched: OpenAI Responses FLAT function tool
(`{type:"function", name, description, parameters, strict:true}`) and
Anthropic (`{name, description, input_schema, strict:true}`) — the current
official formats as verified live during B09/B09.1 (Anthropic strict tools
additionally rejecting `minItems`/`maxItems`, which stay outside the wire
subset). Every currently valid catalog schema declares explicit types
(`obj()` helper), so no valid tool's meaning changed — all NINE exposed
schemas render deterministically for both providers (test-gated), and the
regenerated provider-parity artifact reports full semantic equivalence.

## Permanent regressions

`b10-editor-context.test.ts` §F: nested properties-without-type refuses;
items-without-array-type refuses; the explicit-type control still renders
with unchanged meaning. The B09.2/B09.3 hostile schema suites continue to
run unchanged.
