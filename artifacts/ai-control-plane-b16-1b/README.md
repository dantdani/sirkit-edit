# B16.1B — live production-auth qualification and revocation truth

**Status: stop condition B — BLOCKED-LIVE-QUALIFICATION (external), offline work COMPLETE.** The Supabase project named by the local configuration no longer resolves (DNS `ENOTFOUND`; pooler tenant not found), and no isolated project, qualification account, or isolated admin credentials were supplied. Everything provable offline or read-only was proven — with the REAL SDK and REAL signatures where it mattered, and with the REAL production build over real HTTP — and two reproduced defects were closed. Nothing fake is labelled live.

## What changed (security-relevant)

1. **Session liveness (§E, R8).** With asymmetric signing keys `getClaims()` verified a revoked session's still-valid token locally and never asked the Auth server — reproduced with the real SDK. Closed by ONE provider-neutral boundary: exactly one `getUser()` confirmation per request after signed-claim validation, `user.id === claims.sub`, bounded and abort-safe, every failure the uniform 401. [session-liveness-and-revocation.md](session-liveness-and-revocation.md)
2. **Bounded provider calls.** An expired-session cookie held a real request 51 s while the SDK retried an unreachable refresh (proxy + route). Every SDK call now runs through a per-request 5-second budget with a non-retryable deadline sentinel: 6.3 s, fail closed. [pre-edit-counterexamples.md](pre-edit-counterexamples.md)
3. **Cookie flags.** The SSR default is `httpOnly:false`, no `Secure`; the repo claimed HttpOnly. Now server-owned: HttpOnly, SameSite=Lax, Path=/, Secure iff the expected origin is https. [cookie-and-refresh-proof.md](cookie-and-refresh-proof.md)
4. **Truthful sign-out.** `signedOut` (local retirement) and `remoteRevocation: confirmed|unconfirmed` are two facts; before, a failed remote call was reported as a sign-out.
5. **RLS parity (§F).** The drizzle schema (what `drizzle-kit push` applies) lacked the migration's RLS + policy; declared now, parity test-pinned; nothing applied to any database; 0027 stays unregistered in the journal (owner decision). [membership-and-rls-proof.md](membership-and-rls-proof.md)

## Artifact index (§I)

1. [README.md](README.md) 2. [starting-state.md](starting-state.md) 3. [official-supabase-contract.md](official-supabase-contract.md) 4. [configuration-readiness.md](configuration-readiness.md) 5. [pre-edit-counterexamples.md](pre-edit-counterexamples.md) 6. [live-auth-qualification-matrix.md](live-auth-qualification-matrix.md) 7. [cookie-and-refresh-proof.md](cookie-and-refresh-proof.md) 8. [session-liveness-and-revocation.md](session-liveness-and-revocation.md) 9. [membership-and-rls-proof.md](membership-and-rls-proof.md) 10. [tenant-project-isolation.md](tenant-project-isolation.md) 11. [csrf-boundary-proof.md](csrf-boundary-proof.md) 12. [zero-secret-evidence.md](zero-secret-evidence.md) 13. [changed-files.md](changed-files.md) 14. [test-and-validation-report.md](test-and-validation-report.md) 15. [unknowns-and-owner-decisions.md](unknowns-and-owner-decisions.md) 16. [final-verdict.md](final-verdict.md)

## Counts

74 new always-on tests (19 real-SDK offline, 55 fake) + 9 opt-in live (skipped: BLOCKED) · battery 92 files / 1857 passed / 0 failed · full suite 4591 passed / 0 failed once the dead database is excluded (run 1: 1 environmental failure in an untouched DB-bound test) · 153 / 150 / 3 / 0 / 12 · tsc 0 · ESLint 0 · secret scans 0 hits · 2 real-HTTP builds × 23 rows.

Labels used precisely: CONFIRMED (with the evidence class named), INFERRED, PROPOSED, BLOCKED, UNKNOWN. A fake-client or spy-backed result is never CONFIRMED LIVE.

Stopped after B16.1B. Not started: MCP, multi-agent orchestration, provider expansion, signup, production data migration, component downloads, new editor features.
