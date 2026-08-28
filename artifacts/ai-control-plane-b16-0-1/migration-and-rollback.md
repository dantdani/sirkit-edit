# B16.0.1 — migration and rollback

## What changed, at the contract level

1. **Route authorization**: every `app/api` route/method is classified in ONE
   exact policy table and enforced by ONE adapter. New routes fail closed
   (runtime 500 `AUTH_POLICY_MISSING` + CI) until classified.
2. **Identity headers**: `x-sirkit-actor-id/-role/-actor-kind/-session-id` are
   DEAD in production code. Only tenant/project/branch selector headers (or
   body selectors) remain, and they carry no authority. Existing UI clients
   keep working: they already sent selectors, and identity now comes from the
   session (local_dev principal in the local build).
3. **Provider-credit routes require membership**: previously-public AI compute
   routes now 401/403 for anonymous callers. Local browser flows are
   unaffected (local_dev resolves the fixed principal); external scripts that
   relied on anonymity BREAK BY DESIGN.
4. **Sealed proposal contracts** (exposed, so versioned explicitly):
   - tier-1: `sirkit.schematic-tier1-proposal.v2 → .v3` (adds `authorization`)
   - replacement: `sirkit.schematic-replacement-proposal.v1 → .v2` (adds it)
   - bounded PCB: `sirkit.pcb-bounded-edit-proposal.v1 → .v2` (the binding is
     part of the explicit v2, not a silent v1 mutation)
   Legacy artifacts refuse APPLICATION with `legacy-authorization-missing`;
   they are never migrated or backfilled — regenerate the proposal.
5. **Durable journals/receipts**: entries and receipts now carry the sealed
   `{principalId, membershipRevision}` and their schema strings advanced.
   Pre-stage local journals classify as unadoptable (`recovery-required`) —
   deliberate fail-closed; with no deployed users the cost is zero.
6. **Apply flows**: every B12/B14/B15 human-approved apply now performs live
   membership reauthorization through `/api/pcb/apply-authorization` before
   minting its one-shot capability. Offline apply is therefore impossible —
   by design (the server is the membership authority).

## Deferred (tracked, policy-classified, not silent)

- Membership-scoping the local-store routes' free-form `projectKey`
  (bom/snapshot, bom/notifications, spice/runs, spice/models/import): they now
  authenticate but any member can name any projectKey. Their policy rows keep
  them visible to the gate.
- Live Supabase validation (R9) — see unknowns-and-owner-decisions.md.

## Rollback

The stage is additive at the infrastructure level and revertible per section:

- **§A/§B/§C**: revert `authorize.ts`/`route-policy.ts` and the per-route
  `authorizeRequest` call sites; the B16.0 resolver remains functional. The
  B16.0 gates would then re-require the legacy backlog list to be restored.
- **§D**: remove the `verifiedActor` input; the assembler falls back to the
  local-only actor (the pre-stage behavior) with no data migration.
- **§E/§F**: revert the schema-version bumps and binding fields; proposals
  sealed DURING the stage would then refuse as wrong-version (fail closed in
  the safe direction). No durable format requires down-migration because
  legacy-refusal, not conversion, is the compatibility mechanism in both
  directions.
- **§G**: mode hardening is a pure tightening; reverting restores the R7
  hole and is NOT recommended under any circumstance.
- **§H**: the auth routes are additive; deleting them restores B16.0.
- **§I**: gates are tests; reverting them removes protection only.

No git history was rewritten; all work is uncommitted edits in
`C:\Users\robsa\Desktop\sirkit-edit` on top of the single base commit, and the
protected original `C:\Users\robsa\sirkit` was never touched.
