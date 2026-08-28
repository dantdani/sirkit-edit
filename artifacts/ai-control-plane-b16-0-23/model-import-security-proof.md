# B16.0.23 §D — model import security

`models/import` (`authenticatedJsonRoute`, WRITE_EDITORS + CSRF, 4 MB / 20 s)
is a stateless candidate VALIDATION transform — it persists nothing.

- **Bound to trusted actor + exact scope**: authorization (membership + role +
  CSRF) completes in the wrapper before the body is read; the import itself is
  a pure text transform and stores nothing, so there is no cross-tenant write
  surface. **CONFIRMED**.
- **Size + structural bounds** (`importModelText`, models.ts): unsupported
  extension → 422 (`Unsupported model file extension`); empty file → 422;
  `> 5,000,000` chars → 422 (`exceeds the 5 MB import limit`); NUL byte →
  422 (`binary data or NUL bytes`). Pinned: bad extension and NUL both 422.
  **CONFIRMED**.
- **Traversal / URL / external include fail closed at execution**: import
  parses `.include`/`.inc` targets into `candidate.dependencies`; the
  execution gate `assertModelSafeForExecution` refuses absolute include paths
  (`^\.(?:include|inc)\s+["']?(?:[A-Za-z]:[\\/]|[/\\]{2}|\/)`), `.control`,
  `.shell`/`.cd`/`.source`/`.quit`, shell escapes (`!`), command substitution
  (backticks), and ANY unresolved dependency — all BEFORE a spawn. URLs are
  never fetched anywhere in the import/smoke path. Pinned: `.control` and
  unresolved-dependency refusals both 422 with ZERO spawns. **CONFIRMED**.
- **Server-computed checksum**: the route overwrites the candidate checksum
  with `sha256(content)` (server-side) — pinned equal to `sha256` of the exact
  content, so a client cannot assert a colliding/forged digest for accepted
  authority. **CONFIRMED**.
- **No live download**: nothing in the import or smoke path performs a network
  fetch (gate: public/exec modules import no network primitive; the import
  route imports only the model lib + manifest hash). **CONFIRMED**.

## Idempotency / digest conflict (recorded)

Import is a stateless transform with no durable store, so "duplicate import"
is simply a repeated pure computation returning the same candidate + checksum
(idempotent by construction). There is no accept-and-overwrite path here to
silently clobber authority — persistence/acceptance lives outside this
tranche's routes. **CONFIRMED / owner-visible.**
