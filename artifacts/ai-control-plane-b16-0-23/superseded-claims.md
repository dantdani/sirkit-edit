# B16.0.23 — superseded claims

## From B16.0.22

"Remaining migration: 18 raw methods (baseline 21) — spice/chat/misc + 3
factories" is **superseded**: the 13 SPICE methods are now canonical.

| claim | prior | now |
|---|---|---|
| canonical wrappers | 132 | **145** |
| raw methods | 18 | **5** |
| baseline | 21 | **8** |
| remaining families | spice, chat, misc | chat, misc (+3 factories) |

## Intentional behavior changes (both reproduced verbatim pre-edit)

1. **§E/§F job-store terminal guard**: `executeQueuedRun` previously
   `Object.assign`'ed a late worker result over a TERMINAL record (a cancelled
   run could flip to completed under a runner that ignored its abort signal).
   Reproduced verbatim pre-edit; corrected to refuse any late overwrite of a
   terminal record on both settle paths. Unreachable through the real worker.
2. **§G AI provider/local error split**: in-loop LOCAL failures previously
   returned 503 provider envelopes (`providerErrorResponse`); corrected so
   local failures carry deterministic local 422 codes
   (`SPICE_AI_NO_TOOL_CALL`, `SPICE_AI_TOOL_INPUT_INVALID`,
   `SPICE_AI_REQUEST_INVALID`) and only a genuine provider fault produces 503.

## NOT superseded

All B16.0.1–B16.0.22 claims for the other 140 methods; the SPICE domain
semantics (compiler/estimator/report determinism, model import/smoke screens,
job-store scope isolation and no-existence-oracle property, the in-process
worker and its server-owned limits, the AI tool loop's proposal-only
operations) are unchanged. The 20 tool schemas are byte-identical to the
former inline array — only relocated beside their validator.
