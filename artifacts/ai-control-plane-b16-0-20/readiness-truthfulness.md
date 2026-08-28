# B16.0.20 §H — Readiness truthfulness (CONFIRMED / by construction)

`/readiness` preserves: trusted problem project/branch (foreign → 403
`readiness scope mismatch`, pinned); model + testbench registries;
provider/environment; applicability results; optional denominator / coverage /
campaign; provider discrepancy IDs; and the deterministic
`evaluateSimulationReadiness` (untouched — domain suite green).

Readiness is NOT (human-truth gates + response shape):

- simulator execution (the runner is BLOCKED — 501);
- model validation (applicability results are inputs, not conclusions);
- waveform truth (no waveform is consumed here);
- assertion approval (assertions live in /measure as evidence);
- safety certification / ERC signoff / PCB release / manufacturing release
  (no such claim exists in the response; the release descriptor stays
  internal-only, gate-asserted).

Unknown / diagnostic-only / incomplete / discrepant / uncovered evidence
cannot silently become pass — the evaluator's conservative semantics are
untouched, and the route adds no defaulting on top of them.
