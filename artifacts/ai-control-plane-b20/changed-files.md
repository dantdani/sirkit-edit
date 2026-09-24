# B20 - changed files

Every path changed on `chapter/b20-mcp-adapter` since `main` (102dd27): 232 files (135 added, 97 modified, 0 deleted) across 25 first-parent commits. The commit column names the first commit on the branch that touched the path; the subject says which increment.

## `(root)` (6)

| status | path | first touched by |
|---|---|---|
| M | `.env.example` | `c79b723` B20-A0: the MCP server registry, generalised admission, the feature flag and the CI admiss |
| M | `app/api/__tests__/b16-0-identity-header-gate.test.ts` | `71250ad` Merge the B20 server track (B2) into the B20 chapter branch |
| M | `app/api/__tests__/b16-1c-invariant-tripwires.test.ts` | `71250ad` Merge the B20 server track (B2) into the B20 chapter branch |
| M | `app/lib/prompts.ts` | `3b4b337` B20-A4: MCP results as observations, the agent port, trace attribution |
| M | `playwright.config.ts` | `3cb6f04` B20-D: the adversarial chapter - hostile server, never-reachable sweep, authority import g |
| M | `tsconfig.json` | `71250ad` Merge the B20 server track (B2) into the B20 chapter branch |

## `.github` (1)

| status | path | first touched by |
|---|---|---|
| M | `.github/workflows/deterministic-manufacturing.yml` | `c79b723` B20-A0: the MCP server registry, generalised admission, the feature flag and the CI admiss |

## `app/.well-known` (1)

| status | path | first touched by |
|---|---|---|
| A | `app/.well-known/oauth-protected-resource/api/mcp/route.ts` | `71250ad` Merge the B20 server track (B2) into the B20 chapter branch |

## `app/api/chat` (4)

| status | path | first touched by |
|---|---|---|
| M | `app/api/chat/__tests__/b19-d-external-text-injection-route.test.ts` | `3b4b337` B20-A4: MCP results as observations, the agent port, trace attribution |
| A | `app/api/chat/__tests__/b20-a4-chat-mcp-runtime.test.ts` | `3b4b337` B20-A4: MCP results as observations, the agent port, trace attribution |
| A | `app/api/chat/mcp-observation-runtime.ts` | `3b4b337` B20-A4: MCP results as observations, the agent port, trace attribution |
| M | `app/api/chat/route.ts` | `3b4b337` B20-A4: MCP results as observations, the agent port, trace attribution |

## `app/api/mcp` (10)

| status | path | first touched by |
|---|---|---|
| A | `app/api/mcp/__tests__/b20-b2-mcp-endpoint.test.ts` | `71250ad` Merge the B20 server track (B2) into the B20 chapter branch |
| A | `app/api/mcp/__tests__/b20-b2-mcp-token-route.test.ts` | `71250ad` Merge the B20 server track (B2) into the B20 chapter branch |
| A | `app/api/mcp/__tests__/b20-b2-own-client-interop.test.ts` | `71250ad` Merge the B20 server track (B2) into the B20 chapter branch |
| A | `app/api/mcp/__tests__/b20-b2-protected-resource-metadata.test.ts` | `71250ad` Merge the B20 server track (B2) into the B20 chapter branch |
| A | `app/api/mcp/__tests__/b20-b3-mcp-tools-call-reads.test.ts` | `a097c3a` Merge the B20 server track (B3) into the B20 chapter branch |
| A | `app/api/mcp/__tests__/b20-c2-tools-list-interop.test.ts` | `4f3dd30` Merge the B20 server track (B4 and C1..C3) into the B20 chapter branch |
| A | `app/api/mcp/__tests__/b20-d2-never-reachable-sweep.test.ts` | `3cb6f04` B20-D: the adversarial chapter - hostile server, never-reachable sweep, authority import g |
| A | `app/api/mcp/read-runtime.ts` | `a097c3a` Merge the B20 server track (B3) into the B20 chapter branch |
| A | `app/api/mcp/route.ts` | `71250ad` Merge the B20 server track (B2) into the B20 chapter branch |
| A | `app/api/mcp/token/route.ts` | `71250ad` Merge the B20 server track (B2) into the B20 chapter branch |

## `app/lib/acquisition` (5)

| status | path | first touched by |
|---|---|---|
| M | `app/lib/acquisition/__tests__/b19-e-ci-job-scope.test.ts` | `c79b723` B20-A0: the MCP server registry, generalised admission, the feature flag and the CI admiss |
| A | `app/lib/acquisition/__tests__/b20-a4-mcp-quarantine.test.ts` | `3b4b337` B20-A4: MCP results as observations, the agent port, trace attribution |
| M | `app/lib/acquisition/admission-control.ts` | `c79b723` B20-A0: the MCP server registry, generalised admission, the feature flag and the CI admiss |
| M | `app/lib/acquisition/import-review.ts` | `3b4b337` B20-A4: MCP results as observations, the agent port, trace attribution |
| M | `app/lib/acquisition/quarantine.ts` | `3b4b337` B20-A4: MCP results as observations, the agent port, trace attribution |

## `app/lib/agent` (23)

