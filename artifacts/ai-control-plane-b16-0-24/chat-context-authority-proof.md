# B16.0.24 §E — chat context authority proof

`POST /api/chat` → `agentStreamRoute({ maxBytes: 8_000_000, defaultScope:
local/local/local })`. The wrapper owns the boundary; the callback keeps every
B09–B15 control-plane contract.

- **Identity/membership/role/scope resolved before provider work**: the
  wrapper resolves the trusted context from the body scope and applies the role
  gate before the callback; the provider loop is unreachable without them.
  (The scope is unavoidably in the body — the client sends no headers — so the
  bounded body is read to obtain the selector; this is the byte-pinned
  `body-scope-server-actor` contract.) **CONFIRMED**.
- **Exact 8,000,000-byte ceiling + streaming bound**: `readBoundedStream` in
  the wrapper stops at the ceiling (never buffering a hostile body); 413
  "board-capable limit" pinned; the standing 12 MB hostile-cancel pins
  (`pulled ≤ 10`, no unhandled rejection) pass unchanged. **CONFIRMED**.
- **Exact body + nested-object schemas**: the callback's exact-key contract
  (`ALLOWED_BODY_KEYS`), per-message `{role,content}` shape, exact scope
  `{tenantId,projectId,branchId}` strings, and the full editorContext contract
  all remain and fail closed. **CONFIRMED** (standing b10/b10-1/b10-2 pass).
- **Authority-shaped fields fail closed**: `AUTHORITY_CLAIM_KEYS` refuses
  `actor/role/capability/authority/approval/release/durable-board/idempotency`
  by name wherever nested; pinned top-level and scope-level. **CONFIRMED**.
- **Client board/netlist/component authority cannot become verified
  authority**: `editorContext.authoritySource` may ONLY be
  `local-working-copy`; the server recomputes the PCB revision over the
  validated board and fails closed on mismatch; component/replacement authority
  is loaded SERVER-SIDE from the durable source bound to THIS run's canonical
  revision and the shared board identity (never a body field). Standing
  b13-2 asserts the exact server-derived board scope. **CONFIRMED**.
- **Prompt/version/context/schemas/tool-choice/budgets/iteration ceilings
  unchanged**: the callback threads the same `AGENT_SYSTEM_PROMPT`,
  `AGENT_SYSTEM_PROMPT_VERSION`, `DEFAULT_AGENT_BUDGET`, and `runAgentLoop` —
  the migration relocated the boundary only. **CONFIRMED**.
- **Provider choice bounded; no silent cross-provider fallback**:
  `requestedProvider` clamps to a supported provider; a provider switch is a
  new run with a new run id (unchanged). **CONFIRMED**.
