# B16.0.4 — Changed files

Every file this stage created, edited, or deleted, with the reason. (The
working tree also carries all prior B-stage changes against the single
baseline commit; this list is B16.0.4's delta only.)

## Created — production

| File | Why |
|---|---|
| `app/lib/auth/route-handlers.ts` | The audited higher-order route wrappers (`authenticatedJsonRoute`, `authenticatedRoute`, `workerJsonRoute`, `publicJsonRoute`) — authorization-then-bounded-body by construction (§A) |

## Created — tests

| File | Why |
|---|---|
| `app/lib/auth/__tests__/b16-0-4-authorization-and-body-gates.test.ts` | §A's 10 method-scoped negative tripwires + factory tripwires (on-disk OS-temp fixtures) + §C body-API/aliased-request/`body.getReader` tripwires (15 tests) |
| `app/api/__tests__/b16-0-4-bounded-body-behavior.test.ts` | §D behavioral matrix over real handlers per family + shared-reader deadline/trickle/ceiling/abort/late-latch proofs (52 tests) |

## Created — scripts / artifacts

| File | Why |
|---|---|
| `scripts/generate-b16-0-4-artifacts.ts` | Sanctioned generator for the two byte-pinned CSVs (uses the SAME `analyzeMethodBoundary` the gate runs) |
| `artifacts/ai-control-plane-b16-0-4/` (15 docs + `_r4-raw.txt`) | §G stage record |

## Edited — analyzer & gates (test infrastructure)

| File | Why |
|---|---|
| `app/lib/auth/__tests__/_boundary-analysis.ts` | EXTENDED with the method-scoped analysis: `analyzeMethodBoundary`, `exportedHttpMethods`, `directBodyReads`, `APPROVED_ROUTE_WRAPPERS`, factory-following, purity fixpoint, guard-shape recognition; plus a tsc fix (closure-assigned `let` → typed const) and non-null/paren unwrapping in body-read detection |
| `app/lib/auth/__tests__/b16-0-2-gates.test.ts` | §A boundary section replaced with the method-scoped loop over every protected exported method; §D's 11-route `BOUNDED_CONSUMERS` allowlist replaced with the automatic `directBodyReads` discovery gate (§C) |
| `app/lib/agent/__tests__/b11-5-capture-exactness.test.ts` | Admitted the new factory-fixture test into the §D test-write gate via a `justified` predicate that ENFORCES OS-temp `scratchRoot` confinement (the gate's documented mechanism; an added invariant, not a weakening) |
| `app/api/replacement-authority/__tests__/b16-0-3-route-auth.test.ts` | The `[200,503]` success test rewritten to require EXACT 200 with unconditional nonce/component/trusted-scope binding assertions via a real durable aggregate (§D) |

## Edited — the 49 migrated routes (§B)

Each replaced its direct `request.json()`/`request.text()` with
`readBoundedJsonObject` + `boundedJsonRefusalResponse` (auth position
preserved; existing ceilings kept; unused byte-check consts removed):

- **architecture** (5): `alternatives`, `candidates`, `compare`, `problem`, `propose`
- **interfaces** (6): `allocate`, `alternatives`, `candidates`, `compare`, `problem`, `propose`
- **power** (6): `alternatives`, `candidates`, `compare`, `problem`, `propose`, `reconcile`
- **schematic** (8): ``, `build`, `build-multi`, `cross-verify`, `edit`, `edit-build`, `layout-critic`, `review`
- **pcb-ai** (4): `pcb/ai-rules/from-brief`, `pcb/assign/suggest`, `pcb/edit/assist`, `pcb/repair/agent`
- **spice + requirements** (6): `spice/ai`, `spice/compile`, `spice/reports`, `spice/run-plans/estimate`, `requirements/compile`, `requirements/sources`
- **bom** (6): ``, `cart/digikey`, `cart/lcsc`, `cart/mouser`, `export-csv`, `procurement-packet`
- **public-misc** (7): `components/atomic/search`, `parts/search`, `constraints/explain`, `constraints/preview`, `export/kicad`, `pcb/export/kicad-pcb`, `pcb/placement/preview`
- **worker** (1): `assignment-queue/materialize` (timingSafeEqual guard kept FIRST)

(All under `app/api/…/route.ts`.)

## Deleted (temporary, nothing references them)

| File | Why |
|---|---|
| `scripts/_b16-0-4-scan.ts`, `_b16-0-4-allroutes.ts`, `_b16-0-4-analyzer-check.ts`, `_b16-0-4-puredbg.ts` | Disposable pre-edit reproduction / analyzer-bring-up probes (outputs recorded in `pre-edit-counterexamples.md` / `_r4-raw.txt`) |
| `.claude/workflows/_b16-0-4-body-migration.js` | The one-shot 9-family migration workflow script |
| the temporary matrix dumper test | Superseded by `scripts/generate-b16-0-4-artifacts.ts` |

## Explicitly NOT changed

- `C:\Users\robsa\sirkit` — untouched (its 3 dirty auth files carry mtime
  2026-07-16, predating this session).
- No route's auth ordering, status-code contract, scope checks, or
  `Cache-Control` behavior; no test status-code assertion; no test skipped or
  deleted; no timeout loosened.
