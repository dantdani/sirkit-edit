# B16.0.17 §E — KiCad quarantine proof (CONFIRMED)

`/kicad/inspect` (migrated, `{ body }` callback) preserves the quarantine:

| Rule | Evidence |
|---|---|
| raw source must be a string | 400 `KiCad source string is required` (pinned) |
| parser limits from `LOW_VOLTAGE_SCHEMATIC_PROFILE_V1` | `inspectKiCadSchematic(body.source, LOW_VOLTAGE_SCHEMATIC_PROFILE_V1)` unchanged |
| authority remains `quarantine_inspection_only` | pinned on BOTH the parsed (200) and failed-parse (422) paths |
| `semanticImport` remains `null` | pinned; the gate suite also asserts the literal in source |
| inspection cannot create an authoritative semantic graph | the response carries only the inspection + null import; no graph object is emitted |
| inspection cannot mutate project state | pure function over the supplied string; no store/service is touched |
| malformed/unsupported KiCad stays quarantined | non-parsed source → 422 with the same quarantine authority (pinned); unsupported version → `semanticAdapterState: "unsupported_version"` (standing routes.test) |

No KiCad semantic importer was built in this stage.
