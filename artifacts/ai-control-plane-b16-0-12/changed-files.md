# B16.0.12 — Changed files

## Migrated routes (boundary prologue → canonical wrapper; business logic byte-preserved)

`publicRoute` (no-body / query / params projections):

1. `app/api/ai/runtime/route.ts`
2. `app/api/components/atomic/route.ts` — `{ query: true }` (limit/after via `meta.query`)
3. `app/api/parts/[id]/route.ts` — `{ routeParams: ["id"] }`
4. `app/api/parts/[id]/alternates/route.ts` — `{ routeParams: ["id"], query: true }` (kind/limit)
5. `app/api/pcb/footprints/[id]/route.ts` — `{ routeParams: ["id"] }`
6. `app/api/pcb/footprints/resolve/route.ts` — `{ query: true }` (hint)
7. `app/api/pcb/footprints/search/route.ts` — `{ query: true }` (q/limit/padCount/smd)

`publicJsonRoute`:

8. `app/api/components/atomic/search/route.ts` — 200 KB / 10 s
9. `app/api/export/kicad/route.ts` — 8 MB / 30 s
10. `app/api/pcb/export/kicad-pcb/route.ts` — 16 MB / 45 s
11. `app/api/pcb/placement/preview/route.ts` — 16 MB / 45 s

`kicadLibraryRoute` (target-classification corrected):

12. `app/api/kicad/v1/parts/category/[id]/route.ts` — `{ routeParams: ["id"] }`; the manual `authorizeKicadHttpLibrary` call moved into the wrapper boundary

In each: `new URL(req.url)`/`searchParams`/`ctx.params` reads became the
wrapper's bounded projections with identical string-or-null semantics; nothing
else changed.

## Tests

- `app/api/__tests__/b16-0-12-tranche-parity.test.ts` — NEW; the 24-pin suite
  (queue-driven drizzle fake, counted embedding fake, engine spy, adversarial
  runtime-secret fixture; run green pre-migration, kept green post).
- `app/lib/auth/__tests__/b16-0-8-migration-ratchet.test.ts` — `TRANCHE_5`
  pins; `BASELINE_MAX` 101→89; `MIGRATED_FLOOR` 52→64.

## Regenerated through sanctioned generators only

- `_raw-route-baseline.json` — 101→89 (12 removed, 0 added).
- wrapper + b16-0-4 matrices ×2, byte-stable; tranche manifest extracted here.

## Explicitly NOT changed

`openai-config.ts`, `kicad-export.ts`, `write-pcb.ts`, the placement engine,
`embeddings.ts`, `atomic/*` (catalog/search/compatibility/server-auth),
`alternates.ts`, `footprint-api-types.ts`, all schema/queries, provider config,
tool exposure, replay pins, hashes. `C:\Users\robsa\sirkit` untouched.
