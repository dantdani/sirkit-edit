# B16.0.4 §A — Authorization analyzer negative tripwires

A sound gate is worthless if it cannot fail. These tripwires feed
`analyzeMethodBoundary` synthetic route sources that are **deliberately unsafe**
and assert the analyzer **rejects** each one. If a future refactor makes the
analyzer permissive, these fail. They live in
[`app/lib/auth/__tests__/b16-0-4-authorization-and-body-gates.test.ts`](../../app/lib/auth/__tests__/b16-0-4-authorization-and-body-gates.test.ts)
(§A block) and are exercised by the CI gate.

## The 10 method-scoped tripwires (each MUST be rejected)

| # | Scenario | Why it must fail |
|---|---|---|
| 1 | Guarded `GET` + **unguarded `POST`** in one file | The `POST` cannot borrow the sibling `GET`'s boundary (method isolation). The `GET` passes; the `POST` rejects. |
| 2 | Guarded `POST` + **unguarded `PATCH`** | Same isolation the other direction — the `PATCH` rejects. |
| 3 | **Ignored** `authorizeRequest` result (`await authorizeRequest(req)` with no consult) | No reachable refusal ⇒ not load-bearing. |
| 4 | **Durable read before** the boundary (`getDb().select()` then authorize) | Dominance violation: durable work precedes the refusal. |
| 5 | **Provider call before** the boundary (`llmRouter.generate()` then authorize) | Dominance violation: credit could be spent before refusal. |
| 6 | **Body read before** the boundary (`await request.text()` then authorize) | Dominance violation: unbounded body pulled before refusal. |
| 7 | Authorization only inside a **dead branch** (`if (false) { …authorize… }`) | The boundary is unreachable ⇒ not load-bearing on the live path. |
| 8 | Imported **factory whose returned handler is unguarded** | Following the factory into its closure finds no boundary ⇒ reject (the guarded factory sibling passes). |
| 9 | Imported factory whose returned handler **awaits the boundary but ignores its refusal** | Awaited-but-ignored ⇒ not load-bearing, even one indirection away. |
| 10 | A **public sibling** method's absence of a guard cannot satisfy a protected method | Confirms the gate analyzes each method against its own policy; the protected method must guard itself. |

Tripwires 8 and 9 use **on-disk fixture modules** (written to a temp dir in
`beforeAll`, removed in `afterAll`) because factory delegation resolves the
imported module from the filesystem — the analyzer follows `createGuardedHandler`
/ `createUnguardedHandler` / `createIgnoringHandler` into their real returned
closures.

## Positive control

The same block asserts the audited **wrapper** form
(`authenticatedJsonRoute(opts, handler)`) **passes**, and that a bare
`export const POST = async (req) => …` with no guard **fails** — so the wrapper
allowlist cannot be spoofed by a same-named local.

## Live-route tripwire (in the main gate)

Beyond the synthetic set, the §A gate in
[`b16-0-2-gates.test.ts`](../../app/lib/auth/__tests__/b16-0-2-gates.test.ts)
runs `analyzeMethodBoundary` over **every real protected method** (121 of them)
and additionally asserts that mutating the real `replacement-authority` route to
read its body before authorizing would be rejected — a canary that the analyzer
still discriminates on production code, not just fixtures.
