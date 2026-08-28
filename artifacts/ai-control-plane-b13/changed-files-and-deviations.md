# B13 — changed files and deviations

## Production

| File | Change |
| --- | --- |
| `app/lib/engineering/component-authority-source.ts` | NEW — the server-owned loader: `loadComponentAuthorityRecords`, `loadRunComponentAuthority` (deadline/abort/fail-closed), narrow injectable `AuthorityBindingSource` + `AtomicRevisionConfirmer`, projection + exact-authority resolution |
| `app/lib/engineering/component-authority.ts` | ADD server-owned `ComponentExactAuthority` + `ComponentAuthorityRecord.exactAuthority`. Inspector/summary UNCHANGED (B05 pins stable) |
| `app/lib/engineering/schematic-authority.internal.ts` | `consumeReplacementAuthority` requires + derives/exact-compares the server-owned exact authority for every asset field; new `asset_mismatch` code |
| `app/lib/engineering/tool-catalog.ts` | `sirkit.component-authority.inspect` → `agentExposed: true` (per-run availability gated on the resource) |
| `app/lib/agent/contracts.ts` | `AgentRunContext` gains `componentAuthority` + `componentAuthorityDigest` |
| `app/lib/agent/context.ts` | server-owned `componentAuthority` input; structural validation + digest; `durable-server-board` in availableAuthority when present; seals the `component-authority-records` envelope (durable-server-board, revision-pinned) |
| `app/lib/agent/gateway.ts` | `verifyAgentContextIntegrity` recomputes the authority digest + refuses dangling/mismatched claims |
| `app/lib/agent/loop.ts` | `availableResourceKinds` includes `component-authority-records` when present |
| `app/api/chat/route.ts` | loads server-owned authority after scope validation (deadline/abort/fail-closed), re-assembles the run context with it; never reads authority from the body |
| `app/api/chat/component-authority-runtime.ts` | NEW — `resolveComponentAuthoritySource` (null in local-only; injectable) + `setComponentAuthoritySourceFactory` |

## Fixtures / artifacts regenerated (justified)

- `app/lib/engineering/schematic-replay-evidence.ts` — the B06.1 fixture
  record carries server-owned `exactAuthority` (the fixture consumed
  `cert-new`/`sel-new` that existed nowhere pre-B13).
- Regenerated: B06/B06.1 (`generate-b06-schematic-artifacts.ts`),
  B04 registry + provider parity (`generate-tool-registry-artifacts.ts`),
  B05/B05.1 read fixtures (`generate-read-invocation-artifacts.ts`),
  B09 agent manifest (`generate-agent-artifacts.ts`), B11 replay pins +
  evaluation (`generate-b11-artifacts.ts`). All byte-stable ×2.

## Tests

- NEW `b13-component-authority-bridge.test.ts` (24).
- Updated `b06-1-proposal-authority-durability.test.ts` (fixture record
  gains exact authority; one refusal code `wrong_revision → asset_mismatch`
  — strictly more precise).
- Updated `b04-tool-registry.test.ts` exposure tripwire (nine → ten, adds
  `sirkit.component-authority.inspect`).
- Exposure-count assertions nine → ten across B09/B10/B11/B12 (13 files) —
  a strictly truthful count change; the no-mutation/no-release/no-apply
  invariants are unchanged and still asserted.

## Deviations

- **Static exposure moved nine → ten.** The stage's SCOPE PROTECTION
  ("do not change tool exposure") is read as "do not alter the existing
  nine / add mutation-release exposure"; the OBJECTIVE explicitly requires
  the component-authority READ tool to "become callable." The count change
  is the sanctioned consequence, and the security invariant (no
  mutation/release exposure) holds.
- **B11 replay pins moved** (`ab36b0c9… → 03e043f4…`) — the unavoidable,
  explicitly-justified consequence of exposing the tenth tool; PCB hashes
  unchanged.
- **Replay-context key not added.** No committed eval capsule carries
  authority (local-only loads none), so `REPLAY_CONTEXT_KEYS` was left
  unchanged to avoid churning the b11 capsule schema; authority changes are
  already detected via the manifest digest in trace context digests. An
  authority-bearing eval capsule is a PROPOSED follow-up.
- **Local-only source resolves to null.** No authenticated durable source
  exists in this build, so the production integration is real but inert
  until a source is wired; the loader + boundary are fully tested with
  in-memory sources. This is the honest state of the local-only app, not a
  harness-only fix (the tests exercise the same production functions the
  route calls).
