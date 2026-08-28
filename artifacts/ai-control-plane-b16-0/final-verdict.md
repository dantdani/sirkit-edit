# B16.0 — final verdict

> **SUPERSEDED (B16.0.1, 2026-08-21).** Independent review did NOT accept this
> verdict's stop condition, and B16.0.1 corrects four overclaims made here:
> (1) "R02-B1-011 CLOSED" held only for a 6-route perimeter — 74 routes
> remained caller-header-authenticated (R5) and a resolvable VIEWER passed the
> release scope because membership EXISTENCE, not role sufficiency, was
> checked (R1); (2) "trusted production identity proven" overstated — the
> resolved principal was DISCARDED by the agent assembly (R3), production
> could resolve local_dev admin via the missing-host path (R7), and live
> Supabase behavior remains UNKNOWN (R9); (3) membership revocation did NOT
> invalidate existing proposals — `membershipRevision` was bound into nothing
> (R4); (4) **"B16.1 MAY proceed" is WITHDRAWN** — B16.1 remained blocked
> until B16.0.1's closures. See
> `artifacts/ai-control-plane-b16-0-1/` for the corrective stage.

**R02-B1-011 is CLOSED for the release perimeter.** Caller `x-sirkit-*`
identity headers no longer establish identity or role on the sensitive routes
(`/api/pcb-sync`, `/api/pcb/qualify`, `/api/pcb/release`,
`/api/physical-bindings`, `/api/assignment-queue`, `/api/chat`). Identity,
actor kind, and role are derived server-side from a verified authenticated
principal and server-owned project membership. Production fails closed;
local-development identity is an explicit, non-production, loopback-only mode
with a visible banner.

## Reproduced counterexamples (all closed on the perimeter)
1-3 forged role / actor-id / actor-kind accepted → now IGNORED (server-derived).
4 qualify/release inherited the header scope → now derive identity.
5 no membership authority → `project_members` + repository added.
6 no session producer → Supabase Auth adapter (`getClaims`) added.
7 UI clients asserted identity → pcb-sync client, PcbEditor, AssignmentQueuePanel send only selectors.
8 routes read identity headers → the 5-route perimeter reads none (CI-pinned).
9-10 12 tools can't reach release; MFG01 is server-authority-only → unchanged/verified.

## Proof caller headers no longer grant identity/role
- `resolveTrustedRequestContext` derives role from membership; a forged
  `x-sirkit-role: project_admin` on a viewer yields the viewer role (test).
- The CI forbidden-header gate pins the migrated perimeter at ZERO reads of
  `x-sirkit-role` / `x-sirkit-actor-kind` / `x-sirkit-actor-id`, with a
  negative tripwire for a new offender.

## Production fails closed
`sensitiveOperationsBlocker` refuses sensitive requests (403) when production
lacks configured Supabase auth; the identity provider returns null (401) for
missing/expired/invalid sessions; membership lookup returns null (403) for
missing/revoked/cross-tenant/cross-project.

## Local-development limitations
A single fixed `project_admin` principal; not production authentication; a
visible `LOCAL DEVELOPMENT IDENTITY — NOT PRODUCTION AUTHENTICATION` banner;
truthful diagnostics; never reachable as a silent production fallback.

## Session / proposal / approval retirement
A revoked member is refused at chat (403); logout clears the session (a later
request is 401); the membership revision changes on any role change /
revocation; the B15.3 PcbEditor retires pending PCB proposals on lifecycle /
project transitions.

## Validation
38 new tests + updated migration tests; full suite green (the 4 pre-fix
failures resolved — async await, a static Supabase import for the AST gate,
and one unrelated perf flake that passes in isolation); tsc 0; ESLint clean;
git diff --check clean; artifacts byte-stable; exposure exactly 12; release
internal-only; protected original at its 6-entry baseline.

## CONFIRMED / INFERRED / PROPOSED / UNKNOWN
See `unknowns-and-owner-decisions.md`. CONFIRMED: the perimeter closure,
fail-closed production, server-owned membership, worker≠human, AI≠human.
INFERRED: the live Supabase cookie→claims round-trip (validated by the SDK,
injected in tests). PROPOSED: migrate the 12 legacy CD-stage `_scope.ts`
families; bind `membershipRevision` into the sealed proposal body; auth-gate
the latent `none`-identity state-changing routes. UNKNOWN: two pre-existing
non-deterministic flakes — `assignment-queue-panel` (1 fail / 6 isolated) and
`pcb-repair-agent` performance threshold — both documented since B15.2.2 and
orthogonal to B16.0.

## Is R02-B1-011 fully closed? Is B16.1 authorized?
- R02-B1-011 is CLOSED for the release perimeter and the provider-credit chat
  surface — the routes that gate manufacturing release, qualification, durable
  publication, and provider spend. The broader CD-stage surface remains on a
  CLASSIFIED, CI-pinned legacy backlog (documented, not silent).
- Trusted production identity and authoritative membership ARE proven
  (adapter + membership authority + fail-closed production), so the STOP
  CONDITION's blocker does not apply.
- **B16.1 manufacturing-release integration MAY proceed**, provided it (a)
  keeps `sirkit.manufacturing.release` internal-only / non-callable, and (b)
  gates release on the trusted context + a `project_admin`/release-authorized
  membership. The release perimeter identity is now server-derived; the
  release ENGINE was already server-authority-only.

## Stopped
`sirkit.manufacturing.release` remains internal-only and NOT exposed. B16.1,
MCP, multi-agent orchestration, 3D control, external component acquisition,
and provider expansion were NOT started. Awaiting independent verification.
