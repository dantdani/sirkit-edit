# B16.0.2 — final verdict

Classification: CONFIRMED = reproduced then test-pinned in this tree;
UNKNOWN = deliberately unclaimed.

1. **Can any anonymous caller access SPICE run artifacts, events or waveforms?**
   **NO (CONFIRMED).** bundle/events/waveforms (and list/get/cancel) authorize
   through `authorizeRequest` BEFORE any lookup, stream, listener, or artifact
   read; anonymous → 401. Pinned in `b16-0-2-spice-scope-isolation`.

2. **Can a member of project B enumerate, download, subscribe to or cancel
   project A's runs?**
   **NO (CONFIRMED).** Every run/batch is bound to the server-derived
   `{tenant,project,branch}`; the job store exposes no unscoped accessor; a
   foreign scope gets a uniform 404, no listener is added, and cancellation
   state is untouched — proven across every route surface plus listener counts.

3. **Can any BOM read or mutation escape the trusted project scope?**
   **NO (CONFIRMED).** Ownership is server-derived columns; every
   select/update/delete predicate (raw-id operations included) carries the FULL
   scope; `projectKey`/raw id never authorize; the body may carry no ownership
   claim; diff is a bounded authenticated POST. Legacy NULL-ownership rows are
   quarantined. Cross-project isolation and PG predicate source-pins pinned.

4. **Does CSRF compare the complete server-owned origin?**
   **YES (CONFIRMED).** Scheme + hostname + effective port against the ONE
   server-owned `SIRKIT_EXPECTED_ORIGIN` (or, outside production, the request
   URL). Forwarding/host headers are inert (gate-pinned). Both reproduced
   bypasses refuse; missing production config fails closed.

5. **Can a non-settling request body retain resources indefinitely?**
   **NO (CONFIRMED).** The ONE bounded reader enforces a hard deadline (default
   30 s), a real wire-byte ceiling, and abort propagation; a never-settling body
   deterministically refuses (408, fake-timer proof) with exactly one terminal
   result and no unhandled rejection. All protected body routes migrated; no
   `request.json()/text()` remains (gate-pinned).

6. **Can production tier-1 sealing bind to local-dev fallback?**
   **NO (CONFIRMED).** `session-identity.ts` has no fallback of any kind
   (source-pinned: no local-dev principal, no cache, no prime); the page awaits
   the async typed load and seals ONLY from a successful scope-matching result,
   else creates no proposal. Production integration proves a real principal seals
   and applies exactly once.

7. **Is requiredApplyRole truly enforced?**
   **YES (CONFIRMED).** An explicit accepted-role mapping makes the sealed field
   load-bearing across all three families: `project_admin` accepts only
   `project_admin`; both the family list and the required role must admit the
   live role; an unknown required role fails closed.

8. **Can caller-provided actor/project labels enter an engineering artifact?**
   **NO (CONFIRMED).** `body.actor`/`body.projectIdentity` (and every
   attribution/authority key) are refused 400; attribution derives solely from
   `TrustedRequestContext`; the archive/headers/README/manifest are labelled an
   unverified engineering export.

9. **Is verified manufacturing release still admin-only and internal to the
   agent?**
   **YES (CONFIRMED).** `/api/pcb/release` stays `project_admin`-only,
   release-class; the engineering export can never be release/qualification;
   `sirkit.manufacturing.release` stays internal-only/not-callable; agent tool
   exposure stays EXACTLY 12 (gate-pinned).

10. **Is the full suite functionally green?**
    **YES (CONFIRMED).** 3186 passed / 0 failed / 20 skipped (354 files); tsc
    clean; scoped ESLint clean except 4 pre-existing BomView effect warnings;
    git diff --check clean; artifacts byte-stable across two generations. Load-
    sensitive perf/timeout flakes verified green in isolation; no gate loosened.

11. **Is live Supabase authentication still UNKNOWN?**
    **YES — UNKNOWN (deliberately).** No live credential/JWT/membership was
    exercised; only injected fakes and fail-closed branches. See R9.

12. **Is B16.1 safe to authorize?**
    **The B16.0.2 stop condition is MET** — R1–R8 are closed and pinned, SUBJECT
    TO independent verification (this project's standing practice) and the
    owner's R9 decision (live production auth remains UNKNOWN) plus the required
    `SIRKIT_EXPECTED_ORIGIN` configuration and the owner-gated BOM ownership
    migration. **B16.1 was NOT started.**

## Stopped
Per the stop condition: B16.1, manufacturing-release proposal exposure, MCP,
multi-agent orchestration, 3D control, external component acquisition, and
provider expansion were NOT started. Awaiting independent verification.


---

## SUPERSESSION NOTE (B16.0.3, 2026-08-24)

Two claims above are corrected by B16.0.3 (this document is preserved as
historical evidence):

1. The stage carried ONE authenticated-route exception
   (/api/replacement-authority in KNOWN_NON_BOUNDARY_ROUTES): that route
   reached durable component-authority resolution WITHOUT authentication
   (anonymous -> 503, never 401), and its classification row
   (durable_access=none, caller-supplied-only) was untrue. B16.0.3 closed the
   route behind authorizeRequest (auth precedes body + all durable reads),
   deleted the exception, hardened the gate structurally, and corrected the
   classification (read / project-durable; /api/chat likewise gained read).

2. The BOM ownership CHECK shipped in 0028 did NOT enforce "a partially-owned
   row can never exist": its btrim-only second disjunct evaluated to SQL
   UNKNOWN for a partial row, which PASSES a PostgreSQL CHECK. B16.0.3 added
   explicit IS NOT NULL conjuncts in both the migration and schema.ts (parity
   test-pinned, six-value truth table).

See artifacts/ai-control-plane-b16-0-3/final-verdict.md.
