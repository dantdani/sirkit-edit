# B16.0.22 — superseded claims

## From B16.0.21

"Remaining migration: 26 raw methods (baseline 29) — spice, chat,
replacement-authority, misc + 3 factories" is **superseded**: the eight
tranche-15 methods (including replacement-authority) are now canonical.

| claim | prior | now |
|---|---|---|
| canonical wrappers | 124 | **132** |
| raw methods | 26 | **18** |
| baseline | 29 | **21** |
| remaining families | spice, chat, replacement-authority, misc | spice, chat, misc (+3 factories) |

## Intentional behavior changes (both reproduced verbatim pre-edit)

1. pcb-sync GET duplicated query key: 422 refusal → deterministic
   first-value-wins ([query-projection-deltas.md](query-projection-deltas.md) #1).
2. assignment-queue POST declared-oversize length: 413
   `AQ_API_PAYLOAD_TOO_LARGE` → 413 `AUTH_PAYLOAD_TOO_LARGE`
   ([query-projection-deltas.md](query-projection-deltas.md) #2).

## NOT superseded

All B16.0.1–B16.0.21 claims for the other 145 methods; the six families'
domain semantics (assignment decisioning, footprint evaluation, passive-policy
capability surface, board loading, binding lifecycle, replacement
reauthorization facts) unchanged; the B14.2/B14.3 replacement-authority
refusal envelopes and nonce semantics unchanged (preserved byte-exact).
