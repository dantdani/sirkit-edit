# B12.7 — the total error-rendering contract

Symbol: `renderUnknownError(value: unknown, maxChars = 300): string`
Module: [app/lib/agent/redaction.ts](../../app/lib/agent/redaction.ts) —
the dependency-neutral redaction layer (imports nothing), so the
project-layer autosaver can share it without a cycle, and it sits beside
`sanitizeTraceText`, whose bounding/redaction it reuses. ONE renderer,
both required consumers:

1. `createAutosaver`'s save-callback catch path;
2. `settleAutosaveForTransition`'s flush-catch path.

## Totality (never throws) — mechanism by input shape

| Input | Handling |
| --- | --- |
| `string` | sanitized + capped; empty string → the fixed generic |
| `number`/`boolean`/`bigint`/`undefined` | `String(value)` — safe on primitives, no traps exist |
| `symbol` | `String(symbol)` — safe (template literals are not) |
| `function` | fixed generic — never invoked, never serialized |
| `null` | `"null"` |
| `Error` instances | `message` read behind its OWN guard; a well-behaved message renders sanitized |
| Error with hostile `message` getter | the getter's throw is caught → fall through to a guarded `name` read (`"Error"`) |
| objects with throwing `toString`/`Symbol.toPrimitive` | never string-converted at all — only guarded `message`/`name` property reads, else generic |
| proxies with hostile get/getPrototypeOf traps; revoked proxies | `typeof` is trap-free; `instanceof` is deliberately NOT used (it walks the prototype chain through the trap); each property read guarded → generic |
| cyclic / unserializable values | never serialized (no JSON/inspect anywhere) → generic |
| anything unforeseen | outermost catch → fixed generic `"unrenderable thrown value"` |

## Boundedness and safety

Every extracted string passes through `sanitizeTraceText` —
credential-shaped content replaced with `[redacted]`, hard cap
(default 300 chars; the settlement layer re-caps at 200). Arbitrary
objects are NEVER serialized: the only detail ever extracted is a
string `message` (or string `name`). If no safe useful detail exists,
the fixed generic diagnostic is returned.

## createAutosaver invariants (post-B12.7 `run()`)

- `saved` is reported ONLY after the save function explicitly returned
  `{ ok: true }` (`okValue === true` on a guarded read — a foreign
  truthy `ok` fails closed).
- Every failed or throwing save restores `pending = true` — and the
  restore happens BEFORE any status/listener work, so no downstream
  throw can reopen the R1 loss window.
- Status becomes `error` (with the totally-rendered reason) — never
  remains `saving`.
- A later flush retries the SAME pending write.
- No diagnostic-conversion failure can escape `run()`, `flush()`, or
  the debounce timer callback (proven with a process-level
  uncaughtException/unhandledRejection capture).

## Settlement strictness (post-B12.7)

- Only `flush() === true` settles `{ ok: true }` — `false` AND every
  non-Boolean runtime return fail closed (truthy non-Booleans get the
  distinct "non-boolean result" prefix).
- A thrown value of ANY JavaScript shape returns a typed failure; the
  settlement itself can never throw.
- Details remain bounded and credential-redacted
  (prefix + `sanitizeTraceText(…, 200)`).
