# B01 — Canonical Action Coverage

This stage records current behavior without changing runtime execution.

- Source of truth: `app/lib/engineering/action-registry.ts`
  - `ACTION_COVERAGE_REGISTRY` — 69 versioned semantic-command records
    (kind, status, handler symbol, domain command, mutation authority,
    validation, history/revision behavior, tool exposure, approval tier,
    evidence sources).
  - `API_ROUTE_COVERAGE` — complete enumeration of all 137 `app/api` route
    files, each mapped to its owning record with expected methods and the
    strongest reachable action class.
- Scanners: `app/lib/engineering/action-surface.ts` (route walker + method
  extraction handling `export function`, `export const`, and re-exports;
  UI actionable-control label fingerprint over the demo-path surfaces).
- Generated matrices (regenerate with
  `npx tsx scripts/generate-action-toolability-matrix.ts`):
  - `ui-command-toolability-matrix.csv` — UI-action → handler → domain-command
    → mutation authority → validation → agent-tool matrix.
  - `api-route-coverage.csv` — route → record → class matrix.
  - `ui-control-fingerprint.json` — committed actionable-control fingerprint.
- CI gates: `npx vitest run app/lib/engineering/__tests__/action-registry.test.ts`
  1. duplicate/invalid ids and policy-inconsistent records fail;
  2. every route file must be claimed; stale claims fail; method drift fails;
  3. a NEW actionable UI control (labelled/titled button) on a watched surface
     fails until the registry and fingerprint are updated;
  4. committed matrices must byte-match the registry render.

The registry deliberately distinguishes schema declaration from executable
agent reachability (`schema-only` is never agent-callable). Grouped
`cd.*.workbench` records cover the CD-1..12 workbench route families at the
route grain in `API_ROUTE_COVERAGE`; per-route server write-behavior of their
`transaction`/`problem` routes is recorded as **not individually audited in
B01** (see record notes). A future B02/B03 stage may connect records to the
transactional executor, but B01 does not migrate mutations or add agent tools.
