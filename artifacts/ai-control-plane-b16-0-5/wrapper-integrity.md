# B16.0.5 §D — Wrapper integrity: no raw Request reaches a callback

B16.0.4 claimed the audited wrapper callbacks "cannot access the raw Request",
but the wrappers passed `request: Request` in the callback input object. A
callback could therefore re-read the body unbounded, re-derive identity from
headers, or read `Cookie`/`Authorization`. B16.0.5 removes that.

## The corrected callback surface

In [`app/lib/auth/route-handlers.ts`](../../app/lib/auth/route-handlers.ts) the
callback inputs now carry ONLY:

| Wrapper | Callback input |
|---|---|
| `authenticatedJsonRoute` | `{ context, body, bytes, meta }` |
| `authenticatedRoute` (no body) | `{ context, meta }` |
| `workerJsonRoute` | `{ principal, body, bytes, meta }` |
| `publicJsonRoute` | `{ body, bytes, meta }` |

where `meta: RequestMeta = { method, pathname }` is the ONLY request-derived
data — explicitly non-secret. There is **no** `request`, `headers`, `cookie`,
or `authorization`. `body` is the already-parsed, already-bounded value; the raw
`Request` never leaves the wrapper.

Because the wrapper runs authorization (and, for the JSON kinds, the media-type
check + bounded body read) FIRST and only then invokes the callback, a wrapped
route is guaranteed by construction: authorize → 415-or-bounded-body → callback,
with the callback unable to touch the raw request.

## Proof

[`b16-0-5-media-type-and-wrapper.test.ts`](../../app/api/__tests__/b16-0-5-media-type-and-wrapper.test.ts)
drives the real `authenticatedJsonRoute` with a request carrying `cookie` and
`authorization` headers and asserts the callback input keys are exactly
`["body", "bytes", "context", "meta"]`, with no `request`/`headers`/`cookie`/
`authorization` property and `meta` limited to `["method", "pathname"]`.
