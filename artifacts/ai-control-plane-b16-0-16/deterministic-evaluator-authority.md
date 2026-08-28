# B16.0.16 §D — Deterministic evaluator authority (CONFIRMED / by construction)

The migration touched only each route's boundary prologue; all deterministic
CD-7 logic is byte-identical and covered by the unchanged `app/lib/calculation`
domain suite (green post-migration).

## /corners

- `maximumCorners: LOW_VOLTAGE_CALCULATION_PROFILE_V1.limits.maximumDiscreteCorners`
  unchanged; variant/mode filtering and forbidden assignments passed verbatim to
  `enumerateCornerCases`; complete → 200 / else 422 with `no-store`; **no
  provider call** (pinned).

## /evaluate

- approved model registry unchanged: `loaded_divider`, `rc_time_constant`,
  `static_power`, `ldo_loss`, `ideal_adc_lsb`, `simple_thermal_estimate`;
- typed interval validation via `validateEngineeringInterval` unchanged;
  evidence-class semantics unchanged;
- **unapproved model → 422** (pinned); **no provider call** (pinned); no ad-hoc
  calculation path added.

## /problem

- all pinned CD-1…CD-6 states + signoff + registry required (400 otherwise);
- `LOW_VOLTAGE_CALCULATION_PROFILE_V1` and deterministic digest construction
  unchanged; caller cannot substitute actor or project scope (§C).

## /report

- graph/problem binding (`graph.problemRevisionId === problem.problemId`) and
  digest verification for the graph, its nodes, results, margins, and coverage
  (`calculationDigest(...)`) unchanged; fixed-point evidence, selected values,
  solver certificates, and downstream obligations passed verbatim to
  `materializeCircuitCalculationReport`; materialized with the server-derived
  actor; **no unverified numeric result can enter the report** (the digest gates
  precede materialization and are unchanged).

## /export

- requires one current human-approved report (`state.decision.state ===
  "approved"` matching `reportId` + `deterministicDigest`); **NOT_RELEASED**
  otherwise (pinned); exact `Content-Disposition` filename sanitization; explicit
  `APPROVED_CALCULATION_HANDOFF_NOT_A_SCHEMATIC_OR_PCB_RELEASE` status — never a
  schematic/PCB/manufacturing release ([export-authority-and-human-approval.md](export-authority-and-human-approval.md)).
