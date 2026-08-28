# B16.0.20 §F — Measurement & assertion authority (CONFIRMED / by construction)

`/measure` preserves: runId requirement, authoritative-waveform requirement,
measurement + assertion definitions, applicable scenario/corner binding, and
`resolutionStudyPassed` threading (exact 400 pinned; deterministic
`evaluateMeasurement`/`evaluateAssertion` untouched — domain suite green).

| Proof | Status |
|---|---|
| missing/malformed waveform cannot produce authoritative measurements | UNCHANGED — `evaluateMeasurement` marks non-evaluable inputs accordingly (domain semantics untouched); the route requires a waveform object before any evaluation |
| assertions reference only produced measurements | UNCHANGED — `evaluateAssertion` receives ONLY the measurements produced in this call for this runId |
| failed/absent resolution study cannot be represented as passed | UNCHANGED — `resolutionStudyPassed: body.resolutionStudyPassed === true` (strict boolean; anything else is false) |
| output is evidence, not approval/certification | CONFIRMED — the response is `{ measurements, assertions }` only; no approval field exists; human-truth gates cover the family |
| no provider / no runner / no mutation | CONFIRMED — statically gated (no llmRouter/spawn/fetch); pure evaluation |
