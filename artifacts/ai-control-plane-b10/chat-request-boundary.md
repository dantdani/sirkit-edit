# B10 — chat request boundary

Route: `app/api/chat/route.ts`. Tests:
`app/api/chat/__tests__/b10-chat-boundary.test.ts` (production POST handler
with a controlled provider adapter — the loop, gateway, and context
assembly are real).

## Contract

- **Byte bound**: the ACTUAL request body (`req.arrayBuffer()`) is bounded
  at `MAX_CHAT_REQUEST_BYTES = 8_000_000` BEFORE JSON parsing (413) —
  never Content-Length alone.
- **Exact allowed top-level keys**: `provider, messages, scope,
  schematicState, schematicHeadMark, editorContext`. Anything else — actor,
  role, capability, authority, approval, durable-board, release, and
  idempotency claims included — refuses 400 with a bounded key echo. The
  obsolete `boardState` path refuses EXPLICITLY (it can never bypass the
  atomic contract).
- **editorContext envelope**: object with exact keys `{schema, scope,
  board, pcbRevisionId, selection, netlist, schematicDigest,
  authoritySource}`; `schema` must be `sirkit.editor-context.v1`; the
  embedded scope MUST equal the request scope (400); `authoritySource` may
  only be `local-working-copy` — any durable/server authority claim
  refuses 400.

## Server authority semantics

- The board is validated server-side by `validatePcbBoardStructure` inside
  `assembleAgentRunContext`; only a fully valid board yields
  `CanonicalProjectState`, and it is treated exclusively as a verified
  LOCAL WORKING-COPY snapshot (`availableAuthority:
  ["local-working-copy"]`) — never `durable-server-board`.
- The server RECOMPUTES the schematic digest, PCB semantic revision,
  canonical revision, and every resource digest. The client
  `pcbRevisionId` is a verifiable hint only; no client digest is ever
  authority.
- Board or scope validation failure withholds ALL canonical reads; an
  invalid optional selection/netlist withholds ONLY that resource while the
  canonical board remains live.
- Context warnings are bounded, redacted assembly warnings — invalid
  request bodies are never echoed.
- One ProjectAsyncScope, one immutable schematic snapshot, one immutable
  editor context, one head mark — all captured client-side for the SAME
  project/branch generation (the bridge's generation gate makes a
  cross-generation mix structurally impossible).
