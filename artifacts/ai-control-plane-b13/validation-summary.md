# B13 — validation summary

## Authoritative hashes

```
app/lib/pcb/types.ts                              sha256=72ad7c77…  UNCHANGED
app/lib/agent/generated/pcb-shape-descriptor.ts   sha256=5501d810…  UNCHANGED
artifacts/ai-control-plane-b11/replay-trace-pins.json  sha256=03e043f4…  (was ab36b0c9…) — JUSTIFIED
```

The PCB type hashes are byte-identical — B13 touches no PCB types. The
B11 replay pins moved because exposing the tenth agent tool changes the
per-run discovery digest baked into every eval capsule's trace; the pins
regenerated deterministically (byte-stable ×2) and all 19 cases + 59
checks pass. Descriptor `--check`: OK (same graph/source digests). The
B04 registry digest changed (new `agentExposed` flag) and regenerated
byte-stable ×2.

## Static gates

| Gate | Result |
| --- | --- |
| `npx tsc --noEmit` | clean |
| Scoped ESLint (11 changed production/test files) | clean |
| `npx eslint app/page.tsx` | exactly the 14 pre-existing baseline errors, 0 new |
| descriptor `--check` | OK |
| B11 / B04 generators ×2 | byte-stable |
| `git diff --check` | clean |

## Test battery (exact counts)

| Suite | Result |
| --- | --- |
| **B13** `b13-component-authority-bridge` (new) | **24 / 24** |
| B04 tool-registry (exposure tripwire ten; artifacts regenerated) | green |
| B05 / B05.1 read-invocation + resource-pinning | green |
| B06 / B06.1 / B06.2 authority + replacement | green |
| B09 / B10 agent boundary / discovery / provider / chat boundary | green |
| B11 trace / replay / evaluation (pins regenerated) | green |
| B12 → B12.8 family | green |
| Engineering + physical-binding + atomic + project batch | **818 / 818** (+6 DB-gated skips) |
| **Full suite** `npx vitest run --pool=forks --maxForks=5` | **2589 passed / 20 skipped / 4 flakes** (308 files) |

## The four non-passes — classified only after isolated reproduction

`auto-place`, `connectivity-board`, `route-tool` (wall-clock performance
bounds) and `InterfacePlanningWorkspace` (CD-4 jsdom component render) —
all in code B13 never touched, under the machine's heavy background load.
Each re-run **three times in isolation: 8/8, 10/10, 25/25, 2/2 — green
every time.** No functional failure was classified as timing; no
threshold was relaxed. (The bounded `--maxForks=5` invocation changes
scheduling parallelism only, matching the established practice on this
loaded machine.)

## Protected original

`C:\Users\robsa\sirkit` was never modified — its pre-existing 6-entry
dirty baseline is unchanged.