| status | path | first touched by |
|---|---|---|
| M | `app/lib/agent/__tests__/b10-editor-context.test.ts` | `71250ad` Merge the B20 server track (B2) into the B20 chapter branch |
| M | `app/lib/agent/__tests__/b11-1-trace-integrity.test.ts` | `71250ad` Merge the B20 server track (B2) into the B20 chapter branch |
| M | `app/lib/agent/__tests__/b11-2-replay-context.test.ts` | `8a5637f` B20 closeout (1/2): supersede the standing "no MCP" statements (D20-30) |
| M | `app/lib/agent/__tests__/b11-3-generated-pcb-shape.test.ts` | `8a5637f` B20 closeout (1/2): supersede the standing "no MCP" statements (D20-30) |
| M | `app/lib/agent/__tests__/b11-4-capture-ownership.test.ts` | `8a5637f` B20 closeout (1/2): supersede the standing "no MCP" statements (D20-30) |
| M | `app/lib/agent/__tests__/b11-5-capture-exactness.test.ts` | `8a5637f` B20 closeout (1/2): supersede the standing "no MCP" statements (D20-30) |
| M | `app/lib/agent/__tests__/b11-6-projection-ownership.test.ts` | `8a5637f` B20 closeout (1/2): supersede the standing "no MCP" statements (D20-30) |
| M | `app/lib/agent/__tests__/b11-trace-replay-evaluation.test.ts` | `71250ad` Merge the B20 server track (B2) into the B20 chapter branch |
| M | `app/lib/agent/__tests__/b17-f-view-tools.test.ts` | `3b4b337` B20-A4: MCP results as observations, the agent port, trace attribution |
| M | `app/lib/agent/__tests__/b18-b-loop-execution.test.ts` | `3b4b337` B20-A4: MCP results as observations, the agent port, trace attribution |
| M | `app/lib/agent/__tests__/b18-c-gateway-execution.test.ts` | `3b4b337` B20-A4: MCP results as observations, the agent port, trace attribution |
| A | `app/lib/agent/__tests__/b20-a4-observation-read-service.test.ts` | `3b4b337` B20-A4: MCP results as observations, the agent port, trace attribution |
| A | `app/lib/agent/__tests__/b20-a4-trace-attribution.test.ts` | `3b4b337` B20-A4: MCP results as observations, the agent port, trace attribution |
| M | `app/lib/agent/adapters.ts` | `6e3efa7` B20-A5: provider-native MCP connectors refused as policy |
| M | `app/lib/agent/context.ts` | `3b4b337` B20-A4: MCP results as observations, the agent port, trace attribution |
| M | `app/lib/agent/contracts.ts` | `3b4b337` B20-A4: MCP results as observations, the agent port, trace attribution |
| M | `app/lib/agent/gateway.ts` | `3b4b337` B20-A4: MCP results as observations, the agent port, trace attribution |
| M | `app/lib/agent/loop.ts` | `3b4b337` B20-A4: MCP results as observations, the agent port, trace attribution |
| A | `app/lib/agent/mcp-observation-reads.ts` | `3b4b337` B20-A4: MCP results as observations, the agent port, trace attribution |
| A | `app/lib/agent/provider-output-guard.ts` | `6e3efa7` B20-A5: provider-native MCP connectors refused as policy |
| M | `app/lib/agent/redaction.ts` | `c79b723` B20-A0: the MCP server registry, generalised admission, the feature flag and the CI admiss |
| M | `app/lib/agent/trace-recorder.ts` | `3b4b337` B20-A4: MCP results as observations, the agent port, trace attribution |
| M | `app/lib/agent/trace.ts` | `3b4b337` B20-A4: MCP results as observations, the agent port, trace attribution |

## `app/lib/atomic` (1)

| status | path | first touched by |
|---|---|---|
| M | `app/lib/atomic/types.ts` | `3b4b337` B20-A4: MCP results as observations, the agent port, trace attribution |

## `app/lib/auth` (23)

| status | path | first touched by |
|---|---|---|
| M | `app/lib/auth/__tests__/_boundary-analysis.ts` | `71250ad` Merge the B20 server track (B2) into the B20 chapter branch |
| M | `app/lib/auth/__tests__/b16-0-1-ci-gates.test.ts` | `71250ad` Merge the B20 server track (B2) into the B20 chapter branch |
| M | `app/lib/auth/__tests__/b16-0-2-gates.test.ts` | `71250ad` Merge the B20 server track (B2) into the B20 chapter branch |
| M | `app/lib/auth/__tests__/b16-0-22-tranche15-confinement-gate.test.ts` | `71250ad` Merge the B20 server track (B2) into the B20 chapter branch |
| M | `app/lib/auth/__tests__/b16-0-23-tranche16-confinement-gate.test.ts` | `71250ad` Merge the B20 server track (B2) into the B20 chapter branch |
| M | `app/lib/auth/__tests__/b16-0-24-tranche17-confinement-gate.test.ts` | `71250ad` Merge the B20 server track (B2) into the B20 chapter branch |
| M | `app/lib/auth/__tests__/b16-0-3-effective-classification.test.ts` | `71250ad` Merge the B20 server track (B2) into the B20 chapter branch |
| M | `app/lib/auth/__tests__/b16-0-7-wrapper-adoption-gate.test.ts` | `71250ad` Merge the B20 server track (B2) into the B20 chapter branch |
| M | `app/lib/auth/__tests__/b16-0-8-migration-ratchet.test.ts` | `71250ad` Merge the B20 server track (B2) into the B20 chapter branch |
| M | `app/lib/auth/__tests__/b16-1b-auth-composition.test.ts` | `71250ad` Merge the B20 server track (B2) into the B20 chapter branch |
| A | `app/lib/auth/__tests__/b20-b2-mcp-access-token.test.ts` | `71250ad` Merge the B20 server track (B2) into the B20 chapter branch |
| A | `app/lib/auth/__tests__/b20-b2-mcp-route-policy.test.ts` | `71250ad` Merge the B20 server track (B2) into the B20 chapter branch |
| A | `app/lib/auth/__tests__/b20-b2-route-matrices-pinned.test.ts` | `71250ad` Merge the B20 server track (B2) into the B20 chapter branch |
| A | `app/lib/auth/__tests__/b20-b2-route-tree.test.ts` | `71250ad` Merge the B20 server track (B2) into the B20 chapter branch |
| M | `app/lib/auth/authorize.ts` | `71250ad` Merge the B20 server track (B2) into the B20 chapter branch |
| M | `app/lib/auth/expected-origin.ts` | `71250ad` Merge the B20 server track (B2) into the B20 chapter branch |
| A | `app/lib/auth/mcp-bearer.ts` | `71250ad` Merge the B20 server track (B2) into the B20 chapter branch |
| M | `app/lib/auth/route-coverage.ts` | `71250ad` Merge the B20 server track (B2) into the B20 chapter branch |
| M | `app/lib/auth/route-handlers.ts` | `71250ad` Merge the B20 server track (B2) into the B20 chapter branch |
| M | `app/lib/auth/route-policy.ts` | `71250ad` Merge the B20 server track (B2) into the B20 chapter branch |
| M | `app/lib/auth/route-resource-classification.ts` | `71250ad` Merge the B20 server track (B2) into the B20 chapter branch |
| A | `app/lib/auth/route-tree.ts` | `71250ad` Merge the B20 server track (B2) into the B20 chapter branch |
| M | `app/lib/auth/trusted-request-context.ts` | `71250ad` Merge the B20 server track (B2) into the B20 chapter branch |

