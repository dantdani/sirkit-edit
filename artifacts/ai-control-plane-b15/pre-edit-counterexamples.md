# B15 — pre-edit counterexamples (recorded before any production change)

Probe: a DISPOSABLE vitest file (`b15-probe.test.ts`, deleted after
capture) run against the UNMODIFIED B14.5 tree. All seven mandatory
reproductions confirmed; exact outputs below.

## C1 — the exposed registry contains exactly 11 tools

```json
{"exposedCount": 11, "ids": [
 "sirkit.component-authority.inspect",
 "sirkit.manufacturing.readiness-inspect",
 "sirkit.pcb.board-inspect",
 "sirkit.pcb.revision-inspect",
 "sirkit.project.canonical-revision-inspect",
 "sirkit.schematic.inspect",
 "sirkit.schematic.propose-component-replacement",
 "sirkit.schematic.propose-tier1-edit",
 "sirkit.selection.inspect",
 "sirkit.validation.connectivity-verify",
 "sirkit.validation.drc-run"]}
```

## C2 — no agent-exposed PCB edit proposal tool exists

```json
{"pcbExposedIds":["sirkit.pcb.board-inspect","sirkit.pcb.revision-inspect"],
 "proposeExposedIds":["sirkit.schematic.propose-component-replacement","sirkit.schematic.propose-tier1-edit"],
 "hasPcbProposeTool":false}
```

Both exposed PCB tools are READ tools; both exposed propose tools are
SCHEMATIC. There is no PCB propose tool of any kind.

## C3 — existing PCB mutate/destructive descriptors are not provider-discoverable

```json
{"mutatingDescriptorCount":10,"exposedMutatingCount":0,
 "leakedIntoProviderSchemas":[],"providerRenderedToolCount":11}
```

Ten mutate/destructive descriptors exist in the registry; ZERO are
agent-exposed, and none appears in the OpenAI/Anthropic schemas rendered
for the exposed set.

## C4 — PCB editor actions execute through UI-owned handlers, not the agent gateway

```json
{"pcbActionCount":30,"toolExposures":["none","preview-apply","repair-agent","structured-route"],
 "actionsHandledByAgentGateway":[]}
```

All 30 registered PCB actions are handled by UI-owned handlers routed to
canonical operations; none names the agent gateway/loop/provider as its
handler.

## C5 — a provider cannot currently create an actionable PCB proposal

```json
{"proposalSchemasRecognizedByLoop":["sirkit.schematic-replacement-proposal.v1"],
 "loopMentionsPcbProposal":false,"contractsHavePcbProposalEvent":false}
```

The agent loop recognizes exactly one sealed-proposal schema (schematic
replacement); no `pcb_proposal_ready` event exists in the contracts.

## C6 — a provider cannot directly call `commitPcbCandidate`

AST importer census (B14.5 gate) of the real production tree:

```json
{"allImporters":["app/components/pcb/PcbEditor.tsx","app/components/pcb/ZoneTool.tsx",
 "app/components/pcb/hooks/useAutoPlace.ts","app/components/pcb/hooks/useAutoroute.ts",
 "app/components/pcb/hooks/useDimensionTool.ts","app/components/pcb/hooks/useNetClass.ts",
 "app/components/pcb/hooks/useRouteTool.ts","app/components/pcb/hooks/useSilkTool.ts",
 "app/components/pcb/inspectors/DimensionInspector.tsx","app/lib/pcb/ai/pcb-tool-service.ts",
 "app/lib/pcb/repair/transaction.ts"],
 "agentOrApiImporters":[]}
```

Every importer is UI-owned (PCB editor components/hooks) or a UI-invoked
PCB service. NOTHING under `app/lib/agent/**` or `app/api/**` imports the
commit gateway — the provider path has no route to it.

## C7 — PCB history still owns undo/redo for canonical board commits

```json
{"commitOk":true,"status":"executed","historyEntries":1,
 "widthBefore":200000,"afterCommit":250000,"afterUndo":200000,"afterRedo":250000}
```

One `commitPcbCandidate` call through a bound canonical session produced
exactly ONE `PcbHistory` entry, and undo/redo restored the exact
before/after values.

## Baseline consequences for B15

- The exposure count must move 11 → **12**, and only by the new
  `sirkit.pcb.propose-bounded-edit` descriptor.
- The loop must gain a SECOND recognized proposal schema and a distinct
  `pcb_proposal_ready` event, without generalizing tool dispatch.
- The commit path must remain `commitPcbCandidate` reached only from
  trusted UI composition — the C6 census is the permanent gate B15 must
  keep true (the new apply controller becomes an approved importer;
  agent/API paths must stay absent).
