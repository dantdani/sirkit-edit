# B16.0.7 §B/§C/§D — Canonical wrapper architecture (target)

## Why

A growing heuristic taint analyzer is the wrong PRIMARY security boundary — each
stage (B16.0.4–B16.0.6) found new fail-open holes. The durable fix is
**mandatory canonical route wrappers**: ordinary `app/api` route modules stop
implementing authorization / body ordering themselves and stop receiving a raw
`Request` in business callbacks. Ordering becomes RUNTIME code inside a tiny
audited wrapper set, not something an analyzer must infer.

## The wrappers

Existing ([`app/lib/auth/route-handlers.ts`](../../app/lib/auth/route-handlers.ts)):

| Wrapper | Protocol |
|---|---|
| `authenticatedJsonRoute(options, cb)` | authenticated JSON body |
| `authenticatedRoute(options, cb)` | authenticated, no body (GET/read) |
| `workerJsonRoute(options, cb)` | worker-secret JSON body |
| `publicJsonRoute(options, cb)` | public JSON body |

Additional narrow wrappers this stage SPECIFIES for genuinely different
protocols (to be added during migration — see
[migration-and-rollback.md](migration-and-rollback.md)):

- `authenticatedStreamingJsonRoute` — authenticated NDJSON/streaming responses
  (e.g. `/api/chat`) where the response is a stream but the request is bounded JSON;
- `publicStreamingInputRoute` — public streaming input under the bounded reader;
- `boundedNonJsonRoute` — non-JSON bounded input (explicitly classified);
- `selectorEnvelopeRoute` — the §C selector-from-body legacy surface (below).

No generic "escape hatch" wrapper is permitted.

## Ordering — runtime, not inferred

Each wrapper runs, in order:

1. resolve the exact route/method policy;
2. establish trusted identity / principal (where applicable);
3. enforce role / membership / CSRF;
4. enforce media type (415, before any body pull);
5. bounded / deadline-controlled body read;
6. parse + validate;
7. invoke the callback.

## Callback inputs (raw Request forbidden)

Callbacks receive ONLY: trusted `context` or worker `principal`; the validated
parsed `body` (or bounded `bytes`); the byte count; an `AbortSignal` where
required; and safe `meta` (`method`, `pathname`, and — for GET — parsed
`searchParams`). NEVER `Request`, `Headers`, `Cookie`, `Authorization`,
`request.body`, or a recoverable wrapper around them (B16.0.5 §D already removed
`Request` from the existing wrapper callbacks; the new variants keep that
invariant).

## §C — scope selection

Routes that derive project scope from the body migrate the trusted selector to
the project-selector HEADERS first: authorize against the trusted selector, then
bounded-read the body, then require any body `scope` to byte-match the trusted
context. Where a two-phase body selector is temporarily unavoidable,
`selectorEnvelopeRoute` reads only a strictly bounded selector envelope, does
zero provider/durable/process/mutation work, authorizes immediately after
extracting the selector, and invokes no business callback until authorization
succeeds — documented truthfully as bounded selector parsing preceding
membership authorization.

## §D — the structural adoption gate

[`b16-0-7-wrapper-adoption-gate.test.ts`](../../app/lib/auth/__tests__/b16-0-7-wrapper-adoption-gate.test.ts)
classifies every exported HTTP method (`classifyRouteMethodForm`) as
`canonical-wrapper` (resolved to `route-handlers.ts` by exact symbol), `factory`,
or `raw-function`/`raw-arrow`. It proves the negative tripwire (a raw
`export async function POST` is `raw-function`, i.e. NON-adopted) and records the
adoption baseline. It is NOT yet a hard all-adopted gate because the migration is
incomplete — see [final-verdict.md](final-verdict.md).

## Current status (honest)

Per [route-wrapper-matrix.csv](route-wrapper-matrix.csv): **0 / 153** methods use
a canonical wrapper today (3 factories, 150 raw handlers). The wrapper
infrastructure exists for the four core protocols; the route migration and the
new streaming/selector wrappers are the major remaining work.
