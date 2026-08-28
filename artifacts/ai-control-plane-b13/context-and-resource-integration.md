# B13 — context and resource integration

## The sealed envelope

`buildAgentResourceBundle` ([context.ts](../../app/lib/agent/context.ts))
seals a `component-authority-records` envelope when the run context carries
server-owned records — NOT through the `local-working-copy` helper:

- `authoritySource: "durable-server-board"`, `authorityStatus: "verified"`;
- `sourceCanonicalRevision` pinned to the run's canonical revision digest;
- content shaped `{ records, candidates }` (the exact shape
  `buildScopedResources` expects);
- `producer: "component-authority-source"`.

The envelope thus inherits the full B05.1 bundle discipline: content
digest, manifest entry, scope pinning, revision compatibility, and
manifest-digest agreement (all validated by `validateReadResourceBundle`).

## Context assembly

`AssembleAgentContextInput` gains a SERVER-OWNED `componentAuthority`
field. The route supplies it ONLY from the loader — never from the request
body. The assembler:

- structurally validates it (bounded arrays of well-formed records;
  malformed/oversized ⇒ withhold with a warning, never widen);
- computes `componentAuthorityDigest`;
- advertises `durable-server-board` in `availableAuthority` ONLY when the
  resource is present;
- sets `context.componentAuthority` + `context.componentAuthorityDigest`
  (new `AgentRunContext` fields).

`verifyAgentContextIntegrity` (gateway) recomputes the authority digest,
and refuses when: the digest was tampered post-assembly; authority is
claimed without canonical state; authority is present but
`durable-server-board` is not advertised; or a digest is claimed without
the resource.

## /api/chat integration

After scope validation, context assembly, and the server-side
board-revision recompute, the route
([route.ts](../../app/api/chat/route.ts)):

1. resolves the durable source via `resolveComponentAuthoritySource(requestScope)` ([component-authority-runtime.ts](../../app/api/chat/component-authority-runtime.ts)) — authenticated server scope ONLY;
2. if a source exists AND canonical state exists, loads authority with
   `loadRunComponentAuthority` (deadline-bounded, `req.signal`-aware),
   using the run's canonical revision and the schematic's stable component
   ids;
3. fail-closed: unavailable/timeout/abort/empty ⇒ null ⇒ the resource is
   withheld, the tool stays unexposed, and unrelated chat tools continue —
   an empty verified set is NEVER fabricated;
4. on success, RE-ASSEMBLES the context with the server-owned records so
   the sealed bundle carries the resource; the run context, trace context
   digests, and gateway all use the re-assembled context.

In the local-only build there is no authenticated durable source, so
`resolveComponentAuthoritySource` returns null and behavior is identical
to pre-B13 (tool withheld, chat unaffected) — zero regression to the B10
route boundary tests, while the production path is fully wired and
activates the moment a durable source is configured. A late or foreign
result cannot cross runs: the envelope is scope-exact and revision-pinned,
and the re-assembly binds it to THIS run's canonical revision.

Client authority forgery is structurally impossible: `ALLOWED_BODY_KEYS`
and `ALLOWED_EDITOR_CONTEXT_KEYS` carry no authority field, `exactObjectShape`
rejects authority-shaped keys, and the assembler reads authority only from
the server-supplied input the route fills from the loader.
