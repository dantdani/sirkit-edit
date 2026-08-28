# B16.0.24.1 — superseded claims (exact)

Each superseded B16.0.24 claim received an APPENDED note in its original
artifact; the historical text is preserved verbatim above each note.

| B16.0.24 claim (location) | status | correction |
|---|---|---|
| "raw-file read \| 20 MB (`slice(0, MAX_RAW_BYTES)`)" presented as a bound (simulator-output-and-cleanup-proof.md) | **SUPERSEDED** | full-buffer truncation → `readBoundedRawFile` (handle/chunked/explicit refusal); partial output is never parsed |
| "the raw file read is `slice(0, MAX_RAW_BYTES)` (20 MB)" under "bounded stdout/stderr/raw" (simulate-process-security-proof.md) | **SUPERSEDED** | same correction |
| "Deterministic env injection … `exposeEnvironment` … `input.environment`" presented as confinement (signout-session-retirement-proof.md, README capability table) | **SUPERSEDED** | full process.env exposure → frozen three-field `exposeAuthRuntime` projection; sentinel-proven |
| "exactly one credential call on a valid attempt — CONFIRMED / INFERRED" and "uniform authentication failure … INFERRED" (signin-credential-boundary.md) | **UPGRADED to CONFIRMED** | fake-SSR proof: one call, trimmed email, byte-identical 401s |
| "Retry/replay … CONFIRMED" + exchange-success behavior without executable coverage (auth-callback-security-proof.md) | **UPGRADED to CONFIRMED** | fake-SSR proof: one exchange, adapter-only cookie writes, safe redirect, no diagnostic leak |
| "the Supabase credential-verification branches remain UNKNOWN by design" (final-verdict.md, unknowns-and-owner-decisions.md) | **SUPERSEDED IN PART** | SDK-boundary contract now PROVEN with fakes; LIVE-Supabase behavior (real network/project) remains UNKNOWN |

## NOT superseded

Everything else in B16.0.24: the five migrations, the zero-raw/exact-factory
ratchet, the chat boundary/streaming/tracing proofs, the simulate spawn
confinement (executable/args/shell/env/cwd/timeout — the env-allowlist claim
was always about the CHILD process and holds), and all B16.0.1–B16.0.23
claims.
