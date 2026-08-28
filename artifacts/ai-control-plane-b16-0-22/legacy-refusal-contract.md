# B16.0.22 — the `replacement-authority-v1` legacy refusal contract

## Why

`authenticatedJsonRoute`'s canonical reader refusals carry `AUTH_*` codes and
settle a client abort at 400; the replacement-reauthorization boundary has
ALWAYS (B14.2 §B / B14.3 §B) emitted plain `{ ok:false, error }` bodies with
abort settling **408**. §A pins those envelopes byte-exact and §B forbids
weakening them — so the wrapper needed a way to express them without handing
routes an envelope-injection escape hatch.

## What (precedent: B16.0.14's selector refusal contract)

A DECLARATIVE, closed-enum option on `BoundedBodyOptions`:

```ts
legacyReaderRefusals?: "replacement-authority-v1";
```

The mapping is a frozen table INSIDE `app/lib/auth/route-handlers.ts` — routes
select a named contract; they cannot supply envelope logic or functions:

| reader reason | status | body |
|---|---|---|
| over-limit | 413 | `request body exceeds the bounded limit` |
| timeout | 408 | `request body was not received within the read deadline` |
| aborted | **408** | `request aborted before the body completed` |
| unreadable | 400 | `unreadable request body` |
| invalid-utf8 | 400 | `request body is not valid UTF-8` |
| invalid-json | 400 | `request body is not valid JSON` |
| not-object | 400 | `request body must be an object` |
| unsupported-media-type | — | falls through to the CANONICAL 415 (the historical route already used it) |

Historical refusals carried no `Cache-Control` header; the mapped responses
preserve that too.

## Confinement

- The option type is a single-value union — no free-form value compiles.
- Gate: the table's seven envelope strings + `aborted: { status: 408` are
  pinned in the confinement suite; repo-wide scan proves ONLY
  `replacement-authority/route.ts` adopts the option. Reverting either fails
  CI.
- Ordering, ceilings, deadlines, zero-work-before-auth are byte-identical to
  the canonical contract; ONLY refusal wording/status differs.
