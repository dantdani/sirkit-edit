# B14 — verified component-replacement proposal → human approval → one canonical transaction

Sirkit's first agent-assisted exact component replacement, built ON the
existing control plane (B06 replacement planning, B09 proposal loop, B12
approved-mutation execution, B13 component authority) — no parallel mutation
path exists.

## The pipeline

1. **Propose** — the ELEVENTH agent-exposed tool
   `sirkit.schematic.propose-component-replacement` (propose-class,
   proposal-artifact side effects; input `{componentId, expectedMpn?}` —
   intent only, never authority). The server assembler derives the target
   EXCLUSIVELY from the B13 `exactAuthority` block, resolves published
   current/target pin facts through B13.2 cancellable reads, consumes
   replacement authority against a deterministic sealed bundle, plans through
   the ONE existing `planSchematicReplacement`, and seals
   `sirkit.schematic-replacement-proposal.v1`. Receiving/displaying it
   mutates NOTHING; every out-of-scope replacement is a structured blocker —
   [replacement-tool-contract.md](replacement-tool-contract.md),
   [current-and-target-pin-authority.md](current-and-target-pin-authority.md),
   [sealed-replacement-proposal-schema.md](sealed-replacement-proposal-schema.md).
2. **Review** — a distinct human review surface
   (`ReplacementReviewDialog`) shows the complete reviewed identity/impact
   and requires an EXPLICIT `Apply exact replacement` click —
   [review-ui-and-human-approval.md](review-ui-and-human-approval.md).
3. **Approve & execute** — `applyApprovedReplacementProposal` (the B12
   sibling sharing the same registry/journal/interlock/gateway/adoption
   primitives): capture+authenticate → live authority → one-shot claim →
   durable journal/idempotency evidence → currency at the serialized head →
   FRESH server authority via the read-only reauthorization endpoint →
   deterministic plan RECOMPILE with operation/impact digest BYTE-MATCH →
   fresh runtime grant (retired on every terminal path) → journal.prepare →
   exactly ONE canonical `schematic.replace-component` transaction →
   replacement postconditions → adoption → receipt →
   `sirkit.approved-replacement-receipt.v1` —
   [authority-reauthorization-boundary.md](authority-reauthorization-boundary.md),
   [approved-replacement-execution.md](approved-replacement-execution.md),
   [replacement-receipt-and-journal.md](replacement-receipt-and-journal.md),
   [replacement-impact-and-postconditions.md](replacement-impact-and-postconditions.md),
   [concurrency-recovery-and-idempotency.md](concurrency-recovery-and-idempotency.md).

No provider, model, browser request field, catalog candidate,
permitted-alternative string, or serialized fake grant can choose installed
identities — [pre-edit-counterexamples.md](pre-edit-counterexamples.md)
records R1–R12.

Exposure/discovery/trace/replay: eleven statically exposed tools; pins
regenerated through generators —
[provider-discovery-trace-and-replay.md](provider-discovery-trace-and-replay.md),
[artifact-and-pin-stability.md](artifact-and-pin-stability.md).

Evidence: [regression-evidence.md](regression-evidence.md) ·
[final-verdict.md](final-verdict.md)
