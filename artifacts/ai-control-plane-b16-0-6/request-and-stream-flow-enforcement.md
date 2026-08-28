# B16.0.6 §D — Fail-closed request & stream flow enforcement

## From bounded-depth taint to security-by-construction

B16.0.5 chased the request through taint forms and stopped at depth 4, silently
returning CLEAN at the limit (R8) and on unresolved (namespace) flow. B16.0.6
adopts the mandate's preferred enforcement: **a raw Request may flow only to a
canonical sink; anything else — or any flow the analyzer cannot resolve — is a
violation.** There is no depth limit and no name trust.

## The rule

For each exported handler (and a followed handler factory's returned closure),
seed the request parameter as tainted and compute `requestFlowViolations`. A
violation is any of:

- a body-consuming call on a tainted request/clone/container/element:
  `.json/.text/.arrayBuffer/.blob/.formData`, `["json"]()`, `.json.call/apply/bind`;
- a stream-consuming call on `request.body` or a tracked body stream:
  `.getReader/.read/.tee/.pipeTo/.pipeThrough/.cancel/.values`;
- a tainted **Request** passed to a callee that is not a safe request consumer at
  that argument;
- a tainted **body stream** passed to any callee other than the canonical
  `readBoundedStream`;
- a tainted **body method** passed as an argument;
- a tainted request/stream/method **returned** (escape);
- a tainted request **spread** or passed to an **unresolved / dynamic** callee.

Taint propagates to a fixed point through `const`/`let`, **assignment**
(`alias = request` — R5), destructuring and **destructure-assignment**
(`({ json } = request)`), **object and array containers** (`{r:request}`,
`[request]`), `.clone()`, `.body`, and property extraction.

## Safe consumers — compositional, memoized, fixed-point, cycle-rejecting

`safeRequestConsumer(callee, paramIndex)`:

- a **canonical sink** (by provenance) is safe;
- any other consumer — a local function, a `const x = importedFactory(...)`
  returned closure, or an imported function — is safe ONLY if its own
  `requestFlowViolations` (with the received parameter tainted) is empty;
- memoized by `module#symbol#paramIndex`; a **cycle** resolves to unsafe
  (fail closed); an **unresolvable** callee (node/npm, namespace member, dynamic)
  is unsafe.

This is a fixed point, not a depth cutoff: R8's five-hop chain is rejected
because the terminal `h5` reads the body → `h5` unsafe → propagates up → passing
the request to `h1` is a violation. A deep chain that instead terminates only in
a canonical reader converges to SAFE (proven — no false positive).

## What this guarantees

- Outside the canonical body authority, a Request receiver call to
  `json/text/arrayBuffer/blob/formData/clone` or a body-stream reader is
  rejected.
- A Request, `request.body`, a body stream, a body method, or a clone passed to
  any non-canonical helper is rejected — helpers needing url/method/context must
  receive safe metadata (`request.headers`, `request.url`, …), which is not
  tainted and flows freely.
- An unresolved or cyclic tainted flow produces a violation, never a clean
  verdict.

Every reproduced form (R5–R8 + namespace / array / destructure-assign / stream-
returned-from-helper) is a permanent regression in
[`b16-0-6-analyzer-hardening.test.ts`](../../app/lib/auth/__tests__/b16-0-6-analyzer-hardening.test.ts);
the production routes still report **0** violations
([request-body-boundary-matrix.csv](request-body-boundary-matrix.csv)).
