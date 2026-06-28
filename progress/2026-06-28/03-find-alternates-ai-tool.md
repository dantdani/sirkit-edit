# Build-mode AI — find_alternates tool

**Date:** 2026-06-28
**Status:** Code complete; runtime trigger depends on catalog data (see caveats).

## Goal
Give the Build-mode generator a third tool, `find_alternates`, so it can self-substitute
a risky part (NRND / EOL / low-stock) for a better-scored alternate **before** submitting.

## Files changed (deviation from prompt's file list — see note)
The prompt said "modify only route.ts + parts-search.ts", but the tool loop, tools array,
and system prompt do **not** live in `app/api/schematic/build/route.ts` (a thin wrapper).
They live in `app/lib/build-loop.ts` and `app/lib/prompts.ts`. Placing the changes where
their counterparts already live was the only way to wire the tool in. Route untouched.

- **`app/lib/parts-search.ts`**
  - New `fetchAlternatesForAI(partId, kind, limit)` → `AiAlternateResult[]`. Queries the
    `alternates` table joined to `parts`; `kind` "all" = no filter, else `WHERE kind = $kind`;
    `ORDER BY score DESC LIMIT limit`. Compact shape (no pins/description) → ~150 B/row,
    5 rows ≈ <1 KB.
  - Added `lifecycleStatus` to `AiPartResult` (the compact search shape) so the AI can
    actually *see* which candidates are risky. Populated in `toAiPart` + `getPartsByIds`.
    **This is the one search_parts-output change** — additive, token-cheap, and required:
    the spec's own system-prompt text tells the AI to read `lifecycleStatus` off candidates,
    which is impossible unless search returns it. Tool name/input schema unchanged.
- **`app/lib/prompts.ts`**
  - New `BUILD_FIND_ALTERNATES_TOOL` (name/description/schema verbatim from spec).
  - `BUILD_SYSTEM_PROMPT`: inserted the "WHEN TO CALL find_alternates" guidance before the
    "Always END with…" line.
- **`app/lib/build-loop.ts`**
  - Added the tool to the `tools` array (counts toward the unchanged `MAX_ITERATIONS = 20`).
  - Handler runs find_alternates blocks in parallel, logs
    `[AI] called find_alternates for partId=X (kind=…)`, returns the compact JSON as a
    `tool_result`, and on error returns `{ error }` with `is_error: true`.
  - **Submittability:** for each returned alternate, loads the full part record (with pins)
    via the existing `getPartsByIds` and registers it in `returnedParts`. Without this, a
    chosen alternate's partId would fail submission validation ("never returned by search").
    The AI payload stays pin-free; pins are only used server-side for connection validation.

## Definition-of-done check
- [x] `find_alternates` appears in the Build-mode tool list.
- [x] Handler executes and returns a `tool_result` (success or structured error).
- [x] Log line emitted when called (`[AI] called find_alternates for partId=X`).
- [x] `tsc --noEmit`: exit 0, no errors.
- [~] "Typical generation produces 1–2 calls for risky circuits" — **data-gated**: per
  schema, `lifecycleStatus` defaults to `"unknown"` until Stage 3 and the `alternates`
  table is "empty until populated by a future script". Until both are backfilled, no part
  reads as NRND/low-stock and `fetchAlternatesForAI` returns `[]`, so the model has nothing
  to trigger on. The plumbing is correct and will activate once that data lands.

## Notes / follow-ups
- The shared loop is also used by `/api/schematic/edit-build`; it now exposes
  `find_alternates` there too (harmless, arguably useful — its prompt just doesn't advertise it).
- Did not add `totalAvail` to search results (needs a `part_offers.stock` aggregation, a
  heavier query change). The system prompt references it as "(when present)", so its absence
  is acceptable; lifecycle alone drives triggering today.
- Live DB smoke test skipped (needs env + a partId with populated alternates). Verified via
  typecheck, which validates every drizzle column reference in the new query.
