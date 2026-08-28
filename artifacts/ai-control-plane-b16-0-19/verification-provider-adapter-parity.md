# B16.0.19 §F — Verification provider-adapter parity (CONFIRMED)

Same fake-SDK proof as the knowledge tool, run for
`CIRCUIT_VERIFICATION_PROPOSAL_TOOL`:

| Guarantee | OpenAI | Anthropic |
|---|---|---|
| schema | `parameters` reference-identical | `input_schema` reference-identical |
| strict | `true` | `true` |
| toolChoice | `{ type: "function", name: "propose_circuit_verification_remediation" }` | `{ type: "tool", name: "propose_circuit_verification_remediation" }` |
| new §F bounds declared | asserted: finding ids / actionId / targetIds items all carry `maxLength: 4096` | same schema object |
