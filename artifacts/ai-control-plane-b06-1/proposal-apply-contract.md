# B06.1 — Tier-1 Proposal / Apply Contract

The boundary between provider output and schematic mutation. Implemented in
`app/lib/engineering/schematic-proposals.ts`, `schematic-plans.ts`
(`compileTier1Proposal`), and the `page.tsx` proposal dialog; enforced by
`app/lib/engineering/__tests__/b06-1-proposal-authority-durability.test.ts` §1.

## Propose (no mutation authority)

`POST /api/schematic/edit` (owned by registry record
`schematic.edit-tier1-propose`, kind `propose`) returns a validated op list.
Receiving that response **mutates nothing**: the client compiles it with the
deterministic, strictly all-or-nothing compiler and seals the result:

```
SealedTier1Proposal (sirkit.schematic-tier1-proposal.v1, deep-frozen)
  proposalId            digest of the proposal body (identity)
  baseSchematicDigest   UI-projection digest the ops were compiled against
  operations            the EXACT canonical operations the apply will submit
  operationsDigest      digest over (base, operations)
  impacts               property edits + full delete impact plans + destructive flag
  provenance            { provider, note, instruction } — display-only, never authority
  createdAt / expiresAt createdAt + 10 min TTL
```

**All-or-nothing compilation.** Any of the following BLOCKS the complete
proposal — the valid subset never executes and no apply button is offered:

- unknown target at its position in the proposed sequence (`unknown-target`);
- theory id-rename (`unsupported-theory-rename`) — it rewrites the component
  primary key (netlist id, pcb-sync `componentInstanceId`, physical-binding
  scope); the legacy `setComponents` rename side channel is REMOVED
  (structural test: `app/page.tsx` contains no `legacyTheoryRenames`);
- kicad delete without supplied catalog pin data (`pins-unavailable`);
- a refused delete plan (`delete-plan-refused`);
- an empty op list (`empty-proposal`).

A blocked proposal is reported to the chat with every blocker; nothing is
staged.

## Review

The proposal dialog displays the exact proposed operations (property edits
with old→new values; deletes with the component, incident wires, removed
label names, and downstream consequences) plus provider provenance, proposal
id, and expiry. Nothing executes while the dialog is open.

## Apply (destructive-tier human command)

Only the explicit **“Apply exact proposal”** button executes, as registry
record `schematic.edit-tier1-apply` (kind `destructive`, no API route, no
tool/provider/chat/MCP exposure). Two verification layers run:

1. `verifySealedTier1Proposal` — recomputes the operations digest AND the
   proposal identity digest (any alteration → `altered`), checks expiry
   (`expired`), and compares the pinned `baseSchematicDigest` against the
   current schematic (`stale-base`).
2. The serialized session queue re-checks the pinned base digest at the
   actual execution position (`expectedBaseDigest` → `stale_revision`,
   `EXPECTED_BASE_DIGEST_MISMATCH`) — a caller that skipped step 1 is still
   stopped before any mutation.

The apply submits **exactly the sealed operations** as ONE atomic canonical
transaction through the trusted interactive schematic session (canonical
validation, capability checks, revision check, durable commit, exact
inverses, one history entry). A rejected transaction changes nothing and is
never followed by another state mutation.

**Cancel** discards the proposal; nothing was staged, so nothing changes.
