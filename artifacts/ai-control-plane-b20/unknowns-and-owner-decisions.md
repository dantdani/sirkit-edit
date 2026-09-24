# B20 - unknowns and owner decisions

## Owner decisions recorded (OD-41 and later)

| OD | title | recorded |
|---|---|---|
| OD-41 | Which MCP protocol era Sirkit implements (B20, 2026-09-17) | yes |
| OD-42 | MCP implementation dependency (B20, 2026-09-17) | yes |
| OD-43 | Who issues the bearer tokens the Sirkit MCP endpoint accepts (B20-B2, 2026-09-20) | yes |
| OD-44 | CSRF on the MCP endpoint (B20-B2, 2026-09-20) | yes |
| OD-45 | May Sirkit hand an MCP server credential to a model provider? (B20-A5, 2026-09-23) | yes |
| OD-46 | OAuth state storage for the MCP client (B20-A0, 2026-09-17) | yes |
| OD-47 | - | no: recorded in discovery.md section 6 with its safe default applied (stdio deferred) and never re-recorded as a heading |
| OD-48 | The initial external MCP allowlist (B20-A0, 2026-09-17) | yes |
| OD-49 | Selection and view-session controls over MCP (B20-B1, 2026-09-20) | yes |
| OD-50 | Inert proposal delivery over MCP (B20-B4, 2026-09-21) | yes |
| OD-51 | - | no: recorded in discovery.md section 6 with its safe default applied (the rebinding mitigation D1 executes) and never re-recorded as a heading |
| OD-52 | How a FOREIGN MCP tool is named inside Sirkit (B20-A2, 2026-09-20) | yes |
| OD-53 | Per-process quota meters for MCP servers (B20-A0, 2026-09-17) | yes |
| OD-54 | The MCP route classification (route part) (B20-B2, 2026-09-20) | yes |
| OD-55 | External reads over MCP (B20-B1, 2026-09-20) | yes |
| OD-56 | Output schemas declared to MCP (B20-B1, 2026-09-20) | yes |
| OD-57 | What tools/list varies by (B20-B2, 2026-09-20) | yes |
| OD-58 | How a FOREIGN JSON Schema is validated (B20-A2, 2026-09-20) | yes |
| OD-59 | CI admission rule for B20 suites (B20-A0, 2026-09-17) | yes |
| OD-60 | The `_meta` prefix of Sirkit's MCP tool definitions (B20-B1, 2026-09-20) | yes |
| OD-61 | How the MCP client's authorization hosts are allowlisted (B20-A3, 2026-09-21) | yes |
| OD-62 | Scope ceiling and step-up for the MCP client (B20-A3, 2026-09-21) | yes |
| OD-63 | Client-credentials token lifetime, cache and request rate (B20-A3, 2026-09-21, within OD-46) | yes |
| OD-64 | When the MCP client discovers authorization, and how strictly (B20-A3, 2026-09-21) | yes |
| OD-65 | Who the MCP caller is inside Sirkit (B20-B2, 2026-09-20) | yes |
| OD-66 | Where the protected-resource metadata lives, and what the route inventories walk (B20-B2, 2026-09-20) | yes |
| OD-67 | What an MCP read may read, and which revision it is pinned to (B20-B3, 2026-09-21) | yes |
| OD-68 | The durable-server-board authority on six board reads (B20-B3, 2026-09-21) | yes |
| OD-69 | The MCP subset shrinks from 16 to 14 (B20-B3, 2026-09-21) | yes |
| OD-70 | How a call binds its revision, registry version and idempotency (B20-B3, 2026-09-21) | yes |
| OD-71 | Idempotent replay of MCP reads (B20-B3, 2026-09-21) | yes |
| OD-72 | The MCP read trace and membership re-verification (B20-B3, 2026-09-21) | yes |
| OD-73 | Bounds, parity and labelling of MCP reads (B20-B3, 2026-09-21) | yes |
| OD-74 | The agent's reach into approved external MCP servers (B20-A4, 2026-09-21) | yes |
| OD-75 | What may leave Sirkit in an agent-authored MCP call (B20-A4, 2026-09-21) | yes |
| OD-76 | What of an external MCP result and catalog reaches the model (B20-A4, 2026-09-21) | yes |
| OD-77 | Result text that reads as an instruction or carries a credential (B20-A4, 2026-09-21) | yes |
| OD-78 | Freshness, caching and retention of external MCP observations (B20-A4, 2026-09-21) | yes |
| OD-79 | MCP facts in the quarantine pipeline (B20-A4, 2026-09-21) | yes |
| OD-80 | How an external call is attributed in the run trace (B20-A4, 2026-09-21) | yes |
| OD-81 | What the directive filter on foreign tool text guarantees (B20-A2, 2026-09-21) | yes |
| OD-82 | Every proposal withheld from MCP; the subset shrinks from 14 to 9 (B20-B4, 2026-09-21) | yes |
| OD-83 | - | no: reserved for the proposal reversal (task-B4.md section 8) |
| OD-84 | - | no: reserved for the proposal reversal (task-B4.md section 8) |
| OD-85 | - | no: reserved for the proposal reversal (task-B4.md section 8) |
| OD-86 | - | no: reserved for the proposal reversal (task-B4.md section 8) |
| OD-87 | Placement over MCP: the engine cannot be bounded or stopped inside a spec (B20-B4, 2026-09-21) | yes |
| OD-88 | - | no: reserved for the proposal reversal (task-B4.md section 8) |
| OD-89 | - | no: a numbering gap: never assigned by any increment |
| OD-90 | Provider-native MCP connectors in B20 (B20-A5, 2026-09-23) | yes |
| OD-91 | A provider response carrying output Sirkit did not request (B20-A5, 2026-09-23) | yes |
| OD-92 | The conditions any future provider-native connector must meet (B20-A5, 2026-09-23) | yes |
| OD-93 | - | no: a numbering gap: never assigned by any increment |
| OD-94 | - | no: a numbering gap: never assigned by any increment |
| OD-95 | Where the three-way parity of the MCP-exposed tools is proven and recorded (B20-C, 2026-09-22) | yes |
| OD-96 | Output schemas and `structuredContent` at the MCP boundary (B20-C, 2026-09-22; amends OD-56) | yes |
| OD-97 | tools/list pagination (B20-C, 2026-09-22) | yes |
| OD-98 | Listing identity and caching of tools/list pages (B20-C, 2026-09-22; amends OD-57) | yes |
| OD-99 | The first-party descriptor text gate: what it judges and under which bounds (B20-C, 2026-09-23) | yes |
| OD-100 | Annotation-shaped fields and privilege labels on first-party descriptors (B20-C, 2026-09-22) | yes |
| OD-101 | Contextual discovery on tools/list (B20-C, 2026-09-22) | yes |
| OD-102 | The live external contract check is recorded, not built (B20-D, 2026-09-24) | yes |
| OD-103 | What the adversarial chapter may duplicate (B20-D1, B20-D2, 2026-09-24) | yes |
| OD-104 | How exhaustive the never-reachable sweep is (B20-D2, 2026-09-24) | yes |
| OD-105 | The approval-controller import family, and the asymmetric gate (B20-D3, 2026-09-24) | yes |

