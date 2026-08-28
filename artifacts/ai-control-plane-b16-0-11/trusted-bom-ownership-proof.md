# B16.0.11 §D — Trusted BOM ownership proof

## The scope is server-derived, always

Every durable BOM callback derives its ownership key through the Request-free
projection in [`app/api/bom/_scope.ts`](../../app/api/bom/_scope.ts):

```ts
bomOwnershipScope(context) === { tenantId: context.tenantId, projectId: context.projectId, branchId: context.branchId }
```

`context` is the wrapper's `TrustedRequestContext` — identity + active
membership + role + CSRF, resolved by `authorizeRequest` inside
`authenticatedJsonRoute` / `authenticatedRoute` BEFORE any body or repository
work. The behavioral pins assert every repository call
(`createSnapshot`, `listSnapshots`, `getSnapshot`, `updateNotification`,
`markAllNotificationsRead`, `deleteNotifications`, `listNotifications`)
received exactly `{ tenantId:"local", projectId:"proj-1", branchId:"main" }`.

## Forbidden authority claims — exact historical contract preserved

The seven body keys (`projectKey`, `tenantId`, `projectId`, `branchId`,
`actor`, `actorId`, `role`) are refused IN the callbacks with the exact
historical response — 400 `AUTH_AUTHORITATIVE_INPUT_FORBIDDEN`,
`` `key` is server-derived and may not be supplied. ``, `no-store` — pinned per
key per method. The wrapper's generic `forbiddenBodyKeys` option was
deliberately NOT used because its message text differs; the established BOM
contract wins (§D of the mandate).

## Cross-project impossibility (proven behaviorally)

- a caller cannot select a different project through body or query data: the
  scope never reads the body/query; the forbidden-key gate refuses the attempt
  before any repository call (0 repo calls asserted);
- a foreign snapshot id → the existing uniform 404 `BOM_NOT_FOUND` (lookup
  carried the trusted scope; the fake repo proves the predicate is id AND
  scope);
- a foreign notification id → 404, never updated;
- `markAllRead` and `DELETE olderThan` bulk operations carry the trusted scope
  (asserted on the repository mock);
- legacy unowned records remain quarantined — the repository predicates are
  unchanged (`b16-0-2-bom-ownership.test.ts` still green);
- `to=current` diff builds an UNPERSISTED snapshot: pinned that
  `createSnapshot` is never invoked, so a live diff can never change ownership
  authority.

## Unreachable-branch note

The old `bomScope` returned a `BOM_API_UNAUTHENTICATED` 401 for a
non-"authenticated" principal kind; the wrapper returns
`AUTH_UNSUPPORTED_PRINCIPAL` 403 for that branch. The branch is unreachable in
practice (these policy rows are authenticated-only, so any passing principal is
of kind "authenticated") — recorded in
[unknowns-and-owner-decisions.md](unknowns-and-owner-decisions.md), not
observable in any pinned contract.
