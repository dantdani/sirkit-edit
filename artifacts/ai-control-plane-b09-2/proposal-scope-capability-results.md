# Section E — proposal scope + capability closure

> **SUPERSESSION NOTE (B09.3).** The "full actor/discovery integrity" claim below was OVERSTATED: `verifyAgentContextIntegrity` did not cover LINEAGE — a foreign discovery.lineageId passed integrity and executed reads. B09.3 seals lineage into the integrity boundary (with in-boundary head-mark revalidation) and marks the proposal descriptor requiresLineage. See artifacts/ai-control-plane-b09-3/lineage-integrity-results.md.

## Defects

1. `isWellFormedProposalScope` had its own WEAKER mark shape check: marks the
   canonical validator (`validateSchematicCanonicalMark`) refuses were
   accepted at the proposal boundary (R6).
2. Proposal capability was checked against DISCOVERY grants, not the
   effective actor; a capability-stripped actor with intact discovery still
   sealed proposals, and actor/discovery divergence was undetected (R7).
3. An apply-path scope hardcoded `branchId: "main"` instead of the captured
   `ProjectAsyncScope` branch.

## Production changes

- `app/lib/engineering/schematic-proposals.ts`:
  `isWellFormedProposalScope` = exact scope keys
  (`tenantId, projectId, branchId, headMark`) + strict id pattern
  (`/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/`) + delegation to
  `validateSchematicCanonicalMark` (exact mark keys, `lin1-`/`eng1-` hex
  formats, nonnegative safe-integer sequence). No second mark validator
  exists anywhere.
- `app/lib/agent/gateway.ts`:
  - `verifyAgentContextIntegrity(context)` compares actor id, role, sorted
    capability SET, tenant/project/branch, and the revision anchor between
    the effective actor and discovery; any divergence refuses
    `context_integrity` — for READS and PROPOSALS alike (checked first in
    `invoke`).
  - `ProposalInvocationService` additionally verifies the EFFECTIVE actor
    holds the required capability (missing → `unauthorized`).
  - `AGENT_PROPOSAL_TOOL_VERSION = "1.1.0"` — the V2 scope-sealed contract is
    a visible version bump (catalog descriptor updated with versionNotes).
- `app/page.tsx`: the apply path builds `expectedScope` from the captured
  scope — `branchId: scope.branchId` (never hardcoded "main") — with the
  current session head mark; the seal path likewise uses the scope branch.

## Test results (`b09-2-closure.test.ts` §E)

- Every mark refused by the canonical validator (bad formats, negative
  sequence, `2^53` unsafe sequence, extra mark key) is refused by the scope
  validator; an extra SCOPE key ("role") refuses; the exact valid shape
  passes (R6).
- A capability-stripped effective actor refuses proposal creation (R7).
- Divergence matrix — forged actor id, elevated role, injected discovery
  capability, foreign project, forged revision anchor — every gateway
  invocation refuses `context_integrity`; a consistent context reports zero
  integrity issues.
- A NON-"main" branch (`release-b`) seals successfully with the branch
  carried in the sealed scope and real provider provenance (`anthropic`) —
  proving no hardcoded branch survives.
- Strict schemas refuse authority-shaped argument injection (asserted in the
  B09.1 loop-safety suite, same battery).
