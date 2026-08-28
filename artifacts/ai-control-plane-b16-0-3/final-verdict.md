# B16.0.3 — final verdict

Classification: CONFIRMED = reproduced then test-pinned in this tree;
UNKNOWN = deliberately unclaimed.

1. **Does POST /api/replacement-authority authenticate at runtime?**
   **YES (CONFIRMED).** `authorizeRequest` is the handler's first act:
   authentication, active project membership, the editor-class role set, and
   exact-origin CSRF — from the exact policy row, before anything else. The
   pre-edit probe showed an anonymous caller reaching source resolution (503);
   the post-fix suite shows 401.

2. **Does authorization precede all body and durable-resource work?**
   **YES (CONFIRMED).** With a counted body stream and instrumented source
   factories: anonymous → 401 and cross-origin → 403 with ZERO body pulls,
   ZERO component-authority resolutions, ZERO pin-facts resolutions; a
   disallowed role, revoked membership, foreign membership, and a smuggled
   body scope all refuse before any source call.

3. **Does any authenticated-route exception exist?**
   **NO (CONFIRMED).** `KNOWN_NON_BOUNDARY_ROUTES` is deleted (source-pinned
   absent). The boundary gate is structural (TypeScript AST): a real,
   reachable, imported call to a terminal boundary primitive — directly or
   transitively through a `_scope.ts` family helper — is required for EVERY
   authenticated route, with the four mandated negative tripwires (comment,
   unused import, durable-loader-only handler, the previous
   replacement-authority shape) all failing as required.

4. **Can anonymous/foreign/revoked callers reach component or pin authority?**
   **NO (CONFIRMED).** Each is refused (401/403) with zero source/facts
   resolutions, proven against the real handler. The trusted scope — never a
   body field, never a local constant — is the only value that ever reaches
   `resolveComponentAuthoritySource` / the loaders, and it is proven to arrive
   exactly (`{local, <project>, main}` from the authenticated selector).

5. **Is the effective resource classification truthful?**
   **YES (CONFIRMED).** `/api/replacement-authority` is now
   `is_public=false, durable_access=read, project_data_sensitivity=project-durable,
   authoritative_write=false, provider_credit=false, external_process=∅`; the
   connective check ties actual durable-source CALLS (AST-extracted) to the
   annotation and surfaced + fixed a second untrue row (`/api/chat` → read).
   The CSV was regenerated only through its generator and is byte-stable ×2.

6. **Are partially owned BOM records rejected by both checked-in schema and
   migration SQL?**
   **YES (CONFIRMED — in the checked-in sources).** Both `0028` and
   `schema.ts` now carry the explicit `IS NOT NULL + btrim` form under
   identical constraint names; the six-value truth table is test-pinned with
   the old form as a regression witness (cases 1–3: UNKNOWN→passed before,
   FALSE→rejected now). Whether any LIVE database enforces this is UNKNOWN
   (nothing was applied).

7. **Is the migration delivery state documented honestly?**
   **YES (CONFIRMED).** Journal ends at 0026, snapshots at 0008, no migrate
   command exists; 0027/0028 are documented as owner-applied manual
   migrations; the one reproducible deployment path is stated (manual SQL in
   order — complete — or `db:push`, which omits 0027's RLS policies, stated);
   drizzle-kit registration of 0028 is recorded as an owner-gated blocker
   requiring live-state reconciliation. No metadata was invented.

8. **Does the full regression suite have functional failures?**
   **NO (CONFIRMED).** Final full suite: 3220 passed / 0 failed / 20 skipped
   (358 files). The one real regression surfaced during validation
   (b14-route-replacement drove the endpoint unauthenticated) was FIXED, not
   excused; the wall-clock flakes were verified with repeated isolated green
   runs and pass in the final full run anyway. tsc clean, scoped ESLint clean,
   git diff --check clean, all generators byte-stable ×2.

9. **Is live Supabase authentication still UNKNOWN?**
   **YES — UNKNOWN (deliberately).** Injected fakes and fail-closed branches
   only.

## Stopped
Per the stop condition: B16.1, MCP, multi-agent orchestration, manufacturing
expansion, provider work, and new AI tool exposure were NOT started. Tool
exposure remains EXACTLY 12; `sirkit.manufacturing.release` remains
internal-only and not-callable. The B16.0.2 chapter's remaining exception is
eliminated; awaiting independent verification.
