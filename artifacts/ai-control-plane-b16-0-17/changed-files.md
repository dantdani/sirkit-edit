# B16.0.17 — Changed files

## Migrated routes (boundary prologue → canonical wrapper; business logic byte-preserved)

All → `authenticatedJsonRoute({ maxBytes: 32_000_000, deadlineMs: 30_000 })`:

1. `app/api/schematic-compiler/compare/route.ts` — `{ context, body }`
2. `app/api/schematic-compiler/diff/route.ts` — `{ context, body }`
3. `app/api/schematic-compiler/export/route.ts` — `{ context, body }`
4. `app/api/schematic-compiler/graph/validate/route.ts` — `{ context, body }`
5. `app/api/schematic-compiler/kicad/inspect/route.ts` — `{ body }` (never used scope)
6. `app/api/schematic-compiler/layout/route.ts` — `{ context, body }`
7. `app/api/schematic-compiler/problem/route.ts` — `{ context, body }`
8. `app/api/schematic-compiler/propose/route.ts` — `{ context, body }`
9. `app/api/schematic-compiler/transaction/route.ts` — `{ context, body }`
10. `app/api/schematic-compiler/variants/route.ts` — `{ context, body }`

Each: raw `POST(request)` + `scopedJson(request)` prologue replaced with the
wrapper + `schematicCompilerScopeFromContext(context)`; everything else
byte-identical.

## Shared helper (extended, NOT weakened)

- `app/api/schematic-compiler/_scope.ts` — ADDED
  `SCHEMATIC_COMPILER_API_DEADLINE_MS = 30_000` and
  `schematicCompilerScopeFromContext(context)` (delegates to `flatScopeOf`).
  `scopedJson`, `object`, the scope interface, and the max-bytes constant
  UNCHANGED and retained.

## Tests

- `app/api/__tests__/b16-0-17-tranche-parity.test.ts` — NEW; 82 route pins
  (pre = post; two disclosed pin-authoring corrections recorded against the
  pre-edit runs).
- `app/lib/auth/__tests__/b16-0-17-schematic-compiler-confinement-gate.test.ts`
  — NEW; 11 AST-backed confinement + human-truth gates.
- `app/lib/auth/__tests__/b16-0-8-migration-ratchet.test.ts` — `TRANCHE_10`
  pins; `BASELINE_MAX` 72→62; `MIGRATED_FLOOR` 81→91.

## Regenerated through sanctioned generators only

- `_raw-route-baseline.json` — 72→62 (10 removed, 0 added).
- wrapper + b16-0-4 matrices ×2, byte-stable; tranche manifest extracted here.

## Explicitly NOT changed

semantic graph model, editor mutation system, KiCad parser
(`inspectKiCadSchematic`), layout engine (`compileDiagramView`),
`SCHEMATIC_PROPOSAL_TOOL` + system prompt, `normalizeSchematicChangeProposal`,
transactions, `certifySemanticRoundTrip`, approval model, tool registry,
DB migrations, authoritative hashes, replay pins. The standing
`routes.test.ts` untouched. `C:\Users\robsa\sirkit` untouched.
