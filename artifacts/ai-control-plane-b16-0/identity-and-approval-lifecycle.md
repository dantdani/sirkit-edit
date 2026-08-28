# B16.0 — identity and approval lifecycle

> **SUPERSEDED IN PART (B16.0.1, 2026-08-21).** This document's claim that
> membership revocation invalidated existing proposals was NOT true at B16.0:
> `membershipRevision` changed on revocation but was bound into NOTHING — no
> sealed proposal, approval intent, journal record, or receipt carried it, and
> no apply path re-checked it (counterexample R4). B16.0.1 makes it
> load-bearing: every sealed proposal family carries a closed authorization
> binding (principal + membership revision + scope + required apply role), and
> apply-time reauthorization reloads the LIVE membership and refuses
> logout/replacement/downgrade/revocation/revision-change before any one-shot
> capability is minted. See
> `artifacts/ai-control-plane-b16-0-1/proposal-membership-binding.md` and
> `apply-time-reauthorization.md`.

## Preserved AI/approval invariants

- Agent exposure remains exactly **12** read/propose tools (pinned).
- `sirkit.manufacturing.release` is NOT agent-exposed and stays release-class;
  no exposed tool is release/mutate/destructive.
- No provider-to-commit or provider-to-release path (B12/B14/B15 boundaries
  intact).
- The B12/B14/B15 one-shot approval boundaries are unchanged.

## Binding to the verified principal + membership revision

`TrustedRequestContext` now carries the server-verified `principalId` and a
`membershipRevision`. The chat surface (`/api/chat`) resolves the trusted
context before assembling the run, so a run — and any sealed proposal it
issues — is gated on a verified authenticated principal with an ACTIVE
membership. The sealed PCB/schematic proposals already bind
`effectiveActor.actorId` (the human principal) and scope; the
`membershipRevision` is the new value a binding uses so it is invalidated when
membership changes.

## Retirement on identity change / logout / revocation

- **Membership revocation**: `membershipRevisionOf` changes on any role
  change / version bump / revocation (permanent test); a revoked member is
  refused at `/api/chat` (403), so no new proposal or approval can be issued.
- **Logout**: `/api/auth/signout` clears the session; a subsequent sensitive
  request has no verified principal (401), retiring any principal-bound
  capability.
- **Session replacement / identity change / project switch**: the B15.3
  `PcbEditor` already retires pending PCB proposals on lifecycle-generation
  change and project switch (`onPcbProposalSettled("retired")`), and
  `resetTransientProjectState` clears pending proposals on a project
  transition. A principal change reloads the authenticated session and the
  pending state does not survive it.

## The AI cannot claim to be a human

- `/api/chat` reads NO `x-sirkit-*` identity headers (source-checked) and
  refuses body authority claims (`AUTHORITY_CLAIM_KEYS`), so a model or a
  caller can never assert an actor id, kind, or role.
- Browser/session principals are ALWAYS `actorKind: "human"`; AI actors are
  minted internally only after a verified human request enters the agent
  boundary; workers are `automated_engine` on a separate secret boundary and
  can never mint a human.