## `app/lib/engineering` (21)

| status | path | first touched by |
|---|---|---|
| A | `app/lib/engineering/__tests__/_durable-board-fixture.ts` | `a097c3a` Merge the B20 server track (B3) into the B20 chapter branch |
| M | `app/lib/engineering/__tests__/b04-tool-registry.test.ts` | `3b4b337` B20-A4: MCP results as observations, the agent port, trace attribution |
| M | `app/lib/engineering/__tests__/b12-boundary-and-e2e.test.ts` | `8a5637f` B20 closeout (1/2): supersede the standing "no MCP" statements (D20-30) |
| M | `app/lib/engineering/__tests__/b17-a-control-inventory.test.ts` | `3b4b337` B20-A4: MCP results as observations, the agent port, trace attribution |
| M | `app/lib/engineering/__tests__/b17-f-agent-exposure.test.ts` | `3b4b337` B20-A4: MCP results as observations, the agent port, trace attribution |
| M | `app/lib/engineering/__tests__/b18-c-exposure-lift.test.ts` | `3b4b337` B20-A4: MCP results as observations, the agent port, trace attribution |
| M | `app/lib/engineering/__tests__/b19-e-no-purchase-tripwire.test.ts` | `71250ad` Merge the B20 server track (B2) into the B20 chapter branch |
| A | `app/lib/engineering/__tests__/b20-a4-observation-descriptor.test.ts` | `3b4b337` B20-A4: MCP results as observations, the agent port, trace attribution |
| A | `app/lib/engineering/__tests__/b20-b1-mcp-exposure.test.ts` | `5121891` Merge the B20 server track (B1) into the B20 chapter branch |
| A | `app/lib/engineering/__tests__/b20-b3-durable-read-bundle.test.ts` | `a097c3a` Merge the B20 server track (B3) into the B20 chapter branch |
| A | `app/lib/engineering/__tests__/b20-b3-mcp-subset-move.test.ts` | `a097c3a` Merge the B20 server track (B3) into the B20 chapter branch |
| M | `app/lib/engineering/action-registry.ts` | `71250ad` Merge the B20 server track (B2) into the B20 chapter branch |
| M | `app/lib/engineering/action-surface.ts` | `71250ad` Merge the B20 server track (B2) into the B20 chapter branch |
| M | `app/lib/engineering/agent-exposure.ts` | `3b4b337` B20-A4: MCP results as observations, the agent port, trace attribution |
| A | `app/lib/engineering/descriptor-text.ts` | `4f3dd30` Merge the B20 server track (B4 and C1..C3) into the B20 chapter branch |
| A | `app/lib/engineering/durable-read-bundle.ts` | `a097c3a` Merge the B20 server track (B3) into the B20 chapter branch |
| A | `app/lib/engineering/mcp-exposure-review.ts` | `5121891` Merge the B20 server track (B1) into the B20 chapter branch |
| A | `app/lib/engineering/mcp-exposure.ts` | `5121891` Merge the B20 server track (B1) into the B20 chapter branch |
| M | `app/lib/engineering/tool-catalog.ts` | `a097c3a` Merge the B20 server track (B3) into the B20 chapter branch |
| M | `app/lib/engineering/tool-discovery.ts` | `5121891` Merge the B20 server track (B1) into the B20 chapter branch |
| M | `app/lib/engineering/tool-registry.ts` | `3b4b337` B20-A4: MCP results as observations, the agent port, trace attribution |

## `app/lib/llm` (1)

| status | path | first touched by |
|---|---|---|
| M | `app/lib/llm/errors.ts` | `6e3efa7` B20-A5: provider-native MCP connectors refused as policy |

## `app/lib/mcp` (79)

