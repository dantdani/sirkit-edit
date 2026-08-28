# B16.0.20 — Model-simulation route migration, tranche 13

All six CD-10 methods → `authenticatedJsonRoute({ maxBytes: 64_000_000,
deadlineMs: 30_000 })` (deadline verified as the reader default).
`scopedJson` retained; Request-free `modelSimulationScopeFromContext` added.

## The §C finding (reproduced pre-edit, corrected)

The `/execute` actor gate was `actorKind !== "human" && role !== "automation"`
— an **AI actor with the automation role passed the gate** (reproduced live
pre-edit: ai+automation → 400 required-field, not 403), contradicting the
route's own "AI cannot execute simulation campaigns" contract. Mitigating
fact: the trusted-context resolver mints `actorKind: "human"` for ALL session
principals, so the flaw was unreachable via the HTTP boundary — but it was a
real latent defect in the defense-in-depth layer. **Corrected** to refuse ANY
non-human actor (a strict narrowing), with the pre-edit behavior recorded in
[human-ai-authority-separation.md](human-ai-authority-separation.md) and the
corrected gate pinned.

## Results at a glance

| Metric | Value |
|---|---|
| §A pins (pre = post, green first run) | **44** |
| Execution-authority + confinement + human-truth gates | **9** |
| Standing route + domain suites | unchanged, green |
| Runner | remains BLOCKED — 409 denied / fail-closed **501** with the exact blocked-runner error; zero process/container/network (statically gated) |
| Ratchet | 43 → **37** (6 removed, 0 added) |
| Inventory | **153 total · 116 canonical · 3 factories · 34 raw** |
| Full suite | recorded in [test-and-validation-report.md](test-and-validation-report.md); tsc 0; eslint 0; git clean; generators ×2 byte-stable |

## Scope

No runner implementation, subprocess/container/network execution, external
simulator calls, or provider expansion. Tools stay 12.
`C:\Users\robsa\sirkit` untouched. B16.0.21 / B16.1 NOT started.
