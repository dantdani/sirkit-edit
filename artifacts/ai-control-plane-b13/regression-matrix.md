# B13 — regression matrix

The stage's 26 required test areas → coverage in
`app/lib/engineering/__tests__/b13-component-authority-bridge.test.ts`
(24 tests) plus the updated B06.1 grant suite.

| # | Required coverage | Where |
| --- | --- | --- |
| 1 | verified exact physical-binding projection | B13 #1 |
| 2 | missing record | B13 #2 |
| 3 | stale record | B13 #3 |
| 4 | unapproved record | B13 #4 |
| 5 | unavailable footprint | B13 #5 |
| 6 | unverified mapping | B13 #6 (+ #6b atomic-unconfirmed) |
| 7 | conflicting records | B13 #7/#8 |
| 8 | duplicate records | B13 #7/#8 |
| 9 | foreign tenant/project/branch | B13 #9 |
| 10 | wrong canonical revision | B13 #10 |
| 11 | database unavailable | B13 #11 |
| 12 | bounded timeout/abort | B13 #12, #12b |
| 13 | late-result ownership | B13 #10 (revision pin) + context-and-resource-integration.md (scope+revision pinned re-assembly) |
| 14 | browser authority forgery | B13 #14 (route body/editor-context gate) |
| 15 | candidate-only record | B13 #15/#16 |
| 16 | permitted alternative without exact authority | B13 #15/#16, #16b |
| 17 | exact authorized alternative | B13 #17 |
| 18 | substitution of every asset-ID field | B13 #18 (all five fields) |
| 19 | resource content tamper | B13 #19 |
| 20 | manifest tamper | B13 #20 |
| 21 | resource change detected during replay | B13 #21 (manifest digest) |
| 22 | tool included when valid | B13 #22 |
| 23 | tool withheld when invalid/unavailable | B13 #23 |
| 24 | other chat tools survive authority-source failure | B13 #24 |
| 25 | OpenAI/Anthropic schema parity unchanged | B13 #25 (+ regenerated B04 parity artifact, B09 schema suites) |
| 26 | no mutation/approval/release/external request from the loader | B13 #26 |

Plus: context-integrity refusal on post-assembly authority mutation
(B13 integrity test); the B06.1 executor-side grant gate stays green with
the server-owned exact-authority fixture.

## Prior-stage suites (unchanged in strength; counts updated to ten tools)

| Suite | Result |
| --- | --- |
| B04 tool-registry (exposure tripwire → ten; artifacts regenerated) | green |
| B05 / B05.1 read-invocation + resource-pinning | green |
| B06 / B06.1 / B06.2 authority + replacement (fixture carries exact authority; artifacts regenerated) | green |
| B09 boundary/closure/discovery/provider (nine→ten) | green |
| B10 editor-context / chat boundary (nine→ten) | green |
| B11 trace/replay/evaluation (pins regenerated, byte-stable ×2) | green |
| B12 → B12.8 family | green |
| physical-binding / atomic / project | green |
