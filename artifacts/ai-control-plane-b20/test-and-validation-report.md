# B20 - test and validation report

## Suites (case counts are `it(` blocks as they stand on the tree)

| increment | suite | cases |
|---|---|---|
| A4 | `app/api/chat/__tests__/b20-a4-chat-mcp-runtime.test.ts` | 4 |
| B2 | `app/api/mcp/__tests__/b20-b2-mcp-endpoint.test.ts` | 36 |
| B2 | `app/api/mcp/__tests__/b20-b2-mcp-token-route.test.ts` | 12 |
| B2 | `app/api/mcp/__tests__/b20-b2-own-client-interop.test.ts` | 4 |
| B2 | `app/api/mcp/__tests__/b20-b2-protected-resource-metadata.test.ts` | 5 |
| B3 | `app/api/mcp/__tests__/b20-b3-mcp-tools-call-reads.test.ts` | 18 |
| C2 | `app/api/mcp/__tests__/b20-c2-tools-list-interop.test.ts` | 4 |
| D2 | `app/api/mcp/__tests__/b20-d2-never-reachable-sweep.test.ts` | 16 |
| A4 | `app/lib/acquisition/__tests__/b20-a4-mcp-quarantine.test.ts` | 6 |
| A4 | `app/lib/agent/__tests__/b20-a4-observation-read-service.test.ts` | 14 |
| A4 | `app/lib/agent/__tests__/b20-a4-trace-attribution.test.ts` | 7 |
| B2 | `app/lib/auth/__tests__/b20-b2-mcp-access-token.test.ts` | 15 |
| B2 | `app/lib/auth/__tests__/b20-b2-mcp-route-policy.test.ts` | 13 |
| B2 | `app/lib/auth/__tests__/b20-b2-route-matrices-pinned.test.ts` | 5 |
| B2 | `app/lib/auth/__tests__/b20-b2-route-tree.test.ts` | 8 |
| A4 | `app/lib/engineering/__tests__/b20-a4-observation-descriptor.test.ts` | 7 |
| B1 | `app/lib/engineering/__tests__/b20-b1-mcp-exposure.test.ts` | 22 |
| B3 | `app/lib/engineering/__tests__/b20-b3-durable-read-bundle.test.ts` | 14 |
| B3 | `app/lib/engineering/__tests__/b20-b3-mcp-subset-move.test.ts` | 8 |
| A0 | `app/lib/mcp/__tests__/b20-a0-admission-by-server-and-tool.test.ts` | 20 |
| A0 | `app/lib/mcp/__tests__/b20-a0-feature-flag.test.ts` | 12 |
| A0 | `app/lib/mcp/__tests__/b20-a0-server-registry.test.ts` | 34 |
| A1 | `app/lib/mcp/__tests__/b20-a1-http-transport.test.ts` | 70 |
| A1 | `app/lib/mcp/__tests__/b20-a1-redaction-linear.test.ts` | 4 |
| A2 | `app/lib/mcp/__tests__/b20-a2-foreign-tools.test.ts` | 66 |
| A2 | `app/lib/mcp/__tests__/b20-a2-negotiation.test.ts` | 35 |
| A2 | `app/lib/mcp/__tests__/b20-a2-tool-call.test.ts` | 17 |
| A2 | `app/lib/mcp/__tests__/b20-a2-tool-discovery.test.ts` | 28 |
| A3 | `app/lib/mcp/__tests__/b20-a3-as-metadata.test.ts` | 10 |
| A3 | `app/lib/mcp/__tests__/b20-a3-authorized-post.test.ts` | 38 |
| A3 | `app/lib/mcp/__tests__/b20-a3-live-reread.test.ts` | 9 |
| A3 | `app/lib/mcp/__tests__/b20-a3-prm-discovery.test.ts` | 24 |
| A3 | `app/lib/mcp/__tests__/b20-a3-registry-authorization-pin.test.ts` | 13 |
| A3 | `app/lib/mcp/__tests__/b20-a3-secret-hygiene.test.ts` | 7 |
| A3 | `app/lib/mcp/__tests__/b20-a3-token-audience.test.ts` | 10 |
| A3 | `app/lib/mcp/__tests__/b20-a3-token-cache.test.ts` | 17 |
| A3 | `app/lib/mcp/__tests__/b20-a3-token-request.test.ts` | 18 |
| A4 | `app/lib/mcp/__tests__/b20-a4-agent-read-port.test.ts` | 18 |
| A4 | `app/lib/mcp/__tests__/b20-a4-observation-normalizer.test.ts` | 17 |
| A5 | `app/lib/mcp/__tests__/b20-a5-connector-tripwires.test.ts` | 7 |
| A5 | `app/lib/mcp/__tests__/b20-a5-provider-connector-policy.test.ts` | 10 |
| A5 | `app/lib/mcp/__tests__/b20-a5-provider-output-guard.test.ts` | 13 |
| A5 | `app/lib/mcp/__tests__/b20-a5-provider-request-shape.test.ts` | 4 |
| D1 | `app/lib/mcp/__tests__/b20-d1-malicious-server.test.ts` | 25 |
| D1 | `app/lib/mcp/__tests__/b20-d1-rebinding-window.test.ts` | 6 |
| B1 | `app/lib/mcp/server/__tests__/b20-b1-tool-definitions.test.ts` | 20 |
| B2 | `app/lib/mcp/server/__tests__/b20-b2-import-gates.test.ts` | 4 |
| B2 | `app/lib/mcp/server/__tests__/b20-b2-server-protocol.test.ts` | 6 |
| B3 | `app/lib/mcp/server/__tests__/b20-b3-import-gates.test.ts` | 7 |
| B3 | `app/lib/mcp/server/__tests__/b20-b3-read-arguments.test.ts` | 10 |
| B3 | `app/lib/mcp/server/__tests__/b20-b3-read-call.test.ts` | 23 |
| B3 | `app/lib/mcp/server/__tests__/b20-b3-read-trace.test.ts` | 6 |
| B3 | `app/lib/mcp/server/__tests__/b20-b3-replay-cache.test.ts` | 10 |
| B4 | `app/lib/mcp/server/__tests__/b20-b4-process-gate.test.ts` | 5 |
| B4 | `app/lib/mcp/server/__tests__/b20-b4-stop-evidence.test.ts` | 8 |
| B4 | `app/lib/mcp/server/__tests__/b20-b4-withhold-proposals.test.ts` | 8 |
| C1 | `app/lib/mcp/server/__tests__/b20-c1-structured-content.test.ts` | 10 |
| C1 | `app/lib/mcp/server/__tests__/b20-c1-three-way-parity.test.ts` | 18 |
| C2 | `app/lib/mcp/server/__tests__/b20-c2-tools-list-pages.test.ts` | 13 |
| C3 | `app/lib/mcp/server/__tests__/b20-c3-a2-cross-check.test.ts` | 2 |
| C3 | `app/lib/mcp/server/__tests__/b20-c3-descriptor-text-gate.test.ts` | 13 |
| C3 | `app/lib/mcp/server/__tests__/b20-c3-negative-tripwires.test.ts` | 8 |
| D2 | `app/lib/mcp/server/__tests__/b20-d2-name-spellings.test.ts` | 7 |
| D3 | `app/lib/mcp/server/__tests__/b20-d3-authority-import-gates.test.ts` | 7 |
| A1 | `app/lib/net/__tests__/b20-a1-outbound-headers.test.ts` | 20 |
| A1 | `app/lib/net/__tests__/b20-a1-sse-reader.test.ts` | 28 |
| D3 | `e2e/mcp-endpoint.spec.ts` | 11 |

