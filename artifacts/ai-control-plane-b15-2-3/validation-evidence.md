# B15.2.3 — validation evidence

| battery | result |
| --- | --- |
| B15.2.3 suite (R24 + boundaries + numerics + bounds + order + totality + genuine) | **18/18** |
| All six B15 proposal suites together (b15 core 15, b15-1 28, b15-2 20, b15-2-1 15, b15-2-2 14, b15-2-3 18) | **110/110** (6 files) |
| B08 canonical/authority (5 files) + B11.5 exposure gate + B14.4/B14.5 AST gates | **112/112** (9 files, direct battery) |
| **FULL SUITE** | **2884 passed / 20 skipped / 0 failures** (2904; 324 files passed / 3 skipped) |

`pnpm exec tsc --noEmit`: **0 errors**. Scoped ESLint on all three changed
files: clean (exit 0). `git diff --check`: clean (exit 0). The full-suite
run completed with exit code 0 and NO intermittent failure this time (the
pre-existing `assignment-queue-panel` flake recorded in B15.2.2 did not
fire; it remains un-repaired and still flagged for separate triage there).

## Zero assertion drift

No existing test file was modified and no prior assertion was weakened: the
existing tamper cases that touch the impact (`impactDigest: "forged"`,
partial fabricated impact, forged candidate digest, minted-id mismatch) pin
`ok:false` without a code that the earlier-running shape check could shift
— all still refuse. Both §G genuine positives (single-op; real
`set_net_class_rule` with nonempty ruleChanges/affectedNetIds/minted rule
id) prove the closed contract matches the real producer, not a guess.

## Invariants preserved

- agent exposure **exactly 11**; no PCB propose tool (asserted in-suite by
  the standing B15.2.2 §C test, green in this run);
- raw-sealer allowlist **unchanged** at exactly two modules, with the
  standing "must NOT grow in B15.3" assertion + negative tripwire green;
- R22 exact outline authority untouched and green (b15-2-2 §A 14/14);
- deterministic pins byte-identical:
  `artifacts/ai-control-plane-b11/replay-trace-pins.json` `e66dd9e06f48a658`,
  `app/lib/pcb/types.ts` `72ad7c7758b44414`,
  `app/lib/agent/generated/pcb-shape-descriptor.ts` `5501d810e583395d`,
  `artifacts/ai-control-plane-b05-1/composite-replay-fixtures.json`
  `f18e47e0f14b2d1d`;
- protected original `C:\Users\robsa\sirkit` at its exact 6-entry baseline
  (4 modified auth files + `ai_recon.patch` + untracked `artifacts/`);
- no gateway/loop, review UI, approval/apply, durability, MCP, multi-agent
  or manufacturing-release change; no provider credits; no dependency
  changes.
