# B20 - final verdict (2026-09-24)

**Verdict: PARTIAL.** Sirkit consumes explicitly approved external MCP servers read-only and exposes a bounded, read-only
subset of its own registry over MCP, with no authority bypass found by the adversarial chapter. One B20-B deliverable is
DEFERRED by owner decision rather than built: inert proposal creation over MCP.

Labels as in `README.md`: **CONFIRMED** (executed and measured), **INFERRED**, **PROPOSED**, **RECORDED**, **UNKNOWN**,
**BLOCKED-LIVE-QUALIFICATION**.

## What B20 delivers (CONFIRMED by suites on the tree; live behaviour BLOCKED-LIVE-QUALIFICATION where stated)

1. **B20-A, Sirkit consumes external MCP (read-only).** A reviewed server registry (1.2.0) behind a flag that is OFF, with
   an empty registry committed: nothing is exposed today. A server row is admitted only with a canonical HTTPS URI, an
   operator-pinned descriptor digest, per-server and per-tool quotas, an explicit agent disclosure, and - since A4L - a
   fail-closed per-tool `agentTools` allowlist. The transport (A1) bounds every body and stream, refuses redirects and
   private addresses, and never re-sends a credential. Discovery (A2) accepts a foreign tool only inside the proven wire
   schema subset, with every judged string read by one directive matcher recorded as defense-in-depth (OD-81), and pins
   the listing digest against the registry. Authorization (A3) does client credentials with RFC 9728 discovery, a pinned
   issuer, RFC 8707 `resource`, an in-process cache, one refresh and one bounded step-up, redacting every token a call
   held. Results (A4) reach a model only as bounded, quarantined `sirkit.mcp-observation.v1` records through ONE agent read
   tool injected by the chat route through one runtime file, attributed in the trace by identity, never by content.
   Provider-native connectors are refused as policy (A5, OD-90): they would bypass every one of those controls, and no
   MCP credential ever reaches a provider request (OD-45).
2. **B20-B, Sirkit exposes an MCP server.** `POST /api/mcp` (2026-07-28, JSON only) behind a Sirkit-issued bearer bound to
   the live membership; nine reads served from the project's durable server board (never an editor's unsaved state), each
   call binding the principal, tenant/project/branch, membership revision and role, registry digest, expected revision
   and an idempotency key, with a closed trace record per call and admission slots that follow their durable queries.
   Selection and view-session controls are deferred (OD-49) and stdio is deferred (OD-47), both by the discovery
   defaults. **Inert proposal creation is DEFERRED (OD-50, OD-82, OD-87):** four proposals need browser-only state or a
   child process, and the placement engine blocks the event loop 44-104 s per run and cannot be stopped inside a
   candidate spec (measured); the reversal waits on B22-B's bounded engine host. MCP exposure in B20 is read-only.
3. **B20-C.** Three-way parity of every exposed tool across OpenAI, Anthropic and MCP, byte-gated; output schemas
   declared only when provably evaluable and a non-conforming `structuredContent` refused rather than sent; paged
   tools/list with bounded cursors and caching fields; a first-party descriptor text gate that judges ids, titles,
   descriptions and schema strings, re-applied by the renderer.
4. **B20-D.** One hostile external server driven through the whole client chain (25 attacks plus the DNS rebinding
   window, closed as recorded under OD-51), asserted on the agent's refusal code, its fixed sentence, the observation
   record, the attribution and a leak sweep; every registry descriptor (42) under every mapped role (5) through the real
   endpoint - 210 requests, 167 identical refusals with every spy 0 and 43 served reads - plus name spellings, nested
   spellings, tampered and replayed tokens and a thousand hostile argument spellings never echoed; the asymmetric
   authority import gate (approval controllers on both halves, grants, reauthorization and fabrication on the derived
   client half, every family by prefix); and the wire-level spec on the fixture server (GET 405, DELETE 405, OPTIONS 204,
   Origin 403, the RFC 9728 challenge, 202, -32020/-32022, the hidden release tool's identical -32602, no token, secret,
   stack frame or file path in any answer). Five vitest suites (61 cases) and one Playwright spec (11); reviewed under
   four lenses (40 confirmed findings, each fixed test-first against a hash-verified production mutation); no production
   code changed. Recorded limits: the window inside one admission->connect pair (OD-42's pinned dispatcher) and the
   live contract against an approved external server (none approved; OD-102).

**Totals on the tree:** 67 B20 suites, 994 cases (`test-and-validation-report.md`); 232 files changed since `main` before this closeout commit
(`changed-files.md`); OD-41..OD-105 recorded or reserved (`unknowns-and-owner-decisions.md`). The 165-route ratchet is
unchanged at 162 canonical + 3 factories + 0 raw; every generator re-run with zero drift.

## What B20 does not deliver, stated plainly

- Inert proposals over MCP (above). B20-B is therefore partial against the runbook's list.
- Selection / view-session controls over MCP (OD-49) and stdio transport (OD-47): deferred by default, not built.
- Live qualification of every external behaviour: real MCP servers, the provider connectors, Supabase production auth
  and the provider models stay BLOCKED-LIVE-QUALIFICATION. The database migration mechanism, by contrast, WAS qualified
  on a real PostgreSQL 17.6 server on 2026-09-24 (LB-4).
- The handshake-era (2025-11-25) client path (A2b) is not built; the SDK and both provider connectors speak that era, so
  today neither connector can call Sirkit's own server (OD-41, OD-70).
- The 2026-07-28 `authorization_servers` MUST of RFC 9728 is a recorded deviation (OD-43): the served metadata carries
  none until an authorization server exists, and D3's W7 pins the document as served.

## Follow-ups raised to the owner during the chapter

- The anonymous `/api/pcb/placement/preview` route can block the event loop for about two minutes per request
  (measured 124.9 s); queued as its own fix outside B20. [B24-closeout, 2026-10-10] superseded: B24-A3's record, artifacts/ai-control-plane-b24/abuse-controls.md:334.
- The DB-gated suites share fixed fixture ids and one fixed idempotency key, so they collide across workers and re-runs;
  queued as its own fix.
- OpenAI reports no credits for the organisation behind both configured keys, so nothing that embeds or calls a model
  live could be qualified.
- Every A-suite case addition is a D page edit (`mcp-adversarial.md` section D1.6), by design (OD-103).
- Whether a peer-invented, non-secret-shaped value in a text block should be withheld (D1 case 6a records the current
  behaviour: it is served as text).

## Report lines

```
MCP-EXPOSED TOOLS: 9 (reads only; every proposal withheld, OD-82 / OD-87)
MCP STATUS: client behind SIRKIT_MCP_ENABLED (off) with an empty registry; server read-only over POST /api/mcp; connectors refused; proposals deferred
```
