# B24-F - MCP security report

Labels: **CONFIRMED** (read at the cited file:line at `58c0834`, or executed and measured), **INFERRED** (a reading, nothing executed),
**RECORDED** (taken from a record without a claim of our own), **UNKNOWN**, **BLOCKED-LIVE-QUALIFICATION** (needs a live resource the
owner has not supplied; never faked, never claimed). Base: `58c0834`. Written from B20's adversarial chapter
(`artifacts/ai-control-plane-b20/mcp-adversarial.md`), the reviewed exposure list and E's matrix rows Q12 and Q14.

## 1. Sirkit's MCP server: nine reads, proposals withheld (Q14; **CONFIRMED**)

- `POST /api/mcp` serves exactly the nine reads of `INTENTIONAL_MCP_EXPOSED_TOOL_IDS`
  (`app/lib/engineering/mcp-exposure-review.ts:14`), pinned as `mcpExposed` 9 at
  `app/lib/mcp/server/__tests__/b20-c1-three-way-parity.test.ts:241` (48 / 37 / 9 / 28). Every proposal is withheld (OD-82, OD-87), and
  B24-D2's paged board read is withheld by choice (OD-235): eight withheld tools. A bearer token is re-checked against the live
  membership on every call; the endpoint is canonical (`mcpBearerJsonRoute`).
- `e2e/mcp-endpoint.spec.ts` runs the endpoint in page-browser-e2e under the fixture runtime; Q14 is NOT APPLICABLE with that CI
  evidence, the one passing MCP row.

## 2. B20's adversarial chapter, as recorded (**RECORDED**, re-read at `58c0834`)

- **D1, the malicious external server** (the client half; `artifacts/ai-control-plane-b20/mcp-adversarial.md:73`): every attack of a
  hostile server answered by a composed bound, the leak sweep, and the suites that prove each on fake servers.
- **D20-23, the DNS rebinding window, closed as recorded under OD-51** (`artifacts/ai-control-plane-b20/mcp-adversarial.md:164`): the
  rebinding test proves refusal when the resolver flips between admission calls and documents the residual window; OD-51 is a
  discovery-only number (`artifacts/ai-control-plane-b20/unknowns-and-owner-decisions.md:17`) and no new decision was spent on it.
- **D2, hidden release tools and cross-project access** (the server half; `artifacts/ai-control-plane-b20/mcp-adversarial.md:226`).
- **D2.5, the recorded limit the sweep does not close, open** (`artifacts/ai-control-plane-b20/mcp-adversarial.md:345`): the wrapper's
  refusals before the dispatch runs are not traced; the endpoint limiter of 120 requests per 60 seconds per tenant, project and subject
  compensates, and is never phrased as a security property.
- **D3, the authority import gate and the wire-level endpoint spec** (`artifacts/ai-control-plane-b20/mcp-adversarial.md:381`).

## 3. Sirkit's MCP client: external servers (Q12; BLOCKED-LIVE-QUALIFICATION, LB-16)

The approved-server registry is empty (`MCP_SERVER_REGISTRY`, `app/lib/mcp/server-registry.ts:134`; OD-48), so no external MCP server
can be admitted; the client suites run on fake servers only (`b20-a2-tool-discovery`, `b20-d1-malicious-server`, in
agent-boundary-suites). A live approved external server is BLOCKED-LIVE-QUALIFICATION (LB-16; OD-48, OD-102).

## 4. MCP readiness

IN PART: Q14 passes (the nine-read server, offline and in the fixture browser); Q12 is BLOCKED-LIVE-QUALIFICATION (LB-16). Proposals over
MCP stay withheld (OD-82, OD-87). `final-verdict.md` section 1 states the scope from E's matrix.

## 5. What stays open (INFERRED)

- D2.5 above; and B20's own recorded limits (`artifacts/ai-control-plane-b20/mcp-adversarial.md:150`).
- Provider-native MCP connectors are refused as policy (D20-29) and their live behaviour is unverifiable without an owner resource.
