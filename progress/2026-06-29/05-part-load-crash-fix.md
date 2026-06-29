# Part-load crash fix (graceful missing parts)

**Date**: 2026-06-29 · **Status**: Shipped

## Symptom
Dev error overlay: `Part feabe0b0-… not found` at `app/lib/parts-cache.ts:57`.
Looked like a compile error but was a **runtime unhandled promise rejection**.

## Root cause
`ensurePartLoaded` loads a part via `GET /api/parts/[id]`; the route returns
`{ ok: true, part: null }` for a valid UUID with no DB row (or whose library row is
absent, via its `innerJoin`). The cache then threw `Part … not found`. That throw
was handled by every *caller* chain — but the module's internal cleanup chain,
`void promise.finally(() => inflight.delete(partId))`, re-rejects and was NOT
caught, so it surfaced as an unhandled rejection and tripped the dev overlay. The
id is runtime state (a placed/generated component whose part isn't in this DB) —
not hardcoded anywhere.

## Fix — `app/lib/parts-cache.ts` only
- Swallow the rejection on the internal cleanup chain:
  `void promise.finally(() => inflight.delete(partId)).catch(() => {})`. Callers
  still receive the rejection via the returned promise.
- Negative-cache definitively-absent ids (`ok:true, part:null`) in a `missing` set;
  `getCachedPart` returns `null` for them without re-fetching every render. A
  `ok:false` server/DB error is treated as transient (not cached), so it can recover.

The canvas already renders a `null` part as `<KicadPlaceholder>` (page.tsx), so a
missing part now degrades to a placeholder instead of crashing.

## Not fixed (data, not code)
The part `feabe0b0-…` is genuinely absent from the local DB. The component
referencing it shows as a placeholder — use **Delete** / **Replace part…** in the
selection panel, or re-ingest the part if it should exist.

## Verification
- `npx tsc --noEmit` clean; `eslint app/lib/parts-cache.ts` clean.
