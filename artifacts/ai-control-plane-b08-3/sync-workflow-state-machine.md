# B08.3 — Owned Sync-Preparation Workflow: State Machine and Server-Effect Truth

## States (`runOwnedSyncPreparation`)

```
 idle ── begin("sync-preparation") ──▶ warmup ──▶ binding ──▶ publishing ──▶ persisting ──▶ preflighting ──▶ completing ──▶ idle
   ▲          │refused-busy (a CURRENT-generation request holds the slot)
   │          ▼
   └──── (zombie holder from a retired generation is EVICTED — never blocks)
```

Ownership (`op.owned()` = slot still owned by this requestId AND the
capturing generation is current) is verified:

| checkpoint | on stale |
|---|---|
| after warmup | settle(stage), stop |
| before dequeuing EACH binding | worker stops silently (settled once at the join) |
| after EVERY binding response | worker stops; progress write skipped |
| after the binding join | settle(stage), stop |
| after publication resolves | settle(stage — `published` if it committed), stop; snapshot revision NOT persisted |
| before snapshot-revision persistence | (same check as above — persistence only in a verified-current window) |
| after preflight resolves | stale preflight result DISCARDED (never reaches `pendingPreflight`); settle(stage) |
| before complete()/progress()/fail() | ports are owned-gated (`op.ifOwned`) — structurally unreachable when stale |

## Cancellation boundaries

| stage | AbortSignal | rationale |
|---|---|---|
| warmup (part-cache) | none needed | local, idempotent |
| physical bindings | YES (`scope.signal` → fetch) | idempotent, resumable server transactions; restart resumes |
| publication (`client.publish`) | NO — deliberate | durable commit; the response is the only evidence of commitment — abort would lose the truth needed for settlement |
| preflight (`client.preflight` + `{signal}`) | YES | its plan is inert until an explicit apply; safe to drop |
| sync apply (`client.apply`) | NO — deliberate | durable commit (same rationale as publication) |
| qualification POST | NO — deliberate | durable server routing/qualification |

## Per-stage server-effect truth table (stale settlement)

`stage` tracks the FURTHEST durable server effect reached; the stale path
calls `settleStale(stage, scope)` → editor port → `settleServerCommit`:

| stage reached | server truth | same identity | cross identity / disposed |
|---|---|---|---|
| `none` | nothing durable happened | silent discard (no notice, no toast) | silent discard |
| `bindings` | binding transactions MAY have committed (idempotent, resumable) | reconcile notice: "Sync preparation had started changing server state (durable component bindings)… Restart Schematic → PCB to resume and reconcile." | discard — nothing written |
| `published` | the schematic snapshot publication committed (and bindings before it) | reconcile notice: "Sync preparation DID change server state (component bindings and the schematic snapshot publication committed)… Restart Schematic → PCB to reconcile." | discard — nothing written |

Never described as canceled or unchanged once `stage ≠ none`. The stale
snapshot revision is never persisted — the restarted sync republished
under the current generation re-establishes it from the server response.

## Sync apply / qualification (`runVerifiedServerAdoption`)

```
 idle ─ begin(kind) ─▶ committing ─▶ [committed? no → commit-failed (owned toast, no settlement)]
                            │ yes (IRREVERSIBLE from here)
                            ▼
                     settle-if-stale ─▶ stale? → reconcile notice (same id) / discard (cross id) — reload never runs
                            ▼
                     verifying: expected revision+digest non-empty → reload → revision == expected
                                → digest == expected → record identity == captured scope
                            │ any failure → verification-failed → authority notice (same id only);
                            │              local board preserved; no cache/evidence/checkpoint/success
                            ▼
                     adopting: all-or-nothing bundle (cache + authoritativeRecord + editor adoption +
                               evidence + checkpoint + success toast) — the adoption itself advances
                               the generation; registry.retireGeneration() settles the busy slot
                               synchronously (the workflow's own finish() then no-ops)
```
