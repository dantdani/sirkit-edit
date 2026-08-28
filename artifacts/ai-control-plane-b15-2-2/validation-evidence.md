# B15.2.2 — validation evidence

| battery | result |
| --- | --- |
| B15.2.2 suite (R22, R23, seal allowlist, exposure) | **14/14** |
| B15.2.1 residual-closure | 15/15 |
| B15.2 core-closure | 20/20 |
| B15.1 corrective | 28/28 |
| B15 core | 15/15 |
| B15 family + B08 canonical/authority + B11.5 exposure + B14.4/B14.5 AST gates | **174/174** (direct battery, 10 files) |
| **FULL SUITE** | **2866 passed / 20 skipped / 0 failures** (2886; 323 files passed / 3 skipped) |

`pnpm exec tsc --noEmit`: **0 errors**. Scoped ESLint on every changed file:
clean. `git diff --check`: clean.

## One intermittent failure, honestly classified

The first full-suite run had **one** failure:
`app/components/pcb/__tests__/assignment-queue-panel.test.tsx › physical
assignment workbench › does not preselect a candidate and requires preview
plus explicit exact-plan confirmation` (2865 passed / 1 failed).

Per the stage rule it was reproduced in ISOLATION rather than assumed:

- 3 isolated runs → 1 failure, 2 passes;
- a further 6 isolated runs → **6 passes, 0 failures**.

So it is **intermittently flaky in isolation as well as under load** — NOT a
load artifact, and NOT deterministic. It is **pre-existing and unrelated to
B15.2.2**: the suite imports only `@/app/lib/assignment-queue/materializer`,
its fixtures, and `AssignmentQueuePanel`; it reaches **zero** of the modules
this stage changed (a grep for `geometry-exact` / `proposal/` in that file
returns 0). It was NOT repaired here — silently fixing an unrelated failure
is forbidden by the stage. It is recorded in [unknowns.md](unknowns.md) for
separate triage.

The re-run of the complete suite was clean (2866, 0 failures).

## Invariants preserved

- agent exposure **exactly 11**; no PCB propose tool (asserted in-suite);
- raw-sealer allowlist **unchanged** at exactly two modules;
- deterministic pins byte-identical: `replay-trace-pins.json` `e66dd9e0…`,
  `app/lib/pcb/types.ts` `72ad7c77…`, `pcb-shape-descriptor.ts`
  `5501d810…`, `composite-replay-fixtures.json` `f18e47e0…`;
- protected original `C:\Users\robsa\sirkit` at its 6-entry baseline;
- no provider routing, gateway/loop, review UI, approval/apply, durability,
  MCP, multi-agent, or manufacturing-release change; no provider credits.
