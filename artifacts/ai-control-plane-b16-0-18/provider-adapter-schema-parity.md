# B16.0.18 §E — Provider-adapter schema parity (CONFIRMED)

[`b16-0-18-adapter-schema-parity.test.ts`](../../app/lib/llm/__tests__/b16-0-18-adapter-schema-parity.test.ts)
drives both real provider classes with fake SDK clients (zero credits) using
the tool exactly as the propose route constructs it:

| Guarantee | OpenAI | Anthropic |
|---|---|---|
| schema reaches the SDK payload | `parameters` **reference-identical** to `COMPONENT_SEARCH_PROPOSAL_TOOL.schema` | `input_schema` **reference-identical** |
| nested limits intact | implied by reference identity (and the third test asserts the schema itself declares maxItems + min/max lengths on every array node) | same |
| strict | `strict: true` | `strict: true` |
| toolChoice | `{ type: "function", name: "propose_component_catalog_search" }` | `{ type: "tool", name: "propose_component_catalog_search" }` |

Both adapters pass `tool.inputSchema` through by reference — no
transformation can drop nested constraints, and the reference-identity
assertion fails loudly if a copying layer is ever introduced.
