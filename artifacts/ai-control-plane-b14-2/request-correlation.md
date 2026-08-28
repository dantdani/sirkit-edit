# B14.2 §C — honest request correlation

## The defect (R4)

The B14.1 "nonce" was built locally (deterministically, from timestamp +
proposal + head digest) and appeared NOWHERE in the HTTP exchange — nothing
was sent, validated, or echoed, while the artifacts claimed a
"per-consumption nonce-bound transport".

## The closure

- The channel generates a PLATFORM-RANDOM nonce
  (`crypto.getRandomValues`, 32 hex chars) per consumption and sends it IN
  the request body.
- The endpoint REQUIRES a well-formed nonce (`/^[A-Za-z0-9]{16,128}$/`,
  400 otherwise) and ECHOES the exact value in the allowlisted response
  `binding: { nonce, componentInstanceId, scope }` — where `scope` is the
  SERVER-CONSTRUCTED local scope, never the raw body object.
- The channel verifies the echo BEFORE accepting any facts: exact nonce,
  exact component locator, and the expected server-constructed scope
  (`local` / requested project / `main`). Absent, malformed, changed, or
  mismatched echoes refuse; a binding for another component or project
  refuses.

## Honest documentation

The nonce is CORRELATION AND REPLAY DEFENCE for one request/response
exchange over the channel's own transport — it proves "this response
answers the request this channel just made". It is NOT server
authentication, and no caller-provided nonce or scope value authorizes
anything; the B14.1 §C local-only scope disposition (server-derived
tenant/branch, unauthenticated project locator, no multi-tenant auth) is
unchanged.
