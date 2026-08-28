# B16.0.6 — Post-edit results (all counterexamples fail closed)

Same probe, re-run against the corrected analyzer. Every case fails closed; the
121 real protected methods still pass and the §C gate still reports 0 offenders
across production routes.

## A — Authorization

| ID | PRE-EDIT | POST-EDIT |
|---|---|---|
| R1 bare object negation `if (!authorized)` | accepted | **REJECT** — "authorization result of authorizeRequest is IGNORED (no reachable `if (!authorized.ok) return`)" |
| R2 unawaited inline `if (!authorizeRequest(req))` | accepted | **REJECT** — "boundary authorizeRequest returns a union result and cannot be refused by a bare inline negation (bind it and check .ok)" |
| canonical `const a = await authorizeRequest(req); if (!a.ok) return a.response` | — | **PASS** |
| union bound WITHOUT await, then `!a.ok` | — | **REJECT** ("must be AWAITED") |
| genuine boolean boundary (local → node:crypto timingSafeEqual) inline `if (!ok(req))` | — | **PASS** |
| unknown-contract opaque helper | — | **REJECT** (contract never guessed) |

## B — Request/stream flow

| ID | PRE-EDIT | POST-EDIT |
|---|---|---|
| R3 forged `readBoundedEvil` | `[]` | **REJECT** — "Request passed to non-canonical consumer readBoundedEvil(arg 0)" |
| R4 forged local `readBoundedJsonObject` | `[]` | **REJECT** — "Request passed to non-canonical consumer readBoundedJsonObject(arg 0)" |
| R5 assignment alias | `[]` | **REJECT** — "request body consumed via .json()" |
| R6 body-stream forwarding | `[]` | **REJECT** — "request body stream passed to a non-canonical consumer" |
| R7 returned request alias | `[]` | **REJECT** — "Request passed to non-canonical consumer identity(arg 0)" |
| R8 five-hop chain | `[]` | **REJECT** — "Request passed to non-canonical consumer h1(arg 0)" (no depth escape) |
| namespace helper | `[]` | **REJECT** — "Request passed to an unresolved/dynamic callee" (fail closed) |
| array container | `[]` | **REJECT** — "request body consumed via .json()" |
| destructure-assign | `[]` | **REJECT** — "request body method invoked via json.call()" |
| stream returned from helper | `[]` | **REJECT** — "Request passed to non-canonical consumer getBody(arg 0)" |

## No over-rejection

- All **121** protected methods still prove a load-bearing boundary (the §A gate
  loop over the real tree is green).
- The §C flow gate reports **0** violations across all production routes (the
  real routes reach the body only through the canonical readers / scoped
  families, which the compositional safe-consumer check accepts by provenance).
- A DEEP helper chain that terminates only in a canonical reader converges to
  SAFE — no false positive (proven by a fixture test).
