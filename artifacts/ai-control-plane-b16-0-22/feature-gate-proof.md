# B16.0.22 — feature-gate fail-closed proof

All three gated families default CLOSED and were pinned pre = post:

| family | flag | default | pinned behavior |
|---|---|---|---|
| assignment-queue | `SIRKIT_ASSIGNMENT_QUEUE_STAGE6` | `off` | GET and POST → 503 `AQ_STAGE6_DISABLED` before any durable work |
| passive-policy | `SIRKIT_PASSIVE_POLICY_STAGE5` | `off` | GET capability doc: `mutate:false`, empty `exceptionLifecycle`, `manufacturingReady:false`, `mutatesSchematic:false`, `mutatesPcb:false`; `opt_in` → `mutate:true` with exactly `approve/revoke/supersede` |
| pcb-sync | `SIRKIT_PCB_SYNC_STAGE3` | `off` | GET capability doc: `arbitraryKicadPcb:false`, `routedStructuralChanges:false`, `routing:false`; state header `X-Sirkit-Pcb-Sync-State` |

Ordering guarantees (pinned/gated):

- assignment-queue POST: bounded read → forbidden-authority screen →
  feature-state → operation dispatch (the screen PRECEDES state work —
  source-order gate).
- assignment-queue commit additionally requires `opt_in` AND the exact
  opt-in header ([safe-header-proof.md](safe-header-proof.md)).
- The capability documents are truthful about non-capability (no mutation
  claims while `off`) — byte-pinned fields.

**CONFIRMED**.