| status | path | first touched by |
|---|---|---|
| A | `app/lib/mcp/__tests__/_fake-authorization-server.ts` | `b2b16e4` B20-A3: the MCP client's authorization (client credentials) |
| A | `app/lib/mcp/__tests__/_fake-mcp-server.ts` | `f3c3473` B20-A2: negotiation, tool discovery and foreign-descriptor gates of the MCP client |
| A | `app/lib/mcp/__tests__/_fixtures.ts` | `c79b723` B20-A0: the MCP server registry, generalised admission, the feature flag and the CI admiss |
| A | `app/lib/mcp/__tests__/_hostile-server.ts` | `3cb6f04` B20-D: the adversarial chapter - hostile server, never-reachable sweep, authority import g |
| A | `app/lib/mcp/__tests__/b20-a0-admission-by-server-and-tool.test.ts` | `c79b723` B20-A0: the MCP server registry, generalised admission, the feature flag and the CI admiss |
| A | `app/lib/mcp/__tests__/b20-a0-feature-flag.test.ts` | `c79b723` B20-A0: the MCP server registry, generalised admission, the feature flag and the CI admiss |
| A | `app/lib/mcp/__tests__/b20-a0-server-registry.test.ts` | `c79b723` B20-A0: the MCP server registry, generalised admission, the feature flag and the CI admiss |
| A | `app/lib/mcp/__tests__/b20-a1-http-transport.test.ts` | `0ae9b57` B20-A1: the Streamable HTTP transport of the MCP client |
| A | `app/lib/mcp/__tests__/b20-a1-redaction-linear.test.ts` | `0ae9b57` B20-A1: the Streamable HTTP transport of the MCP client |
| A | `app/lib/mcp/__tests__/b20-a2-foreign-tools.test.ts` | `f3c3473` B20-A2: negotiation, tool discovery and foreign-descriptor gates of the MCP client |
| A | `app/lib/mcp/__tests__/b20-a2-negotiation.test.ts` | `f3c3473` B20-A2: negotiation, tool discovery and foreign-descriptor gates of the MCP client |
| A | `app/lib/mcp/__tests__/b20-a2-tool-call.test.ts` | `f3c3473` B20-A2: negotiation, tool discovery and foreign-descriptor gates of the MCP client |
| A | `app/lib/mcp/__tests__/b20-a2-tool-discovery.test.ts` | `f3c3473` B20-A2: negotiation, tool discovery and foreign-descriptor gates of the MCP client |
| A | `app/lib/mcp/__tests__/b20-a3-as-metadata.test.ts` | `b2b16e4` B20-A3: the MCP client's authorization (client credentials) |
| A | `app/lib/mcp/__tests__/b20-a3-authorized-post.test.ts` | `b2b16e4` B20-A3: the MCP client's authorization (client credentials) |
| A | `app/lib/mcp/__tests__/b20-a3-live-reread.test.ts` | `d7d2f61` B20-A3: record the live re-read that stopped the first dispatch |
| A | `app/lib/mcp/__tests__/b20-a3-prm-discovery.test.ts` | `b2b16e4` B20-A3: the MCP client's authorization (client credentials) |
| A | `app/lib/mcp/__tests__/b20-a3-registry-authorization-pin.test.ts` | `b2b16e4` B20-A3: the MCP client's authorization (client credentials) |
| A | `app/lib/mcp/__tests__/b20-a3-secret-hygiene.test.ts` | `b2b16e4` B20-A3: the MCP client's authorization (client credentials) |
| A | `app/lib/mcp/__tests__/b20-a3-token-audience.test.ts` | `b2b16e4` B20-A3: the MCP client's authorization (client credentials) |
| A | `app/lib/mcp/__tests__/b20-a3-token-cache.test.ts` | `b2b16e4` B20-A3: the MCP client's authorization (client credentials) |
| A | `app/lib/mcp/__tests__/b20-a3-token-request.test.ts` | `b2b16e4` B20-A3: the MCP client's authorization (client credentials) |
| A | `app/lib/mcp/__tests__/b20-a4-agent-read-port.test.ts` | `3b4b337` B20-A4: MCP results as observations, the agent port, trace attribution |
| A | `app/lib/mcp/__tests__/b20-a4-observation-normalizer.test.ts` | `3b4b337` B20-A4: MCP results as observations, the agent port, trace attribution |
| A | `app/lib/mcp/__tests__/b20-a5-connector-tripwires.test.ts` | `6e3efa7` B20-A5: provider-native MCP connectors refused as policy |
| A | `app/lib/mcp/__tests__/b20-a5-provider-connector-policy.test.ts` | `6e3efa7` B20-A5: provider-native MCP connectors refused as policy |
| A | `app/lib/mcp/__tests__/b20-a5-provider-output-guard.test.ts` | `6e3efa7` B20-A5: provider-native MCP connectors refused as policy |
| A | `app/lib/mcp/__tests__/b20-a5-provider-request-shape.test.ts` | `6e3efa7` B20-A5: provider-native MCP connectors refused as policy |
| A | `app/lib/mcp/__tests__/b20-d1-malicious-server.test.ts` | `3cb6f04` B20-D: the adversarial chapter - hostile server, never-reachable sweep, authority import g |
| A | `app/lib/mcp/__tests__/b20-d1-rebinding-window.test.ts` | `3cb6f04` B20-D: the adversarial chapter - hostile server, never-reachable sweep, authority import g |
| A | `app/lib/mcp/agent-port.ts` | `3b4b337` B20-A4: MCP results as observations, the agent port, trace attribution |
| A | `app/lib/mcp/authorization.ts` | `b2b16e4` B20-A3: the MCP client's authorization (client credentials) |
| A | `app/lib/mcp/foreign-tools.ts` | `f3c3473` B20-A2: negotiation, tool discovery and foreign-descriptor gates of the MCP client |
| A | `app/lib/mcp/http-transport.ts` | `0ae9b57` B20-A1: the Streamable HTTP transport of the MCP client |
| A | `app/lib/mcp/negotiation.ts` | `f3c3473` B20-A2: negotiation, tool discovery and foreign-descriptor gates of the MCP client |
| A | `app/lib/mcp/oauth-discovery.ts` | `b2b16e4` B20-A3: the MCP client's authorization (client credentials) |
| A | `app/lib/mcp/observation.ts` | `3b4b337` B20-A4: MCP results as observations, the agent port, trace attribution |
| A | `app/lib/mcp/provider-connector-policy.ts` | `6e3efa7` B20-A5: provider-native MCP connectors refused as policy |
| A | `app/lib/mcp/request-id.ts` | `b2b16e4` B20-A3: the MCP client's authorization (client credentials) |
| A | `app/lib/mcp/rollout.ts` | `c79b723` B20-A0: the MCP server registry, generalised admission, the feature flag and the CI admiss |
| A | `app/lib/mcp/server-registry.ts` | `c79b723` B20-A0: the MCP server registry, generalised admission, the feature flag and the CI admiss |
| A | `app/lib/mcp/server/__tests__/_citations.ts` | `4f3dd30` Merge the B20 server track (B4 and C1..C3) into the B20 chapter branch |
| A | `app/lib/mcp/server/__tests__/_import-closure.ts` | `a097c3a` Merge the B20 server track (B3) into the B20 chapter branch |
| A | `app/lib/mcp/server/__tests__/_read-harness.ts` | `a097c3a` Merge the B20 server track (B3) into the B20 chapter branch |
| A | `app/lib/mcp/server/__tests__/b20-b1-tool-definitions.test.ts` | `5121891` Merge the B20 server track (B1) into the B20 chapter branch |
| A | `app/lib/mcp/server/__tests__/b20-b2-import-gates.test.ts` | `71250ad` Merge the B20 server track (B2) into the B20 chapter branch |
| A | `app/lib/mcp/server/__tests__/b20-b2-server-protocol.test.ts` | `71250ad` Merge the B20 server track (B2) into the B20 chapter branch |
| A | `app/lib/mcp/server/__tests__/b20-b3-import-gates.test.ts` | `a097c3a` Merge the B20 server track (B3) into the B20 chapter branch |
| A | `app/lib/mcp/server/__tests__/b20-b3-read-arguments.test.ts` | `a097c3a` Merge the B20 server track (B3) into the B20 chapter branch |
| A | `app/lib/mcp/server/__tests__/b20-b3-read-call.test.ts` | `a097c3a` Merge the B20 server track (B3) into the B20 chapter branch |
| A | `app/lib/mcp/server/__tests__/b20-b3-read-trace.test.ts` | `a097c3a` Merge the B20 server track (B3) into the B20 chapter branch |
| A | `app/lib/mcp/server/__tests__/b20-b3-replay-cache.test.ts` | `a097c3a` Merge the B20 server track (B3) into the B20 chapter branch |
| A | `app/lib/mcp/server/__tests__/b20-b4-process-gate.test.ts` | `4f3dd30` Merge the B20 server track (B4 and C1..C3) into the B20 chapter branch |
| A | `app/lib/mcp/server/__tests__/b20-b4-stop-evidence.test.ts` | `4f3dd30` Merge the B20 server track (B4 and C1..C3) into the B20 chapter branch |
| A | `app/lib/mcp/server/__tests__/b20-b4-withhold-proposals.test.ts` | `4f3dd30` Merge the B20 server track (B4 and C1..C3) into the B20 chapter branch |
| A | `app/lib/mcp/server/__tests__/b20-c1-structured-content.test.ts` | `4f3dd30` Merge the B20 server track (B4 and C1..C3) into the B20 chapter branch |
| A | `app/lib/mcp/server/__tests__/b20-c1-three-way-parity.test.ts` | `4f3dd30` Merge the B20 server track (B4 and C1..C3) into the B20 chapter branch |
| A | `app/lib/mcp/server/__tests__/b20-c2-tools-list-pages.test.ts` | `4f3dd30` Merge the B20 server track (B4 and C1..C3) into the B20 chapter branch |
| A | `app/lib/mcp/server/__tests__/b20-c3-a2-cross-check.test.ts` | `4f3dd30` Merge the B20 server track (B4 and C1..C3) into the B20 chapter branch |
| A | `app/lib/mcp/server/__tests__/b20-c3-descriptor-text-gate.test.ts` | `4f3dd30` Merge the B20 server track (B4 and C1..C3) into the B20 chapter branch |
| A | `app/lib/mcp/server/__tests__/b20-c3-negative-tripwires.test.ts` | `4f3dd30` Merge the B20 server track (B4 and C1..C3) into the B20 chapter branch |
| A | `app/lib/mcp/server/__tests__/b20-d2-name-spellings.test.ts` | `3cb6f04` B20-D: the adversarial chapter - hostile server, never-reachable sweep, authority import g |
| A | `app/lib/mcp/server/__tests__/b20-d3-authority-import-gates.test.ts` | `3cb6f04` B20-D: the adversarial chapter - hostile server, never-reachable sweep, authority import g |
| A | `app/lib/mcp/server/dispatch.ts` | `71250ad` Merge the B20 server track (B2) into the B20 chapter branch |
| A | `app/lib/mcp/server/inbound-limits.ts` | `71250ad` Merge the B20 server track (B2) into the B20 chapter branch |
| A | `app/lib/mcp/server/protocol.ts` | `71250ad` Merge the B20 server track (B2) into the B20 chapter branch |
| A | `app/lib/mcp/server/read-arguments.ts` | `a097c3a` Merge the B20 server track (B3) into the B20 chapter branch |
| A | `app/lib/mcp/server/read-call.ts` | `a097c3a` Merge the B20 server track (B3) into the B20 chapter branch |
| A | `app/lib/mcp/server/read-trace.ts` | `a097c3a` Merge the B20 server track (B3) into the B20 chapter branch |
| A | `app/lib/mcp/server/replay-cache.ts` | `a097c3a` Merge the B20 server track (B3) into the B20 chapter branch |
| A | `app/lib/mcp/server/request-trace.ts` | `71250ad` Merge the B20 server track (B2) into the B20 chapter branch |
| A | `app/lib/mcp/server/resource-metadata.ts` | `71250ad` Merge the B20 server track (B2) into the B20 chapter branch |
| A | `app/lib/mcp/server/structured-content.ts` | `4f3dd30` Merge the B20 server track (B4 and C1..C3) into the B20 chapter branch |
| A | `app/lib/mcp/server/token-issuance.ts` | `71250ad` Merge the B20 server track (B2) into the B20 chapter branch |
| A | `app/lib/mcp/server/tool-definitions.ts` | `5121891` Merge the B20 server track (B1) into the B20 chapter branch |
| A | `app/lib/mcp/server/tool-pages.ts` | `4f3dd30` Merge the B20 server track (B4 and C1..C3) into the B20 chapter branch |
| A | `app/lib/mcp/server/tool-parity.ts` | `4f3dd30` Merge the B20 server track (B4 and C1..C3) into the B20 chapter branch |
| A | `app/lib/mcp/tool-call.ts` | `f3c3473` B20-A2: negotiation, tool discovery and foreign-descriptor gates of the MCP client |
| A | `app/lib/mcp/tool-discovery.ts` | `f3c3473` B20-A2: negotiation, tool discovery and foreign-descriptor gates of the MCP client |

