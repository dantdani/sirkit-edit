# B12.2 — persistence and undo evidence

What is now proven about the committed edit's durability and the
determinism of undo/transition immediately after committed success.

## Persistence before the winning transition installs

Sequence proven in `b12-2-transition-serialization.test.ts` test 8 and
`b12-2-synchronous-adoption.test.ts` test 4:

```
approved apply commits (durable store head 0 → 1, INSIDE the lease)
  → synchronous adoption: projection + ONE history entry + autosave SCHEDULED
  → receipt consumed, lease released
  → transition barrier settles
  → beforeInstall: autosaver FLUSH — the retiring project's persisted
    projection now equals the COMMITTED authoritative state
  → the winning target installs
```

Event-order assertion: `beforeInstall:flush` strictly precedes
`install:<target>`; the persisted digest for the retiring project equals
`schematicStateDigest(commandResult.state)`.

**Fresh-browser reopening cannot lose the committed edit.** Two independent
layers:

1. The canonical envelope was durably committed by the session INSIDE the
   critical section (store head advanced before adoption even began) — the
   canonical head can never be lost, transition or not.
2. The flushed projection now MATCHES that durable head, so a fresh
   `openForProject(persistedProjection, mark)` resumes `ready` at the
   committed head (proven: reopening the retired store yields
   `lifecycle: "ready"`, `headSequence: 1`) — no recovery dialog, no
   stale-projection reconciliation.

## Immediate undo

Proven with fake timers and NO timer advance
(`b12-2-synchronous-adoption.test.ts` tests 1–2):

- at committed-promise settlement the history already holds the apply entry
  (`entries.length === 2`, `canUndo === true`, undo label pinned);
- the real history record happens BEFORE the `committed-verified` audit
  event (event-order instrumented);
- an immediate `runHistoryStep("undo")` through the production coordinator
  restores the exact pre-apply visible digest and reconciles the durable
  lineage (`headMark().canonicalStateDigest` back to the sealed base,
  lineage unchanged).

## No duplicate entry

The page's design-state watcher is simulated faithfully (the
applying-history suppression flag + the 350 ms debounce) under fake timers:
after committed success, flushing 2 s of timers records nothing further —
one `history-record` event total, zero `debounce-record` events.

## Immediate transition

A transition requested immediately after committed success (no lease held
at that point) installs synchronously; the retiring project's history is
already complete (2 entries) and its persisted projection is the committed
state. With a lease still held, the transition waits (B12.1 §B, re-proven
in the §A suite) — either way, no window exists in which a transition
observes a committed-but-unrecorded apply.
