# B12.2 — pre-edit counterexamples (R1–R3)

All three reproductions were run against **production code, before any B12.2
edit**, through a transient probe
(`app/lib/engineering/__tests__/_tmp-b122-repro.test.ts`, deleted after
capture). R1 and R3 replicate the exact `page.tsx` algorithms verbatim
(source lines quoted below) over the real `ProjectCommitInterlock`,
`SchematicEditorSession`, `SchematicGestureCoordinator`, `SchematicHistory`,
delayed `AtomicProjectStore`, and the real B12.1 service; R2 uses one shared
registry exactly as the production singleton is shared. Outputs verbatim.

---

## R1 — reentrant transition bypass

The page.tsx transition mechanism under test (B12.1, lines 2933–2940 / 2974
/ 3049): a mutable `commitInterlockRef` that is **nulled at deferral time**,
plus a recursive re-entry through the ambient `hydrateProjectRef`:

```tsx
const priorInterlock = commitInterlockRef.current;
commitInterlockRef.current = null;
if (priorInterlock && priorInterlock.busy) {
  void priorInterlock.retire().then(() => hydrateProjectRef.current!(record, opts));
  return;
}
```

Project A holds a real approved commit/adoption lease (service apply blocked
inside a delayed durable-store commit). Transition A → B is requested, then
— before the lease releases — transition A → C:

```json
B122_R1_START{
 "event sequence": [
  "deferred:B",
  "hydrate:A->C",
  "hydrate:C->B"
 ],
 "final project": "B",
 "interlock reachable during retirement-pending window": "NULL (a new Apply proceeds with NO interlock)",
 "A disposed while its approved lease was still held": true,
 "in-flight apply outcome after A's disposal": "refused:postcondition-failed",
 "retired A durable store head (0 untouched / 1 ADVANCED)": 1
}B122_R1_END
```

Exactly the stated counterexample:

1. **The second request bypasses the retiring interlock.** `hydrate:A->C`
   ran immediately because the deferral had already nulled
   `commitInterlockRef` — the A→C request found no interlock at all.
2. **A is disposed while its lease is held** (`lifecycle: "unavailable"`
   with `interlockA.busy === true`) — the in-flight approved commit then
   lands on the retired store (head 1) while the caller is refused
   (`postcondition-failed`), recreating the R4 lie B12.1 claimed closed.
3. **Stale deferred B overwrites the newer C** (`hydrate:C->B`; final
   project **B** though **C** was the most recent request).
4. **The null-interlock window** means a NEW Apply issued during retirement
   pending is passed `{}` (no interlock) and proceeds without any lease
   refusal.

**Architectural cause.** The B12.1 deferral is not a serialized transition
coordinator: it has no monotonic request identity (no latest-wins), it makes
the retiring interlock unreachable the moment deferral begins, and its
deferred continuation re-enters `hydrateProject` through an ambient mutable
ref with no staleness check — so it happily "retires" whatever project is
current by then. B12.1's own tests only exercised ONE transition at a time.

## R2 — foreign consumed replay

One registry (as the production `approvedMutationRegistry` singleton is one
object across every project the page ever opens). A project-A proposal is
applied and consumed; the exact intact artifact is then invoked from a
**live project-B composition** (ready session, `currentProjectId: "proj-B"`):

```json
B122_R2_START{
 "invoked from": "LIVE project-B session (ready), currentProjectId proj-B",
 "replay ok": true,
 "replay status": "already-applied",
 "receipt exposed to project B": {
  "projectId": "proj-A",
  "receiptId": "amr-db8a69ae7b141d8b…"
 },
 "receipt.projectId": "proj-A"
}B122_R2_END
```

Project B received `ok: true / already-applied` **carrying project A's
receipt**.

**Architectural cause.** The §C ordering authenticates the ARTIFACT before
the one-shot lookup, but the consumed branch returns its receipt without
ever verifying the CURRENT authority: current scope/head verification
(step 5) runs only at execution position, which a consumed hit
short-circuits. B12.1's replacement-containment test handed the replacement
a **fresh registry**, masking exactly this. The sealed scope inside the
artifact matches the receipt — but nothing checked it against the live
session actually asking.

## R3 — production history finalization gap

The page.tsx adoption mechanism under test (applyCanonicalSchematicProjection,
lines 2745–2759, plus the design-state watcher, lines 3077–3107): the
applier only sets React state and `historyLabelRef`; the REAL
`SchematicHistory.record` runs in a **debounced 350 ms timer**. Replicated
verbatim with fake timers under the real coordinator + service:

```json
B122_R3_START{
 "service returned committed + receipt consumed": true,
 "SchematicHistory entries AT receipt consumption": 1,
 "canUndo AT receipt consumption": false,
 "SchematicHistory entries after 350ms debounce": 2,
 "conclusion": "receipt finalization PRECEDES the real history entry"
}B122_R3_END
```

At the moment the service returned `committed`, consumed the receipt, and
released the lease, the production history still had only its "Opened
project" entry and `canUndo: false`. The entry the receipt's postconditions
claim ("exactly one real SchematicHistory entry") did not exist until
350 ms later — a window in which immediate undo is unavailable and an
immediate project transition would find history/persistence incomplete.

**Architectural cause.** The service trusts the coordinator-host contract
("adoption records ONE history entry"), but the page's host implementation
only SCHEDULES the entry. B12.1's tests substituted a synchronous
"production-shaped" host instead of the page's actual mechanism — the
substitution hid the gap.

---

## Closures (implemented by B12.2)

| # | Closure |
| --- | --- |
| R1 | §A — hook-free `ProjectTransitionCoordinator` imported by page.tsx: monotonic request identity, latest-target-wins, one retirement per incarnation, the retiring interlock reachable until retirement completes (never a null window), stale continuations inert, no dispose while a lease is held |
| R2 | §B — before a consumed receipt is returned, the LIVE session's `scopeIdentity()` (tenant/project/branch/lineage/lifecycle) and the current scope token must match the sealed scope; foreign/retired/stale invocations refuse without exposing the receipt |
| R3 | §C — one shared synchronous canonical-adoption primitive (`adoptCanonicalResult`) used by page.tsx and tests: the authoritative projection and exactly one real history entry exist BEFORE the coordinator job returns, hence before receipt consumption and lease release; the debounce watcher is suppressed from double-recording |
