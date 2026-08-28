# B16.0.10 §A — Pre-edit route contracts (pinned BEFORE migration)

The behavioral pin suite
[`app/api/__tests__/b16-0-10-tranche-parity.test.ts`](../../app/api/__tests__/b16-0-10-tranche-parity.test.ts)
was written against the PRE-migration raw handlers and run GREEN first
(**57 / 57**, recorded), then kept green unchanged post-migration.

## Shared boundary pins (×8 routes)

| Pin | Contract |
|---|---|
| anonymous | 401 `AUTH_UNAUTHENTICATED`, **0 body pulls**, 0 provider/build-loop calls |
| production cross-origin | 403, **0 body pulls** |
| text/plain | 415 `AUTH_MEDIA_TYPE_UNSUPPORTED`, **0 body pulls** |
| malformed JSON | 400 `AUTH_INVALID_JSON` |
| oversized (16 MB + 1) | 413 `AUTH_PAYLOAD_TOO_LARGE` |
| required-field refusal | exact status + error string (below), 0 provider calls |

(Foreign/revoked membership and stalled-body/deadline settlement are covered by
the standing B16.0.3/B16.0.4 suites over the same shared boundary primitives —
`b16-0-4-bounded-body-behavior` drives `schematic/build` directly and stays
green.)

## Per-route required-field contracts (exact, historical)

| Route | Empty-body refusal | Notes |
|---|---|---|
| `/api/schematic` | 400 `{ error: "prompt is required" }` | **bare `{error}` shape — NO `ok` field**; success returns the RAW netlist object (no envelope, no no-store header) — preserved exactly |
| `/api/schematic/build` | 400 `{ ok:false, error:"prompt is required" }` | failure passes through `{error, code, provider}` + loop status |
| `/api/schematic/build-multi` | 400 `{ ok:false, error:"prompt is required" }` | planner → complexity gate → single loop when ≤1 block |
| `/api/schematic/cross-verify` | 400 "Cross-verify needs a prompt and a Build-mode schematic" | SchGen unconfigured → 200 `available:false`, zero fetch |
| `/api/schematic/edit` | 400 "instruction is required" / "no components to edit" | unknown-target ops dropped into the note |
| `/api/schematic/edit-build` | 400 "instruction is required" / "current netlist is required" | seeds parts via `getPartsByIds` before the loop |
| `/api/schematic/layout-critic` | 400 "Layout critic needs a Build-mode schematic with catalog parts" | hallucinated refDes verified away → `applied:false`, original state |
| `/api/schematic/review` | 400 "no components to review" | contradicted unconnected-claims dropped; `dropped` count reported |

## Provider/domain invocation counts (fake adapters)

`llmRouter.generate`, `runBuildToolLoop`, and `parts-search` are mocked
(vi.mock) — **no provider credits, no DB**. Every refusal above asserts ZERO
calls to both seams; the valid paths assert exactly-once invocation with the
REQUESTED provider (see [provider-zero-call-evidence.md](provider-zero-call-evidence.md)).
