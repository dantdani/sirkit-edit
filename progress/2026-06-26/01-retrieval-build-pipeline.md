# Retrieval + build-pipeline improvements

Date: 2026-06-26 · Status: done (type-checked, lint-clean)

## What
Hardened the Build-mode generation loop and the part-retrieval that feeds it.

- **Prompt caching** in the build tool loop — `cache_control` on the system/tools
  prefix + a single moving breakpoint on the latest turn, so each iteration
  reuses the cached transcript instead of re-billing accumulated search results.
- **Self-correction** — `finalizeSubmission` returns a structured error (bad
  partId / dangling pins) that is fed back into the loop as a tool_result so the
  model fixes it in-place, instead of failing the request one-shot.
- **Hybrid retrieval** (`app/lib/parts-search.ts`) — vector (HNSW) + lexical
  (exact-token ILIKE over name/mpn/keywords) recall fused via Reciprocal Rank
  Fusion, so exact identifiers (MPN fragments, "0805", "ESP32") aren't lost to
  pure semantic match.
- **Haiku rerank** — a cheap `claude-haiku-4-5` pass reorders the fused
  candidate pool for the specific role; best-effort (falls back to fused order).
- **Cross-search dedup** — a part already returned in full earlier in a turn
  comes back as a slim pointer from later searches, saving tokens.
- **Prompt consolidation** — every system prompt + tool schema moved into
  `app/lib/prompts.ts` (single diffable registry).
- **`getPartsByIds`** — fetch parts by id in the compact AI shape (used later to
  seed the edit/multi-agent loops with existing components).

## Files
`app/api/schematic/build/route.ts`, `app/lib/parts-search.ts`, `app/lib/prompts.ts`
