# B11.1 — adversarial review findings (beyond R1–R6)

After the six required closures were implemented, the boundary was audited
by four independent lenses (trace validator, sink isolation, route
finalization, capsule validation), each followed by an adversarial verifier
whose job was to REFUTE the claims by executing them against the real
modules. Findings below are the ones that survived verification, plus the
notable refutations (kept because "we checked and it is not a defect" is
itself evidence).

## CONFIRMED and closed in B11.1

| # | Defect | Closure |
| --- | --- | --- |
| 1 | **Sink re-entrancy** — a sink calling `recordTerminal()` from inside `append()` terminated the trace early, silently dropping every later event; a sink calling `finalize()` from `complete()` recursed until an internal failure was swallowed. | `inSinkCall` guard around every sink callback; `append`/`recordWarning`/`finalize` refuse while raised and classify `trace_reentrant_call_refused`; a re-entrant `finalize` returns a composed snapshot without persisting. |
| 2 | **Prototype-carried fields** — `Object.keys` and `JSON.stringify` see only OWN properties, so a required field supplied through the prototype chain satisfied the "missing" check, hid from the forbidden-name denylist, the size bound, AND the secret scan, while remaining readable by the replay engine. `Object.create(validCapsule)` (zero own keys) validated clean and executed. | `findNonPlainJsonPath` runs FIRST in both validators: rejects any non-`Object.prototype` prototype, symbol keys, non-enumerable own properties, and (added after a further finding) accessor properties. `hasOwnProperty` also required for every key. |
| 3 | **Secret in a KEY NAME** — an unknown key literally named `x-api-key=sk-ant-…` was echoed verbatim into the refusal, leaking the secret into the evaluation report. | Every echoed key name passes through `sanitizeTraceText` (top-level, nested, and fixture-scan recursion labels). |
| 4 | **`seq` monotonic but not contiguous** — an event could be DELETED from the ledger and the matching total decremented, leaving a fully self-consistent document. | `seq` must be contiguous from 1, exactly as the recorder assigns it. |
| 5 | **`kind in EVENT_KEYS` walked the prototype chain** — a pure-JSON event with `"kind":"constructor"` (or `toString`/`valueOf`/`__proto__`) resolved to an `Object.prototype` member, which was then fed to `exactKeys` as a key list: `TypeError: keys.includes is not a function`. This broke the bounded-output contract, and two call sites (`replay-capsule`, `evaluation`) were unguarded. | `Object.prototype.hasOwnProperty.call(EVENT_KEYS, kind)`. All five hostile kinds now return the bounded `unknown event kind` issue. |
| 6 | **Already-aborted request signal** — `req.signal.addEventListener("abort", …)` is attached AFTER the bounded read; an already-aborted signal never fires a later listener, so a client that disconnected during those awaits had its run complete anyway (provider spend, tools executed, and a trace recording `completed` for an abandoned run). The loop's own pre-abort defenses were unreachable from this call site. | `if (req.signal.aborted) abort.abort(); else addEventListener(...)`. Verified end-to-end: `adapter.start` is now invoked 0 times and the trace terminal is `cancelled`. |
| 7 | **Near-miss forbidden names** — the denylist was exact and case-sensitive, so `apikey`, `API_KEY`, `Authorization`, `reasoningContent`, `continuationState`, `providerRawBody`, and `openaiClient` all passed and executed. | Names are folded (lowercased, separators stripped) and matched against folded exact names plus unambiguous compound stems. Deliberately NOT substring-matched on short generic names — that regressed `canonicalStateDigest` during implementation and was corrected. |
| 8 | **JSON-quoted credential blindness** — the secret regexes matched `api_key: VALUE` but not the serialized form `{"apiKey":"AKIA…"}`, weakening the whole-document scan in both validators. | A JSON-aware pattern with folded separators/case. Verified no false positives on `toolId`, `argsDigest`, or `verification` values. |
| 9 | **Async sink → escaping unhandled rejections** — `async append()` type-checks against the sync interface (void-return bivariance); its rejection escaped as an unhandled rejection and was never classified. | The returned thenable is detected SYNCHRONOUSLY and classified `trace_sink_contract_violation` (so it reaches the persisted document), and its rejection is captured and classified. Measured: 0 unhandled rejections. |
| 10 | **No route-level stream-terminal guard** — "exactly one terminal event" was enforced only inside the loop, invisible to the route. | The route's `emit` now owns `streamTerminalEmitted`. |

## CONFIRMED but deliberately NOT structurally closed

**Deferred (asynchronous) sink callbacks bypass `inSinkCall`.** A sink that
schedules `queueMicrotask(() => recorder.recordTerminal("completed", null))`
runs after the guard is lowered and can forge an internally consistent,
schema-valid trace. Verified.

Why it is not closed here, stated plainly: a boolean cannot express "this
caller may never write". The structural answer is a writer capability
(the recorder mints a private token/handle for its owner and refuses calls
without it), which is an API change across the loop and route — larger than
this stage's scope. It grants **no additional authority**: nothing in
production ever hands a sink a recorder reference (the route constructs the
sink first and never passes the recorder), so an attacker who can make that
deferred call already has in-process code execution and could invoke the
recorder directly. The recorder's docstring now states the guard's scope
precisely ("synchronous re-entrancy") rather than claiming unconditional
isolation. **PROPOSED for a later stage: writer-capability separation.**

## Notable REFUTATIONS (checked, not defects)

- **Non-enumerable own properties leaking outward** — they validate but
  cannot leave the boundary: `JSON.stringify` omits them and
  `structuredClone` drops them, so nothing is persisted, transmitted, or
  digested. (They are now refused anyway by the plain-JSON check.)
- **Inherited `toJSON` neutralizing the secret sweep** — its effect is
  masking, not leaking, and `structuredClone` drops the inherited method,
  so the sink stores the plain fields regardless.
- **Secrets split across two fields** — reproduces, but no sound fix
  exists: detecting it would require scanning concatenations of unrelated
  fields, which false-positives on legitimate digests. No honest producer
  can split a key (sanitization runs on the whole string before slicing).
- **`step.toolCallCount` not reconciled with the `tool_invocation` count** —
  the proposed "exact equality" invariant is FALSE for honest traces: the
  loop records `toolCallCount` before the per-call loop, and refusals
  (`unknown_tool`, `budget_exhausted`, `invalid_input`, `repeated_call`,
  `proposal_exists`) never reach `recordTool`. A verifier disproved it with
  an honest recorder producing 762 counted calls against 0 invocations.
  Adding the check would reject valid documents.
- **Dead `validate + digest` in the route's finalize** — factually a nit
  (nothing consumes either value); both calls are synchronous and inside a
  `try/catch`, so no input produces a failure.

Every CONFIRMED item above is covered by a permanent regression in
`b11-1-trace-integrity.test.ts` or `b11-1-route-finalization.test.ts`.
