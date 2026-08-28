# B14 §G — the review UI and human approval

## The distinct surface

[ReplacementReviewDialog.tsx](../../app/components/schematic/ReplacementReviewDialog.tsx)
— separate from the Tier-1 review dialog. It displays: component reference +
stable id, current exact part, proposed exact part + manufacturer,
source/target atomic revisions, mapping mode + certificate (+ mapping
evidence), preserved-connection count with the explicit "0 dropped" rule,
wire endpoint and net-label move counts, downstream invalidations,
warnings, authority freshness note, proposal expiry, and the plain statement
that NOTHING has changed yet.

Buttons: `Apply exact replacement` and `Cancel — change nothing`.

- Apply exists ONLY on this trusted interactive surface; it requires an
  explicit click (proven: rendering never invokes it), disables during
  execution (busy state; clicking the disabled button does nothing), and
  surfaces structured refusal/recovery outcomes as toasts.
- Approval is NEVER inferred from provider text or from the proposal's
  existence; the provider's tool-result note explicitly instructs the model
  never to claim the edit happened.
- Cancel, dismissal, chat close, timeout, project switch, reload, or
  proposal replacement mutate nothing (cancel is a pure state clear +
  audit event; the apply path itself refuses on switch/retirement).

## Page wiring (page.tsx)

- `pendingReplacement` state receives ONLY the discriminated
  `proposal_ready` union member with the replacement schema; the Tier-1 path
  is untouched.
- `applyReplacementProposal` mirrors the B12 apply discipline exactly: scope
  captured BEFORE async work, the interlock from the transition coordinator,
  the durable journal scoped to the CAPTURED project, `stillCurrent` from
  the scope registry, outcomes applied only `ifCurrent` — and passes the
  private trusted reauthorization adapter
  (`createReplacementReauthorization`) that only this handler constructs.
- The verified receipt renders as a distinct confirmation card
  (source → target, transaction id, undoable).

Tests: b14-replacement-review (render/click/busy behavior + a supplementary
page source tripwire); the service-level approval-channel guarantees live in
b14-replacement-apply.