**Total: 994 cases in 67 suites** (A0 66, A1 122, A2 146, A3 146, A4 73, A5 34, B1 42, B2 108, B3 96, B4 21, C1 28, C2 17, C3 23, D1 31, D2 23, D3 18).

## Gates as the ledger records them (each increment's `Gates` line)

- **B20-A0 - the MCP server registry, generalised admission, the feature flag and the CI admission rule (2026-09-17 local; w**
  - Gates (lead re-run on the combined tree, bounded batches, one at a time): mcp, acquisition, distributor quota/registry/ egress 18 files / 384 (+2 env-gated skips); agent, redaction consumers, AST import gates, B16.1C tripwires (ratchet unchanged 162 = 159 + 3 + 0: A0 adds no route), B17-F exposure, no-purchase 40 / 471; tsc 0; eslint clean on the 10 changed .ts files; the B20 registry, B19 source registry, action-toolability and B16.0.1/0.2 generators re-run with zero drift; no CRLF or control characters. Closes D20-20 (registry half), D20-21 (per-tool dimension; meters per process, OD-53), D20-24 (registry pins `maxRedirects` 0; the wire test follows in A1), D20-26, D20-27.
- **B20-A1 - the Streamable HTTP transport of the MCP client (2026-09-17 to 2026-09-20 local; workflow, three review-fix rou**
  - Gates (lead re-run on the final combined tree, bounded batches, one at a time): net, http, mcp 9 files / 323; acquisition, distributor egress and quota, schgen, cross-verify 17 / 242 (+2 env-gated skips); agent and the other redaction consumers 36 / 420; AST import gates, B16.1C tripwires, B17-F exposure, no-purchase 4 / 51; tsc 0; eslint clean on the 10 changed .ts files; the B20 and B19 registry generators with zero drift; no CRLF, control characters, console calls or mutation markers. The four A1 suites hold 122 cases (20 + 28 + 70 + 4), pinned against the page by a test.
- **B20-A2 - negotiation, tool discovery and foreign-descriptor gates of the MCP client (2026-09-20 local; workflow, review **
  - Gates (lead re-run on the combined tree, one heavy job at a time under the global lock): mcp, net, http 13 files / 422; acquisition, distributor egress and quota, schgen, cross-verify 17 / 242 (+2 env-gated skips); agent, B04 registry, B17-F exposure, no-purchase, build-loop injection 38 / 463; AST import gates and B16.1C tripwires 2 / 29 (ratchet unchanged, 162 = 159 + 3 + 0: A2 adds no route); tsc 0; eslint clean on the 10 changed .ts files; the B20 registry, B04 tool-registry and B09 agent generators with zero drift; no CRLF, control characters, console calls or mutation markers. The four A2 suites hold 99 cases (32 + 26 + 15 + 26).
- **B20-A2 review round 2 - the eight residual issues of the independent check (2026-09-21 local; fix workflow + lead; this **
  - Gates (lead re-run, one heavy job at a time under the global lock): mcp, net, http, acquisition, distributor egress and quota 28 files / 650 (+2 env-gated skips); agent, build-loop injection, B16.1C tripwires, AST import gates 37 / 440; tsc 0; eslint clean. The four A2 suites hold 111 cases.
- **B20-B1 - the MCP exposure subset and the tool definitions rendered from the registry (2026-09-20/21 local; server-track **
  - Gates (lead re-run in the worktree, under the lock): the B1 suites, mcp and the CI scope guard 8 files / 291; engineering 96 / 1 078; agent, B16.1C tripwires and AST import gates 36 / 423 (ratchet unchanged at 162 = 159 + 3 + 0: B1 adds no route); tsc 0; eslint clean on the 7 changed .ts files; the B04 and B09 generators and the new manifest generator with zero drift. 42 cases in two suites.
- **B20-A2 review round 3 - one directive matcher for every judged string, a scan budget, UTF-8 size bounds (2026-09-21 loca**
  - Gates (lead re-run, one heavy job at a time): mcp (client and server), net, http and the B1 exposure suite 488 passed; agent, B16.1C tripwires and AST import gates 423; tsc 0; eslint clean. The four A2 suites hold 123 cases.
- **B20-A2 review round 4 - the matcher regressions, bounded failing reads, word-aligned squashing, OD-81 (2026-09-21 local;**
  - Gates (lead re-run, one heavy job at a time): mcp (client and server), net, http and the B1 exposure suite 499 passed; agent, B16.1C tripwires and AST import gates 423; tsc 0; eslint clean. The A2 suites hold 134 cases.
- **B20-B2 - the Sirkit MCP endpoint, its principal, the route policy and the census move (2026-09-20/21 local; server-track**
- **B20-A2 follow-up - format characters inside a word, glued spellings, a schema node read as one text, two page rows (2026**
  - Gates (lead re-run, one heavy job at a time): mcp (client and server), net, http and the B1 exposure suite 514 passed; agent 394; B16.1C tripwires and AST import gates 29; tsc 0; eslint clean on the three changed files. The A2 suites hold 139 cases.
- **B20-A2 round 6 - the in-word run-on narrowed, the exfiltration phrase within one string, exact always-verb statements (2**
  - Gates (lead re-run, one heavy job at a time): mcp (client and server), net, http and the B1 exposure suite 521 passed; agent, B16.1C tripwires and AST import gates 423; tsc 0; eslint clean on the three changed files. The A2 suites hold 146 cases.
- **B20-B3 - MCP reads served from the durable server board (2026-09-21 local; server-track workflow + lead; 78c0339, merged**
  - Gates (lead re-run in the worktree, one heavy job at a time): auth, API MCP and lib MCP 59 files / 880 (+9 env-gated skips); app/api 27 / 1 059; engineering, agent, CI scope, AST gates and the acceptance pipeline 135 / 1 534; tsc 0; eslint clean on 34 files; 14 generators with zero drift (artifact hashes compared before and after). Merged into this branch with a normal merge.
- **B20-A3 - first dispatch stopped at the live re-read of the authorization pages, before any code; the lead's decisions (2**
  - Gates (fix round and lead, one heavy job at a time): lib MCP, net and the CI job-scope guard pass with this entry; tsc 0; eslint clean on the new suite; no generator input changed.
- **B20-A3 - the authorization client, delivered by the re-dispatch with the lead's decisions (2026-09-21 local; increment w**
  - Gates (lead, one heavy job at a time): mcp (client and server), net, http and the B1 exposure suite 721 passed; app/api/mcp 75; agent, B16.1C tripwires, AST import gates and the CI job-scope guard 430; tsc 0; eslint clean on the 20 changed and new files; the registry generator byte-identical. The A3 suites hold 146 cases.
- **B20-A4 - external MCP results as observations, the agent port and trace attribution (2026-09-21/22 local; increment work**
  - Gates (lead, one heavy job at a time): mcp, net, http and engineering 131 files / 1 836 passed; agent, acquisition, atomic and the AST import gates 76 / 1 064 (+2 env-gated skips); app/api 90 / 1 614 (+5 skips); tsc 0; eslint clean on the 43 changed and new files; 16 generators with zero drift (A4 had regenerated the B01, B04, B09, B10, B11 and B16-0-1/2 artifacts its one new descriptor moves). The A4 suites hold 68 cases.
- **B20-A4L - the registry row's per-tool agent allowlist, fail closed (2026-09-23 local; increment workflow + lead; this co**
  - Gates (lead, one heavy job at a time): mcp, net, http and engineering 131 files / 1 849 passed; agent and acquisition 50 / 623 (+2 env-gated skips); app/api 90 / 1 614 (+5 skips); tsc 0; eslint clean (one unused declaration the split left behind, removed); 16 generators with zero drift beyond the regenerated registry CSV.
- **B20-B4 - no proposal over MCP: the withholding move, the process gate, the stop evidence (2026-09-21 local; server-track**
  - Gates (lead, in the worktree, one heavy job at a time): auth, API MCP, lib MCP and net 69 files / 1 114 (+9 env-gated skips); app/api 27 / 1 059; engineering, agent, acquisition, AST gates, the acceptance pipeline and pcb candidates 148 / 1 733 (+2 skips); tsc 0; eslint clean on 15 files; 16 generators with zero drift; census 165/162/3/0.
- **B20-C1..C3 - three-way parity, tools/list pages, the first-party descriptor text gate (2026-09-22/23 local; server-track**
  - Gates (lead, in the worktree and again on the merged tree): auth, API MCP, lib MCP and net 76 files / 1 182 (+9 env-gated skips); app/api 27 / 1 059; engineering, agent, acquisition, AST gates and the acceptance pipeline 147 / 1 728 (+2 skips); on the merged tree 142 / 1 932, 122 / 1 635 (+11 skips) and 91 / 1 618 (+5 skips); tsc 0; eslint clean; 17 generators with zero drift; census 165/162/3/0.
- **B20-A5 - the provider-native MCP connector policy, refused (2026-09-23 local; increment workflow + lead; this commit)**
  - Gates (lead, one heavy job at a time): mcp and agent 77 files / 1 195 passed; engineering, acquisition, auth and app/api 245 / 3 412 (+16 env-gated skips); tsc 0; eslint clean on the 8 changed and new files; 17 generators with zero drift.
- **B20-D - the adversarial chapter: D1..D3, reviewed and fixed (2026-09-23/24 local; increment workflow + lead; this commit**
  - Lead gates (2026-09-24): `app/lib/mcp` + `app/api/mcp/__tests__` 918/920 in a 35-minute run under load (the two failures were 120 s timeouts inside AST tripwires - `b20-a3-secret-hygiene` D14 and `b20-b4-process-gate` case 3 - with `[vitest-worker]: Timeout calling "onTaskUpdate"`; re-run alone both suites pass 12/12 in 55 s; the cause is the loaded machine, the cold-import-under-load pattern recorded at B16-0, and it is recorded here rather than dismissed); tripwires 13 files / 229 cases; tsc clean; eslint clean on the D files and the configuration; Playwright `mcp-endpoint` 11/11 in 14.3 s (GET 405, DELETE 405, OPTIONS 204 measured again); the mcp-only wire run rewrote no evidence PNG; no generator affected (no descriptor, manifest, digest or generated artifact moves).
