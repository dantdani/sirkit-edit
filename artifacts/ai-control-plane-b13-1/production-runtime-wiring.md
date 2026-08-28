# B13.1 §A — production runtime wiring

Module: [component-authority-runtime.ts](../../app/api/chat/component-authority-runtime.ts)

## The production default (R1/R2 closure)

`sourceFactory` now DEFAULTS to `productionSource` — a real server-owned
adapter. No production code path requires `setComponentAuthoritySourceFactory`;
the setter is test-only, paired with `resetComponentAuthoritySourceFactory`
for deterministic isolation (every B13.1 §A/§G test restores it in
`afterEach`).

`productionSource(scope)`:

- **No I/O at module import.** The repository and confirmer are constructed
  inside the resolve call, per request.
- **Bindings**: `new PostgresPhysicalBindingRepository()` adapted through the
  narrow `AuthorityBindingSource` interface — `findForComponentVariant` with
  the SHARED scope defaults (`PCB_BOARD_HIERARCHY_PATH`,
  the caller's `assemblyVariantId`), projecting ONLY `{ set, bindings }`
  (never audits/migrations/assessments/raw rows).
- **Atomic**: `loadPublishedPortableSnapshot(revisionId)` reduced to the
  allowlisted `AtomicRevisionConfirmation` projection — requiring
  `publicationState === "published"`, a present `exactPart`, `symbol`,
  `footprint`, and an APPROVED `mapping`; returns null otherwise (no exact
  authority for incomplete/unapproved snapshots).

## Fail-closed configuration

- `DATABASE_URL` unset → the resolver returns null BEFORE constructing the
  repository (`getDb()` would throw); the resource is withheld and unrelated
  chat continues (proven: §A test 2, §G test 25).
- A throwing factory (construction failure) → `resolveComponentAuthoritySource`
  catches and returns null.
- Any query/atomic failure downstream → the loader converts to
  `unavailable` → the route withholds.

## No untrusted inputs

The resolver takes only the authenticated server scope
(tenant/project/branch from the validated request scope). Authority data
and source selection can never come from the request body, browser state,
provider output, or the model — the body/editor-context contracts carry
no authority key (§G test 26 + the B13 #14 gate).
