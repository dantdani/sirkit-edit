# KiCad export: server/client boundary fix

Date: 2026-06-26 · Status: done (type-checked, lint-clean)

## Symptom
`POST /api/export/kicad` → 500: *"Attempted to call ensurePartLoaded() from the
server but ensurePartLoaded is on the client."* The client then failed to parse
the HTML error page (`Unexpected token '<' … is not valid JSON`).

## Root cause
The export route (server, `runtime: nodejs`) loaded part data via
`ensurePartLoaded()` — which lives in `app/lib/parts-cache.ts` (`"use client"`,
fetches `/api/parts/[id]`). A client module's function can't be invoked from a
server route.

## Fix
- Added server-side **`getFullPartsByIds(ids)`** to `app/lib/parts-search.ts`:
  loads full `CachedPart` records (incl. `symbolRaw` + geometry pins) directly
  from the DB via `inArray` (the server equivalent of the client cache).
- `app/api/export/kicad/route.ts` now uses it (and infers the
  `Map<string, CachedPart>`), dropping the client `ensurePartLoaded` import.

## Related (not the crash)
- A `/api/schematic/build-multi` 404 was a stale dev-server route manifest —
  fixed by restarting `npm run dev` (newly-added route dirs aren't always
  hot-registered, esp. with Turbopack).
- Removed a stray temp diagnostic file (`scripts/_mark-generics.ts`) left from an
  earlier command that timed out before its cleanup ran.
