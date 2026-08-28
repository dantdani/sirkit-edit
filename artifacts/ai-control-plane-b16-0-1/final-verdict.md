# B16.0.1 — final verdict

Reported separately, per the stage mandate. Classification: CONFIRMED =
reproduced/test-pinned in this tree; UNKNOWN = deliberately unclaimed.

1. **Is caller-header identity eliminated from all sensitive routes?**
   **YES (CONFIRMED).** Production `app/api` contains ZERO reads of
   `x-sirkit-actor-id/-role/-actor-kind/-session-id` (gate-pinned with a
   synthetic tripwire); only selector headers remain and they carry no
   authority. The B16.0 legacy backlog is the EMPTY list.

2. **Are all provider-credit routes protected?**
   **YES (CONFIRMED).** Every provider-credit row requires trusted
   authentication + active membership (editor-class roles); the invariant
   gate pins that no credit row can ever be public; the 13 previously-public
   AI routes now refuse anonymous callers before any provider call.

3. **Do release and qualification enforce exact roles?**
   **YES (CONFIRMED).** `/api/pcb/release` = `project_admin` only (an editor
   is refused); `/api/pcb/qualify` = `pcb_editor|project_admin` (a reviewer is
   refused); a viewer is refused 403 BEFORE any authority load or router
   creation; no other row may claim release/qualification (gate-pinned).
   Deliberately role-gated, never `export_project` (which viewers hold).

4. **Is CSRF active at real route boundaries?**
   **YES (CONFIRMED).** Policy-driven inside `authorizeRequest` /
   the trusted resolver for every authenticated non-GET row (invariant-gated),
   directly in-route for the auth boundary, proven in production mode for the
   release perimeter, the migrated scope families, and chat (403 with no run
   id, i.e. before any provider call). Same-origin requests authorize.

5. **Does the verified principal reach proposal seals?**
   **YES (CONFIRMED).** The run actor IS the verified principal
   (id/role/membership revision/auth class), and every sealed family's
   `effectiveActor` + §E authorization binding derive from it; the provider
   can neither supply nor alter the binding (closed-key refusals pinned).

6. **Is the membership revision enforced at apply?**
   **YES (CONFIRMED).** All three human-approved apply flows (B12 service,
   B14 controller, B15 controller) reload the LIVE membership through the one
   narrow endpoint and compare principal, revision, role, and scope against
   the sealed binding before minting the one-shot capability. Every denial
   (logout / replacement / downgrade / revocation / revision change / foreign
   scope / unreachable transport) produces ZERO canonical transactions and
   ZERO journal prepares — test-pinned per family — and the identity is also
   bound into intents, journal prepares, receipt commitments, finalized
   receipts, and replay/recovery adoption (a landed commit under a foreign
   principal can never be adopted). Legacy artifacts refuse with
   `legacy-authorization-missing`.

7. **Is production local-dev fallback impossible?**
   **YES (CONFIRMED).** `NODE_ENV=production` always resolves production;
   `SIRKIT_AUTH_MODE=local_dev`, missing host variables, and host headers can
   never downgrade it; production without configured auth fails closed.

8. **Was a real Supabase session tested?**
   **NO — UNKNOWN (deliberately).** No live project/user exists here. The
   identity logic is proven against injected fakes and fail-closed branches
   only; live credential verification, JWT round-trips, and real membership
   rows remain unproven. See unknowns-and-owner-decisions.md for the owner
   checklist.

9. **Is the full suite functionally green?**
   **YES (CONFIRMED).** 3073 passed / 0 failed / 20 skipped across 345 files;
   `tsc --noEmit` clean; eslint clean on the stage surfaces. Three known
   load-sensitive flakes are documented (isolated-reproduction evidence), not
   repaired by loosening; three real production defects surfaced by the
   migration's own verification were fixed and pinned.

10. **Is B16.1 authorized?**
    **The B16.0.1 stop condition is MET** — no sensitive route is
    caller-header-authenticated, no viewer reaches qualification/release,
    CSRF is enforced by actual routes, and membership revocation stops an
    already-sealed proposal from applying. The blockers named by this stage
    are closed, SUBJECT TO independent verification (this project's standing
    practice) and to the owner's R9 decision: live production authentication
    remains UNKNOWN, so releasing to a real deployment before the R9
    checklist is exercised would rest on unproven live behavior. B16.1 was
    NOT started.

## Stopped

Per the stop condition: B16.1, manufacturing-release proposal exposure, MCP,
multi-agent orchestration, 3D control, external component acquisition, and
provider expansion were NOT started. `sirkit.manufacturing.release` remains
internal-only and not-callable; exposed tool count remains EXACTLY 12 with
unchanged tool ids (gate-pinned). Awaiting independent verification.
