# B16.0.17 §F — Layout view authority (CONFIRMED)

`/layout` (migrated) preserves the view-only contract:

| Rule | Evidence |
|---|---|
| graph + sheetInstanceId validation | 400 `graph and sheetInstanceId are required` (pinned); graph validity + project scope → 422 |
| priorView behavior | optional object passed through to `compileDiagramView` unchanged |
| `maximumDiagramItems` profile limit | `LOW_VOLTAGE_SCHEMATIC_PROFILE_V1.limits.maximumDiagramItems` unchanged |
| deterministic `compileDiagramView` | untouched module (domain suite green) |
| response authority remains `view_only` | pinned by the standing routes.test and asserted in source by the gate |
| `semanticGraphDigest` bound to the source graph | response carries `graph.deterministicDigest` (routes.test pins it) |
| layout coordinates never semantic connectivity authority | the view is a projection; the graph is not modified and no connectivity is derived from coordinates (unchanged model) |
| no graph mutation, no PCB mutation | pure compile over the supplied graph; no store/PCB service touched |
