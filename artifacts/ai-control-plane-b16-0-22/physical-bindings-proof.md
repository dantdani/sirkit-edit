# B16.0.22 §F — physical-bindings proof

All pins pre = post.

## GET

- Missing `setId` → 400 `PB_API_SET_ID_REQUIRED` BEFORE any repository read
  (spy uncalled). Unknown set → 404; foreign-scope set → 403
  `PB_API_SCOPE_FORBIDDEN`. **CONFIRMED**.
- **Legacy-raw redaction is role-gated on the TRUSTED role**:
  `includeLegacyRaw=true` as pcb_editor still yields
  `rawFields: { redacted: true }`; as project_admin the raw fields are
  returned; migration-record `rawFields` are stripped for EVERYONE.
  **CONFIRMED** (byte-exact pins).

## POST (six operations, dispatch unchanged)

- `create_candidate`: requires candidate + idempotencyKey (else 403
  `PB_API_CREATE_FORBIDDEN`); candidate scope must byte-match the trusted
  scope (else 403 `PB_API_SCOPE_FORBIDDEN`); the built candidate's
  `origin.actor` and `createdBy` are FORCED from the trusted scope (spy pin:
  browser-supplied `actorId:"evil", actorKind:"ai"` overwritten with
  `u1`/`human`/`pcb_editor`); the idempotency key passes through verbatim →
  201. **No partial commit**: every refusal returns before
  `service.createCandidate`. **CONFIRMED**.
- `transition`: setId+transition floors (400); set loaded and scope
  byte-matched BEFORE the service transition runs (spy uncalled on foreign
  scope); actor + timestamp forced server-side. **Revision checks** live in
  the domain service (`PB_*STALE/CONFLICT` → 409 mapper) — unchanged and
  covered by the standing domain suites. **CONFIRMED**.
- `migrate_legacy`: admin-only (editor → 403 `PB_API_MIGRATION_FORBIDDEN`);
  actorKind forced `system_migration` in the unchanged callback. **CONFIRMED**.
- `bind_atomic_selection` / `assess` / `validate` floors → exact 400 codes;
  unknown operation → 400 `PB_API_OPERATION_UNSUPPORTED`. **CONFIRMED**.
