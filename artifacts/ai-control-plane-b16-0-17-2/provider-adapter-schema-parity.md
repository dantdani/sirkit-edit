# B16.0.17.2 §D — Provider-adapter schema parity (CONFIRMED)

[`b16-0-17-2-adapter-schema-parity.test.ts`](../../app/lib/llm/__tests__/b16-0-17-2-adapter-schema-parity.test.ts)
drives BOTH real provider classes with fake SDK clients (the established
`providers.test.ts` injection pattern — zero credits) using the tool object
EXACTLY as the propose route constructs it.

| Guarantee | OpenAI | Anthropic |
|---|---|---|
| schema reaches the SDK payload | `tools[0].parameters` **is reference-identical** to `SCHEMATIC_PROPOSAL_TOOL.schema` | `tools[0].input_schema` **is reference-identical** |
| nested `maxLength` intact | asserted on both id nodes (values read from the schema) | same |
| nested `minLength` intact | asserted (1) | asserted (1) |
| `strict` | `strict: true` on the function tool | `strict: true` passed through |
| toolChoice | `{ type: "function", name: "propose_schematic_semantic_changes" }` | `{ type: "tool", name: "propose_schematic_semantic_changes" }` |
| prompt / maxTokens 4096 / temperature 0 | unchanged (request passed as the route builds it) | unchanged |

Because both adapters pass `tool.inputSchema` through **by reference**
(`parameters: tool.inputSchema` / `input_schema: tool.inputSchema`), no
transformation exists that could drop nested constraints — and the
reference-identity assertion would fail loudly if a copying/stripping layer
were ever introduced. Neither adapter silently omits `maxLength`; no explicit
failure path is needed since both represent it natively.
