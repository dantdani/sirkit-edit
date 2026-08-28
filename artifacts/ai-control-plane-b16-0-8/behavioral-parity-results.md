# B16.0.8 §D — Behavioral parity results

## Method

The parity suite
([`b16-0-8-tranche-parity.test.ts`](../../app/api/__tests__/b16-0-8-tranche-parity.test.ts),
24 pins) was written FIRST and run GREEN against the PRE-migration handlers
(all 24 passed on the first pre-edit run), then kept green after every method
moved to its canonical wrapper. Identical mocked DB/catalog seams in both runs;
no live database contacted; no provider credit.

## Result: 24/24 pins green pre-edit AND post-edit

Pinned per method: success status + body shape + content type + Cache-Control
and custom headers (`X-Sirkit-Mapping-Stage4`), auth refusal codes
(AUTH_UNAUTHENTICATED), worker refusal codes with exact header presence
(`AQ_SOURCE_WORKER_UNAUTHORIZED` with NO Cache-Control;
`AQ_REVALIDATION_WORKER_UNAUTHORIZED` / `DW_WORKER_UNAUTHORIZED` WITH
no-store; 0 body pulls on refusal; unconfigured secret → 401 never 500),
media-type 415, byte ceilings (413), invalid JSON (AUTH_INVALID_JSON),
public error strings ("program and targetId are required", "query must be
under 500 characters", "requirements compile scope mismatch", …), dynamic
param resolution + `.json` suffix stripping, and db-failure 500 shapes.

## Call-convention notes (not behavior changes)

- `requirements/capabilities` and `parts/categories` handlers previously
  declared NO request parameter; the wrapper form receives the Request that
  Next always passes. Two parity call sites and one legacy test
  (`api-persistence.test.ts`) now pass a Request explicitly — statuses,
  bodies, and headers are unchanged.
- The kicad `GET`s were synchronous; wrappers are async. The Stage 5 KiCad
  tests now `await` them — Next.js treats both identically.

## One discovered protocol difference (resolved truthfully, not forced)

First migration attempt gave `kicadLibraryRoute` the standard policy-adapter
step; the Stage 5 KiCad tests immediately failed with
`500 AUTH_POLICY_MISSING` because the historical surface tolerates
trailing-slash URLs (`/api/kicad/v1/`) that the exact-path policy lookup
refuses. Per the stage rule ("do not silently force a materially different
protocol"), the narrow variant runs ONLY the historical token boundary and
documents that scope in its TRUTHFUL SCOPE NOTE. All Stage 5 pins pass
unchanged.

## Worker proofs (§D mandate)

Proven in the parity + capability suites: invalid/missing worker secret
refuses before any body pull with the exact historical code; no
durable/materialization work occurs on refusal; a valid worker principal
(`sirkit-workflow-worker`) reaches the callback; the callback receives a
non-human actor and has no channel to forge one (input keys pinned).
