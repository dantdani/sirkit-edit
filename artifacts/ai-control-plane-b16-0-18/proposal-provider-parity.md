# B16.0.18 §D — Proposal-only provider parity (CONFIRMED)

`llmRouter.generate` is a spy; zero credits.

## Byte-identical provider parameters (pinned)

| Parameter | Value |
|---|---|
| provider | `requestedProvider(body.provider)` |
| maxTokens | **4096** |
| temperature | **0** |
| system prompt | the exact "proposal-only CD-6 catalog search assistant…" text (asserted on the call; unchanged in source) |
| tools | `COMPONENT_SEARCH_PROPOSAL_TOOL` (`propose_component_catalog_search`), `strict: true` |
| toolChoice | `{ name: "propose_component_catalog_search" }` (forced) |
| digest binding | `problem.catalogSnapshotRevision === catalog.deterministicDigest` enforced BEFORE the provider (mismatch → 422, provider ZERO, pinned) |

## Proposal-only authority (pinned)

Valid → `{ ok, proposal, authority: "proposal_only", hardGateResults: [],
selectedPart: null }` + `X-Sirkit-AI-Provider` + `no-store`. The provider can
only propose bounded search filters: it cannot select/approve a part, pass a
hard gate, invent a property/price/stock/lifecycle fact, claim equivalence,
alter requirements, buy parts, or mutate schematic/PCB state — the response
shape carries no channel for any of it, unpinned references are refused with
the exact `CD6_*` codes, and the human-truth gate pins the response literals.

## Boundary counts (pinned)

Zero provider calls on: every §A refusal class, catalog-digest mismatch, scope
mismatch. Exactly one on: valid requests, no-tool-call (422), structural-422,
CD6-422, and provider-failure (503) paths.
