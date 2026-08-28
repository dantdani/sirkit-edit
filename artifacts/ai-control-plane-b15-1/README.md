# B15.1 — corrective closures for the PCB proposal core

**Status: Sections A–G complete and green; H–K not built. The tool is NOT
exposed (registry still 11).** See [final-verdict.md](final-verdict.md).

R1–R9 were reproduced against the delivered B15 core and are now permanent
fail-closed regressions:

- [pre-edit-counterexamples.md](pre-edit-counterexamples.md) — exact
  reproduction output for all nine.
- [corrective-closures.md](corrective-closures.md) — what each defect was,
  how it was closed, and which test pins it.

Suites: `b15-1-corrective-closures.test.ts` (28) and
`b15-bounded-edit-core.test.ts` (15). Full suite 2817 pass / 20 skip / 0
failures.
