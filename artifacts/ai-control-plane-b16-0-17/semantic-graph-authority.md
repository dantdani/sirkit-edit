# B16.0.17 §C — Semantic graph authority (CONFIRMED / by construction)

The migration touched only boundary prologues; every graph-authority rule is
byte-identical code, covered by the standing `routes.test.ts` (real graphs) and
the schematic-compiler domain suite — both green unchanged.

| Rule | Status |
|---|---|
| malformed graphs fail before diff/layout/variants/export/proposal | UNCHANGED — `validateSchematicGraph` gates precede every operation |
| validation uses `LOW_VOLTAGE_SCHEMATIC_PROFILE_V1` limits | UNCHANGED — graph/validate passes `profile.limits`; layout uses `maximumDiagramItems` |
| geometry/labels/net names never semantic connectivity authority | UNCHANGED — the graph model is stable-semantic-ID based; diff separates `connectivityChanges` from `diagramOnlyChanges` (routes.test pins it) |
| stable semantic IDs remain authoritative | UNCHANGED — propose allowlists only supplied IDs; normalize refuses unknown IDs |
| no mutation by validation/comparison/layout/inspection/proposal | CONFIRMED — all five are pure reads over the supplied body; propose returns `graphMutation: null` |
| /diff: both graphs validate + belong to the trusted project; deterministic diff | UNCHANGED + pinned scope check |
| /graph/validate: counts + status mapping + profile limits; mismatch 403 | CONFIRMED — pinned 403; counts shape pinned by routes.test |
| /variants: single + all-variant projection; graph non-mutation | UNCHANGED — `projectSchematicVariant` / `projectAllSchematicVariants` untouched (routes.test pins the projection) |
