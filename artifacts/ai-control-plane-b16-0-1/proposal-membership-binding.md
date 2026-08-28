# B16.0.1 §E — membership-bound proposals and approvals (R4 closure, part 1)

## The closed authorization binding

Every EXPOSED sealed-proposal family now seals a closed authorization binding
inside its whole-body identity digest:

| field | meaning |
|---|---|
| `authorizationSchema` | the binding's own version (`sirkit.schematic-proposal-authorization.v1` for the two schematic families; `sirkit.pcb-proposal-authorization.v1` for the PCB family) |
| `principalId` | the VERIFIED principal — always equals the server-derived effective actor |
| `membershipRevision` | the `mbr1-…` revision the principal's role was resolved at |
| `tenantId`/`projectId`/`branchId` | must AGREE with the proposal scope (validated at seal AND verify) |
| `requiredApplyRole` | one of the closed apply roles (`pcb_editor`/`project_admin`) |

Sources of truth: the agent gateway derives it from the §D verified run actor;
the interactive page derives it from the session identity module
(`session-identity.ts`); the provider can NEITHER supply NOR alter it — every
provider argument surface is closed-key and refuses authorization-shaped
arguments by name (test-pinned for the PCB handler; the schematic tool
accepts only its documented op arguments).

## Explicit schema versioning (exposed contracts are never silently mutated)

| family | old (legacy) | new | legacy application refusal |
|---|---|---|---|
| schematic tier-1 | `…tier1-proposal.v2` (v1 already dead) | `…tier1-proposal.v3` | `legacy-authorization-missing` (v1 stays `wrong-version`) |
| component replacement | `…replacement-proposal.v1` | `…replacement-proposal.v2` | `legacy-authorization-missing` |
| bounded PCB edit | `…pcb-bounded-edit-proposal.v1` | `…pcb-bounded-edit-proposal.v2` | `legacy-authorization-missing` |

Identity-digest schemas advanced in lockstep (`…-id.v3` / `…-id.v2` /
`…-id.v2`); membership authority is never guessed or backfilled into an old
artifact — regeneration is the only path. Provider-neutral descriptors and
replay pins were updated through the repo's own sanctioned generators
(`scripts/generate-b11-artifacts.ts` — only the e10 proposal-trace pin and its
derived digests changed; `scripts/generate-action-toolability-matrix.ts`).
Tool count remains EXACTLY 12 with unchanged tool ids (gate-pinned).

## The same identity, bound down the entire approval chain

For each family, `{principalId, membershipRevision}` now also travels in:

1. **the one-shot approval intent** — `PcbEditApprovalIntent`,
   `ReplacementApprovalIntent` binding inputs; consumption compares it
   (`approval-wrong-authorization` on mismatch);
2. **the journal PREPARE record** — durable BEFORE the canonical commit, in
   the shared schematic journal AND the PCB journal; `authorization` is an
   IMMUTABLE entry field (a re-prepare under another principal conflicts);
3. **the receipt COMMITMENT** — the chain-protected commitment digests now
   include the authorization identity (`…receipt-commitment.v2` schemas), so
   a durable transaction committed under one principal can never corroborate
   a receipt claiming another;
4. **the finalized receipt** — all three receipt schemas advanced
   (`…agent-mutation-receipt.v2`, `…replacement-receipt.v2`, PCB receipt
   +1) with the authorization identity as a validated closed field, and the
   journal's receipt-finalized coherence requires
   `receipt.authorization === entry.authorization`;
5. **replay/recovery evidence** — reconstruction uses the entry's
   authorization; adoption REFUSES (`recovery-required`) any receipt or entry
   whose authorization diverges from the proposal's sealed binding — proven
   with a real landed foreign-principal commit that can never be adopted.

Legacy (pre-stage) journal entries and v1 receipts never validate — the
fail-closed compatibility mechanism in both directions.

## Proof

`b16-0-1-tier1-authorization.test.ts` (15),
`b16-0-1-replacement-authorization.test.ts` (14),
`b16-0-1-apply-reauthorization.test.ts` (extended, incl. the legacy-v1 and
foreign-authorization recovery refusals), plus the updated b12/b14/b15 journal
strictness, receipt linkage, and adoption-identity matrices (mutation matrices
EXTENDED — e.g. the b12 receipt matrix grew 20 → 22 forgeries).
