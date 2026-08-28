# B15.2.1 — validation evidence

| battery | result |
| --- | --- |
| B15.2.1 residual-closure suite (R17–R21 + AST gate) | **15/15** |
| B15.2 core-closure (over the new authorities) | 20/20 |
| B15.1 corrective + B15 core | 28/28 + 15/15 |
| B15 family + B08 canonical/authority + B11.5 exposure + B14.4/B14.5 gates | 160/160 (direct battery) |
| **FULL SUITE** | **2852 passed / 20 skipped / 0 failures** (2872; 322 files passed / 3 skipped) |

`pnpm exec tsc --noEmit`: **0 errors**. Scoped ESLint on every changed
file: clean. `git diff --check`: clean. The full suite passed on its first
completed invocation — no timing flakes to classify. (One earlier run was
interrupted by a session teardown, not a test failure; it left no result
and was re-run to completion.)

Invariants preserved:
- agent-exposed tool count **exactly 11**; no PCB propose tool
  (`{"count":11,"pcbPropose":false}`);
- deterministic pins byte-identical: `replay-trace-pins.json`
  `e66dd9e0…`, `app/lib/pcb/types.ts` `72ad7c77…`,
  `pcb-shape-descriptor.ts` `5501d810…`;
- protected original `C:\Users\robsa\sirkit` at its 6-entry baseline;
- no provider credits, provider-config, gateway/loop, UI, approval/apply, or
  durability changes.
