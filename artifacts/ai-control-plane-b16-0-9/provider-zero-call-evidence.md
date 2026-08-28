# B16.0.9 §D — Provider zero-call evidence

Fake adapter: `vi.mock("@/app/lib/llm/router")` replaces `llmRouter.generate`
with a counting `vi.fn()` in the pin suite — no provider credit can be spent,
no provider configuration touched. Applies to the three provider-bound methods:
`/api/architecture/propose`, `/api/power/propose`, `/api/interfaces/propose`.

## Zero-call refusals (per method, `generate` asserted 0 calls after each)

| Refusal | Result |
|---|---|
| Anonymous (401) | 0 provider calls |
| Production cross-origin CSRF (403) | 0 provider calls |
| Invalid media type (415) | 0 provider calls |
| Malformed JSON (400) | 0 provider calls |
| Oversized body (413) | 0 provider calls |
| Scope mismatch (403) | 0 provider calls |
| Problem integrity failure (422 + diagnostics) | 0 provider calls |

(The stalled-body 408 path is the shared reader's proven settlement — B16.0.4
§D — and refuses before the callback, hence before any provider call, by the
same construction as the other body refusals.)

## Valid-path routing parity (per method)

With a digest-valid fixture problem and a REAL synthesized proposal returned by
the fake adapter:

- `generate` invoked **exactly once**;
- the call argument's `provider` equals the REQUESTED provider from the body
  (`"anthropic"`) — requested-provider routing preserved;
- response carries `X-Sirkit-AI-Provider: anthropic` and
  `Cache-Control: no-store`;
- deterministic **200** with `ok: true` (the fixture proposal compiles).

## Provider-error normalization (per method)

`generate` rejecting (`Error("boom")`) → the historical
`providerErrorResponse` path: **503**, `ok: false`, `generate` called exactly
once. Unchanged by the migration (the try/catch moved verbatim into the
callback).

## Discovery recorded (pre-existing, unchanged)

A structurally SHAPELESS problem (missing arrays) makes the architecture and
interface validators THROW, which lands in the same catch → provider-error
path — with `generate` still at 0 calls (the throw happens before the provider
call). This pre-existing behavior is preserved, not silently altered.
