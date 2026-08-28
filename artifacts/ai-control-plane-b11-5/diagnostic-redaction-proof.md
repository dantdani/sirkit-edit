# B11.5 §B — diagnostic redaction

New module: [`app/lib/agent/redaction.ts`](../../app/lib/agent/redaction.ts)

## The problem

`plain-capture.ts` sits **below** `trace.ts` in the import graph, so it could
not import the shared credential classifier without a cycle. It had grown its
own rule instead:

```ts
function safeKeyName(key: string): string {
  return key.replace(/[^\x20-\x7e]/g, "?").slice(0, 60);
}
```

That strips non-ASCII and truncates. It does not redact. B11.5 R2 showed a
synthetic marker in an untrusted key name reaching capture issues,
`validateReplayCapsule` issues, and `ReplayCapsuleInvalidError.message`
verbatim.

## The fix: one authority, extracted

`redaction.ts` imports **nothing**. That is what lets every producer share it:

| Consumer | Uses |
| --- | --- |
| `plain-capture.ts` | `redactPathSegment` (as `safeKeyName`) |
| `trace.ts` | re-exports the whole authority; `safeKey` → `redactPathSegment` |
| `replay-capsule.ts` | `safeCapsuleKey` → `redactPathSegment` |
| `replay-context.ts` | `safeKey` → `redactPathSegment` |
| `pcb-shape-projection.ts` | `safeKey` → `redactPathSegment` |

`trace.ts` re-exports `sanitizeTraceText`, `containsSecretShapedText`,
`isCredentialShapedName`, `foldFieldName`, and `redactPathSegment`, so every
existing import site keeps working and there is still **exactly one**
definition — no second classifier to drift.

## The rule

```ts
export function redactPathSegment(key: string, maxChars = 60): string {
  if (isCredentialShapedName(key) || containsSecretShapedText(key)) return "[redacted-key]";
  const printable = key.replace(/[^\x20-\x7e]/g, "?");
  return sanitizeTraceText(printable, maxChars);
}
```

Two independent reductions, in order: a credential-shaped **name** is itself the
payload, so no fragment of it survives — it collapses to a stable
classification. Anything else passes through the content redactor and the
length bound, so an embedded secret pattern inside an otherwise innocent key is
stripped. Control characters and non-ASCII are normalized so a diagnostic can
never carry terminal escapes or bidirectional-override payloads.

## Evidence

```
capture issues   ["capsule.[redacted-key]: a function is not JSON data (it is never invoked)"]
capsule issues   ["capsule.[redacted-key]: a function is not JSON data (it is never invoked)"]
thrown message   "REPLAY_CAPSULE_INVALID: capsule.[redacted-key]: a function is not JSON data (it is never invoked)"

marker in capture issues : false
marker in capsule issues : false
marker in thrown message : false
```

The regression additionally proves the marker is absent from board, context,
trace, secret-scan, and plain-JSON diagnostics, and that neither the marker nor
the substring `apiKey` appears in `JSON.stringify(issues)` or the thrown
message.

## Still bounded, deterministic, and useful

* **Deterministic** — the same key always yields the same segment (asserted).
* **Bounded** — at most 60 characters (asserted with a 500-character key).
* **Useful** — ordinary keys come through unchanged (`formatVersion`,
  `tracks`, `innocentUnknownKey`, `__proto__`, `constructor` all asserted
  verbatim), so diagnostics remain readable and actionable.

## Two earlier assertions re-worded, not weakened

Two B11.1 message-shape assertions changed because the redaction got stronger:

1. *"forbidden field names nested inside context fixtures are refused"* asserted
   the issue echoed `rawResponse`. `rawResponse` is a provider-body key name, so
   it is now redacted. The assertion now proves **refused AND not leaked** —
   strictly more.
2. Two assertions expected the literal `[redacted]` (content redaction). They
   now assert `[redacted-key]` — the stable classification for a
   credential-shaped **name** — plus that `x-api-key` does not appear at all.
