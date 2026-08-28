# B16.0.23 §E — run creation and lifecycle

Seven methods over the in-memory job store (`app/lib/spice/server/job-store.ts`),
scope-confined by `RunScope { tenantId, projectId, branchId }`.

- **Creation uses trusted scope + actor**: POST /runs passes
  `spiceRunScopeFromContext(context)` to `startRunPlan`; a malformed/missing
  scope throws before anything is created (`wellFormedScope`). The batch and
  every run record its trusted scope; the body's `project.id` stays a
  DISPLAY-ONLY client assertion (standing pin). **CONFIRMED**.
- **Caller-supplied ownership/status/timestamps are ignored**: run status is
  ONLY ever a server transition (queued→…→completed/failed/cancelled); the
  request body carries no writable status/owner/digest field into the store.
  **CONFIRMED**.
- **Bounded, scope-confined ids; uniform non-leaking responses**: run ids
  arrive as the wrapper's bounded `routeParams.id`; a missing OR foreign id
  returns the byte-exact `{ ok:false, code:"SPICE_RUN_NOT_FOUND",
  error:"Run not found" }` 404 — no existence oracle (pinned for both cases).
  **CONFIRMED**.
- **Cancellation explicit + race-safe**: DELETE is owner-only (foreign scope
  → 404, run never cancelled — pinned); an owner cancel is 200 → `cancelled`;
  a second cancel is 409 `Run has already finished` (pinned exact).
  `cancelInternal` refuses to re-cancel a terminal run. **CONFIRMED**.
- **DELETE cannot erase another project's run; cancellation cannot forge
  completion**: foreign DELETE is a no-op 404; and the §E/§F correction means
  a late worker settlement can NEVER flip a cancelled run to completed (both
  store settle paths guarded). Pinned. **CONFIRMED**.
- **Persistence never exposes partial commits as completed**: the store
  mutates a single record object under the in-process pool; `getRun` returns a
  `structuredClone` of the current record, and batch status is recomputed on
  every read — a run reads as its true current status, never a half-written
  completion. **CONFIRMED**.

## Recorded (as-is, not a defect)

Run/batch creation is NON-idempotent by contract: every POST mints fresh
ids; there is no idempotency key in the request shape. Retries create new
batches — the historical behavior, preserved and pinned (missing-field 400,
zero-run 422). No "idempotent where promised" claim is made because none is
promised. **CONFIRMED.**
