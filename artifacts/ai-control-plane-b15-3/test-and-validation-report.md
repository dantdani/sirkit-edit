# B15.3 — test and validation report

## New permanent suites (47 tests)

| suite | tests | covers |
| --- | --- | --- |
| `b15-3-validation-policy.test.ts` | 6 | item-10 gate: policy sealed + integrity-pinned; different presets no longer identical; tamper refuses; smuggled rules inert |
| `b15-3-pcb-proposal-exposure.test.ts` | 13 | K1–8, K10, K12–14, K43: exposure 12 + exact ids, provider parity, strict input + authority-arg refusal, prerequisite fail-closed, the scripted REAL loop emits exactly one `pcb_proposal_ready` + zero mutation, timeout/abort zero, fabricated events refuse |
| `b15-3-approved-pcb-apply.test.ts` | 18 | K17–41: one transaction + exact undo/redo, unforgeable approval, all currency refusals, double-click/concurrent/replay one commit, all crash windows, authentic + forged recovery |
| `b15-3-import-gates.test.ts` | 8 | K16, K42: approval/apply import boundaries + negative tripwires, commitPcbCandidate unreachable from provider/route/gateway, UI safety-claim source gate, raw-sealer allowlist unchanged |
| `b15-3-production-integration.test.tsx` | 2 | K44/K45: fresh-browser prompt → real route+loop+gateway → `pcb_proposal_ready` → real dialog → click → one commit → exact undo/redo; zero mutation before the click; no paid provider |

## Regression batteries (green)

- All six B15 proposal-core suites: **110/110** (after the validationPolicy
  migration; zero assertion weakened).
- B08 canonical/authority + B11.5 exposure + B14.4/B14.5 AST gates: green.
- Agent suites (b09/b10/b11/b12 boundary) + chat-route + b14-1 integration:
  green after the exposure pins moved 11→12 and the b11 replay pins
  regenerated.
- Executor kernel + action-registry + editor-adapter suites: green with the
  new `pcb.bounded-edit-apply` binding and additive `provenanceCandidateId`.

## Full validation

- **Full suite: 2931 passed / 20 skipped / 0 failures** (2951; 329 files
  passed / 3 skipped), exit 0. +47 vs B15.2.3's 2884 — exactly the new
  B15.3 tests. No intermittent failure (the pre-existing
  `assignment-queue-panel` flake did not fire this run).
- `pnpm exec tsc --noEmit`: **0 errors**.
- Scoped ESLint on all changed production files: clean (exit 0).
- `git diff --check`: clean (exit 0).
- All four artifact generators run TWICE: byte-stable
  (`ALL_BYTE_STABLE`).

## Commands

```
pnpm exec tsc --noEmit
pnpm exec eslint <changed files>
npx vitest run app/lib/pcb/proposal/__tests__/b15-3-validation-policy.test.ts
npx vitest run app/lib/agent/__tests__/b15-3-pcb-proposal-exposure.test.ts
npx vitest run app/lib/engineering/__tests__/b15-3-approved-pcb-apply.test.ts
npx vitest run app/lib/project/__tests__/b15-3-import-gates.test.ts
npx vitest run app/lib/project/__tests__/b15-3-production-integration.test.tsx
npx vitest run --pool=forks --poolOptions.forks.maxForks=5   # full suite
npx tsx scripts/generate-action-toolability-matrix.ts
npx tsx scripts/generate-tool-registry-artifacts.ts
npx tsx scripts/generate-agent-artifacts.ts
npx tsx scripts/generate-b11-artifacts.ts
```

## Invariants preserved

- agent exposure **exactly 12**; the exact id set pinned; no PCB
  mutate/apply/destructive tool exposed;
- raw-sealer allowlist **unchanged** at two modules;
- protected original `C:\Users\robsa\sirkit` at its **6-entry** baseline;
- deterministic pins: `types.ts` `72ad7c77…`, `pcb-shape-descriptor.ts`
  `5501d810…`, `composite-replay-fixtures.json` `f18e47e0…` (all UNCHANGED);
  `replay-trace-pins.json` legitimately advanced to `aed49ee4402dd565`
  (the 11→12 exposure drift, byte-stable, exactly as B14's exposure moved it).
