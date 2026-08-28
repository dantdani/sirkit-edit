# B14 — artifact and pin stability

## Regenerated THROUGH GENERATORS (justified; nothing hand-edited)

| artifact family | generator | why it moved | stability |
| --- | --- | --- | --- |
| `ai-control-plane-b11/` (replay-trace-pins, evaluation results/matrix) | `generate-b11-artifacts.ts` | the ELEVENTH tool + the new propose action changed the registry digest, which participates in every capsule's trace identity | pins sha256 `e66dd9e06f48a658…`, byte-stable ×2; suite re-scored green |
| `ai-control-plane-b09/` (exposed-tool manifest, activation audit, provider parity, loop fixtures) | `generate-agent-artifacts.ts` | registry render: "11 statically exposed tools (28 registered)" | regenerated; b09-3 manifest tests green |
| `ai-control-plane-b04/` (tool-registry renders) | `generate-tool-registry-artifacts.ts` | new descriptor | byte-stable ×2 |
| `ai-control-plane-b01/` (action matrices, route coverage) | `generate-action-toolability-matrix.ts` | new propose action + the `/api/replacement-authority` route claim | byte-stable ×2 (`612115ab…`) |

## Unchanged

| gate | value |
| --- | --- |
| B05.1 composite replay fixtures | `f18e47e0f14b2d1d…` — UNCHANGED (byte-stable ×2; the new tool has no read binding) |
| `app/lib/pcb/types.ts` | `72ad7c7758b44414…` — UNCHANGED |
| `pcb-shape-descriptor.ts` | `5501d810e583395d…` — UNCHANGED; `--check` matches a fresh generation |
| provider-neutral schemas of the ten prior tools | unchanged (parity suites green) |
| B12 mutation/approval invariants | full family green |
| Tier-1 proposal schema/verifiers | untouched |
| `git diff --check` | clean |
| page.tsx ESLint | exactly the 14-problem pre-existing baseline |

## Protected original

`C:\Users\robsa\sirkit` untouched — `git status --porcelain` still lists
exactly the same 6 pre-existing entries (the user's own Jul 16 auth files
and Aug 3 `ai_recon.patch`). Nothing in the protected tree was modified,
formatted, staged, reset, or generated.
