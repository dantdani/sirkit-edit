# B15.3 §I — human review and safety contract

## The distinct review surface, inside PcbEditor

`PcbProposalReviewDialog.tsx` is mounted inside `PcbEditor` — the owner of
the live board and PCB history. Canonical PCB mutation authority is NOT
lifted into the chat page or the agent layer: the page only narrows the
event (safe discriminator) and hands the display-only proposal to the editor
via the `pcbProposalIntake` prop; the editor owns the approval controller
call.

## Complete evidence shown

Scope (project/branch/board-instance); proposal identity + expiry; base
revision, board digest, history head (+ label), lineage; provider/model
provenance (runId truncated, no secrets); the complete operation list with
human-readable summaries; affected changed objects, nets, layers; rule
changes; DRC before/after error+warning counts and the exact new/resolved
violation identifiers; connectivity before/after (routed/total/unrouted/
shorts); routing-completion before/after + delta; warnings; candidate digest
+ impact-certificate identity.

## Mandated limitation statements (source-gated)

Two statements are always rendered and a source gate (`b15-3-import-gates.ts`
§K16) asserts their presence and the ABSENCE of any prohibited claim:

- "**Manufacturing readiness is unavailable** for this proposal: …"
- "DRC and connectivity results above are **engineering evidence only — they
  are NOT a guarantee of safety or manufacturability**."

The dialog NEVER renders "safe", "ready", "manufacturable", or "production
ready" (regex-checked in the source gate — the doc comment was reworded so
it does not itself contain the banned phrases).

## Exactly two actions

`Approve and apply PCB edits` and `Cancel`. The dialog explains that
approval produces one atomic PCB transaction. There is NO force-apply
bypass.

## Approval disabled with a precise visible reason

`pcbProposalDisableReason` (a `useMemo` in `PcbEditor`) returns null (enabled)
or the EXACT reason, re-evaluated against LIVE editor state (and re-ticked
for expiry every 5s). Disable conditions: verification fails; expired;
demo/no durable scope; foreign project/branch/board-instance; interlock
retiring; session still loading (revalidation not complete); live revision
≠ base; canonical session cannot prove the current board is its head;
history head advanced; lineage changed; active DRC preset ≠ sealed policy;
an apply already in progress. The Approve button is truly `disabled`
(`disabled={busy || disableReason !== null}`), not merely styled.

Every one of these is ALSO re-checked at the serialized apply position by
the service — the UI gate is a courtesy, never the security boundary.

## Retirement of a pending proposal

Closing, cancelling, stream abort, project/branch switch (page-level
`resetTransientProjectState` clears `pendingPcbProposal`), and editor
lifecycle adoption/retirement (a `lifecycleGeneration` change while a
proposal is pending calls `onPcbProposalSettled("retired")`) all retire the
pending proposal. There is no persistent capability to leak: the one-shot
intent exists ONLY inside a single `approveAndApplyPcbEdit` call, minted on
the click and retired in its `finally`.
