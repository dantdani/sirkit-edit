# B09.1 — Strict Provider Wire-Schema Contract

## The proven common wire subset

`type, description, properties, required, additionalProperties, items,
enum, anyOf, const, title` — nothing else. Every other keyword
(`minItems`, `maxItems`, `minLength`, `maxLength`, `minimum`, `maximum`,
`pattern`, `format`, `oneOf`, `allOf`, `$ref`, …) is REJECTED by
`validateWireSubset` before any provider rendering (B09 had observed
Anthropic strict tools rejecting `maxItems` live). Unknown constructs are
never weakened, guessed, or silently forwarded.

## Enforcement points (fail closed)

- `toStrictSchema` — converts (additionalProperties:false everywhere,
  full required lists, optional → nullable) THEN validates the subset;
  violation throws `STRICT_SCHEMA_UNSUPPORTED:<paths>`.
- `buildAgentToolDeclarations` — throws when explicitly passed an
  incompatible descriptor.
- `buildRunToolset` — excludes incompatible discovered descriptors with a
  safe warning diagnostic; the remaining declarations render for both
  providers strict:true and semantically equivalent.
- `tool-provider-adapters.ts` (deprecated wrapper) — `renderOpenAiTool` /
  `renderAnthropicTool` throw for incompatible schemas; the v2 parity
  report records them `wireCompatible:false` instead of rendering.
- EXPOSURE GATE (b09-1-boundary §4): a future descriptor cannot reach a
  model merely by setting `agentExposed:true` — a wire-incompatible
  schema is excluded with a diagnostic and the eight legitimate tools
  still render.

## Runtime bounds stay server-side

Removed from wire schemas, preserved in validation: proposal ops 1–20
(`parseOps`), board-inspect projectId / component-authority componentIds
sizes (B05 `DEFAULT_INPUT_LIMITS`: strings ≤ 10k chars, arrays ≤ 2000
items, depth/keys/nodes caps).

Proof: b09-1-boundary §4 (nested unsupported keywords, nullable
conversion, additionalProperties:false + complete required on all EIGHT
exposed schemas, collision rejection [b09 loop-safety 12], exposure gate).
