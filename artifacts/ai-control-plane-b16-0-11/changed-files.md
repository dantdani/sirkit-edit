# B16.0.11 — Changed files

## Migrated routes (boundary prologue → canonical wrapper; business logic byte-preserved)

Public → `publicJsonRoute({ maxBytes: 8_000_000, deadlineMs: 30_000 })`:

1. `app/api/bom/route.ts`
2. `app/api/bom/cart/digikey/route.ts`
3. `app/api/bom/cart/lcsc/route.ts`
4. `app/api/bom/cart/mouser/route.ts`
5. `app/api/bom/export-csv/route.ts`
6. `app/api/bom/procurement-packet/route.ts`

Authenticated:

7. `app/api/bom/diff/route.ts` — POST → `authenticatedJsonRoute` 8 MB/30 s
8. `app/api/bom/snapshot/route.ts` — POST → `authenticatedJsonRoute` 8 MB/30 s; GET → `authenticatedRoute`
9. `app/api/bom/notifications/route.ts` — GET → `authenticatedRoute({ query: true })` (bounded frozen `meta.query`); PATCH → `authenticatedJsonRoute` 16 KB/10 s; DELETE → `authenticatedJsonRoute` 16 KB/10 s (**target classification corrected** — it reads a bounded JSON body)

In each: the handwritten scope/reader prologue was deleted, `scoped.scope`
became the callback-derived `scope`, and everything else stayed byte-identical
(forbidden-key checks, statuses, messages, no-store, repository calls).

## §E — the scope helper

- `app/api/bom/_scope.ts` — REWRITTEN Request-free: `bomOwnershipScope(context)`
  projection replaces the removed request-taking helper; `BOM_FORBIDDEN_BODY_KEYS`
  and `bomNotFound` preserved verbatim; no boundary imports remain.

## Tests

- `app/api/__tests__/b16-0-11-tranche-parity.test.ts` — NEW; the 60-pin suite
  (run green pre-migration, kept green post; cart-pin URL corrected to the real
  route paths — disclosed in behavioral-parity-results).
- `app/lib/auth/__tests__/b16-0-11-bom-confinement-gate.test.ts` — NEW; all-12
  canonical + no-bomScope-bypass + Request-free `_scope` + no-raw-URL gates.
- `app/lib/auth/__tests__/b16-0-8-migration-ratchet.test.ts` — `TRANCHE_4`
  pins; `BASELINE_MAX` 113→101; `MIGRATED_FLOOR` 40→52.

## Regenerated through sanctioned generators only

- `app/lib/auth/__tests__/_raw-route-baseline.json` — 113→101 (12 removed, 0 added).
- wrapper + b16-0-4 matrices — regenerated ×2, byte-stable; manifest extracted
  into this stage's dir.

## Explicitly NOT changed

`app/lib/bom-builder.ts`, `app/lib/bom/build.ts`, `app/lib/cart-formats.ts`,
`app/lib/bom/snapshot-repository.ts` (repository + predicates),
`app/lib/snapshots.ts`, `app/lib/auth/route-handlers.ts`, provider config, tool
exposure, replay pins, hashes. Public/auth policy unchanged.
`C:\Users\robsa\sirkit` untouched.