## Discovery defects D20-1..36

| defect | title | state | closed by | live |
|---|---|---|---|---|
| D20-1 | No per-protocol exposure dimension in the registry. | closed | B1 |  |
| D20-2 | A registry-generated list built from the reviewed agent set would advertise the six granted Tier 1 mutations. | closed | B1 |  |
| D20-3 | No bearer/OAuth user principal; no audience/issuer validation. | closed | B2 | BLOCKED-LIVE |
| D20-4 | Same-origin CSRF refuses a missing Origin on every authenticated non-GET row, and CI pins it. | closed | B2 |  |
| D20-5 | No route class, identity source or wrapper for a bearer-authenticated JSON-RPC endpoint; single-row policy per | closed | B2 |  |
| D20-6 | No server-side canonical-state source for a browser-less read. | closed | B3 |  |
| D20-7 | Selection and view-session controls have no delivery path outside the chat run's stream. | deferred | OD-49 |  |
| D20-8 | Inert proposals and layout candidates exist only as run-stream events. | deferred | B4 (OD-50, OD-82, OD-87) |  |
| D20-9 | Membership revision not bound into read/view invocations or traces. | closed | B3 |  |
| D20-10 | No invocation/idempotency identity for reads or proposals. | closed | B3 |  |
| D20-11 | Trace contracts cannot record an MCP principal or an external server. | closed | A4, B3 |  |
| D20-12 | Parity is two-way over `{name, description, inputSchema}`; output schemas never pass the structural validator. | closed | C1 |  |
| D20-13 | No name-spelling rule for MCP tool names. | closed | A2, C1 |  |
| D20-14 | No cursor pagination, `ttlMs`/`cacheScope`, or listing identity. | closed | B1, C2 |  |
| D20-15 | No lexical/injection gate on names, titles, descriptions or annotations. | closed | A2, C3 |  |
| D20-16 | `outboundFetch` discards response headers and the distributor wrapper never parses non-2xx bodies. | closed | A1 |  |
| D20-17 | No server-side SSE reader; the bounded reader succeeds only on `done`. | closed | A1 |  |
| D20-18 | No MCP client exists: negotiation, discovery ingestion, schema validation, `$ref` policy, `x-mcp-header`. | closed | A2 |  |
| D20-19 | No OAuth 2.1 client machinery or credential store. | closed | A3 (the credential store deferred, OD-46) |  |
| D20-20 | Allowlist is host-level; the source-id union is closed; no canonical URI or pinned descriptor digest. | closed | A1, A2 |  |
| D20-21 | Quotas/breakers are per source and per process; no per-tool dimension. | closed | A0 |  |
| D20-22 | No normalizer from an MCP result into an observation record; results are text-only; no `resultType`/MRTR or no | closed | A4 |  |
| D20-23 | DNS rebinding window between admission check and connect. | recorded | D1 (OD-51) |  |
| D20-24 | Same-origin redirects re-send caller headers including `Authorization`. | closed | A1 |  |
| D20-25 | stdio transport prerequisites are absent. | deferred | OD-47 |  |
| D20-26 | No MCP feature flag. | closed | A0 |  |
| D20-27 | CI admission guard covers `/b19-/` only. | closed | A0 |  |
| D20-28 | No in-repo way to prove wire-level 405/202/Origin behaviour of `/api/mcp` on the real server, nor to reach a l | closed | D1 (loopback half), D3 (wire half) |  |
| D20-29 | Provider-native MCP connectors are not rendered and their live behaviour is unverifiable. | closed | A5 | BLOCKED-LIVE |
| D20-30 | Stale "no MCP" statements after B20-B lands. | closed | the closeout |  |
| D20-31 | No scope/step-up model; `authStrength` never enforced. | closed | A3 |  |
| D20-32 | Branch is a validated selector, never authorized. | recorded | - |  |
| D20-33 | Grant identity is structurally unreachable for a non-cookie principal. | closed | B1 |  |
| D20-34 | Cancellation does not reach sealed-proposal compilation, grant minting or the placement engine. | closed | B4 (placement half); the rest recorded |  |
| D20-35 | Three route matrices are regenerated by convention only. | closed | B2 |  |
| D20-36 | No environment-scoped, project-bound principal suitable for a stdio process. | deferred | OD-47 |  |

