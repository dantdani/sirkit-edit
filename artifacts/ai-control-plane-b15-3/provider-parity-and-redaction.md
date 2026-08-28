# B15.3 — provider parity and redaction

## OpenAI/Anthropic parity

The PCB proposal descriptor renders identically for both providers.
`renderProviderParityReport(registry.list())` reports the tool
`wireCompatible: true`, `semanticallyEquivalent: true`, provider name
`sirkit_pcb_propose-bounded-edit` (the '.' → '_' mapping applies to BOTH
providers identically; the only listed "differences" are that identical
name-normalization and that the output schema is registry-only metadata
neither provider declares — both non-substantive and shared). The committed
`artifacts/ai-control-plane-b04/provider-schema-parity.json` regenerated and
is byte-stable. Both descriptions carry the same strict `{intent,
operations}` contract; the strict-compatibility gate in the loop admits it
to the model only because `additionalProperties:false` holds everywhere.

## Redaction / no secret leakage

- Provider arguments are bounded and re-validated; only `{intent,
  operations}` survive, and every other key refuses by name.
- The sealed proposal's `provenance` carries `provider`, `model`, and a
  bounded `runId` — no keys, tokens, or provider diagnostics. The review
  dialog truncates the runId and shows no raw provider payload.
- The loop's trace records bounded identity + digests only
  (`{proposalId, operationsDigest}`) for the PCB branch — never proposal
  content — reusing the existing `AgentTraceRecorder.recordTool` path.
- Refusal diagnostics returned to the provider are bounded and describe the
  refusal class, never internal state.
- The `pcb_proposal_ready` event carries the sealed proposal (already a
  redaction-safe artifact) and never provider diagnostics; it never triggers
  application automatically.
