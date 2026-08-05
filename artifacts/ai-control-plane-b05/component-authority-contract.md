# B05 — Component Authority Contract

Authoritative code: `app/lib/engineering/component-authority.ts` (pure
inspector over explicitly supplied records; facet-state vocabulary from
`app/lib/physical-binding/types.ts`).

## Authority states (closed vocabulary)

| State | Meaning |
|---|---|
| `verified-exact` | Selected exact part + available footprint asset + verified pin/pad mapping + approved |
| `exact-missing-footprint` | Exact selection exists but footprint/mapping/approval authority is incomplete |
| `candidate-only` | Only catalog search candidates exist — candidates are NEVER authority |
| `unresolved` | A record exists but no exact selection authority |
| `stale` | Binding or mapping is stale against its source |
| `conflicted` | Conflicting binding records present — must be resolved, never auto-picked |
| `unknown` | No record and no candidates for the requested component |

## Per-component facts

Each summary distinguishes: exact part (MPN + manufacturer + package +
provenance — present ONLY under selection authority), footprint-binding
availability, pin/pad mapping verification state, approval state, freshness,
conflict state, recorded permitted alternatives (exact MPNs), catalog
candidates (labelled as candidates), evidence references, and named
authority gaps.

## Hard rules (all tested)

- An exact component or footprint is NEVER inferred from display text.
- Search results are never treated as selected authority — a component with
  only candidates reports `candidate-only` with `exactPart: null`, even when
  a candidate carries a tempting exact MPN.
- AI reranking is not an input to this model at all.
- Unknown facts are returned as explicit `"unknown"`, never invented.
- The output vocabulary is a closed allowlist; credential-bearing or
  supplier-internal fields cannot appear (evidence refs are ids/digests).
- Deterministic ordering (componentId; sorted alternatives/candidates/gaps).

## Fixtures

`__tests__/b05-read-invocation.test.ts` pins: verified exact binding,
unresolved component, stale binding, conflicting binding, candidate-only
search result, and exact component with missing footprint authority.
