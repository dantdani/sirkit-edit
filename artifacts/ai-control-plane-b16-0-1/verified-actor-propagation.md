# B16.0.1 §D — verified actor propagation into the agent runtime

## The change (R3 closure)

`createLocalOnlyActor()` is no longer the production agent identity. The chat
route projects the server-derived trusted context into a `VerifiedRunPrincipal`
(`{principalId, actorRole, membershipRevision, authMethod}`) and passes it to
BOTH `assembleAgentRunContext` calls (initial + component-authority
reassembly). `buildRunActor` binds the run actor:

- `actorId` = the verified principal id (Supabase user id / the fixed
  local-dev principal / a worker principal);
- `actorRole` = the SERVER-derived membership role (a viewer runs as a
  viewer — the propose surface gates on the real role);
- `membershipRevision` = the revision the role was resolved at (→ §E seals);
- `authClass` = the auth method (`supabase_cookie`/`local_dev`/`worker_secret`);
- `source` = `verified-session` / `verified-worker` / `local-only` (the honest
  label for the local_dev build);
- `grantedCapabilities` stays `["read_project"]` — the agent run keeps its
  read + PROPOSE ceiling; no mutation capability is ever granted here.

Local development obtains its actor through the SAME `TrustedRequestContext`
path (the chat route always supplies `verifiedActor`); the bare
`createLocalOnlyActor()` fallback remains only for direct non-route callers
(tests) and is impossible to reach in production because the local-dev mode
itself is impossible there (§G).

## Chat route enforcement order

bounded read → exact body keys (authority-shaped keys refuse BY NAME) →
editor-context validation → trusted context with `enforceSameOrigin: true` →
exact chat policy role check (`authorizeActor`) → assembly with
`verifiedActor` → provider loop. A viewer or cross-origin caller is refused
BEFORE any provider budget is spent.

## Sealed-proposal consequences

- `AgentRunContext.actor.actorId` === the verified principal (test-pinned).
- `effectiveActor.actorId` in every sealed proposal === the verified principal
  (the PCB handler and the schematic gateway derive it from `context.actor`).
- The §E authorization binding derives `principalId` from the same actor and
  the `membershipRevision` from `context.actor.membershipRevision` — the
  provider can neither supply nor alter any of it (closed argument surfaces
  refuse unknown keys by name).

## Trace/replay hygiene

The actor fields added are bounded non-secret identifiers (a principal id, a
`mbr1-…` revision digest, an enum). No cookie, JWT, email, token, or raw
session value enters prompts, traces, or replay artifacts — the trace recorder
still receives only context digests, and `sessionIdentity` remains an opaque
server-side label. The B11 trace/replay suites pass unmodified semantics.

## Proof

`app/lib/agent/__tests__/b16-0-1-verified-actor.test.ts` (binding, viewer
gating, worker/local_dev sources, discovery-context agreement, read-only
capability), `app/api/chat/__tests__/b16-0-1-chat-authorization.test.ts`
(role + CSRF before provider), plus the unchanged B09–B11 context/gateway/
trace suites.
