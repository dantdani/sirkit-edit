# Engineering-export truth boundary (§G / R8)

## Two distinct paths
- `/api/pcb/release` — server-authoritative VERIFIED manufacturing release,
  **admin-only** (`project_admin`), release-class. Reloads its own immutable
  durable source; a browser board can never be release authority. UNCHANGED.
- `/api/pcb/export/gerbers` — CLIENT-WORKING-COPY ENGINEERING PROTOTYPE EXPORT
  only. NOT a verified release; unsuitable as deterministic release evidence.

## What R8 closed on the engineering path
- **Protected**: authenticated project membership + engineering role
  (`pcb_editor | reviewer | project_admin`) + same-origin CSRF, through the
  shared `authorizeRequest` boundary, BEFORE the body is read or kicad-cli runs.
  Anonymous → 401 (no byte pulled); viewer → 403; foreign project selector →
  403.
- **Truthful attribution**: `body.actor`, `body.projectIdentity` (and
  `actorId/role/tenantId/projectId/branchId/principalId`) are REFUSED (400). The
  ONLY attribution source is `engineeringExportAttribution(context)` — actor =
  `human:<principalId>`, project = `<tenant>/<project>/<branch>` — derived from
  `TrustedRequestContext`. The waiver's actor is the verified principal.
- **Labelled unverified**: response headers `X-Sirkit-Engineering-Export:
  not-verified-release`, `X-Sirkit-Export-Notice`, `X-Sirkit-Export-Attribution-
  Source: trusted-request-context`; the bundle README (both kicad-assisted and
  native) and the preflight body carry the engineering notice; disposition is
  `engineering_prototype_export`. `releaseMode: "verified"` is refused (409,
  points at `/api/pcb/release`) — only `engineering` produces an artifact here.

## No button routes a "verified release" to this path
`useFabExport` posts `releaseMode: "engineering"` ONLY (never a `verified`
ternary); a verified request without a server-authoritative `verifiedRelease`
flow is refused in the hook, not routed to the legacy path. The browser sends no
actor/projectIdentity (source-pinned).
