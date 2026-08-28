# B14.1 §A — the one-shot interactive approval capability

> **SUPERSEDED IN PART by B14.2**: the walker below protected only the
> approval-intent module — the authority-bearing CONTROLLER wrapper
> (`approveAndApplyReplacement`) remained publicly importable. B14.2 makes
> the controller an internal composition-boundary module with its own
> permanent walker (importers: page.tsx only), splits safe proposal-event
> discrimination into a separate module, gates the reauthorization channel
> module and test factory, and adds a synthetic-injection negative tripwire.
> Historical text below is preserved unmodified.


## The defect (R1)

`applyApprovedReplacementProposal` accepted no approval capability: a direct
service call committed, and the receipt stamped
`approvalActor: "human:interactive"` as an unconditional constant.

## The capability

[replacement-approval.internal.ts](../../app/lib/engineering/replacement-approval.internal.ts)
— `ReplacementApprovalIntent`: private constructor + module-scoped
`static {}` factory (never exported), frozen instances, `toJSON()` collapses
to an inert string, module-private registry. Authority = registry membership
+ class identity — never booleans, strings, actorKind, provenance fields,
React state, `Event.isTrusted`, or caller-supplied callbacks.

Bindings sealed into every intent: `proposalId`, tenant/project/branch,
lineage + head mark (the reviewed artifact's), `issuedAt`, and a 2-minute
expiry.

Lifecycle:

- ISSUED only by the trusted approval controller
  ([replacement-approval-controller.ts](../../app/lib/project/replacement-approval-controller.ts))
  when the human activates Apply in the review dialog;
- CONSUMED exactly once at the top of the apply service — the registration
  is BURNED ON ANY TENDER before validation, so replay after success, replay
  after a refusal, and duplicate tenders all grant nothing;
- RETIRED on every terminal path (consumption burns it; the controller's
  `finally` retires an un-tendered intent; cancel paths hold no intent
  because issuance happens at activation).

Refusal classification (`approval-required`, with precise internal codes):
missing, forged (structural/serialized/boolean/string), replayed,
wrong-proposal, wrong-scope, stale-head, expired — all proven to refuse
BEFORE any journal or canonical work (zero journal entries, zero
transactions).

`approvalActor: "human:interactive"` is now written ONLY on paths that
consumed a valid intent — the service refuses before any work without one.

## Import boundary (permanent walker)

Approved production importers: the internal module itself, the
approved-replacement service (consume), and the approval controller
(issue/retire). The engineering barrel exports nothing from it; API routes,
the agent gateway, provider adapters, and the tool registry cannot reach it
— so provider/model code can neither acquire nor invoke the capability. The
B03 interactive-channel import boundary is untouched.
