# B16.0.7 §E — Raw Request confinement contract

## Target contract

Outside a tiny, exact-path set of modules, no production business module may:

- accept a `Request` parameter;
- declare a callback type containing `Request` or `Headers`;
- pass, return, store, wrap in a container, assign to a property, capture in a
  closure, or construct with a `Request` / `request.body` / body-reading method.

The ONLY production modules permitted to handle `Request` directly:

| Module | Role |
|---|---|
| `app/lib/auth/route-handlers.ts` | the canonical route wrappers |
| `app/lib/auth/authorize.ts` | `authorizeRequest`, `scopedTrustedJson` |
| `app/lib/auth/request-security.ts` | `requireSameOrigin`, `requireJsonContentType`, `isJsonContentType` |
| `app/lib/auth/trusted-request-context.ts` | `resolveTrustedRequestContext` |
| `app/lib/auth/worker-principal.ts` | `verifyWorkerSecret` |
| `app/lib/http/bounded-json.ts`, `app/lib/http/bounded-stream.ts` | the bounded readers |

Plus each family `_scope.ts` boundary until its route migrates to a wrapper.

## What is enforced TODAY (analyzer/flow gate — defense in depth)

The B16.0.6 provenance flow gate, EXTENDED in B16.0.7, already rejects at the
`app/api` route surface (permanent tests in
[`b16-0-7-analyzer-hardening.test.ts`](../../app/lib/auth/__tests__/b16-0-7-analyzer-hardening.test.ts)):

- a `Request` passed to any non-canonical consumer (resolved by exact provenance,
  fixed-point, cycles/unresolved reject);
- a `Request` in a disallowed VALUE position — object/array literal element,
  aggregate return, property write, spread (R5/R6/R9/R10/R11);
- `request.body` consumed by a stream reader, a constructor
  (`new Response(request.body)` — R7), or a for-of/for-await (R8);
- every body-reading method call, alias, destructure, container, clone.

## What is NOT yet enforced (honest)

The mandate's §E asks for a **TypeScript type-checker** pass that rejects, by
RESOLVED TYPE and exact file provenance, any `Request` parameter / `Request` in a
callback type across ALL production route-reachable modules — with the permitted
set pinned by negative tripwires. That type-checker gate is **not implemented in
this stage**; the current enforcement is the AST/flow gate scoped to the `app/api`
route handlers (and their followed helpers). Delivering the full type-driven
confinement depends on the route migration (E's "no business module may accept a
Request" only becomes true once the routes stop taking a `Request` param — i.e.
once they use wrappers). See [final-verdict.md](final-verdict.md) and
[migration-and-rollback.md](migration-and-rollback.md).