## `app/lib/net` (4)

| status | path | first touched by |
|---|---|---|
| A | `app/lib/net/__tests__/b20-a1-outbound-headers.test.ts` | `0ae9b57` B20-A1: the Streamable HTTP transport of the MCP client |
| A | `app/lib/net/__tests__/b20-a1-sse-reader.test.ts` | `0ae9b57` B20-A1: the Streamable HTTP transport of the MCP client |
| M | `app/lib/net/outbound-fetch.ts` | `0ae9b57` B20-A1: the Streamable HTTP transport of the MCP client |
| A | `app/lib/net/sse-reader.ts` | `0ae9b57` B20-A1: the Streamable HTTP transport of the MCP client |

## `app/lib/schgen` (1)

| status | path | first touched by |
|---|---|---|
| M | `app/lib/schgen/endpoint-client.ts` | `0ae9b57` B20-A1: the Streamable HTTP transport of the MCP client |

## `app/lib/workflow` (1)

| status | path | first touched by |
|---|---|---|
| M | `app/lib/workflow/prompt-to-gerber/__tests__/acceptance-pipeline.test.ts` | `a097c3a` Merge the B20 server track (B3) into the B20 chapter branch |

## `artifacts/ai-control-plane-b01` (2)

| status | path | first touched by |
|---|---|---|
| M | `artifacts/ai-control-plane-b01/api-route-coverage.csv` | `71250ad` Merge the B20 server track (B2) into the B20 chapter branch |
| M | `artifacts/ai-control-plane-b01/ui-command-toolability-matrix.csv` | `71250ad` Merge the B20 server track (B2) into the B20 chapter branch |

