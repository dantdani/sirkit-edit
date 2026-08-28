# B16.0.24.1 — Final security correction

A narrow corrective stage closing exactly THREE verified gaps left by
B16.0.24 (which is otherwise unchanged):

1. **§1 True bounded simulator file read** — `/api/simulate`'s
   `readFile(rawPath,"utf8").slice(0, MAX_RAW_BYTES)` buffered the COMPLETE
   file before truncation and could parse partial output. Replaced with
   `readBoundedRawFile`: a file-handle, chunked (64 KiB) reader that allocates
   only for actual bytes (never the declared size), advisory-stat fast-fails a
   hugely-declared artifact with ZERO content reads, catches stat/growth races
   with the actual-read cap, refuses over-ceiling output EXPLICITLY (never
   parsed), decodes UTF-8 fatally, and closes the handle in every path.
2. **§2 Least-privilege auth environment** — `exposeEnvironment` handed the
   sign-out callback the COMPLETE `process.env`. Replaced with
   `exposeAuthRuntime` → a FROZEN three-field projection
   (`mode`/`supabaseUrl`/`supabaseKey`, copied values only) built by
   `projectAuthRuntime` in `app/lib/auth/mode.ts`, preserving the exact
   historical key selection (`??`). Sentinel-secret test proves unrelated
   environment values are unreachable.
3. **§3 Real Supabase SSR boundary tests** — fake `@supabase/ssr` clients +
   fake `next/headers` cookie store (zero network) now PROVE the callback
   exchange, sign-in, and sign-out success branches, cookie-adapter writes,
   uniform 401 non-enumeration, bounded secret-free SDK failures, and
   zero-SDK-call refusals.

Supersession notes were APPENDED (history preserved) to the six affected
B16.0.24 artifacts: README, simulate-process-security-proof,
simulator-output-and-cleanup-proof, signout-session-retirement-proof,
signin-credential-boundary, auth-callback-security-proof, final-verdict,
unknowns-and-owner-decisions.

## Invariants preserved (byte-verified)

153 total · 150 canonical · 3 factories · 0 raw · baseline 3 · 12 exposed
tools — generator sha1s IDENTICAL to B16.0.24 (`ad1c5c65…` / `d0542262…`).
Chat protocol, prompts, replay pins, tracing, tool permissions, and the
simulator executable/arguments/shell/network policies unchanged. Protected
original untouched.

## Artifact index

| file | content |
|---|---|
| [final-verdict.md](final-verdict.md) | stop condition, item by item |
| [pre-edit-counterexamples.md](pre-edit-counterexamples.md) | the three reproduced defects |
| [bounded-file-read-proof.md](bounded-file-read-proof.md) | §1 |
| [auth-environment-confinement.md](auth-environment-confinement.md) | §2 |
| [supabase-ssr-fake-client-proof.md](supabase-ssr-fake-client-proof.md) | §3 |
| [changed-files.md](changed-files.md) | edit log |
| [test-and-validation-report.md](test-and-validation-report.md) | full suite + static |
| [superseded-claims.md](superseded-claims.md) | exact claims corrected |
