# B16.0.19 §D — Knowledge provider-adapter parity (CONFIRMED)

Fake SDK clients (zero credits) drive both real provider classes with the tool
exactly as the route constructs it:

| Guarantee | OpenAI | Anthropic |
|---|---|---|
| schema in SDK payload | `parameters` **reference-identical** to `CIRCUIT_RECIPE_CLAIM_TOOL.schema` | `input_schema` **reference-identical** |
| strict | `true` | `true` |
| toolChoice | `{ type: "function", name: "propose_circuit_recipe_claim" }` | `{ type: "tool", name: "propose_circuit_recipe_claim" }` |
| new §D bounds declared | asserted: all three ref-array items carry `maxLength: 300` | same schema object |

Reference identity makes silent weakening impossible — any copy/strip layer
fails the `toBe` assertion loudly.
