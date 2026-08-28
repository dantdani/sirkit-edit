> **SUPERSEDED (B16.0.1, 2026-08-21).** "R02-B1-011 CLOSED" applied only to a
> 6-route perimeter: 74 routes stayed caller-header-authenticated, a viewer
> passed the release scope (role sufficiency was never checked), the verified
> principal was discarded by the agent assembly, membership revocation could
> not stop a sealed proposal from applying, and production could resolve
> local_dev via the missing-host path. B16.0.1
> (`artifacts/ai-control-plane-b16-0-1/`) closes R1–R9; read its final
> verdict, not this document, for the current security posture.

# B16.0 — trusted request identity, project membership, release-perimeter security

**Status: R02-B1-011 CLOSED for the release perimeter.** Server-derived
identity + project membership replace caller-asserted `x-sirkit-*` headers on
the sensitive routes; production fails closed; local-development identity is
explicit, non-production, loopback-only, and visibly banner-labelled.
Manufacturing release stays internal-only. See [final-verdict.md](final-verdict.md).

- [pre-edit-counterexamples.md](pre-edit-counterexamples.md) — the 10 R02-B1-011 reproductions.
- [trusted-request-context.md](trusted-request-context.md) — the resolver + call graph + migrated routes.
- [supabase-auth-adapter.md](supabase-auth-adapter.md) — the Supabase Auth production adapter (official docs, locked versions).
- [project-membership-authority.md](project-membership-authority.md) — the `project_members` model + RLS + role mapping.
- [local-development-security.md](local-development-security.md) — explicit local_dev + fail-closed production + banner.
- [csrf-and-request-security.md](csrf-and-request-security.md) — same-origin, content-type, size, open-redirect, 401/403, constant-time.
- [auth-route-coverage.csv](auth-route-coverage.csv) — all 139 routes classified by auth class + identity source.
- [identity-and-approval-lifecycle.md](identity-and-approval-lifecycle.md) — AI/approval invariants + retirement.
- [test-and-validation-report.md](test-and-validation-report.md) · [changed-files.md](changed-files.md) · [migration-and-rollback.md](migration-and-rollback.md) · [unknowns-and-owner-decisions.md](unknowns-and-owner-decisions.md).

38 new permanent tests. Exposure exactly 12. Locked deps: `@supabase/ssr`
0.12.4, `@supabase/supabase-js` 2.112.3.
