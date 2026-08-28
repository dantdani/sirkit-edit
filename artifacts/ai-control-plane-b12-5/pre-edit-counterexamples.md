# B12.5 — pre-edit counterexamples (verbatim)

All four reproduced against PRODUCTION code before any B12.5 edit, with a
disposable probe (`app/lib/engineering/__tests__/__b125probe__.test.ts`,
deleted after capture). Probe run: `npx vitest run … — 4 passed (4)`.

## R1 — production `saveIf` loses a write

Two `BrowserLocalStorageApprovedMutationJournalStore` instances over one
shared localStorage; the stored journal document seeded at `version: 0`.
The probe forces the legal cross-context interleaving
read(A) → read(B) → write(B) → write(A) by running writer B's complete
synchronous `saveIf` body at the moment writer A's read returns (writer A
resumes with its already-taken read — exactly what two tabs in separate
OS processes can do, because localStorage guarantees no cross-context
atomicity for a read-check-write sequence; modern browsers do not
implement the storage mutex).

```
R1 OBSERVED: {"a":true,"b":true,"bothClaimedSuccess":true,"lostWriter":"B"}
```

Writer B stored its version-1 document; writer A then stored a DIFFERENT
version-1 document from its earlier version-0 read. **Both `saveIf` calls
returned true; only A's write remains.** This disproves the module's
comment that synchronous localStorage read-check-write supplies
cross-context CAS ("atomic per event-loop turn") — atomic per turn is not
atomic per SHARED STORE. The journal's monotonic entry transitions cannot
prevent this lost update: the two writers carried different-identity
entries, so no transition rule ever compared them.

## R2 — pointer failure reports installed

Real `current.ts` functions + real `ProjectTransitionCoordinator`; project
A successfully installed; `localStorage.setItem("sirkit:currentProjectId", …)`
configured to throw; project B installed with the CURRENT page ordering
(update visible state, then call `markProjectCurrent(B)` — return ignored,
as `installProject`'s last line does).

```
R2 OBSERVED: {"markProjectCurrentReturned":false,"returnIgnored":true,"coordinatorOutcome":"installed","visibleProject":"B","persistedCurrent":"A"}
```

`markProjectCurrent` returned `false`; the return was ignored; the
coordinator reported **installed**; the visible project is **B** while the
persisted current project remains **A** — a reload opens A over live work
in B.

## R3 — failed-outcome reentry abandons a live leased interlock

Real `ProjectTransitionCoordinator`: A installed; B's `beforeInstall`
fails; INSIDE B's `transition-failed` outcome callback the probe acquires
a commit lease from the newly reactivated survivor interlock and then
requests C.

```
R3 OBSERVED: {"events":["A","C"],"transitionPending":false,"reactivatedLeaseHeld":true,"currentInterlockBusy":false}
```

C installed IMMEDIATELY (`events: ["A","C"]`) while the acquired lease
remains held on a DIFFERENT, abandoned interlock
(`reactivatedLeaseHeld: true`, `currentInterlockBusy: false`): the
completion loop overwrote `live` with C's fresh incarnation without ever
retiring the reactivated survivor interlock or waiting for its barrier.
The lease-holder believes it is blocking retirement; nothing it protects
is protected.

## R4 — scope-key collision

Production browser journal store: save scope
`{tenantId:"local", projectId:"a:b", branchId:"c"}`, then load scope
`{tenantId:"local", projectId:"a", branchId:"b:c"}` — both valid under the
journal's own `SCOPE_ID` pattern (`:` is an allowed character).

```
R4 OBSERVED: {"storedKeys":["sirkit.approved-mutation-journal.v1:local:a:b:c"],"secondScopeReadsFirstScopesJournal":true,"readOwner":"scope-one"}
```

Both scopes resolve to the SAME storage key
`sirkit.approved-mutation-journal.v1:local:a:b:c`; the second scope reads
(and would overwrite) the first scope's journal. Delimiter-joined tuples
are not injective when the delimiter is a legal scope character.