## `artifacts/ai-control-plane-b04` (2)

| status | path | first touched by |
|---|---|---|
| M | `artifacts/ai-control-plane-b04/provider-schema-parity.json` | `3b4b337` B20-A4: MCP results as observations, the agent port, trace attribution |
| M | `artifacts/ai-control-plane-b04/tool-registry.csv` | `3b4b337` B20-A4: MCP results as observations, the agent port, trace attribution |

## `artifacts/ai-control-plane-b05` (1)

| status | path | first touched by |
|---|---|---|
| M | `artifacts/ai-control-plane-b05/invocation-security-policy.md` | `8a5637f` B20 closeout (1/2): supersede the standing "no MCP" statements (D20-30) |

## `artifacts/ai-control-plane-b09` (5)

| status | path | first touched by |
|---|---|---|
| M | `artifacts/ai-control-plane-b09/agent-exposed-tool-manifest.csv` | `a097c3a` Merge the B20 server track (B3) into the B20 chapter branch |
| M | `artifacts/ai-control-plane-b09/agent-exposed-tool-manifest.json` | `a097c3a` Merge the B20 server track (B3) into the B20 chapter branch |
| M | `artifacts/ai-control-plane-b09/normalized-loop-replay-fixtures.json` | `a097c3a` Merge the B20 server track (B3) into the B20 chapter branch |
| M | `artifacts/ai-control-plane-b09/provider-schema-parity.json` | `3b4b337` B20-A4: MCP results as observations, the agent port, trace attribution |
| M | `artifacts/ai-control-plane-b09/tool-activation-audit.csv` | `a097c3a` Merge the B20 server track (B3) into the B20 chapter branch |

