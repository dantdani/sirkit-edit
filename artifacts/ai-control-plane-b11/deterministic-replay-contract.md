# B11 — deterministic replay contract

> **SUPERSEDED IN PART BY B11.2 AND B11.3.** The capsule schema is now
> `sirkit.agent-replay-capsule.v3` and its `context` is
> `sirkit.agent-replay-context.v2` — a versioned contract that is key-exact at
> EVERY depth of the PCB type graph, driven by a descriptor generated from
> `app/lib/pcb/types.ts` by the TypeScript compiler API. (B11.2 introduced
> capsule v2 / context v1, exact only at the `PcbBoard` top level; B11.3
> tightened it and bumped both.) See
> [../ai-control-plane-b11-2/replay-context-schema.md](../ai-control-plane-b11-2/replay-context-schema.md)
> and [../ai-control-plane-b11-3/generated-pcb-type-graph.md](../ai-control-plane-b11-3/generated-pcb-type-graph.md).

> **SUPERSESSION NOTE (B11.1).** The capsule contract below had NO validator: a capsule carrying `opaqueProviderContinuation`, `rawProviderBody`, `thinking`, or `authorization: "Bearer sk-…"` validated and executed. B11.1 adds `validateReplayCapsule` (exact recursive keys, hard bounds, forbidden names, whole-capsule secret denylist) which refuses BEFORE any execution. See artifacts/ai-control-plane-b11-1/replay-capsule-validation.md.

Module: `app/lib/agent/replay-capsule.ts`
(`sirkit.agent-replay-capsule.v1`).

## Capsule contents (sanitized fixture — never auto-persisted)

`caseId`, `provider`, `promptVersion`/`promptDigest`, `registryDigest`,
`scope`, sanitized `context` inputs (schematic, board, head mark,
selection, netlist, editor schematic digest), `userMessage`, bounded
normalized `steps` (text, tool calls, stop reason, model, usage, or a
normalized scripted provider `failure`), and the pinned `expected`
block (`discoveredTools`, `toolOutcomes`, `terminal`, `traceDigest`).

Capsule steps carry NO provider continuation state — the scripted adapter
supplies an inert `{provider, state: null}` by construction.

## What replay executes

The REAL `sirkitToolRegistry`, `assembleAgentRunContext` (context-integrity
boundary), `buildAgentResourceBundle`, `discoverTools`/`buildRunToolset`,
`createAgentToolGateway`, and `runAgentLoop`, driven by a scripted adapter
and an `AgentTraceRecorder`. There is no provider SDK import, no database,
and no network call anywhere in the replay path — a permanent test stubs
`globalThis.fetch` to throw and asserts it is never called.

## What replay verifies

1. Capsule schema/version.
2. Prompt version + prompt digest (prompt drift fails).
3. Registry digest (tool-registry drift fails).
4. Context assembly + resource manifest digest (stale/absent resources
   change the trace and fail the pins).
5. Expected discovered tools (exact set).
6. Normalized model steps (a short script fails with
   `REPLAY_SCRIPT_EXHAUSTED`).
7. Tool calls and outcomes (tool id, outcome class, status — in order).
8. Terminal outcome + failure reason.
9. Trace digest against the committed pin.

Altered tool arguments change `argsDigest` and therefore the trace digest;
foreign scope changes the scope and context digests; both fail explicitly.
Each of these eight drift shapes is a permanent regression test.

## Determinism sources

- A monotonic counter clock (`tick`) replaces wall time for the recorder
  AND for the gateway's proposal clock, so sealed proposal identity
  (`createdAt`/`expiresAt` → `proposalId`) is reproducible.
- Canonical JSON + `engineeringDigest` for every digest.
- No randomness: run/trace ids are derived from the case id.

Byte stability is proven by running the generator three times and diffing
all three generated documents.
