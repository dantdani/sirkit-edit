# B16.0.1 §F — apply-time membership reauthorization (R4 closure, part 2)

## The ritual (every B12 / B14 / B15 human-approved commit)

1. Verify the sealed proposal (integrity + currency, unchanged families).
2. Verify the human click path (unchanged: intents mint only behind the
   review dialogs' explicit Apply actions; B14.1/B15.3 branded one-shots).
3–4. Reauthenticate the current server session AND reload the ACTIVE project
   membership — one same-origin POST to `/api/pcb/apply-authorization`, which
   derives identity via `resolveTrustedRequestContext` (401 logged out,
   403 removed/foreign) and returns ONLY
   `{principalId, role, membershipRevision, scope}`.
5–9. `evaluateMembershipReauthorization(binding, live, applyRoles)` enforces
   the proposal's required role and compares principal, membership revision,
   and tenant/project/branch — refusing logout (`membership-unavailable`),
   identity replacement (`principal-changed`), role downgrade
   (`role-insufficient`), revocation/revision change (`membership-changed`),
   and scope drift (`scope-changed`). A throwing/unreachable transport
   refuses `reauthorization-unavailable`. ALWAYS before step 10.
10. Only then mint/consume the exact local one-shot apply capability.
11. The existing canonical commit + durability paths continue unchanged.

Enforcement points: the PCB approval controller
(`pcb-edit-approval-controller.internal.ts`), the replacement approval
controller (`replacement-approval-controller.internal.ts`), and — because
tier-1 has no controller module — the tier-1 apply SERVICE itself
(`applyApprovedTier1Proposal` requires a `reauthorize` dependency; even the
already-applied receipt READBACK requires live reauthorization). Production
callers wire `createMembershipReauthorizer()`.

## The one narrow endpoint

`POST /api/pcb/apply-authorization` (family-neutral; see
`membership-reauthorization.ts`): performs NO mutation; accepts NO role,
actor-kind, or membership claim (body carries only a scope selector +
proposalId correlation); verifies scope shape and derives everything
server-side; same-origin protected; returns bounded authorization evidence
only — never a token or secret; is NOT provider-callable (it is no tool, the
gateway cannot reach the apply controllers — §I import gates — and exposure
stays 12); has a closed import/call boundary (the client factory's importers
are the trusted apply surfaces).

## Refusal semantics

Every denial produces **zero canonical transactions and zero journal
prepares** — test-proven per family with real compositions (history entry
counts, visible digests, and the ABSENCE of any journal document asserted).
The review UIs surface the precise bounded refusal (`… Nothing was changed.`)
through their existing outcome display paths, and a proposal sealed before a
membership change permanently fails application afterward — the only path
forward is a FRESH proposal under the new membership.

## Proof

- PCB: `b16-0-1-apply-reauthorization.test.ts` — the six-way denial matrix,
  throwing transport, fresh-membership success, legacy-v1 refusal,
  foreign-authorization recovery refusal, provider-argument refusal.
- Tier-1: `b16-0-1-tier1-authorization.test.ts` — the same matrix through the
  service (plus the revoked author's receipt-readback refusal).
- Replacement: `b16-0-1-replacement-authorization.test.ts` — the same matrix
  through the production controller (reauthorizer provably NOT called for a
  legacy artifact).
- Transport: `parseMembershipReauthorization` fail-closed parsing;
  the endpoint's 401/403/400 behavior via the trusted-context suites.
