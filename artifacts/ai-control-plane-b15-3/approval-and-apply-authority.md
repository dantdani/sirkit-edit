# B15.3 §J — authentic approval, atomic apply, why the AI can never mutate

## Why the AI still cannot directly mutate the PCB

The AI can produce ONE thing: a sealed, display-only `pcb_proposal_ready`
artifact. Sealing runs against an isolated `structuredClone` candidate and
writes nothing. The artifact is an INTEGRITY-checksummed record, never an
authority to mutate. The only path from artifact to canonical board runs
through `commitPcbCandidate`, and:

- no provider/route/gateway/loop module imports `commitPcbCandidate` (AST
  gate + independent grep, §K42);
- the apply service and its one-shot capability are import-gated to the
  approval controller, which is import-gated to itself + `PcbEditor.tsx`
  only — an agent module, API route, gateway, or arbitrary component that
  imports any of them trips the gate (negative tripwires prove it);
- the capability is a branded frozen class that only a real human UI click
  inside `PcbEditor` can mint.

So even a perfectly-formed sealed proposal is inert until a human clicks
Approve in the review dialog `PcbEditor` owns.

## How human approval is authenticated and consumed

`pcb-edit-approval.internal.ts` — `PcbEditApprovalIntent`:
- BRANDED frozen class, private constructor, `static {}`-scoped `make`
  factory: structural copies, `JSON.parse(JSON.stringify(...))` round trips,
  and provider-supplied objects can never be `instanceof` it;
- a module-private `Map` registry (never exported); minted ONLY by
  `issuePcbEditApprovalIntent`, called ONLY by the controller behind the
  dialog's explicit Approve click;
- binds the COMPLETE approval basis: the sealed-proposal-body digest
  (`pcbProposalIdentityKey` over the whole verified body), proposal id,
  tenant/project/branch/board-instance, canonical resource id+digest, base
  PCB revision + board digest, history head sequence + lineage, the sealed
  validation-policy identity, expiry, and the human approval action id;
- `toJSON` is inert (`"[pcb-edit-approval-intent]"`) — it can never
  serialize into provider-visible state.

`consumePcbEditApprovalIntent` is ONE-SHOT: it deletes the registry entry on
ANY tender BEFORE validating, so a valid, forged, or replayed tender all
spend the shot. It is consumed FIRST in the apply service — before any
journal or canonical work — so a bad approval refuses with zero journal
entries and zero transactions. The `approvalActor: "human:interactive"` on
the receipt is EARNED by consumption, never stamped.

## Exact live-state checks before commit

`applyApprovedPcbProposal` (approved-pcb-mutations.ts), in order:

1. **Capture + authenticate** the seal (bounded JSON round-trip, exact
   closed key set, `verifySealedPcbEditProposalIntegrity`).
2. **Expiry** (`isPcbEditProposalExpired`).
3. **Consume the one-shot human approval** (before any journal/canonical
   work).
4. **Live authority** — `stillCurrent()`, `!interlock.retired`, and exact
   scope (tenant/project/branch/board-instance via `pcbBoardInstanceId`).
5. Canonical session present.
6. In-memory identity **claim** (double-click / concurrency).
7. Durable **journal lookup** + **canonical durable evidence**
   (`durableIdempotencyEvidence` — validates the FULL persistence-envelope
   integrity chain); replay/recovery dispositions resolve here.
8. **LIVE currency** — live `pcbRevisionId` === base revision AND === board
   digest; head sequence === base head; lineage === base lineage; active
   DRC preset === sealed preset; sealed policy still matches the registry.
9. Commit **lease** at the serialized position.
10. **RECOMPILE** the sealed operations through the canonical B15 compiler
    against the LIVE board, and **BYTE-MATCH** operations/candidate/impact
    digests AND minted ids — a checksum-consistent forgery whose pins do not
    reproduce from a fresh live recompile refuses (`recompile-mismatch`).
11. Durable **journal.prepare** BEFORE the canonical commit.
12. **Exactly ONE `commitPcbCandidate`** (idempotencyKey = proposalId; the
    chain-protected receipt commitment rides `provenance.candidateId`; the
    serialized `buildCandidate` re-pins the exact base revision and THROWS
    if the board moved — an interleaved commit refuses with zero mutation).
13. **Postconditions** on the live result (revision === candidate digest;
    head advanced by exactly 1; lineage unchanged).
14–16. journal **committed → adopted → receipt → finalized**; registry
    **consume**.
17. **Autosave settlement** before final success is reported.

## Proof of one transaction and exact undo/redo

`b15-3-approved-pcb-apply.test.ts` (18) + `b15-3-production-integration.test.tsx`
(2): the happy path commits ONE canonical transaction = ONE PcbHistory
entry; `undo` restores the previous board by exact semantic revision, `redo`
restores the sealed candidate. Double-click and concurrent
`Promise.all([apply, apply])` create exactly one entry (the second returns
the receipt / refuses `already-in-flight`). A fresh-registry replay after
completion re-executes nothing (durable journal + canonical evidence prove
the commit). Every currency/integrity refusal (stale revision, foreign
scope, head/lineage/policy mismatch, altered body/impact, expired,
recompile mismatch) leaves the history entry count unchanged.
