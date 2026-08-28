# B16.0.16 §E — Proposal-only provider parity (CONFIRMED)

`/propose` is the only provider-credit route. `llmRouter.generate` is a spy;
zero provider credits spent.

## Provider parameters — byte-identical (pinned)

| Parameter | Value |
|---|---|
| provider | `requestedProvider(body.provider)` (unchanged routing) |
| maxTokens | **2048** |
| temperature | **0** |
| system prompt | byte-identical — the pin asserts the exact "proposal-only CD-7 analysis planner…" text was sent |
| tools | `[TOOL]` (`propose_calculation_analysis`, strict schema unchanged) |
| toolChoice | `{ name: "propose_calculation_analysis" }` |

## Proposal-only authority (pinned)

Valid response → `{ ok:true, proposal, authority: "proposal_only",
calculatedResults: [], decisions: [] }` with `X-Sirkit-AI-Provider` +
`no-store`. No numeric result, no formula output, no selected value, no
pass/fail margin, no approval, no schematic/PCB mutation — the response carries
only the normalized proposal and empty result/decision arrays. The
`approvedModelRevisionIds` allowlist and the obligation-id allowlist are both
enforced.

## Boundary counts (pinned)

| Case | Provider calls | Result |
|---|---|---|
| auth / CSRF / media / invalid-json / oversize / pre-abort refusals | **0** | refusal |
| missing required fields (400) | **0** | 400 |
| scope mismatch (422) | **0** | 422 |
| valid request | **exactly 1** | 200 proposal_only |
| tool call missing | 1 | **422** `provider returned no typed analysis proposal` |
| unpinned obligation OR unapproved model revision | 1 | **422** `proposal references an unpinned obligation or unapproved model` |
| provider throws | 1 | **503** normalized `providerErrorResponse` |

No new provider tool is exposed; the tool exposure count stays 12
([no-misleading-authority-proof.md](no-misleading-authority-proof.md)).
