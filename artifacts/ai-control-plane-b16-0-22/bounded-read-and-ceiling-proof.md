# B16.0.22 — bounded read, ceilings & deadlines

The historical ceilings were VERIFIED from each family's `_scope.ts` (not
invented) and are now passed explicitly to the wrappers; the reader-default
30 s deadline each `scopedTrustedJson` family always used is named per family
and passed explicitly.

| family | ceiling (bytes) | deadline | source of truth |
|---|---|---|---|
| assignment-queue | 1,000,000 | 30,000 ms | `ASSIGNMENT_API_MAX_BYTES` / `ASSIGNMENT_API_DEADLINE_MS` |
| footprint-resolution | 4,000,000 | 30,000 ms | `FOOTPRINT_RESOLUTION_API_MAX_BYTES` / `_DEADLINE_MS` |
| physical-bindings | 2,000,000 | 30,000 ms | `PHYSICAL_BINDING_API_MAX_BYTES` / `_DEADLINE_MS` |
| passive-policy (GET only this tranche) | 64,000 (POST factory, unchanged) | reader default | `PASSIVE_POLICY_API_MAX_BYTES` |
| replacement-authority | **16,384** | **10,000 ms** | route constants `MAX_BODY_BYTES` / `REQUEST_READ_DEADLINE_MS` (B14.3 §B) |

Pins (pre = post):

- One wire byte over each ceiling → **413** (1,000,001 / 4,000,001 /
  2,000,001 / 16,385). **CONFIRMED**.
- `text/plain` → **415 AUTH_MEDIA_TYPE_UNSUPPORTED** on all four POSTs
  (the replacement-authority route historically used this exact canonical
  envelope already). **CONFIRMED**.
- Malformed JSON / non-object bodies → the family envelopes (canonical
  AUTH_INVALID_JSON for the three standard families; the exact historical
  plain-text envelopes for replacement-authority — see
  [legacy-refusal-contract.md](legacy-refusal-contract.md)). **CONFIRMED**.
- The standing `b14-3-stream-lifecycle-and-gates` suite (a stream that never
  emits settles 408 at the 10 s deadline with no durable loader run) passes
  UNCHANGED through the migrated wrapper. **CONFIRMED**.

The confinement gate pins all seven constants by value; changing any fails CI.
