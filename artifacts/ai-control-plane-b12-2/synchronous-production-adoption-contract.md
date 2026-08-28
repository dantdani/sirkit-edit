# B12.2 §C — the synchronous production adoption contract

Module: [`app/lib/project/canonical-adoption.ts`](../../app/lib/project/canonical-adoption.ts) (`adoptCanonicalResult`)
Supersedes: B12.1's assumption that the coordinator host's
`applyCanonicalProjection` synchronously establishes one history entry.

## What was wrong (R3)

`page.tsx`'s applier only SET React state and `historyLabelRef`; the real
`SchematicHistory.record` ran in the design-state watcher's **debounced
350 ms timer**. Reproduced: at the moment the service returned `committed`,
consumed the receipt, and released the commit lease, the production history
still had one entry and `canUndo: false` — the entry the receipt's
postconditions claim appeared 350 ms later. In that window immediate undo
was unavailable and an immediate transition found history/persistence
incomplete. B12.1's tests hid this by substituting a synchronous
"production-shaped" host.

## The primitive

ONE synchronous sequence, imported by `page.tsx` AND driven directly by the
test compositions — never a duplicate implementation:

```
adoptCanonicalResult(host, label, state):
  history = host.history()            — REFUSED when absent (no history-less "success")
  host.flushPendingRecord()           — pending debounced (non-canonical) record first
  authoritative = normalize(state)    — arrays present/owned; pageSize iff present
  host.applyProjection(authoritative) — page: the four setters + authoritative mirror
                                        + notifyAuthoritativeProjection
  history.record(label, snapshot)     — EXACTLY ONE real SchematicHistory entry, NOW
  host.historyRecorded()              — page: setSchHistoryView
  host.suppressEffectRecord()         — page: applyingHistoryRef.current = true
  host.scheduleAutosave()             — page: autosaver.schedule()
  → { ok: true } | { ok: false, detail }   (total, never throws)
```

`page.tsx`'s `applyCanonicalSchematicProjection` is now a thin binding of
these ports; on `ok: false` it THROWS, so the coordinator reports the job
`failed` — an approved apply then **poisons its proposal identity** and
enters explicit recovery instead of displaying success.

## Consequences (the ordering the receipts claim is now real)

- The authoritative projection and the real history entry exist **before
  the coordinator job returns** — hence before §D postconditions are
  finalized, before the receipt is consumed, before the
  `committed-verified` audit event, and before the commit lease releases
  (§B retirement therefore waits for a COMPLETE adoption, history
  included).
- **Undo is available immediately** after committed success — no timer.
- **A transition beginning immediately** after committed success finds
  history complete and persistence scheduled; the transition coordinator's
  `beforeInstall` flush makes it durable before the replacement installs.

## The duplicate-entry guard

The primitive marks the page's existing applying-history guard
(`applyingHistoryRef.current = true` — the same flag hydration/undo/redo
have always used). The design-state watcher fires after the React commit,
sees the flag, clears it, schedules autosave, and records NOTHING — the
synchronous canonical entry stays the only one. Gesture PREVIEW activity
keeps its non-authoritative debounced path; ordinary canonical commands and
gesture commits keep their one-entry-per-adoption behavior (the entry is
simply guaranteed at return instead of 350 ms later).

## Evidence

`b12-2-synchronous-adoption.test.ts` — the entry exists before the
committed promise settles and before `committed-verified` (event-order
instrumented); immediate undo (no timer advance) restores the exact
pre-apply digest and reconciles the durable lineage; a faithful watcher
simulation (suppression flag + 350 ms debounce under fake timers) records
no duplicate; an immediate transition persists the committed projection;
adoption failure after a durable commit poisons the identity and refuses
retries; ordinary commands and gestures retain their behavior. The B07.1 E5
structural gate now pins the new responsibilities (canonical applier calls
the shared primitive, records via the real history port, suppresses the
watcher, throws on failure; the lifecycle applier never records).
