# B16.0.21 §D — Full-flow state-machine proof (CONFIRMED, one correction)

## The state machine (mapped before editing)

23 lifecycle states (`created … superseded`), transitioned ONLY through the
server's `transitionRun` (domain module, untouched), which enforces legal
transitions, the `expectedStateDigest` optimistic pin, event typing, and
actor/authority stamping — any illegal transition throws → 409.

| Property | Evidence |
|---|---|
| `propose` remains proposal-only | deterministic route; `requiresDeterministicPolicy: true`, `requiresOwningStageForEngineeringCommit: true`, `externalSideEffects: false` (pinned + gate literals) |
| `transition` accepts only legal server transitions | unknown lifecycle → 400; `transitionRun` throws on illegal → 409; malformed run → fail-closed 409 `CD13_RUN_SHAPE_INVALID` (pre-existing typed catch, preserved & pinned) |
| `run` bypasses nothing | it CREATES a run record only — `authoritativeEngineeringArtifactsCreated: false` (pinned); no executor invocation, no editor mutation, no release path exists in the route (gated) |
| caller claims cannot become authoritative | actor/state/approval all from trusted scope + the server machine; `expectedStateDigest` makes replay deterministic and bounded (stale digest → machine refusal) |
| partial failure cannot report completion | the route returns the machine's result or a typed 409 — no synthesized completion |
| manufacturing release unreachable | `production-released` is a REQUESTED outcome label only; `evaluateCd13ImplementationPrerequisites` reports prerequisites; no release authority is minted (gate: no `releaseManufacturingPackage`/authority-store reference); the MFG01 suites pass unchanged |

## The §D correction

The actor gate refused only `"ai"`; `automated_engine`/`import_adapter`/
`system_migration` passed (reproduced verbatim pre-edit; unreachable via HTTP
— trusted context mints human). Corrected to refuse ANY non-human actor with
the SAME 403 response; all four kinds pinned refused, human still passes to
typed-input validation.
