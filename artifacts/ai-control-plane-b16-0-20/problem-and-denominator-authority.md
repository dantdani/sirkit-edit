# B16.0.20 §E — Problem & denominator authority (CONFIRMED / by construction)

## /problem

CD-8 schematic project + CD-9 circuit-verification project + model registry +
testbench registry + providers + required obligation IDs all required (exact
400 pinned); capability profile `defaultModelSimulationCapabilityProfile()`
and controlled assumptions unchanged; HUMAN actor required (403 pinned);
trusted tenant/branch authority from scope; **BLOCKED BY CD-9 → 409** status
mapping pinned (ok → 200, other verdicts → 422).

## /denominator

Problem scope binding (foreign → 403 `denominator scope mismatch`, pinned);
graph digest binding (`graphDigest: problem.semanticGraphDigest`), obligations,
testbench registry, scenarios, providers, environments, model bindings, and
corner/sample IDs flow unchanged into
`compileSimulationCoverageDenominator` with the deterministic capability
profile; domain errors → 422. **No provider/runner call** (statically gated);
**no mutation** (pure compilation over supplied inputs).

An incomplete or vacuous denominator cannot silently become complete — the
domain compiler's completeness semantics are untouched (standing domain suite
green); the route adds no defaulting.