## Unknowns and blocked items named by the discovery

- **UNKNOWN** Whether Supabase Auth can act as an OAuth 2.1 AS with RFC 8707 resource indicators and RFC 9728 metadata, and whether a bearer-based `getUser` liveness check is possible with `@supabase/ssr` (the current liveness client is cookie-only, `identity-provider.ts:212-217`). Drives OD-43; BLOCKED-LIVE-QUALIFICATION under LB-1.
- **UNKNOWN** Whether Node's `fetch` (undici) permits setting an `Origin` request header from server code; the egress layer passes headers verbatim (`outbound-fetch.ts:172, :181`). Needed only if the client must present an Origin (the spec does not require it).
- **UNKNOWN** Whether Next.js answers 405 for unexported methods on `/api/mcp` under the fixture server; asserted only by a comment today (reader: `b19-e-external-search-route.test.ts:58`). Resolved by the B20-D3 Playwright `request` spec. — settled by D3 W1/W2/W3 on 2026-09-23 (re-measured 2026-09-24): Next 16.2.6 answers **GET 405, DELETE 405, OPTIONS 204** for the unexported methods on `/api/mcp` under the fixture server; a 200 is refused by the spec as the one answer that would mean the method is served. Endpoint page U2 closes with it; U1 closes with W7.
- **UNKNOWN** Whether any existing sealed schematic/PCB proposal path persists server-side (the read found none; D20-8 is INFERRED). Resolved when B20-B4 reads `pcb-edit-proposal-service.ts` and `schematic-proposals.ts` fully.
