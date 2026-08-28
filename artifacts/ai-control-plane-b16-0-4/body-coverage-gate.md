# B16.0.4 §C — Automatic body-coverage gate (zero allowlist)

## What it replaces

B16.0.2 enforced bounded-body coverage with a hand-maintained
`BOUNDED_CONSUMERS` allowlist of 11 routes. An allowlist is a standing lie: a
new route added tomorrow with a raw `await req.json()` is invisible to it, and a
route removed from the list silently drops coverage. B16.0.4 deletes the
allowlist and replaces it with **automatic discovery**.

## The gate

In [`app/lib/auth/__tests__/b16-0-2-gates.test.ts`](../../app/lib/auth/__tests__/b16-0-2-gates.test.ts)
(describe `B16.0.4 §C — no production API route directly consumes the request
body`):

1. Enumerate **every** `route.ts` under `app/api` (recursive, excluding
   `__tests__`).
2. Run `directBodyReads(source, rel)` — an AST pass (not a regex) that finds
   every call to a body-consuming API on the handler's request parameter.
3. Assert the union of offenders is **`[]`**.

Because it discovers routes from the filesystem, a newly-added unbounded route
fails the gate **without anyone editing an allowlist**. This is the invariant
the migration ([bounded-body-migration.md](bounded-body-migration.md)) makes
true and the gate keeps true.

## What `directBodyReads` detects (AST, not text)

- `request.json()`, `.text()`, `.arrayBuffer()`, `.blob()`, `.formData()`;
- `request.body.getReader()` — including through a non-null assertion
  (`request.body!.getReader()`) and parentheses;
- reads through an **aliased** request (`const r = request; await r.json()`) —
  aliases are seeded transitively from the handler's request parameter;
- conventional parameter names (`req`, `request`) even when a handler is defined
  by delegation.

Comments and string literals that merely mention `request.json()` are **not**
flagged (it is an AST walk, so `"request.text()"` in a string and
`/* request.json() */` in a comment are inert). A bounded read
(`readBoundedJsonObject`) is correctly **not** an offender.

These detection guarantees are pinned by their own tripwires in
[authorization-tripwires.md](authorization-tripwires.md)'s companion §C block
(each body API, the aliased request, the `body.getReader()` form, and the
negative "bounded read / comment / string" case).

## A companion positive assertion

The gate also asserts that any route whose source uses a bounded reader actually
imports it from the audited module — a route cannot fake coverage by shadowing
the reader name locally.

## Result

**0** offenders across all `app/api` handlers. See the generated
[route-authorization-and-body-matrix.md](route-authorization-and-body-matrix.md)
§C table for the per-route reader/offender breakdown.
