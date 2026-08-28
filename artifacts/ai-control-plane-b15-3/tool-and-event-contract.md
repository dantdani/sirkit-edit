# B15.3 §H — tool, gateway, loop, event

## The ONE exposed tool

`sirkit.pcb.propose-bounded-edit@1.0.0` — exposure changes exactly **11 → 12**.
`operationClass: "propose"`, `sideEffects: "proposal-artifact"`,
`binding: { status: "bound-proposal", module:
"app/lib/pcb/proposal/pcb-propose-tool-handler.ts", symbol:
"handlePcbProposeTool" }`, `requiredProjectState: ["board-present"]`,
`agentExposed: true`. `approvalTier` stays `"none"` (like both schematic
propose tools — SEALING needs no approval; the topology-or-geometry tier
lives on the sealed ARTIFACT and the `pcb.bounded-edit-apply` action).
`requiresLineage: false` (the discovery lineage anchor is the SCHEMATIC
session lineage by B09.3 digest-domain separation; the PCB proposal's own
lineage binding is the PCB canonical session lineage, enforced by its
`pcbProposalBasis` prerequisite and sealed into `base.lineageId`).

Input schema: strict closed `{ intent: string, operations: object[] }` with
`additionalProperties:false` at every level. The runtime authority is the
canonical `parseBoundedEditRequest` (closed per-kind key sets, ≤16 ops,
exact 32,768-byte ceiling, excluded destructive intents) — wire bounds live
server-side because strict provider modes reject minItems/maxItems/maxLength.

No other PCB mutation/apply/destructive/approval tool is exposed (a K-suite
test asserts every exposed tool is `read` or `propose`).

## The handler — provider arguments are ONLY intent + operations

`handlePcbProposeTool` (pcb-propose-tool-handler.ts) refuses any key outside
`{intent, operations}` BY NAME (`invalid_input`), then derives EVERY
authority-bearing field from the verified run context:

- `board` = `context.canonicalState.pcb` (the structurally validated
  canonical board — never provider data);
- `scope` = run identity + `pcbBoardInstanceId(context.projectId)` (the ONE
  shared board-instance authority);
- `base.canonicalResource` = the run's SEALED canonical-state envelope
  `{resourceId, contentDigest}` (from `buildAgentResourceBundle`, sealed
  fresh per invocation in the gateway);
- `base.historyHead`/`base.lineageId` = the shape-validated
  `context.pcbProposalBasis` the editor bridge captured atomically with the
  board;
- `validationPolicy` = the registry-resolved policy for the basis's active
  DRC preset;
- `actor` = `agent:<provider>` (kind ai); `effectiveActor` =
  `context.actor.actorId` (kind human); `nonce` = a platform-random value.

It calls `createSealedPcbEditProposal` ONLY — never the raw sealer.
Sealing compiles against an isolated `structuredClone` candidate and mutates
NOTHING.

## Gateway + loop

`gateway.ts` — `AGENT_PCB_PROPOSAL_TOOL_ID` is the THIRD allowlisted propose
binding; `ProposalInvocationService.invoke` diverges to `invokePcbEdit`
BEFORE the schematic-only snapshot/head-mark requirements (its basis is the
verified BOARD, not a schematic mark). `invokePcbEdit` refuses when the
canonical board or the canonical resource envelope is unavailable. The
gateway maps a PCB seal to the DISTINCT `kind: "pcb-proposal"` outcome so
the schematic proposal path can never receive one.

`loop.ts` — `buildRunToolset` withholds the PCB tool unless
`context.canonicalState.pcb && context.pcbProposalBasis` are both present
(fail closed, truthful warning). The `pcb-proposal` outcome branch records
bounded identity/digests only, emits `tool_finished(proposal_sealed)` then
**exactly one** `pcb_proposal_ready`, and returns a provider result that
says nothing changed and forbids calling it safe or manufacturing-ready.
The single-flight `proposalIssued` guard covers any propose tool, so a
second propose call in one run refuses.

## The DISTINCT event

`AgentRunEvent` gained `pcb_proposal_ready` — never overloaded onto the
schematic `proposal_ready`. `contracts.ts` documents `SealedAgentProposal`
(the schematic union) as deliberately NOT including the PCB proposal;
`AgentProposalArtifact` is the full union. The safe consumer
`receivePcbProposalReadyEvent` (pcb-proposal-events.ts) requires the exact
event type AND a sealed proposal that passes full structural verification —
a fabricated or malformed event yields null and grants nothing. Emitted at
most once per run; settles correctly on timeout/abort (the K-suite proves
zero events + zero mutation on abort).

## Action registry + generated matrices

Two proposal-only semantic actions added: `pcb.bounded-edit-propose` (kind
`propose`, mutationAuthority NONE) and `pcb.bounded-edit-apply` (kind
`mutate`, the human-gated canonical apply). All four generated matrices
(b01 toolability/route/fingerprint, b04 registry/parity, b09 agent
manifest, b11 replay pins) regenerated and proven byte-stable across two
runs.
