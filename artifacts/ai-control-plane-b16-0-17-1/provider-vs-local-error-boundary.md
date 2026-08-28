# B16.0.17.1 §D — Provider vs local error boundary (CONFIRMED)

## Before (defective)

One broad `try { generate → find tool call → normalize → respond } catch { providerErrorResponse }`
— local normalization failures (including incidental TypeErrors from malformed
provider output) were mislabeled as provider availability problems (503,
`provider_unavailable`-family codes).

## After (corrected route flow)

```
1. try { result = await llmRouter.generate(...) }
   catch → providerErrorResponse(error, provider)        // 503, provider envelope
2. no typed tool call → historical 422
   { error: "provider returned no typed schematic proposal" }
3. validateSchematicProposalToolInput(call.input) — structural, schema-derived
   failures → 422 { code: "SCHEMATIC_PROPOSAL_OUTPUT_INVALID", diagnostics ≤20×200 }
4. try { normalizeSchematicChangeProposal(...) }
   catch CD8_AI_PROPOSAL_REFERENCE_INVALID
     → 422 { code: "CD8_AI_PROPOSAL_REFERENCE_INVALID" }
   catch anything else
     → 422 { code: "SCHEMATIC_PROPOSAL_OUTPUT_INVALID" } (bounded generic text)
5. success → unchanged { ok, proposal, authority: "proposal_only",
   graphMutation/diagramMutation/pcbMutation: null }
   + X-Sirkit-AI-Provider + no-store
```

## Guarantees (all §D items, adversarially tested)

1. provider invocation failures use `providerErrorResponse` — 503 with the
   provider envelope (`provider`, `reason`, `retryable`);
2. missing typed tool call keeps its historical 422;
3. structurally invalid tool output → deterministic local 422;
4. unknown semantic IDs → deterministic local 422 with
   `CD8_AI_PROPOSAL_REFERENCE_INVALID`;
5. local validation errors NEVER carry provider-availability/quota/rate-limit
   classification (asserted: the local envelope has no `provider`/`retryable`
   fields and never the provider codes; the provider envelope never carries the
   local codes);
6. no raw provider payload, stack, secret or credential in any refusal
   (diagnostics are field names, capped 20×200 chars).

Unchanged: provider routing, prompt, tool schema, `temperature: 0`,
`maxTokens: 4096`, `toolChoice`, the success shape, and the provider header.
