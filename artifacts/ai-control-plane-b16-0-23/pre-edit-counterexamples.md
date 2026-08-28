# B16.0.23 §A — pre-edit observed realities and reproduced corrections

The §A suite ran against the RAW handlers first: 42/44 on the first run, then
44/44 after two EXPECTATION corrections (no production edits):

## Expectation corrections (my errors, corrected to observed reality)

1. **The AI studio has 20 typed tools, not 19** — counted from the inline
   TOOL_SCHEMAS array. Pin updated to 20; the count is now permanently gated
   (frozen array, adapter parity, confinement gate). **CONFIRMED**.
2. **`readiness.checkedAt` is a wall-clock stamp** — the ONLY volatile token
   in the compile response. The determinism pin normalizes exactly that field
   and byte-compares the rest. **CONFIRMED**.

## Reproduced defects (verbatim pre-edit, then corrected — both mandated)

3. **§E/§F late-completion overwrite (job store)** — `executeQueuedRun`
   `Object.assign`'ed the worker result over a TERMINAL record with no guard:
   with a worker seam that ignores the abort signal, a run CANCELLED via
   DELETE flipped to **"completed"** when the worker later settled (§A pin
   asserted `"completed"` pre-edit — the fail-open on record). Reachability:
   the REAL worker resolves "cancelled" on abort (worker.ts checks
   `signal`/`processResult.cancelled`), so the overwrite needs a runner that
   ignores its abort signal — defense-in-depth at the store boundary, the
   same latent class as B16.0.20's execute gate and B16.0.21's transition
   gate. **Corrected**: `if (TERMINAL.has(job.record.status)) return;` on
   BOTH settle paths; the pin now asserts `"cancelled"`; the guard is
   source-gated (×2) in the confinement suite. **CONFIRMED**.
4. **§G local-error provider-blame (AI route)** — every in-loop LOCAL failure
   (no tool call, unknown tool name, malformed tool input, unknown
   test/model/run id) was funnelled into `providerErrorResponse` and returned
   **503 blaming the provider** (`reason: "unknown"`), spending the caller's
   retry logic on a non-provider fault (§A pinned the 503s verbatim
   pre-edit). **Corrected** by the provider-invocation-only error split (the
   B16.0.17.1 protocol): local failures now return deterministic local 422
   codes (`SPICE_AI_NO_TOOL_CALL`, `SPICE_AI_TOOL_INPUT_INVALID`,
   `SPICE_AI_REQUEST_INVALID`); a genuine provider rejection alone keeps the
   503 provider envelope (pinned stable). **CONFIRMED**.

## Recorded as-is (not defects, not changed)

- Assignment of run-plan ids/batch ids is NON-idempotent by design (every
  POST mints fresh ids; no idempotency key exists in the contract) — recorded
  in [run-lifecycle-proof.md](run-lifecycle-proof.md). **CONFIRMED**.
- An unrecognized `body.provider` on the AI route silently falls back to
  "openai" (`requestedProvider`) — historical routing preserved and pinned.
  **CONFIRMED**.
- The smoke-test spawn inherits the full server environment (server-owned,
  not caller-influenced) — see
  [unknowns-and-owner-decisions.md](unknowns-and-owner-decisions.md).
