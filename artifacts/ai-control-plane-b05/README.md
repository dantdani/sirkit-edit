# B05 — Read-Only Tool Invocation, Component Authority, and Context Assembly

Activates ONLY safe, revision-pinned read/query/context operations behind a
real invocation layer. No mutation, proposal, release, provider, chat, MCP,
or agent execution was activated; agent discovery remains empty.

## Activated read bindings (8)

Generated inventory: `activated-read-bindings.csv`. Every binding is
allowlisted in code (`tool-bindings-readonly.ts`), matches its descriptor's
declared module+symbol exactly, and is pure over caller-supplied resources:

| Tool | Implementation |
|---|---|
| sirkit.project.canonical-revision-inspect | engineering/revision.ts#computeProjectRevision |
| sirkit.pcb.revision-inspect | pcb/revision.ts#pcbRevisionId |
| sirkit.pcb.board-inspect | pcb/ai/snapshot.ts#buildAIPcbSnapshot (timing normalized) |
| sirkit.selection.inspect | pcb/selection-queries.ts#getItems (compact projection + dropped refs) |
| sirkit.validation.drc-run | pcb/drc/run-drc.ts#runDrc (timing normalized, undefined-stripped) |
| sirkit.validation.connectivity-verify | pcb/connectivity-board.ts#computeConnectivity (Map → sorted JSON) |
| sirkit.component-authority.inspect | engineering/component-authority.ts#inspectComponentAuthority |
| sirkit.manufacturing.readiness-inspect | pcb/readiness/evaluate.ts#evaluatePcbFabricationReadiness (inspection only) |

## Audit outcomes — left inactive (callable metadata unchanged, truthfully noted)

- **sirkit.parts.search** — `searchPartsForAI` calls a provider-hosted
  embedding service and live database; activation requires a proven
  provider-free read path (catalog descriptor carries the audit note).
- **Placement / routing / repair-plan proposals** — proposal-class; belong
  to a later proposal-invocation stage. The B05 resolver rejects them.
- Catalog audit corrections: board-inspect now binds the pure snapshot
  builder (not the session-bound PCBToolService), connectivity binds
  `computeConnectivity`, and component authority binds the new pure
  inspector (PhysicalBindingService performs durable I/O).

## The invocation layer

`ReadToolInvocationService.invoke(request, context, resources)` — a 17-step
deny-by-default pipeline (see `invocation-security-policy.md`): fresh
discovery rerun + independent policy recheck, allowlisted binding
resolution, repository-owned input/output validation
(`tool-io-validation.ts`), deadline/cancellation, revision pinning verified
before AND after execution, redacted provider-neutral traces, and
model-free replay (`read-replay-fixtures.json`, digest-compared in CI).

## Contracts

- `component-authority-contract.md` — truthful authority states; candidates
  are never authority.
- `context-envelope-contract.md` — deterministic
  `sirkit.engineering-context.v1` envelope; unknown ≠ omitted.

## Verification

`npx vitest run app/lib/engineering/__tests__/b05-read-invocation.test.ts` —
34 tests over the required matrix. Full engineering suite (B01→B05):
169/169. Generated artifacts regenerate via
`npx tsx scripts/generate-read-invocation-artifacts.ts` (B05) and
`npx tsx scripts/generate-tool-registry-artifacts.ts` (B04, refreshed for the
audit notes) and are CI byte-matched.
