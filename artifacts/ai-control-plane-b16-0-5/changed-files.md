# B16.0.5 — Changed files

## Analyzer (test-only; imports `typescript`, never in the runtime graph)

| File | Change |
|---|---|
| `app/lib/auth/__tests__/_boundary-analysis.ts` | §A polarity-correct `bindingIsRefused`/`inlineBoundaryGuard` (+ `isNegativeAuthorizationTest`); canonical wrapper/factory resolution (`importedBindingsDetailed`, `isCanonicalWrapper`, original-name factory lookup); §B interprocedural request-taint body-read engine (`growTaint`/`isTaintedRequestExpr`/`bodyReadsFrom`) replacing the name-only detector; `directBodyReads` seeded from real handler params + factory following; `bodyReadIn` upgraded to taint |

## Production

| File | Change |
|---|---|
| `app/lib/http/bounded-json.ts` | §C `requireJsonContentType` (default true) + `isJsonContentType` export + `unsupported-media-type` (415 `AUTH_MEDIA_TYPE_UNSUPPORTED`) refusal, checked before the first body pull |
| `app/lib/auth/route-handlers.ts` | §D wrapper callbacks no longer receive the raw `Request` — inputs are `{ context/principal, body, bytes, meta }` with `meta = { method, pathname }` only (`RequestMeta`/`safeMeta`) |
| `app/api/chat/route.ts` | §C explicit `isJsonContentType` 415 guard before the pre-auth bounded read |
| `app/api/replacement-authority/route.ts` | §C explicit `isJsonContentType` 415 guard after authorization, before the bounded read |

## Tests (permanent regressions)

| File | Change |
|---|---|
| `app/lib/auth/__tests__/b16-0-5-analyzer-hardening.test.ts` | NEW — every §A/§B counterexample (polarity, unrelated binding, ./evil, aliased-symbol, same-named local, re-export barrel fixture, C3a–h + non-null getReader) fails closed |
| `app/api/__tests__/b16-0-5-media-type-and-wrapper.test.ts` | NEW — §C 415-before-body-pull per family (0 counted pulls, no-store) + charset accepted; §D wrapper receives no request/headers/cookie/authorization |
| `app/lib/auth/__tests__/b16-0-2-gates.test.ts` | §C gate now calls `directBodyReads(source, absoluteFile, ROOT)` so the taint engine can follow factories/helpers cross-file |
| `app/lib/http/__tests__/b16-0-2-bounded-json.test.ts` | Empty-body case routed through the JSON helper; NEW media-type unit test (415 / charset / explicit opt-out) |
| `app/lib/agent/__tests__/b11-5-capture-exactness.test.ts` | §D test-write gate admits the new hardening fixture test via an OS-temp `scratchRoot` justification |

## Media-type fallout fixes (send the correct Content-Type; no assertion weakened)

- `app/api/chat/__tests__/b10-1-request-boundary.test.ts` — 2 stream/uint8 requests gained `Content-Type: application/json`
- `app/api/chat/__tests__/b10-2-closure.test.ts` — 2 stream requests gained the header
- `app/lib/constraints/__tests__/kicad-api-agent.test.ts` — preview + explain requests gained the header
- `app/lib/pcb/placement/__tests__/objectives-transaction-api.test.ts` — preview request gained the header

## Artifacts / generator

- `artifacts/ai-control-plane-b16-0-5/` — this stage record (13 docs + 2 regenerated CSVs).
- `scripts/generate-b16-0-4-artifacts.ts` — re-run post-correction (unchanged code; the CSVs it emits from the corrected analyzer are byte-identical: 121 load-bearing / 32 public / 0 UNBOUNDED).

## Deleted (disposable)

- `scripts/_b16-0-5-repro.ts`, `app/api/__tests__/_b16-0-5-pre.test.ts` — pre-edit reproduction harnesses (outputs recorded in [pre-edit-counterexamples.md](pre-edit-counterexamples.md) / [post-edit-results.md](post-edit-results.md)).

## Explicitly NOT changed

- `C:\Users\robsa\sirkit` — untouched.
- No route's authorization ordering, scope checks, success contract, replay pins, authoritative hashes, or the internal-only manufacturing release; exactly **12** exposed tools unchanged.
