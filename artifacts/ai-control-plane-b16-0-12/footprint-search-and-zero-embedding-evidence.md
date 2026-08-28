# B16.0.12 §G — Footprint search & zero-embedding evidence

`embedQuery` is a COUNTED fake in every pin — no live embedding request occurs
anywhere in the suite.

| Claim | Pin |
|---|---|
| Exact `Lib:Name` resolution uses the indexed path | `/resolve` valid hint → exactly ONE select (the unique-index seek), zero embeddings |
| An exact search hit makes ZERO embedding calls | `/search?q=Resistor_SMD:R_0805` with a queued exact row → 1 hit, `score: 1`, `embeds` never called |
| Malformed/missing queries make ZERO embedding calls | missing `q`, >500-char `q`, bad `padCount`, bad `smd` → 400 with zero embeds AND zero selects |
| Free-text search makes EXACTLY ONE embedding call | `/search?q=small resistor` → `embeds` called once, then ≥2 selects (the vector + trigram pools) |
| Vector + trigram pools and filters identical | the pool queries, `padCount`/`smd` SQL filters, 0.6/0.4 hybrid re-rank, and result ordering are byte-preserved (only `params.get(x)` became `meta.query?.x ?? null` with identical string-or-null semantics) |
| No hidden DB/embedding metadata in output | the response shapes (`FootprintSearchHit` / `FootprintResolveResponse` / `FootprintDetail`) are unchanged; `rawSexpr` on detail remains the documented verbatim source |
| Read-only | the DB fake proves selects-only invocation |

The wrapper's 2,048-char query-value truncation now also bounds `q`/`hint`
BEFORE the route's own checks — an unbounded query string can no longer reach
the embedding call at all
([query-and-parameter-confinement.md](query-and-parameter-confinement.md)).
