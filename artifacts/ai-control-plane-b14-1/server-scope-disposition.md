# B14.1 §C — the honest scope disposition

> **SUPERSEDED IN PART by B14.2**: the UTF-8 byte bounds below were
> measured AFTER buffering (`req.text()` / `response.text()`); B14.2 makes
> both directions STREAMING through the shared bounded reader, and adds the
> required request-nonce validation + allowlisted binding echo. The honest
> local-only scope disposition itself is unchanged. Historical text below is
> preserved unmodified.


## The defect (R3)

The reauthorization endpoint read tenant/project/branch from `body.scope`
and handed them to the durable loader while claiming "authenticated server
scope". No authenticated server session exists anywhere in this
application: it is LOCAL-ONLY (single tenant "local"), with no auth layer,
no session store, and no server-side project registry. Calling request-body
data "authenticated" was false.

## The honest boundary (inspected architecture first)

There is no existing authenticated server scope resolver to use, so the
endpoint enforces what the architecture can actually support and documents
the rest as UNAVAILABLE:

| field | disposition |
| --- | --- |
| tenantId | SERVER-DERIVED constant `"local"`. The client value is a locator cross-check; anything else → 403 "multi-tenant authorization is unavailable in the local-only build". A foreign tenant NEVER reaches the durable loader (proven: loader invocation count stays 0). |
| branchId | SERVER-DERIVED constant `"main"`; same cross-check + 403; never reaches the loader. |
| projectId | an UNAUTHENTICATED CLIENT LOCATOR, stated as such. No server mechanism exists to bind it (projects live in browser IndexedDB). It SELECTS durable rows; it authorizes nothing. Defence in depth: the returned facts are only usable against a sealed proposal whose scope/lineage/head the applying browser session must still match — the runtime grant is scope+revision-checked by the executor, so a foreign-project response cannot commit anywhere. |

The loader scope is SERVER-CONSTRUCTED (`{tenantId: LOCAL_TENANT_ID,
projectId, branchId: LOCAL_BRANCH_ID}`) — never the raw body object.
Multi-tenant authorization is documented as unavailable rather than
simulated.

## Additional hardening

- Request and response bounds now count UTF-8 BYTES
  (`TextEncoder().encode(...).byteLength`), not JavaScript characters —
  proven with multi-byte payloads (9 000 `€` characters = 27 000 bytes >
  the 16 384-byte bound → 413).
- The endpoint remains read/prove-only, allowlisted, `no-store`,
  abort/deadline settled, and structurally unable to accept
  browser-selected target assets (unknown keys refuse by name; the target
  revision derives from the durable record).

## Honesty corrections elsewhere

The endpoint's header comment and the B14 artifacts
(`authority-reauthorization-boundary.md`, `api-chat-integration.md`,
`final-verdict.md`) carried supersession notes: request-body scope was
never authenticated, and digest equality never authenticated provenance.
