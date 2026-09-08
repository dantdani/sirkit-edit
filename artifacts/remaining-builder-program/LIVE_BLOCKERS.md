# Live blockers register

Checks that cannot be executed deterministically on this machine. Each is classified exactly; a fake-backed pass is never reported as a live pass.

| # | Check | Classification | What exists instead | Unblocks when |
|---|---|---|---|---|
| LB-1 | Production Supabase authentication browser E2E (sign-in, cookie, liveness, sign-out against a live project) | BLOCKED-LIVE-QUALIFICATION | `injectAuthorizedPrincipal` local/test identity seam; real-SDK offline suites from B16.1B; 9 opt-in live tests gated on `SIRKIT_LIVE_AUTH_QUALIFICATION=1` + marker | owner supplies an isolated, disposable Supabase project + account (recipe: `artifacts/ai-control-plane-b16-1b/live-auth-qualification-matrix.md`) |
| LB-2 | Real LLM provider turn (OpenAI/Anthropic) for the acceptance prompt | UNKNOWN | fake provider adapter returns the recorded 555 design; route/layout/review/sync/qualify/release paths exercised unchanged | owner supplies provider credits with a spend limit |
| LB-3 | Live routing in CI (bundled FreeRouting 2.2.4 + JRE are gitignored) | local-only; CI replays committed recordings keyed by placed-board revision and refuses unknown boards | recordings re-made with `SIRKIT_B16_1C_RECORD_ROUTES=1` on this machine | a qualified CI runner with the runtime, or a container profile (B22) |
| LB-4 | Database-backed tests (`DATABASE_URL` in `.env.local` points to a project that no longer resolves) | dead external resource; one opt-in DB test fails in the default suite | B16-B makes DB tests explicitly opt-in and adds disposable-PostgreSQL migration tests | owner supplies a disposable PostgreSQL / Supabase project |
| LB-5 | Physical fabrication, assembly, incoming inspection, functional test | not attempted | deterministic Gerber/Excellon release + two independent readers | owner approval and hardware (B24-E) |
| LB-6 | Local container PostgreSQL (Docker Desktop 4.67 engine fails at start: Inference-manager socket error, a Docker Desktop defect) | BLOCKED-LIVE-QUALIFICATION for a real-server run on this machine | PGlite (in-process PostgreSQL 17.5) proves the migration mechanism deterministically in the default suite; `b16-b-postgres-qualification.test.ts` runs against any disposable server via `SIRKIT_DB_QUALIFICATION=1` | owner repairs Docker Desktop (reset/update) or supplies a disposable PostgreSQL URL |
