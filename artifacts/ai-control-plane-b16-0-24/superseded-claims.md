# B16.0.24 — superseded claims

## From B16.0.23

"Remaining migration: 5 raw methods (baseline 8) — chat + misc + 3 factories"
is **superseded**: the migration is now COMPLETE. Zero raw handlers remain.

| claim | prior | now |
|---|---|---|
| canonical wrappers | 145 | **150** |
| raw handlers | 5 | **0** |
| baseline | 8 | **3** (exactly the 3 factories) |
| factories | 3 | 3 (unchanged) |

## From B16.0.22

- "the `legacyReaderRefusals` option is a closed enum with exactly one value
  (`replacement-authority-v1`)" is **superseded**: it is now a closed
  two-member union (`replacement-authority-v1 | auth-signin-v1`); still a
  closed string-literal enum, never free-form.
- "ONLY the replacement-authority route adopts the legacy refusal contract" is
  **superseded**: there are now exactly two adopters, each with its own frozen
  profile — replacement-authority → `replacement-authority-v1`,
  sign-in → `auth-signin-v1`. The b16-0-22 gate was updated to pin the exact
  two-adopter mapping.

## Intentional behavior changes (both reproduced/verified pre-edit)

1. **§B callback redirect origin**: raw `new URL(request.url).origin` (host
   -header-derived in production) → server-owned `resolveExpectedOrigin`
   (`SIRKIT_EXPECTED_ORIGIN` in production; request-URL origin in local_dev, so
   the tests are unchanged). Closes the host-header redirect vector.
2. **§G simulate hardening**: shared `tmpdir()` cwd + full inherited env +
   unbounded output/parse + design-data logging + netlist-in-error-body →
   isolated `mkdtemp` dir + `safeEnvironment` allowlist + `shell:false` +
   bounded output/parse + injection guards + cleanup + no design-data logging.
   The success envelope shape is preserved for the client.

## NOT superseded

All B16.0.1–B16.0.23 claims for the other 148 methods; the three factory
routes' DI form; the chat B09–B15 control-plane contracts, NDJSON protocol,
trace machinery, and replay validity; the auth routes' credential/cookie/mode
semantics (relocated into wrappers, not changed).
