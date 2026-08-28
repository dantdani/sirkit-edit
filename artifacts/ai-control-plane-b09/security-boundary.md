# B09 — Security Boundary

## Identity and authority

- `createLocalOnlyActor()` (context.ts) is the ONLY actor source for agent
  runs: application-owned `local-user` / `project_admin` /
  `["read_project"]`, documented as the unauthenticated-local-build
  limitation. Request bodies and model output can never supply actor id,
  role, capabilities, tenant/project/branch, authority source, expected
  revision, lineage, approval, or idempotency authority.
- Tool arguments are strict-schema validated twice (provider strict mode +
  post-normalization revalidation in the read service / proposal parser);
  unknown fields (e.g. `actorRole`) refuse with `invalid_input`
  (loop-safety test 17).

## Default-deny activation

- Discovery channel `assistant-agent` + `agentExposed` + active + callable
  + allowlisted binding + strict-compatible schema + assemblable resources
  + risk ceiling `propose`. Everything else: excluded, with the exact
  reason in `tool-activation-audit.csv`.
- The B04 registry validator still refuses `agentExposed` on any
  mutation-capable class; the b04 tripwire pins the EXACT exposed set and
  requires an activated binding per exposed descriptor.
- Explicitly not exposed (recorded blockers): parts.search (provider-hosted
  embedding), selection/component-authority (B10 context bridge),
  placement/routing/repair proposals (no sealed revision-pinned artifact
  path), every mutation/destructive/release/undo/view-session tool,
  Gerber/KiCad export, 3D/session control.

## Execution boundaries

- Reads: the unmodified B05/B05.1 `ReadToolInvocationService` — fresh
  discovery per invocation, full envelope/bundle verification before AND
  after execution, deadline + cancellation, redacted traces.
- Proposals: `ProposalInvocationService` — pure compile+seal; zero
  mutation; digest-pinned to the exact verified schematic snapshot;
  TTL'd; enters ONLY the existing Apply-exact-proposal review boundary
  (page.tsx → verifySealedTier1Proposal → trusted SchematicEditorSession →
  canonical executor). Stale/altered/expired/foreign artifacts cannot
  apply (proposal tests 27–33).
- No chat/provider module imports CanonicalEditorSession or crosses the
  SchematicEditorSession trusted composition boundary; no API route calls
  another API route as a tool; no LLM-backed route is exposed as a
  deterministic tool.

## Data hygiene

- Tool output returns to providers as bounded (≤60k chars), redacted JSON
  with explicit ok/status — data, never instructions (the system prompt
  states this; the loop never interprets tool output).
- Events carry safe titles/statuses only; provider continuation state
  (reasoning items, raw blocks) is opaque and transient in the adapter;
  chat persistence stores user/assistant text only — no raw tool payloads,
  no secrets, no stacks (loop-safety test 26).
