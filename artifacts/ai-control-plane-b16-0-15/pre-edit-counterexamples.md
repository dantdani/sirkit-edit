# B16.0.15 §A — Pre-edit reproductions & recorded facts

[`app/api/__tests__/b16-0-15-tranche-parity.test.ts`](../../app/api/__tests__/b16-0-15-tranche-parity.test.ts)
was written against the PRE-migration raw handlers and run GREEN (**23/23**),
then kept green unchanged post-migration. Every durable/expensive seam is a spy
(no live routing process, DB, provider, or network). Labels: **CONFIRMED** =
observed in the pre-edit run.

## Recorded fact — the exact existing deadline (CONFIRMED)

`scopedPcbSyncJson` → `scopedTrustedJson(request, { maxBytes: 8_000_000, forbiddenBodyKeys: [...] })`
passes **no** `deadlineMs`; `readBoundedJsonObject` therefore applies
`DEFAULT_BODY_DEADLINE_MS = 30_000`. The migration adopts `deadlineMs: 30_000`
— the discovered value, not an invented one.

## Recorded fact — forbidden-key response shape (CONFIRMED)

Pre-edit, a body carrying `snapshot`/`board`/`path` returns exactly
`{ ok:false, code:"AUTH_AUTHORITATIVE_INPUT_FORBIDDEN", error:"The request body carries a forbidden authoritative field." }`
at 400 with `Cache-Control: no-store` — a **generic** message with **no key
suffix**. The canonical wrapper's built-in `forbiddenBodyKeys` option appends
`(<key>)` and would change this contract, so the check is kept **in-callback**
via `pcbSyncForbiddenAuthorityRefusal` (the same `jsonError(...)` bytes).

## Pinned pre-edit contracts (kept green pre = post)

For BOTH routes (14 refusal classes, §A):

| Class | Response |
|---|---|
| unauthenticated | 401, zero work |
| wrong-project membership | 403, zero work |
| revoked membership | 403, zero work |
| production cross-origin CSRF | 403, **zero body pulls**, zero work |
| text/plain media | 415 `AUTH_MEDIA_TYPE_UNSUPPORTED`, no-store |
| invalid JSON | 400 `AUTH_INVALID_JSON` |
| oversized (8 MB + 1) | 413 |
| pre-aborted body | 400 `AUTH_BODY_ABORTED`, zero work |
| missing designId/boardId | 400 `MFG_API_SCOPE_REQUIRED`, zero work |
| forbidden snapshot/board/path | 400 `AUTH_AUTHORITATIVE_INPUT_FORBIDDEN`, zero work |

Trusted-scope + locator (§D/§E):

- qualify: the durable board read receives exactly
  `{ tenantId, projectId, branchId, boardId }` from the TRUSTED context (body
  `boardId` only); a bogus body field is ignored;
- qualify ineligible design → 422 `MFG_AUTONOMOUS_INELIGIBLE` with the router
  NEVER created and no authority saved;
- release missing authority → 404 `MFG_AUTHORITY_NOT_FOUND`, `releaseManufacturingPackage`
  never called;
- release locator = trusted context + validated ids + **stored** authority
  `boardRevision`/`boardDigest`; attacker body `boardRevision`/`boardDigest`
  ignored;
- release `format="manifest"` exact JSON; default → ZIP bytes + all headers.