## `artifacts/ai-control-plane-b11` (2)

| status | path | first touched by |
|---|---|---|
| M | `artifacts/ai-control-plane-b11/evaluation-results.json` | `a097c3a` Merge the B20 server track (B3) into the B20 chapter branch |
| M | `artifacts/ai-control-plane-b11/replay-trace-pins.json` | `a097c3a` Merge the B20 server track (B3) into the B20 chapter branch |

## `artifacts/ai-control-plane-b16-0` (1)

| status | path | first touched by |
|---|---|---|
| M | `artifacts/ai-control-plane-b16-0/auth-route-coverage.csv` | `71250ad` Merge the B20 server track (B2) into the B20 chapter branch |

## `artifacts/ai-control-plane-b16-0-1` (1)

| status | path | first touched by |
|---|---|---|
| M | `artifacts/ai-control-plane-b16-0-1/exact-route-authorization-policy.csv` | `71250ad` Merge the B20 server track (B2) into the B20 chapter branch |

## `artifacts/ai-control-plane-b16-0-2` (1)

| status | path | first touched by |
|---|---|---|
| M | `artifacts/ai-control-plane-b16-0-2/route-data-and-resource-classification.csv` | `71250ad` Merge the B20 server track (B2) into the B20 chapter branch |

## `artifacts/ai-control-plane-b16-0-4` (2)

| status | path | first touched by |
|---|---|---|
| M | `artifacts/ai-control-plane-b16-0-4/method-authorization-matrix.csv` | `71250ad` Merge the B20 server track (B2) into the B20 chapter branch |
| M | `artifacts/ai-control-plane-b16-0-4/request-body-boundary-matrix.csv` | `71250ad` Merge the B20 server track (B2) into the B20 chapter branch |

## `artifacts/ai-control-plane-b16-0-7` (1)

| status | path | first touched by |
|---|---|---|
| M | `artifacts/ai-control-plane-b16-0-7/route-wrapper-matrix.csv` | `71250ad` Merge the B20 server track (B2) into the B20 chapter branch |

## `artifacts/ai-control-plane-b16-closeout` (2)

| status | path | first touched by |
|---|---|---|
| M | `artifacts/ai-control-plane-b16-closeout/clean-and-upgrade-db-proof.md` | `e5949b7` LB-4: the database qualification run against a real PostgreSQL server |
| M | `artifacts/ai-control-plane-b16-closeout/unknowns-and-owner-decisions.md` | `e5949b7` LB-4: the database qualification run against a real PostgreSQL server |

## `artifacts/ai-control-plane-b17` (1)

| status | path | first touched by |
|---|---|---|
| M | `artifacts/ai-control-plane-b17/unknowns-and-owner-decisions.md` | `e5949b7` LB-4: the database qualification run against a real PostgreSQL server |

## `artifacts/ai-control-plane-b18` (2)

| status | path | first touched by |
|---|---|---|
| M | `artifacts/ai-control-plane-b18/chat-execution-ux.md` | `6e3efa7` B20-A5: provider-native MCP connectors refused as policy |
| M | `artifacts/ai-control-plane-b18/safe-mutation-contract.md` | `6e3efa7` B20-A5: provider-native MCP connectors refused as policy |

## `artifacts/ai-control-plane-b19` (1)

| status | path | first touched by |
|---|---|---|
| M | `artifacts/ai-control-plane-b19/import-security-matrix.md` | `6e3efa7` B20-A5: provider-native MCP connectors refused as policy |

## `artifacts/ai-control-plane-b20` (16)

| status | path | first touched by |
|---|---|---|
| A | `artifacts/ai-control-plane-b20/README.md` | `54ec33f` B20 chapter start: discovery of the MCP adapter surface |
| A | `artifacts/ai-control-plane-b20/discovery.md` | `54ec33f` B20 chapter start: discovery of the MCP adapter surface |
| A | `artifacts/ai-control-plane-b20/mcp-adversarial.md` | `3cb6f04` B20-D: the adversarial chapter - hostile server, never-reachable sweep, authority import g |
| A | `artifacts/ai-control-plane-b20/mcp-client-boundary.md` | `c79b723` B20-A0: the MCP server registry, generalised admission, the feature flag and the CI admiss |
| A | `artifacts/ai-control-plane-b20/mcp-exposure.md` | `5121891` Merge the B20 server track (B1) into the B20 chapter branch |
| A | `artifacts/ai-control-plane-b20/mcp-parity.json` | `4f3dd30` Merge the B20 server track (B4 and C1..C3) into the B20 chapter branch |
| A | `artifacts/ai-control-plane-b20/mcp-parity.md` | `4f3dd30` Merge the B20 server track (B4 and C1..C3) into the B20 chapter branch |
| A | `artifacts/ai-control-plane-b20/mcp-provider-connectors.md` | `6e3efa7` B20-A5: provider-native MCP connectors refused as policy |
| A | `artifacts/ai-control-plane-b20/mcp-reference-notes.md` | `54ec33f` B20 chapter start: discovery of the MCP adapter surface |
| A | `artifacts/ai-control-plane-b20/mcp-server-endpoint.md` | `71250ad` Merge the B20 server track (B2) into the B20 chapter branch |
| A | `artifacts/ai-control-plane-b20/mcp-server-proposals.md` | `4f3dd30` Merge the B20 server track (B4 and C1..C3) into the B20 chapter branch |
| A | `artifacts/ai-control-plane-b20/mcp-server-reads.md` | `a097c3a` Merge the B20 server track (B3) into the B20 chapter branch |
| A | `artifacts/ai-control-plane-b20/mcp-server-registry.csv` | `c79b723` B20-A0: the MCP server registry, generalised admission, the feature flag and the CI admiss |
| A | `artifacts/ai-control-plane-b20/mcp-server-registry.md` | `c79b723` B20-A0: the MCP server registry, generalised admission, the feature flag and the CI admiss |
| A | `artifacts/ai-control-plane-b20/mcp-tool-manifest.csv` | `5121891` Merge the B20 server track (B1) into the B20 chapter branch |
| A | `artifacts/ai-control-plane-b20/mcp-tool-manifest.json` | `5121891` Merge the B20 server track (B1) into the B20 chapter branch |

