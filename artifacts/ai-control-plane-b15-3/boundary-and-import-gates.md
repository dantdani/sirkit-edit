# B15.3 — boundary and import gates

Built on the proven B14.4/B14.5 AST engine (`_import-gate-helpers`:
TypeScript-parser extraction, resolved specifiers, fail-closed opaque loads,
whole-root production walk). Suite: `b15-3-import-gates.test.ts` (8).

## Approved importer sets (closed)

- **Approval controller** `pcb-edit-approval-controller.internal.ts` —
  importable ONLY by itself + `app/components/pcb/PcbEditor.tsx` (the PCB
  composition root). No API route, agent module, gateway, or other UI.
- **One-shot intent** `pcb-edit-approval.internal.ts` — importable ONLY by
  itself, the apply service, and the controller.
- **Apply service** `approved-pcb-mutations.ts` — importable ONLY by itself
  and the controller.

## Negative tripwires (all green)

Injecting `app/api/evil/route.ts` importing the controller,
`app/lib/agent/evil.ts` importing the apply service, and
`app/components/EvilPanel.tsx` importing the one-shot intent are EACH
flagged as offenders — proving an API route, an agent module, and an
arbitrary component cannot gain approval or commit authority.

## commitPcbCandidate unreachable from provider/route/gateway/loop

An independent walk asserts NO importer of `pcb-commit-gateway` lives under
`app/api/`, `app/lib/agent/`, or any `*provider*` path (the real importers
are all in-editor PCB surfaces). A negative tripwire injecting
`app/lib/agent/evil-commit.ts` importing `commitPcbCandidate` is detected.

## Raw-sealer allowlist did NOT grow

The B15.2.2 §C standing assertion (raw sealer importable by exactly the two
existing modules; the future handler must use `createSealedPcbEditProposal`
only) still holds: `b15-2-2-exact-outline-and-shape.test.ts` §C is green
after B15.3, and a source check confirms `pcb-propose-tool-handler.ts`
imports `createSealedPcbEditProposal` and contains neither
`pcb-edit-proposal-sealer.internal` nor `rawSealPcbEditProposal`.

## The apply command is kernel-bound to the bounded vocabulary

`pcb.bounded-edit-apply` is registered in `KERNEL_OPERATION_BINDINGS` with
EXACTLY the operation kinds a bounded proposal can produce
(move_footprint, add/update_track, add/update_via,
update_routing_preferences, update_net_classing,
add/update/remove_dimension, add/update_keepout) — no deletions of copper,
no zones/text/silk/padstack/outline/stackup. A recompiled candidate whose
delta touches any other kind is rejected by the executor
(`operation_mismatch`), a defence-in-depth layer beneath the bounded
compiler's own excluded-intent list.
