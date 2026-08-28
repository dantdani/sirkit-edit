# B16.0.22 §D — footprint-resolution proof

All pins pre = post.

- **Read-only evaluation**: every success envelope carries `readOnly: true`;
  the service is a pure evaluator over the physical-binding repository.
  **CONFIRMED**.
- **Scope + schema forcing**: `scopedRequest` stamps
  `schemaVersion: sirkit.footprint-resolution-request.v1` and the TRUSTED
  tenant/project/branch/actorContext over any browser-supplied values —
  spy-argument pin. Batch requests are individually re-stamped; a non-object
  batch item throws `FR_BATCH_REQUEST_INVALID` (422 mapper). **CONFIRMED**.
- **Cancellation**: the request abort signal reaches `resolve` / `explain` /
  `resolveBatch` ONLY through the declared `exposeAbortSignal` input (code
  gate: no `request.signal`); a service `FR_REQUEST_CANCELLED` surfaces as
  **408**. The §A pin asserts the second service argument is an
  `AbortSignal`. **CONFIRMED**.
- **Input floors**: missing request → 400 `FR_API_REQUEST_REQUIRED`; batch
  without `requests[]` → 400 `FR_API_BATCH_REQUIRED`; malformed legacy
  observation → 422 `FR_LEGACY_OBSERVATION_INVALID`; unknown operation → 400
  `FR_API_OPERATION_UNSUPPORTED`. **CONFIRMED**.
- **GET** was already canonical since B16.0.8 (static capability document) —
  unchanged; the tranche migrated POST only, completing the family.
  **CONFIRMED**.
