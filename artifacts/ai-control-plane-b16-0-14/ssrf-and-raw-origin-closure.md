# B16.0.14 §H/§J — SSRF & raw-origin closure

## The pre-edit surface (recorded)

The raw `assign/suggest` computed `const origin = new URL(req.url).origin` and
built `fetch(\`${origin}/api/pcb/footprints/search?...\`)`. A synthetic
attacker origin therefore steered the server's own outbound request — recorded
verbatim in [pre-edit-counterexamples.md](pre-edit-counterexamples.md):

```
http://synthetic-attacker.example/api/pcb/footprints/search?q=SOIC-8&limit=10&padCount=2
```

## The closure

- the route is now `authenticatedJsonRoute` — the callback never receives the
  Request or URL, so no `req.url`/origin exists to read;
- `const origin = new URL(req.url).origin` is DELETED;
- the `search_footprints` tool calls the Request-free `searchFootprints(...)`
  directly — **no `fetch`, no URL constructed, no Host/forwarded-host consulted**.

## Runtime + structural proof

| Proof | Evidence |
|---|---|
| Attacker origin performs ZERO fetch | pin: synthetic-attacker origin → `fetch` spy never called; `searchSvc` called once with `{ q, limit:10, padCount, smd }` |
| No fetch anywhere in the route | gate: route source has no `fetch(` |
| No request URL/origin/host read | gate: no `new URL(` / `req.url` / `request.url` / `.origin` / `x-forwarded-host` / `"host"` in the route source (comments stripped) |
| Service cannot construct a URL | gate: service source has no `: Request`/`: URL`/`: Headers`/`URLSearchParams`/`.origin`/`fetch(`/`new URL(` |
| No SSRF-capable URL is constructible | the only search path is the typed service call; the search destination is code, not any request-derived value |
