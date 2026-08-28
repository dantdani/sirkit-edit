# Authorization gate and negative tripwires (§B / R2)

## The exception is gone
`KNOWN_NON_BOUNDARY_ROUTES` is DELETED from
`app/lib/auth/__tests__/b16-0-2-gates.test.ts`. Zero authenticated-route
exceptions exist, and a source-pin inside the gate itself asserts the marker
string is absent (built by concatenation so the assertion is not a self-match).
Every route whose policy row has `requiresAuth` — `/api/replacement-authority`
included — must now pass the structural boundary check.

## From text scan to structural analysis
The B16.0.2 gate matched helper NAMES with a regex over the raw source (plus
ancestor `_scope.ts` text), so a comment, a string literal, a type position, an
unused import, or unreachable code containing an approved name would have
satisfied it. B16.0.3 replaces that with the repository's own TypeScript
compiler API (`app/lib/auth/__tests__/_boundary-analysis.ts` — test-only; it
never enters the production runtime graph):

- **A real call**: a `CallExpression` whose callee identifier is one of the
  approved helpers.
- **Genuinely imported**: the callee must be bound by a VALUE `import` in the
  same file (`import type` and `import { type X }` are excluded), and a LOCAL
  same-named declaration (shadowing) disqualifies it.
- **Reachable**: the call must not sit inside a statically-false `if`, the dead
  branch of a statically-true `if`, or after an unconditional `return`/`throw`
  among preceding block statements.
- **Transitive family helpers**: `reachesAuthorizationBoundary` accepts either
  a direct call to a TERMINAL primitive (`authorizeRequest`, `scopedTrustedJson`,
  `resolveTrustedRequestContext`, `verifyWorkerSecret`, `timingSafeEqual`) or a
  reachable imported call into a `_scope.ts` module that itself (recursively,
  cycle-bounded) reaches a terminal — so the CD-stage `scopedJson` /
  `assignmentApiScope` / `spiceRunScope` / `bomScope` families are followed to
  their actual enforcement, not trusted by name.

The gate runs this over every exported method of every route file whose exact
policy row requires authentication; the offender list must be empty (and is).

## The four mandated negative tripwires (all FAIL as required)
`app/lib/auth/__tests__/b16-0-3-boundary-gate.test.ts`:
1. a route with ONLY an `authorizeRequest` comment → fails the gate;
2. an UNUSED `authorizeRequest` import → fails;
3. a policy-classified authenticated handler that directly calls a durable
   loader (`resolveComponentAuthoritySource` + `loadRunComponentAuthority`)
   with no boundary call → fails;
4. the PREVIOUS replacement-authority handler shape (bounded read → local
   constants → durable resolve, no auth) → fails.

Plus mention-only hardening: a string literal, a `typeof` type reference, a
locally-shadowed same-named function, `if (false) { … }`, code after `return`,
and the dead `else` of `if (true)` all fail; a genuine imported call (direct
or via each family wrapper) passes; and the REAL post-fix
replacement-authority route is asserted to pass with `authorizeRequest`
specifically.
