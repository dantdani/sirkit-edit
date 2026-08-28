# Replacement-authority authentication boundary (§A / R1)

## Before (the defect)
`POST /api/replacement-authority` consumed and validated the body, derived
tenant/branch from LOCAL CONSTANTS (`"local"`/`"main"`), took the projectId
from `body.scope` as an unauthenticated locator, and then resolved the durable
component-authority source and pin-facts source — with NO authentication of any
kind. An anonymous same-origin caller received `503 "no durable authority
source is configured"` (or `503 "fresh component authority could not be
resolved"` with a configured source), never `401`/`403`; a cross-origin caller
was likewise not refused. The instrumented pre-edit probe proved the source
factory was invoked (count=1) for an explicitly unauthenticated request.

## After
The handler's FIRST statement is the ONE shared boundary:

```
const authorized = await authorizeRequest(req);
if (!authorized.ok) return authorized.response;
```

`authorizeRequest` enforces, from the exact route policy row
(`read("/api/replacement-authority", ["POST"], …, EDITORS)`), in order:
exact-origin CSRF (POST row ⇒ `requiresCsrf`), authentication, active project
membership for the SELECTOR-named project, and the editor-class role set
(`pcb_editor | reviewer | project_admin | automation`). It consumes NO body.
Only after it succeeds does the handler:
1. read the body through the unchanged bounded reader (16 384-byte UTF-8
   ceiling, 10 s hard read deadline, abort propagation, 413/408/400);
2. validate the closed key set, the REQUIRED well-formed nonce, and the
   component/revision identifiers;
3. resolve the component-authority source and pin-facts sources — with the
   TRUSTED scope only.

## Scope disposition (supersedes B14.1 §C's local-only note)
- `tenantId` / `projectId` / `branchId` derive EXCLUSIVELY from
  `TrustedRequestContext` (project selector headers verified against the
  session's live membership). The `LOCAL_TENANT_ID` / `LOCAL_BRANCH_ID`
  constants are DELETED; no body field selects data.
- `body.scope` remains OPTIONAL as a post-authentication locator CROSS-CHECK:
  if present it must exactly match the trusted scope, else `403` ("the request
  scope does not match the authenticated project scope") BEFORE any source
  resolution. A request without `body.scope` works identically.
- The response `binding` echoes `{ nonce, componentInstanceId, scope:
  trustedScope }` so the channel verifies the server operated on its exact
  project.

## The production channel (client side)
`app/lib/project/replacement-reauthorization.ts`:
- the transport now receives `projectSelectorHeaders(request.scope)` (the
  existing selector authority) and the production fetch merges them into its
  headers — same-origin, `no-store`, `redirect: "error"`, internal abort
  threading all unchanged;
- the response-binding verification now compares the FULL returned trusted
  scope (`tenantId` + `projectId` + `branchId`) against the request's exact
  scope (previously hard-coded `"local"`/`"main"`);
- nonce correlation, one-shot burn semantics, the hard transport deadline,
  the streaming response byte ceiling, and the allowlisted parse are
  byte-for-byte preserved.

## Refusal matrix (all proven against the REAL handler, with zero body pulls
## and zero source/facts resolutions on refusal)
| caller | result |
|---|---|
| anonymous, same-origin, valid body | 401 |
| authenticated, cross-origin (production CSRF) | 403 |
| viewer / commenter | 403 |
| revoked membership | 403 |
| member of a DIFFERENT project (selector names this one) | 403 |
| body-scope smuggle (scope ≠ authenticated project) | 403 |
| body actor/role/tenant/principal claims | 400 (unexpected key, refused BY NAME) |
| permitted member, source unconfigured/failing | 503 — ONLY after authorization |
| permitted member, absent/malformed nonce | 400 — before source resolution |

No development principal, local fallback, body actor, or spoofable identity
header was introduced; identity headers remain project SELECTORS only
(membership is reloaded server-side), and the B14.2/B14.3 import boundaries,
one-shot channel semantics, and deterministic recompile/approval protections
are unchanged (their suites are green).