## `artifacts/remaining-builder-program` (3)

| status | path | first touched by |
|---|---|---|
| M | `artifacts/remaining-builder-program/EXECUTION_LEDGER.md` | `54ec33f` B20 chapter start: discovery of the MCP adapter surface |
| M | `artifacts/remaining-builder-program/OWNER_DECISIONS.md` | `54ec33f` B20 chapter start: discovery of the MCP adapter surface |
| M | `artifacts/remaining-builder-program/PROGRAM_STATE.json` | `54ec33f` B20 chapter start: discovery of the MCP adapter surface |

## `e2e` (1)

| status | path | first touched by |
|---|---|---|
| A | `e2e/mcp-endpoint.spec.ts` | `3cb6f04` B20-D: the adversarial chapter - hostile server, never-reachable sweep, authority import g |

## `scripts` (7)

| status | path | first touched by |
|---|---|---|
| M | `scripts/generate-agent-artifacts.ts` | `3b4b337` B20-A4: MCP results as observations, the agent port, trace attribution |
| M | `scripts/generate-b16-0-4-artifacts.ts` | `71250ad` Merge the B20 server track (B2) into the B20 chapter branch |
| M | `scripts/generate-b16-0-7-artifacts.ts` | `71250ad` Merge the B20 server track (B2) into the B20 chapter branch |
| M | `scripts/generate-b16-0-8-baseline.ts` | `71250ad` Merge the B20 server track (B2) into the B20 chapter branch |
| A | `scripts/generate-b20-mcp-parity.ts` | `4f3dd30` Merge the B20 server track (B4 and C1..C3) into the B20 chapter branch |
| A | `scripts/generate-b20-mcp-server-registry.ts` | `c79b723` B20-A0: the MCP server registry, generalised admission, the feature flag and the CI admiss |
| A | `scripts/generate-b20-mcp-tool-manifest.ts` | `5121891` Merge the B20 server track (B1) into the B20 chapter branch |

## Commits, first-parent order

- `54ec33f` B20 chapter start: discovery of the MCP adapter surface
- `c79b723` B20-A0: the MCP server registry, generalised admission, the feature flag and the CI admission rule
- `0ae9b57` B20-A1: the Streamable HTTP transport of the MCP client
- `f3c3473` B20-A2: negotiation, tool discovery and foreign-descriptor gates of the MCP client
- `a56537a` B20-A2 review round 2: token prefixes, directives in values, a per-listing scrub budget
- `5121891` Merge the B20 server track (B1) into the B20 chapter branch
- `af40a01` B20-B1 lead records: owner decisions, closure clauses, README row, ledger
- `aea624e` B20-A2 review round 3: one directive matcher, a scan budget, UTF-8 size bounds
- `2e1f449` B20-A2 review round 4: matcher regressions, bounded failing reads, OD-81
- `71250ad` Merge the B20 server track (B2) into the B20 chapter branch
- `84e778c` B20-B2 lead records: owner decisions, closure clauses, amendments, README, ledger
- `38d4481` B20-A2 follow-up: format characters inside a word, glued spellings, node text
- `1981285` B20-A2 round 6: narrower in-word run-on, one-string exfiltration phrase
- `a097c3a` Merge the B20 server track (B3) into the B20 chapter branch
- `4299067` B20-B3 lead records: owner decisions, closure clauses, README, ledger
- `d7d2f61` B20-A3: record the live re-read that stopped the first dispatch
- `b2b16e4` B20-A3: the MCP client's authorization (client credentials)
- `3b4b337` B20-A4: MCP results as observations, the agent port, trace attribution
- `c167bd0` B20-A4L: the registry row's per-tool agent allowlist, fail closed
- `4f3dd30` Merge the B20 server track (B4 and C1..C3) into the B20 chapter branch
- `7ac88b3` B20-B4 and C1..C3 lead records: owner decisions, closures, README, ledger
- `6e3efa7` B20-A5: provider-native MCP connectors refused as policy
- `e5949b7` LB-4: the database qualification run against a real PostgreSQL server
- `3cb6f04` B20-D: the adversarial chapter - hostile server, never-reachable sweep, authority import gate, wire spec
- `8a5637f` B20 closeout (1/2): supersede the standing "no MCP" statements (D20-30)

## The closeout commit itself

Generated before the closeout commit, so the table above does not list what that commit adds: this file, `test-and-validation-report.md`, `unknowns-and-owner-decisions.md`, `final-verdict.md`, the README validation row, the ledger's closeout entry and `PROGRAM_STATE.json`.
