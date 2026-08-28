# B16.0.14 §G — Public search route parity

`GET /api/pcb/footprints/search` remains canonical `publicRoute({ query: true })`
and retains ALL of its transport ownership:

- query bounds (the wrapper's frozen `meta.query`);
- exact validation errors + statuses: `q is required` (400),
  `q must be under 500 characters` (400),
  `padCount must be a non-negative integer` (400),
  `smd must be true or false` (400);
- limit clamp (1..100, default 20);
- output shape `{ hits: FootprintSearchHit[] }`;
- zero-embedding invalid/exact paths; one-embedding free-text path.

The ONLY change: the inline algorithm is replaced by a call to
`searchFootprints(...)` from the shared service. The 500 error mapping
(`{ ok:false, error: message }`) is preserved via the route's own try/catch
around the service call.

## Proof — B16.0.12 parity unchanged

The complete B16.0.12 footprint-search parity suite
(`app/api/__tests__/b16-0-12-tranche-parity.test.ts`) passes **24 / 24**
unchanged after the extraction, including:

- `[resolve]`/`[search]` invalid queries → 0 embeddings + 0 selects;
- exact `Lib:Name` hit → score 1, 0 embeddings;
- free text → exactly 1 embedding call, then the two candidate-pool selects;
- footprint detail 404, etc.

Because the mocks target the `@/app/lib/db/client` and `@/app/lib/embeddings`
modules, they intercept the service's calls identically — the select/embed
counts are byte-identical to before the extraction.
