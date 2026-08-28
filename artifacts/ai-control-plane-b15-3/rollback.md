# B15.3 — rollback

B15.3 is purely additive over the accepted B15.2.3 core plus a set of
narrowly-scoped seams. To revert exposure without touching the sealed core:

## Minimal un-exposure (keep the core, hide the tool)

1. In `app/lib/engineering/tool-catalog.ts`, set the
   `sirkit.pcb.propose-bounded-edit` descriptor's `agentExposed: false` (or
   delete the descriptor entirely).
2. Revert the exposure pins 12→11 (the `b04`, `b09-*`, `b11-*`,
   `b12-boundary-and-e2e` tests, and the two B15.2 supersession assertions).
3. Regenerate the four artifact families
   (`generate-action-toolability-matrix`, `generate-tool-registry-artifacts`,
   `generate-agent-artifacts`, `generate-b11-artifacts`).

The loop/gateway PCB branches become dead code (never reached without an
exposed discoverable tool); the review/apply path becomes unreachable
(no `pcb_proposal_ready` is ever emitted). No board is ever mutated.

## Full revert

Delete the seven new production modules, the five new test suites, and
revert the listed production edits (all additive: the `pcbProposalBasis`
context field, the `pcb_proposal_ready`/`pcb-proposal` union members, the
`provenanceCandidateId` passthrough, the `pcb.bounded-edit-apply` executor
binding, the two action records, and the PcbEditor/page wiring). The
validation-policy field on `SealedPcbEditProposal` (the item-10 closure) can
be kept or reverted independently — reverting it restores the pre-exposure
"policy unpinned" behavior and would re-open the item-10 gap, so it should
stay if any PCB proposal is ever exposed again.

## Safety of a partial state

If any authority/durability/human-review invariant could not be proven, the
correct partial state is the tool UNEXPOSED at 11 — the entire apply path is
unreachable without an exposed tool, so leaving the descriptor's
`agentExposed: false` is a complete, safe stopping point with zero mutation
risk. No partially-secured proposal/apply path is ever left exposed.
