# B15.2.1 — residual PCB proposal-core and seal-boundary closure

**Status: R17–R21 behaviorally closed; tool remains UNEXPOSED (registry
exactly 11).** See [final-verdict.md](final-verdict.md).

R17–R21 were reproduced against current production code and are now
permanent fail-closed regressions:

- [pre-edit-counterexamples.md](pre-edit-counterexamples.md) — exact output
  for all five.
- [exact-geometry-contract.md](exact-geometry-contract.md) — R18.
- [footprint-and-dimension-closure.md](footprint-and-dimension-closure.md) —
  R17, R19.
- [rule-delta-semantics.md](rule-delta-semantics.md) — R20.
- [seal-boundary-and-import-gate.md](seal-boundary-and-import-gate.md) — R21.
- [validation-evidence.md](validation-evidence.md),
  [changed-files.md](changed-files.md), [unknowns.md](unknowns.md).

Suites: `b15-2-1-residual-closure.test.ts` (15) + the existing B15/B15.1/
B15.2 suites. Full suite 2852 pass / 20 skip / 0 failures.
