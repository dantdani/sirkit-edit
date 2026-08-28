# B16.0.14 §I — Prompt, tool & provider parity

This stage edited only the boundary prologue and the `runSearch` transport of
`assign/suggest`; every prompt/tool/provider construct is byte-identical.

## Unchanged in `assign/suggest` (verbatim)

- `SYSTEM_PROMPT` (the full matching-rules text, interpolating `MAX_SEARCHES`
  and `MAX_CANDIDATES`);
- `SEARCH_TOOL` — name `search_footprints`, description, input schema
  (query/padCount/smd, required `["query"]`);
- `SUBMIT_TOOL` — name `submit_candidates`, description, nested candidate schema;
- `toolChoice: "required"`, `temperature: 0`, `maxTokens: 2048`;
- `provider = requestedProvider(body.provider)` routing;
- the message transcript construction (user message JSON, assistant/tool-result
  message helpers);
- `validateCandidates` — surfaced-only, pad-count equality, confidence clamp,
  reason bound, `MAX_CANDIDATES` cap;
- `providerErrorResponse(error, provider)` normalization.

## Byte-identity check

The `git diff` for `app/api/pcb/assign/suggest/route.ts` touches ONLY: the two
import lines, the POST prologue (→ `authenticatedJsonRoute` callback), the
removal of `const origin = new URL(req.url).origin`, the `runSearch` body
(fetch → `searchFootprints`), and the closing `});`. The prompt constant, both
tool constants, the validator, and the loop are outside the diff.

No provider or embedding credit is spent anywhere in the tests
(`llmRouter.generate` and `searchFootprints`/`getDb`/`embedQuery` are all
faked/mocked).
