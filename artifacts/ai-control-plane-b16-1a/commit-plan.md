# B16.1A §D — commit plan vs what actually landed

## The §D ten-group plan (as directed)

1. control-plane foundations and command execution
2. schematic mutation authority
3. PCB mutation and proposal authority
4. context, tracing, replay, and durability
5. authentication and canonical route boundaries
6. simulation and manufacturing security
7. tests and executable gates
8. generated evidence and architecture artifacts
9. B16.0.24.1 security corrections
10. benchmark-quality workflow repair

## What actually landed (truthful disposition)

Before this stage's directive arrived, the accumulated tree had ALREADY been
merged to `main` through PR #2 as ONE integration commit (`4e99e3e`, author
`Dandi Desta <dandidesta82@gmail.com>`, no AI trailer) plus one CI-fix commit
(`6956e74`, group 10). Splitting the merged commit into groups 1–9 now would
require rewriting published `main` history — expressly forbidden (no
force-push, no rewrite, no altering merged commits). The grouping is therefore
recorded here as the logical map of the merged content rather than re-executed:

| group | where it lives inside `4e99e3e` |
|---|---|
| 1 | `app/lib/engineering/*` (action registry, executor, tool catalog/gateway) |
| 2 | `app/lib/engineering/schematic-*`, sealed tier-1/replacement proposal families |
| 3 | `app/lib/pcb/*` (canonical editor, proposals, physical bindings, routing) |
| 4 | `app/lib/agent/*` (context, trace recorder, replay), durable-workflow stores |
| 5 | `app/lib/auth/*`, `app/api/**` canonical wrappers, route policy |
| 6 | `app/api/simulate`, `app/lib/spice/**`, manufacturing gates |
| 7 | every `__tests__` suite: parity pins, confinement gates, ratchet |
| 8 | `artifacts/ai-control-plane-*`, sanctioned generators |
| 9 | bounded raw read, auth-runtime projection, SSR fake-client proofs |
| 10 | `.github/workflows/benchmark.yml` pnpm fix (`6956e74`) |

## This stage's new commits (clean conventional subjects, real boundaries)

1. `ci(benchmark): upload failure diagnostics and junit reports` — §F
   hardening (group 10 continuation).
2. `docs(artifacts): B16.1A integration and benchmark-CI evidence` — this
   artifact set (group 8).

Each commit: staged diff inspected, secret-scan clean, focused tests run,
current truthful timestamps, owner identity, no trailers.
