# Unknowns & owner decisions (B16.0.2)

## R9 — live Supabase authentication: UNKNOWN (unchanged, never claimed)
All identity logic is proven against injected fakes and fail-closed branches.
No live project/user/JWT round-trip/real membership row was exercised. Before a
real deployment: exercise the B16.0.1 R9 owner checklist (live sign-in cookie →
`getClaims()` verification → `project_members` role derivation → CSRF with the
real `SIRKIT_EXPECTED_ORIGIN` → apply-time reauthorization on a live session).

## New production configuration the owner MUST set
- `SIRKIT_EXPECTED_ORIGIN` — REQUIRED in production (single absolute https
  origin, or http for a loopback host). Missing/malformed = every protected
  non-idempotent request fails closed. A proxy must declare the public origin
  here, never via forwarding headers.

## BOM ownership migration — owner-gated
`0028_bom_project_ownership.sql` is forward-only and was NOT applied to any live
DB. Legacy rows are quarantined (NULL ownership can never match the scope
predicate). Assigning ownership requires a bespoke, owner-reviewed migration
from an authoritative mapping — never guessed from `project_key`
(a schematic-content hash is not an owner). See
`migration-and-legacy-row-disposition.md`.

## Documented pre-existing item carried to the owner (NOT a new gap)
`/api/replacement-authority` (POST) — the B14 replacement-authority exchange —
derives a SERVER-OWNED local-build scope, validates a body locator, refuses a
foreign tenant/branch, and correlates via a required nonce, but does NOT pass
the shared session-authentication boundary because no authenticated session
exists in the local-only build (same R9 UNKNOWN territory). It is listed
EXPLICITLY as the single `KNOWN_NON_BOUNDARY_ROUTES` entry in
`b16-0-2-gates.test.ts` so a NEW unguarded route still fails the gate. Wiring it
through `authorizeRequest` is a bounded B16.0.3 item (it ripples into the B14
replacement-channel client, which sends no session today). No durable
project-data route is public; this route is not public.

## Pre-existing lint (not a B16.0.2 regression)
`BomView.tsx` carries 4 pre-existing `react-hooks/set-state-in-effect` errors on
effects that predate this stage. B16.0.2 removed one such effect (the
state-hash key). No rule was loosened.

## Scope not started (per the stop condition)
B16.1, manufacturing-release proposal exposure, MCP, multi-agent orchestration,
provider expansion, 3D control, external component acquisition — NOT started.
`sirkit.manufacturing.release` stays internal-only/not-callable; agent tool
exposure stays EXACTLY 12 (gate-pinned).


---

## SUPERSESSION NOTE (B16.0.3, 2026-08-24)

The "documented pre-existing item carried to the owner" above
(/api/replacement-authority not passing the shared boundary, listed as the
single KNOWN_NON_BOUNDARY_ROUTES gate exception) is CLOSED: B16.0.3 wired the
route through authorizeRequest (authentication + membership + editor role +
exact-origin CSRF BEFORE body consumption and BEFORE any component-authority /
pin-facts resolution), extended the production reauthorization channel to send
project selector headers and verify the returned trusted scope, deleted the
exception set, and made the boundary gate structural. The route no longer
depends on the local-only scope disposition. See
artifacts/ai-control-plane-b16-0-3/replacement-authority-authentication-boundary.md.
