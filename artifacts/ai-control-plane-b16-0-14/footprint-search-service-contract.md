# B16.0.14 §F — Shared footprint-search service contract

New module: [`app/lib/pcb/footprint-search-service.ts`](../../app/lib/pcb/footprint-search-service.ts).

## Signature (Request-free)

```ts
export interface FootprintSearchInput { q: string; limit: number; padCount: number | null; smd: boolean | null; }
export async function searchFootprints(input: FootprintSearchInput): Promise<FootprintSearchHit[]>;
```

The service accepts ONLY typed, already-bounded values. It imports no HTTP/URL
type and constructs none — a structural gate asserts the source contains no
`: Request` / `: URL` / `: Headers` / `URLSearchParams` / `.origin` / `fetch(` /
`new URL(`.

## Preserved exactly (behavior)

- **input validation ownership** — callers validate/bound (the public route
  keeps its exact q/limit/padCount/smd checks and messages; the provider loop
  keeps its q-required + search-limit guards);
- **exact `Lib:Name` fast path** — `EXACT_REF_RE` → `findExact` indexed seek;
- **zero embedding calls on an exact hit**; **one embedding call for free text**;
- **vector + trigram candidate pools** via `Promise.all`, identical SQL filters
  (`isNotNull(embedding)`, padCount/smd equality, `trigramSim > 0`);
- **score** = `0.6·cosineSim + 0.4·trigramSim`, sorted desc, sliced to `limit`;
- **output shape** — `FootprintSearchHit[]` (fast-path score 1);
- **database & embedding call ordering** — byte-identical to the pre-extraction
  route body (the algorithm was lifted verbatim);
- **error mapping** — the service throws on DB failure; each consumer maps it in
  its own historical way (public route → 500 JSON; provider loop → in-band
  `search failed (...)` tool error).

## Consumers (both use the ONE service)

- `GET /api/pcb/footprints/search` — `publicRoute({ query: true })` validates,
  then `searchFootprints({ q, limit, padCount, smd })`;
- `POST /api/pcb/assign/suggest` — the `search_footprints` tool calls
  `searchFootprints(...)` directly (no HTTP hop).

No search algorithm is duplicated.
