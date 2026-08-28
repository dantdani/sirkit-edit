# B16.0.14 §H — assign/suggest parity

Migrated to `authenticatedJsonRoute({ maxBytes: 16_000_000, deadlineMs: 45_000 })`;
the callback receives `{ body }` only — no raw URL or origin.

## Internal fetch → shared service (SSRF closed)

The `search_footprints` tool's body changed from
`fetch(\`${origin}/api/pcb/footprints/search?...\`)` to a direct
`searchFootprints({ q, limit, padCount, smd })` call. The typed values are
built exactly as the URL params were (q trimmed, padCount only when a
non-negative integer, smd only when boolean, limit = SEARCH_LIMIT 10).

## Preserved and proven (pins)

| Contract | Value |
|---|---|
| authorization/CSRF/media/body before provider or search | anonymous → 401 with 0 provider + 0 search; invalid component → 400 with 0/0 |
| provider call count on the valid loop | `generate` exactly twice (search turn + submit turn) |
| search tool passes typed pad-count filter + limit | `searchSvc` called `{ q:"SOIC-8", limit:10, padCount:2, smd:null }` |
| search limit | **3** (a 4th `search_footprints` refused in-band; service called 3×) |
| iteration limit | **6** (`MAX_ITERATIONS`, unchanged) |
| result limit | **10** (`SEARCH_LIMIT`, unchanged) |
| max submitted candidates | **3** (`MAX_CANDIDATES`, unchanged) |
| pad-count equality | mandatory — `f-wrongpads` (padCount 14 ≠ 2) dropped |
| surfaced-only | hallucinated `f-hallucinated` (never surfaced) dropped |
| confidence clamp | 2.5 → 1 (0..1) |
| reason bound | `.trim().slice(0, 300)` unchanged |
| provider failure | normalized `providerErrorResponse` → 503 |

All in-loop constants, `validateCandidates`, the message transcript, and the
tool-result formatting are byte-identical
([prompt-tool-provider-parity.md](prompt-tool-provider-parity.md)).
