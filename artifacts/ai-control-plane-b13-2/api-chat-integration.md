# B13.2 §E — actual `/api/chat` integration

## The defect (R7)

B13.1's "route integration" tests re-composed the pipeline by hand
(`resolveComponentAuthoritySource` → `loadRunComponentAuthority` →
`assembleAgentRunContext` → `buildRunToolset`). The exported `POST` handler
was never imported or invoked; the only reference to the route module in the
entire suite was a `readFileSync` source-text scan.

## The executable route test

NEW [b13-2-route-authority.test.ts](../../app/api/chat/__tests__/b13-2-route-authority.test.ts)
imports `POST` from `../route` and drives real `Request` objects through it.

Controlled server-only dependencies (only two):

- the provider adapter — a scripted adapter via `vi.mock`, the same seam
  every B10/B11 route test uses; it reports the EXACT toolset it received, so
  tool exposure is observed from the provider's side of the run;
- the durable authority source — `setComponentAuthoritySourceFactory`, which
  records the exact scope the route asked for.

Everything else executes unmodified: body bounding and exact-key validation,
scope validation, editor-context validation, server-side revision
recomputation, the shared board identity, `resolveComponentAuthoritySource`,
`loadRunComponentAuthority`, context assembly, resource sealing, run-toolset
construction, the agent loop, and trace finalization.

## Requirements → proof

| # | requirement | test |
| --- | --- | --- |
| 1 | authenticated scope accepted | 19 (200 + run completes) |
| 2 | the route calculates the shared board identity | 19 — the recorded scope equals `{board:p132, ["root"], variant-default, componentInstanceId: u1-id}` exactly |
| 3 | the real resolver and loader run | 19 (the source was invoked with that scope) |
| 4 | a matching aggregate becomes the sealed resource | 19 (the tool appears, which requires the sealed resource) |
| 5 | the tool appears in the ACTUAL run toolset | 19 (`TOOLS:` reported by the provider contains it) |
| 6 | component/hierarchy/variant mismatch withholds it | 20 (four mismatch classes, run still completes) |
| 7 | DB failure withholds it, unrelated reads remain | 21 (board-inspect and schematic-inspect still present) |
| 8 | browser-provided authority fields cannot alter it | 22 (top-level key 400; nested authority-shaped key 400 by name; forged `authoritySource` 400; withheld source ⇒ no tool) |
| 9 | request abort settles without the authority deadline | 23 (pre-aborted, <2 s, `run_failed reason=cancelled`) and 23b (MID-FLIGHT abort with a hanging source, <2 s, source signal actually aborted) |
| 10 | the provider is not invoked when already aborted | 23 (`providerCalls.start === 0`) |
| — | resource/tool exposure consistency | 24 (withholding is surgical: every other tool identical) |
| — | toolset determinism across identical requests | 25 |

## Load-bearing vs supplementary

Every proof above is behavioural — the assertions read what the running
handler produced (HTTP status, NDJSON events, the toolset the provider
received, the scope the source was queried with). The only static
source-string checks that remain are explicitly labeled supplementary
tripwires (§D 18d, and the pre-existing B13 route gates), and no closure
depends on them.
