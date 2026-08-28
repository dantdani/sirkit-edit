# B16.0.1 — unknowns and owner decisions

## UNKNOWN (deliberately not claimed)

1. **Live production authentication (R9).** No live Supabase project, test
   user, or deployment exists in this environment. Real JWT verification,
   real `project_members` rows, real cookie rotation, PKCE against a real
   provider, and real sign-in are all UNPROVEN — the identity logic is proven
   against injected fakes and the unconfigured fail-closed branches only.
   Owner action: provision a Supabase project + one existing test account,
   set `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
   apply `drizzle/0027_project_membership.sql`, and exercise sign-in →
   membership → release-perimeter → sign-out end to end before trusting
   production.
2. **Pre-existing non-deterministic flakes (unchanged, documented).**
   `assignment-queue-panel` (since B15.2.2) plus two load-induced timing
   budgets that fail ONLY under the fully parallel suite and pass 3/3 in
   isolation: `passive-policy performance-property` (5.7 s vs 5.0 s budget
   under ~14 workers) and `pcb route-tool perf` (5 s timeout). Source-level
   cause: wall-clock budgets under CPU contention; orthogonal to every edited
   surface. Deliberately NOT repaired (no budget was loosened).

## Owner decisions taken (documented, reversible)

1. **Release gates by ROLE, not capability.** `ROLE_CAPABILITIES` grants
   `export_project` to viewers/commenters, so `/api/pcb/release` is gated on
   `project_admin` membership role only.
2. **The reauthorization endpoint lives at `/api/pcb/apply-authorization`**
   and serves ALL THREE apply families (it reports project-membership
   evidence, nothing PCB-specific). Renaming it would churn the registry,
   policy, and gates for no security gain; the family-neutral client module
   (`membership-reauthorization.ts`) documents this.
3. **Local-store routes (bom/snapshot, bom/notifications, spice/runs,
   spice/models/import) authenticate but do not yet scope `projectKey` to a
   membership.** They now require an authenticated member (no longer
   `identity_source=none` writes), but their free-form `projectKey` is not
   membership-checked — deferred with the migration notes; they carry exact
   policy rows so the gate cannot lose track of them.
4. **Legacy artifacts refuse rather than migrate.** Pre-B16.0.1 sealed
   proposals (tier-1 v2, replacement v1, PCB v1), journal entries, and
   receipts lacking the authorization identity permanently refuse
   application/adoption with precise codes — membership authority is never
   guessed or backfilled. Any locally persisted pre-stage journal becomes
   `recovery-required`; with no deployed users this costs nothing and keeps
   the fail-closed invariant absolute.
5. **CSRF is production-mode-gated inside the trusted resolver** (local_dev
   and tests carry no browser Origin); production behavior is test-proven via
   environment injection. The §H auth routes enforce CSRF unconditionally
   in-route.
6. **Interactive tier-1 sealing uses cached-or-deterministic session
   identity** (`session-identity.ts`): live endpoint evidence when primed,
   else the deterministic local_dev identity. In production a stale fallback
   can only produce a proposal that FAILS apply-time reauthorization —
   fail closed, regenerate.
