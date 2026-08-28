# B16.0.4 §D — The replacement-authority success test now requires EXACT 200

## The defect

B16.0.3's successful-path test for `POST /api/replacement-authority` asserted
`expect([200, 503]).toContain(res.status)` with a stub source
(`{ bindings: { loadForComponent: async () => [] }, atomic: async () => null }`).
An empty binding set makes the loader return no authority → the route answers
**503**. So the test's binding assertions (`nonce`, `component`, `scope`) were
guarded behind `if (res.status === 200)` and, in practice, **never executed** —
the "success" test proved a failure path and asserted nothing about the
authorization-bound response.

## The fix

[`app/api/replacement-authority/__tests__/b16-0-3-route-auth.test.ts`](../../app/api/replacement-authority/__tests__/b16-0-3-route-auth.test.ts)
now drives the **real 200 path** with a genuinely valid durable authority
aggregate, mirroring the B14 route coverage:

- `validApprovedAggregate("u1-id", { scopeOverrides: { tenantId: "local",
  projectId: "proj-reauth", branchId: "main", boardInstanceId:
  pcbBoardInstanceId("proj-reauth"), hierarchyPath: […PCB_BOARD_HIERARCHY_PATH],
  assemblyVariantIds: [FIXTURE_AUTHORITY_VARIANT] } })` — a real aggregate
  produced through the physical-binding service under the route's **exact**
  board scope (the loader is called with `{ …trustedScope, boardInstanceId:
  pcbBoardInstanceId(trustedScope.projectId) }`, so the aggregate must carry
  that board id, hierarchy, and variant — the omission of these was why an
  earlier draft still saw 503).
- `matchingAtomicConfirmer()` — the published atomic projection agrees with the
  fixture exact identity, so exact authority is minted.
- a pin-facts source returning `RA_CURRENT_FACTS` for `rev-current` and
  `RA_TARGET_FACTS` for the fixture target revision.

The test now asserts, unconditionally:

```
expect(res.status).toBe(200);                              // EXACT — no [200,503]
expect(body.ok).toBe(true);
expect(body.records[0].componentId).toBe("u1-id");
expect(body.targetPinFacts.atomicPartRevisionId).toBe(FIXTURE_EXACT.atomicPartRevisionId);
expect(body.binding.nonce).toBe(NONCE);                    // nonce bound
expect(body.binding.componentInstanceId).toBe("u1-id");    // component bound
expect(body.binding.scope).toEqual({ tenantId:"local", projectId:"proj-reauth", branchId:"main" }); // trusted scope bound
expect(res.headers.get("Cache-Control")).toBe("no-store");
```

No provider credit is spent (the route is read/prove-only) and no live database
is touched (the durable source is the in-memory physical-binding service). The
`[200, 503]` tolerance is gone.

## The other 11 tests in the file are unchanged

The pre-existing B16.0.3 §E assertions (anonymous → 401 with zero reads,
cross-origin → 403, disallowed role → 403, revoked/foreign membership → 403,
body-scope smuggling → 403, body identity claims rejected, trusted-scope reaches
the source exactly, nonce validation) still pass — this change only replaced the
one mis-specified success case with a real 200.
