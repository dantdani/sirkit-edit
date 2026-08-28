# B06.2 — Executor Authority Gate

Closes the B06.1 gap where replacement authority was enforced only by
`planSchematicReplacement`: a caller submitting a raw
`schematic_replace_component` operation could install atomic-authority
fields (and caller-controlled `consumedAuthorityResources`) without ever
touching the authority adapter.

## Runtime grants

`consumeReplacementAuthority` (the only authority construction path,
`schematic-authority.internal.ts`) now also REGISTERS every minted
`VerifiedReplacementAuthority` in a module-private registry keyed by a
content-derived `grantId`. The instance additionally records the scope
(tenant/project/branch) and the canonical revision it was consumed against.

The `grantId` carried by the operation is ONLY a registry handle: knowing,
guessing, or cloning the string (or the whole grant object) grants nothing —
verification always resolves the registered branded instance.

## Enforcement point

`CanonicalExecutor.execute` — the canonical execution boundary every command
takes — rejects, BEFORE any transaction, mutation, or durable record exists,
any initial `schematic_replace_component` operation that installs ANY
atomic-authority field (or claims consumed resources / a grant id) unless
`verifyReplacementAuthorityGrant` confirms ALL of:

- a registered branded grant exists for `operation.authorityGrantId`
  (`grant_missing` otherwise — serialized operation data is never proof);
- grant scope == the executing service's tenant/project/branch
  (`grant_scope_mismatch`);
- grant canonical revision == the CURRENT head revision
  (`grant_revision_mismatch` — grants are head-pinned; re-consume after any
  intervening commit);
- grant component == `operation.componentId` (`grant_component_mismatch`);
- grant target part == `operation.replacement.partId`
  (`grant_part_mismatch`);
- every installed authority field exactly equals the grant's field —
  including absence (`grant_field_mismatch`);
- operation-claimed `consumedAuthorityResources` exactly equal the grant's
  own records (`grant_resource_mismatch` — the strings are compared against
  the grant, never trusted).

Rejections surface as `unauthorized` with an
`AUTHORITY_GRANT_<CODE>` diagnostic. Only after the runtime grant validates
do the consumed resources enter durable provenance (via the accepted
transaction's recorded operation).

## Lifecycle

- **Single-use**: grants are retired when their transaction durably commits.
  Re-executing the serialized operation as a NEW execution fails
  (`grant_missing`) — serialized data can never bootstrap authority.
- **Idempotent retry**: a retry whose `clientOperationId` is already durable
  skips the gate and replays the original result (nothing new executes).
  A retry after a persistence failure still holds its unretired grant.
- **Durable undo/redo**: `executeUndoRedo` replays operations sourced
  EXCLUSIVELY from durable records (B03.1 digest-verified) — previously
  accepted replacements undo/redo without a live grant, per the replay
  exemption.
- **Catalog-unverified** replacement carries no authority fields, no
  resources, no grant id; installing even one field without a grant trips
  the gate. Stale atomic authority is still cleared by the operation.

## Honesty note

Like the B03.2 interactive channel, this is an application composition
boundary, not in-process DRM: code that can already reach the raw
transaction service sits below the supported surface. The gate guarantees
that no SUPPORTED path (session commands, executor callers, serialized or
replayed operation data, provider output) can manufacture atomic authority.
If a correct grant path is unavailable, verified replacement is simply
unavailable — catalog-unverified replacement remains, and failing closed is
the designed behavior.

Tests: `__tests__/b06-2-authority-hydration.test.ts` §1 (direct forged
operations, fabricated resource ids, cloned/retired grants, wrong
component/part/scope/revision, catalog clearing, exact-match grant success,
idempotent retry, durable undo/redo).
