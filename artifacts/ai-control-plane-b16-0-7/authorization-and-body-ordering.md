# B16.0.7 — Authorization & body ordering

## The invariant

Authorization must strictly DOMINATE all body/durable/provider/process/mutation
work, and the refusal path must ONLY refuse. Concretely, for any guarded handler:

1. nothing runs between the authorization boundary and its refusal;
2. the refusal branch performs no durable/provider/body/mutation work;
3. the media-type check and bounded body read happen only on the authorized path
   (415 before the first body pull; `no-store`; deadline/ceiling/abort settle
   exactly once).

## How it is enforced

- **By construction (target)** — the canonical wrappers run policy → identity →
  role/CSRF → media → bounded read → validate → callback, as runtime code. A
  wrapped route CANNOT reorder these or place work in a refusal branch, because
  the callback only runs after all boundaries succeed and never sees the raw
  request. This is the primary enforcement the migration delivers.
- **By analysis (defense in depth, enforced today)** — `analyzeHandlerBody` now
  rejects R1 (work between authorization and refusal) and R2/R3 (work inside the
  refusal branch), and requires an async boolean boundary binding to be awaited
  (R4). Union boundaries require an awaited `!x.ok` refusal; boolean boundaries a
  bare negation (awaited if async); unknown contracts reject. See
  [post-edit-results.md](post-edit-results.md).

## Behavioral guarantees (already proven for the wrappers)

The existing wrapper behavioral suite
([`app/api/__tests__/b16-0-5-media-type-and-wrapper.test.ts`](../../app/api/__tests__/b16-0-5-media-type-and-wrapper.test.ts))
proves, for the real `authenticatedJsonRoute`:

- authorization failure → refusal with ZERO body pulls;
- media refusal → 415 `no-store` before the first pull;
- the callback input has no raw `Request`/`Headers`/`Cookie`/`Authorization`.

The additional §F behavioral matrix (wrong role / revoked membership / foreign
project / CSRF; deadline/ceiling/abort settles once; callback cannot execute
before all boundaries succeed) is to be extended per wrapper as the migration
adds the streaming/selector variants — tracked in
[migration-and-rollback.md](migration-and-rollback.md).
