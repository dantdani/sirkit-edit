# B16.0.14 §B/§C/§D — Selector-envelope wrapper contract

## Exported name & provenance

`selectorEnvelopeJsonRoute` in
[`app/lib/auth/route-handlers.ts`](../../app/lib/auth/route-handlers.ts) — the
same sanctioned canonical module as every other wrapper. Added to
`APPROVED_ROUTE_WRAPPERS` in the analyzer, so the classifier recognizes it ONLY
from that exact provenance; a local/aliased/barrel copy fails the structural
gate.

## Execution order (by construction)

1. resolve the exact route/method policy (`policyFor(pathname, method)`);
2. fail closed if the policy is missing or not `requiresAuth` → 500 `policy-missing`;
3. policy-required same-origin CSRF (`requireSameOrigin`) BEFORE any body pull;
4. declared media behavior (`requireJsonContentType`, default true) via the reader;
5. bounded/deadline body read (`readBoundedJsonBody`);
6. validate the EXACT selector envelope: `body.scope.{tenantId,projectId,branchId}` are all strings;
7. treat those fields ONLY as a selector;
8. `resolveTrustedRequestContext(request, { selector, enforceSameOrigin })` — identity → LIVE membership → server-derived role;
9. enforce the exact route policy `permittedRoles`;
10. invoke the callback with `{ context, body, bytes, meta }` (+ `signal` only if `exposeAbortSignal`).

## Options

```ts
interface SelectorEnvelopeOptions {
  maxBytes: number;
  deadlineMs?: number;
  requireJsonContentType?: boolean; // declared media behavior; default true
  exposeAbortSignal?: boolean;      // opt-in projected AbortSignal only
}
```

## Refusal contract (declarative, no Request in any mapper)

Legacy selector-envelope codes are preserved by a fixed mapping over the
reader's refusal `reason` (a string, never the Request):
`over-limit → payload-too-large`, `invalid-json|invalid-utf8 → invalid-json`,
otherwise `body-<reason>` (e.g. `body-unsupported-media-type`,
`body-timeout`), all at the reader's status with `Cache-Control: no-store`;
plus `scope-required` / `scope-malformed` (400) and `policy-missing` (500).

## Confinement (§D, runtime-proven)

The callback receives EXACTLY `{ body, bytes, context, meta }` (keys asserted)
— never Request, Headers, cookies, Authorization, raw body/stream, raw
URL/origin, an identity provider, a membership repository, or any request-like
escape. The selector extraction is fixed and declarative — there is no
arbitrary pre-auth callback. Thirteen runtime + structural proofs in
[`b16-0-14-selector-envelope-gate.test.ts`](../../app/lib/auth/__tests__/b16-0-14-selector-envelope-gate.test.ts):
cross-origin pulls zero bytes; malformed selector refuses before identity;
oversized/malformed settle once; valid-selector-no-identity → 401;
missing/revoked/foreign membership → 403; permitted role succeeds; **selector
body role/actor never determine the resolved role** (server-derived
`pcb_editor`, not body `admin`); callback exposes no Request-capable value.
