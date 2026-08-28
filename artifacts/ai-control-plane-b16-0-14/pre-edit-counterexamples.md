# B16.0.14 §A — Pre-edit reproductions & recorded facts

[`app/api/__tests__/b16-0-14-tranche-parity.test.ts`](../../app/api/__tests__/b16-0-14-tranche-parity.test.ts)
was written against the PRE-migration raw handlers and run GREEN (**13/13**),
recording two load-bearing facts before any production edit:

## Fact 1 — apply-authorization media behavior (RECORDED, not assumed)

The mandate required determining whether text/plain JSON is historically
accepted. Running the raw handler with `Content-Type: text/plain`:

```
APPLY media text/plain → status=415 body={"ok":false,"code":"body-unsupported-media-type"}
```

**text/plain is REJECTED** — the route's own bounded reader
(`readBoundedJsonBody`) defaults `requireJsonContentType: true`, and the route's
legacy code mapping renders the reader's `unsupported-media-type` reason as
`body-unsupported-media-type` at 415. The migration preserves this EXACT legacy
code (not the wrapper's generic `AUTH_MEDIA_TYPE_UNSUPPORTED`) via the
selector-envelope refusal contract.

## Fact 2 — assign/suggest SSRF counterexample (safe fake fetch, no network)

Driving the raw handler from a synthetic attacker origin with a fake `fetch`:

```
SUGGEST internal fetch URL (PRE): http://synthetic-attacker.example/api/pcb/footprints/search?q=SOIC-8&limit=10&padCount=2
```

**The request origin DETERMINED the internal search URL** — a
`new URL(req.url).origin` was concatenated into the fetch target, so a spoofed
Host/origin steered the server's own outbound request (an SSRF surface). No
real network request was made (the fetch was a spy). Post-migration this is
CLOSED: the route performs zero fetches and calls the shared service directly
([ssrf-and-raw-origin-closure.md](ssrf-and-raw-origin-closure.md)).

## Other pinned pre-edit contracts (kept green pre = post)

- apply-authorization: CSRF-before-body (production cross-origin → 403, zero
  body pulls), 413 `payload-too-large`, 400 `invalid-json`, `scope-required`,
  `scope-malformed`, 401 unauthenticated (no membership evidence), 403
  revoked/foreign (no role/revision leak), exact success snapshot with
  server-derived role/principal/revision + trusted scope, body role ignored;
- assign/suggest: anonymous 401 / invalid component 400 with zero provider &
  search work; full loop with pad-count enforcement, hallucinated-id drop,
  confidence clamp, ≤3 candidates; search-limit 3; provider failure → 503.
