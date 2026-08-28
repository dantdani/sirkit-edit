# Changed files (B16.0.3)

## Production
- `app/api/replacement-authority/route.ts` — §A: `authorizeRequest` FIRST
  (auth + membership + editor role + exact-origin CSRF before body and before
  any durable resolution); trusted scope from `TrustedRequestContext` is the
  ONLY data selector; `LOCAL_TENANT_ID`/`LOCAL_BRANCH_ID` constants deleted;
  `body.scope` demoted to an optional post-auth cross-check (mismatch → 403);
  response binding echoes the trusted scope; bounded body/nonce/allowlist
  pipeline byte-preserved.
- `app/lib/project/replacement-reauthorization.ts` — §A client: transport
  signature gains `selectorHeaders`; production fetch merges
  `projectSelectorHeaders(request.scope)`; binding verification compares the
  FULL returned trusted scope to the request scope (was hard-coded
  "local"/"main"). One-shot/deadline/streaming/nonce semantics unchanged.
- `app/lib/auth/route-resource-classification.ts` — §C: replacement-authority
  annotated `read`/`project-durable`; chat annotated `read` (surfaced by the
  new check); `KNOWN_DURABLE_SOURCE_SYMBOLS` exported for the connective gate.
- `drizzle/0028_bom_project_ownership.sql` — §D: explicit `IS NOT NULL`
  conjuncts in both CHECKs + defect commentary.
- `app/lib/db/schema.ts` — §D: name-matched `check(...)` ownership-completeness
  constraints on `bom_snapshots` and `bom_notifications`.

## Gates / test infrastructure
- `app/lib/auth/__tests__/_boundary-analysis.ts` (NEW, test-only) — TypeScript
  AST boundary analysis: real/reachable/imported call detection, type-only
  import exclusion, shadowing rejection, dead-code rejection, transitive
  `_scope.ts` resolution to terminal primitives, durable-call extraction.
- `app/lib/auth/__tests__/b16-0-2-gates.test.ts` — `KNOWN_NON_BOUNDARY_ROUTES`
  DELETED; boundary gate rewired to `reachesAuthorizationBoundary` (structural,
  zero exceptions); replacement-authority positive pin; no-exception source
  pin; pre-existing `module`-variable lint error fixed (rename only).

## New permanent suites
- `app/lib/auth/__tests__/b16-0-3-boundary-gate.test.ts` (11) — §B tripwires.
- `app/lib/auth/__tests__/b16-0-3-effective-classification.test.ts` (4) — §C.
- `app/lib/db/__tests__/b16-0-3-bom-ownership-check.test.ts` (5) — §D truth
  table + schema/migration parity.
- `app/api/replacement-authority/__tests__/b16-0-3-route-auth.test.ts` (12) —
  §E, against the REAL handler with instrumented sources and counted body
  pulls.

## Updated existing tests (route now authenticates; assertions strengthened,
## none weakened)
- `app/lib/project/__tests__/b14-2-settlement-and-boundaries.test.ts` — §B/§C
  direct-endpoint tests inject an authorized editor + selector headers (the
  §C nonce case previously false-passed on a selector-missing 400).
- `app/lib/project/__tests__/b14-3-stream-lifecycle-and-gates.test.ts` — §B
  lifecycle tests inject identity + selector; deadline/abort/oversize
  assertions unchanged.
- `app/api/chat/__tests__/b14-route-replacement.test.ts` — the reauth describe
  authenticates; the foreign tenant/branch case became the STRONGER
  authenticated-scope-mismatch case (still: loader never called).

## Artifacts
- `artifacts/ai-control-plane-b16-0-2/route-data-and-resource-classification.csv`
  regenerated exclusively via `scripts/generate-b16-0-2-artifacts.ts`
  (byte-stable ×2; all four generators re-proven stable ×2).
- `artifacts/ai-control-plane-b16-0-3/` — this evidence package (11 docs).
- Supersession notes appended to four B16.0.2 documents (README,
  final-verdict, unknowns-and-owner-decisions,
  migration-and-legacy-row-disposition); nothing deleted.
