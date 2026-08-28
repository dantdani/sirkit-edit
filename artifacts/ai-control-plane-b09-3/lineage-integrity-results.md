# Section A — lineage sealed into context integrity

## Defect (R1)

`verifyAgentContextIntegrity` compared actor identity, role, capabilities,
project/branch scope, and the revision anchor — but NOT lineage. A context
whose `discovery.lineageId` was replaced with a foreign well-formed lineage
passed integrity with zero issues and executed canonical reads.

## Production changes

### `app/lib/agent/context.ts`

- The context's claimed head mark is `effectiveHeadMark` — the shape-valid
  mark IF a validated schematic exists, else null.
- `discovery.lineageId = effectiveHeadMark?.lineageId ?? ""` — the
  application-owned discovery context carries the validated mark's lineage;
  without a validated mark the lineage anchor stays empty. It is never
  minted from any other digest domain.

### `app/lib/agent/gateway.ts` — `verifyAgentContextIntegrity`

- The stored head mark is REVALIDATED inside the boundary via
  `validateSchematicCanonicalMark` — an object is never assumed to have
  stayed valid because it passed assembly earlier; a present-but-malformed
  mark is itself an integrity failure.
- Expected lineage = revalidated mark's lineage, else `""`; ANY disagreement
  with `discovery.lineageId` refuses. This covers all four divergence
  shapes: head mark + empty discovery lineage; foreign discovery lineage;
  discovery lineage without a head mark; mutated/malformed mark.
- Digest domains stay separate: the revision anchor still derives only from
  the canonical project revision / schematic-state digest (assembly rule);
  the lineage anchor only from the mark. The session head digest
  (`headMark.canonicalStateDigest`) is never equated with either.
- The check runs FIRST in `gateway.invoke` (reads, proposals, and every
  direct invocation) and again in `ProposalInvocationService.invoke` —
  broken lineage integrity fails before any execution.

### `app/lib/engineering/tool-catalog.ts`

`sirkit.schematic.propose-tier1-edit` now declares `requiresLineage: true`
(alongside its existing `requiresExpectedRevision: true`) — an accurate
registration of the head-sealed proposal contract (the mark's lineageId
participates in the sealed identity digest). Discovery consequently
excludes the proposal with `lineage_required` when no lineage anchor is
open, and `revision_required` when no revision anchor exists.

## Test results (`b09-3-closure.test.ts` §A — all pass)

| Case | Result |
| --- | --- |
| Valid assembled lineage | discovery carries the mark's lineage; integrity `[]`; gateway read succeeds |
| Foreign discovery lineage (R1) | integrity names the lineage divergence; read, schematic.inspect, AND proposal all refuse `context_integrity` |
| Head mark + empty discovery lineage | refuses |
| Discovery lineage without a head mark | refuses |
| Post-assembly mark tampering (bad format, negative sequence, extra key, non-object) | "malformed" integrity issue + `context_integrity` refusal |
| Proposal discovery gating | descriptor `requiresLineage`/`requiresExpectedRevision` both true; excluded `lineage_required` without a mark, `revision_required` without any revision anchor |
| Consistent non-main branch (`release-c`) | proposal seals with the captured branch and lineage |

Fallout: `b09-proposals.test.ts` 33b now asserts the honest shapes — a run
ASSEMBLED without a mark refuses `not_discoverable` (`lineage_required`),
while STRIPPING the mark from an assembled context refuses
`context_integrity` (post-assembly tampering).
