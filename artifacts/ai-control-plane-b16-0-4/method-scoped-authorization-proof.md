# B16.0.4 §A — Method-scoped, load-bearing authorization analysis

## What changed from B16.0.3

B16.0.3 detected authorization at **file** granularity: a `route.ts` was
"authorized" if the shared boundary (`authorizeRequest`) appeared anywhere in
the file. That is unsound for three real shapes:

1. **Sibling laundering** — a guarded `GET` in the same file made an unguarded
   `POST` look protected.
2. **Ignored result** — `await authorizeRequest(req)` whose result is never
   consulted returns no refusal; work proceeds regardless.
3. **Late boundary** — a durable/provider/body read that runs *before* the
   boundary already leaked before any refusal could fire.

B16.0.4 replaces file-level detection with **per-exported-method** analysis
(`analyzeMethodBoundary(source, method, filePath, rootDir)` in
[`app/lib/auth/__tests__/_boundary-analysis.ts`](../../app/lib/auth/__tests__/_boundary-analysis.ts)).

## The three properties proven per method

For every exported HTTP method whose route policy has `requiresAuth`, the
analyzer proves the authorization result is:

- **Present & method-scoped** — the boundary is reached on *this* method's own
  control-flow entry, not borrowed from a sibling export.
- **Load-bearing** — a refusal is actually *returned or thrown* on the failure
  branch (`return authorized.response` / `if (!g.ok) return g.response` /
  wrapper refusal). A boundary whose result is discarded fails.
- **Dominant** — no body read, durable/service call, provider call, process
  spawn, or mutation is sequenced *before* the boundary on any path. The first
  awaited side-effecting call in method-entry order must be the boundary (or a
  small allowlist of pre-auth primitives: `requireSameOrigin`, the bounded
  readers' pure refusal helpers).

## How dominance is proven without solving arbitrary control flow

AST analysis cannot decide arbitrary control flow, so the analyzer recognizes a
closed set of **audited guard shapes** and rejects everything else (fail
closed):

- **Wrapper form** — `export const POST = authenticatedJsonRoute(opts, handler)`
  and its siblings (`authenticatedRoute`, `workerJsonRoute`, `publicJsonRoute`
  — the `APPROVED_ROUTE_WRAPPERS` set). The wrapper
  ([`app/lib/auth/route-handlers.ts`](../../app/lib/auth/route-handlers.ts))
  runs `authorizeRequest` **first by construction**; the handler callback
  literally cannot execute until the boundary succeeds and the bounded body is
  read. This is the "small audited higher-order wrapper whose callback cannot
  run until the boundary succeeds" the stage offered.
- **Guard-first Shape A** — `const g = await authorizeRequest(req); if (!g.ok)
  return g.response;` (and `g.kind !== "authenticated"` refusals) as the first
  statements.
- **Guard-first Shape B** — an inline `if (!boundary(req)) return <refusal>`
  (e.g. the worker route's `timingSafeEqual` secret check).
- **Factory delegation** — `export const POST = createXHandler(...)`: the
  analyzer follows the imported factory to its returned closure and analyzes
  *that* closure with the same rules (bounded depth 4, memoized; an opaque or
  unresolvable factory is treated as dangerous → reject).

Anything the analyzer cannot positively classify as one of these is rejected.

## Purity model (why benign pre-auth statements don't trip dominance)

A method may run *pure* preamble before the boundary (destructuring, local
predicate helpers, `new TextDecoder()`, reading `LLM_PROVIDER_IDS` constants).
The analyzer computes a purity fixpoint over **module-top-level** declarations
only:

- `computeSafeDataRoots` — top-level `const` data (unwrapping `as const` /
  parens / `satisfies`) is a safe root.
- `computeImpureModuleConsts` / `moduleDangerousRoots` — imported service
  objects and impure module consts are dangerous roots.
- `computeSafeLocalCallees` — a fixpoint over local functions: a local callee is
  safe if its body only calls params, safe globals, other safe locals, or member
  calls whose root is not dangerous.
- `isImportedCalleePure` / `isFunctionPure` — bounded, memoized cross-file
  purity for imported callees; opaque ⇒ dangerous.

A call whose root reaches a dangerous root before the boundary is a dominance
violation. This is why `chat` and `apply-authorization` (which run same-origin
CSRF + bounded reads as pure pre-auth primitives, then select identity) pass,
while a `getDb().select()` or `llmRouter.generate()` before the boundary fails.

## Result

All **121** protected exported methods across `app/api` prove their own
load-bearing, dominant boundary — **zero rejects** (118 guard-first, 3 factory).
See [route-authorization-and-body-matrix.md](route-authorization-and-body-matrix.md)
for the per-method verdicts. The negative tripwires that keep the analyzer
honest are in [authorization-tripwires.md](authorization-tripwires.md).
