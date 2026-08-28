# B16.0.10 — Authorization & body ordering evidence

## Before (raw handlers)

Each of the 8 routes hand-wrote: `await authorizeRequest(req)` → `if (!ok)
return response` → `readBoundedJsonObject(req, { maxBytes: 16000000,
deadlineMs: 45000 })` → business logic. Correct, but expressed per-route and
provable only by the static analyzer.

## After (canonical wrapper)

`export const POST = authenticatedJsonRoute({ maxBytes: 16_000_000,
deadlineMs: 45_000 }, async ({ body }) => …)` — ordering is RUNTIME code inside
[`app/lib/auth/route-handlers.ts`](../../app/lib/auth/route-handlers.ts):

1. exact route/method policy → `authorizeRequest` (identity + membership +
   role + same-origin CSRF);
2. principal-kind check (`authenticated` required → 403 otherwise);
3. media type (415 `AUTH_MEDIA_TYPE_UNSUPPORTED` before any body pull);
4. bounded read (16 MB ceiling / 45 s deadline / abort; 413/408/400 refusals);
5. JSON object parse;
6. ONLY THEN the business callback — which cannot reach the raw request.

## Behavioral proof (pre = post, zero assertion changes)

For every route: anonymous → 401 with **0 counted body pulls**; production
cross-origin → 403 with **0 pulls**; text/plain → 415 with **0 pulls**;
malformed JSON → 400 `AUTH_INVALID_JSON`; 16 MB + 1 → 413
`AUTH_PAYLOAD_TOO_LARGE`. All identical before and after migration
(57-pin suite run green on both sides).

## Structural proof

- `classifyRouteMethodForm` → `canonical-wrapper / authenticatedJsonRoute` for
  all 8 (exact module + original-symbol provenance);
- the §A method-boundary gate (`b16-0-2-gates`) and §C flow gate keep passing —
  the wrapped routes carry no handwritten authorization and no direct body
  reads;
- the ratchet pins TRANCHE_3 so any revert to a raw handler fails CI.
