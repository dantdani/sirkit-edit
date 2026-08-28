# B08.3 — Request / Busy / Finalizer Ownership Matrix

Registry: `PcbOwnedOperationRegistry` (one per PcbEditor mount, bound to
the `PcbBoardLifecycleOwner`). Kinds: `sync-preparation`, `sync-apply`,
`qualification`. The editor's `syncing`/`applying`/`qualifying` are
DERIVED from the registry via subscription — no ambient booleans exist.

| concern | rule | proof |
|---|---|---|
| busy definition | slot exists AND its scope's generation is current | b08-3 tests 4, 13 |
| single-flight | `begin` refuses only while a CURRENT-generation request holds the kind | tests 4, 5/6 |
| zombie eviction | a holder from a retired generation is evicted by the next `begin` — an abort-ignoring request can never block a fresh generation | tests 4, 5/6 |
| finalizer ownership | `finish()` deletes the slot ONLY if the caller's requestId still owns it — an old finalizer can never clear, replace, or unblock a newer request's state | tests 4, 5/6 (zombie resolves after the new request began; busy stays true) |
| adoption transition | `adoptBoardLifecycle` runs `owner.adopt(identity)` + `registry.retireGeneration()` + `setSyncProgress(null)` SYNCHRONOUSLY — the replacement generation exposes clean idle state immediately, including for the SUCCESSFUL operation whose adoption advanced the generation (its own later `finish()` no-ops) | tests 1, 12, 13 |
| progress ownership | the sync progress line is written only through owned-gated ports and cleared by (a) the owning run's finalizer while still owned, or (b) the adoption transition — a stale run cannot clear or overwrite a newer run's progress | tests 1, 3 |
| stale UI writes | pending plan, dialog close, toasts, progress: all behind `op.ifOwned` — structurally unreachable for a stale run | tests 1, 2, 3 |
| hooks (B08.2) | autoroute/auto-place/repair keep their own request-keyed `activeRef` ownership + `invalidate()`; the B08.3 registry covers the three SERVER workflows the B08.2 effect did not | b08-2 suite (still green) |

## Editor wiring (composition layer only)

- `handleSync` → `runOwnedSyncPreparation(ownedOps, ports)` — ports carry
  the binding fetch (with signal), publish, snapshot-revision persistence,
  preflight (with signal), progress/fail/complete effects, and the
  per-stage settlement (via `settleServerCommit` + the B08.2 recorder).
- `handleApplySync` → `runVerifiedServerAdoption(ownedOps, "sync-apply", …)`.
- `handleQualify` → `runVerifiedServerAdoption(ownedOps, "qualification", …)`.
- `adoptBoardLifecycle` — the ONE transition: history retirement →
  `owner.adopt` → `registry.retireGeneration()` → progress clear →
  generation-state bump (hook invalidation + AssistBox remount) → dispatch.
