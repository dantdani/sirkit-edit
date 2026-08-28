# B16.0.17 §D — Proposal-only provider parity (CONFIRMED)

`llmRouter.generate` is a spy; zero credits.

## Byte-identical provider parameters (pinned)

| Parameter | Value |
|---|---|
| provider | `requestedProvider(body.provider)` |
| maxTokens | **4096** |
| temperature | **0** |
| system prompt | the exact "proposal-only CD-8 schematic reasoning assistant…" text asserted on the call |
| tools | `SCHEMATIC_PROPOSAL_TOOL` (`propose_schematic_semantic_changes`, strict) |
| toolChoice | `{ name: "propose_schematic_semantic_changes" }` |
| pinned digests | problem + graph deterministic digests serialized into the user message (unchanged construction) |
| allowlists | only supplied stable semantic IDs are serialized (components/pins/nets/sheets/ports) |

## Proposal-only authority (pinned)

Valid → `{ ok, proposal, authority: "proposal_only", graphMutation: null,
diagramMutation: null, pcbMutation: null }` + `X-Sirkit-AI-Provider` +
`no-store`. The provider can never mutate a graph, create coordinates, draw
wires, merge nets, fabricate pins/parts/values/evidence, approve, emit
authoritative KiCad, or alter a PCB — the response shape carries no channel for
any of it, and unknown-ID references are refused by the REAL
`normalizeSchematicChangeProposal` (`CD8_AI_PROPOSAL_REFERENCE_INVALID`).

## Boundary counts (pinned)

| Case | Provider calls | Result |
|---|---|---|
| all §A refusal classes | **0** | refusal |
| scope mismatch | **0** | 422 |
| valid | **exactly 1** | 200 proposal_only |
| missing typed tool call | 1 | 422 `provider returned no typed schematic proposal` |
| unknown semantic IDs | 1 | non-200, no proposal (normalize refuses; surfaces via the normalized provider-error envelope — recorded historical behavior) |
| provider throws | 1 | 503 normalized `providerErrorResponse` |

No agent tool exposure changed (still exactly 12).


---

## ⚠️ SUPERSESSION NOTE (B16.0.17.1)

The unknown-semantic-ID claim in THIS document was **overstated and is
superseded**. Independent verification of B16.0.17 confirmed the pin's tool
input did NOT satisfy the SCHEMATIC_PROPOSAL_TOOL schema; the observed failure
was an incidental `TypeError: Cannot read properties of undefined (reading
'map')` — it never reached the known-ID validation and did not prove
`CD8_AI_PROPOSAL_REFERENCE_INVALID`. The corrected proof (real tool-contract
fixture, structural validation before normalization, deterministic local 422
codes, provider/local error-boundary separation) lives in
`artifacts/ai-control-plane-b16-0-17-1/` and the corrected suites
`b16-0-17-tranche-parity.test.ts` + `b16-0-17-1-proposal-validation.test.ts`.
The historical text above is retained as evidence and must not be read as a
valid proof.
