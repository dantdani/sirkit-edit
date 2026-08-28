# B10 — component-authority disposition

**Disposition: `sirkit.component-authority.inspect` remains
`agentExposed: false`.**

## Audit

- The pure inspector (`app/lib/engineering/component-authority.ts`,
  `inspectComponentAuthority`) and its activated binding
  (`read.component-authority` in
  `app/lib/engineering/tool-bindings-readonly.ts`, requiredResources
  `["canonical-state", "component-authority-records"]`) are real and
  B05.1-tested — against FIXTURE records.
- The `component-authority-records` resource requires DURABLE physical-
  binding aggregates with immutable revisions (authorityRecordId,
  authorityRevision, footprintBindingRevision, mappingVerificationRevision,
  approvalRevision, evidence refs). The production owners of that data are
  the project-DB-scoped physical-binding repository and its routes — there
  is NO server-owned adapter in the chat run context that can load the
  exact current project/branch binding aggregates and validate their
  immutable revisions without accepting browser-supplied authority.
- The B10 browser editor context supplies a WORKING-COPY board, selection,
  and netlist. Netlist fields that merely LOOK authoritative
  (`atomicAssignment`, `atomicPartRevisionId`, footprint hints), catalog
  candidates, and model output are browser-side claims — upgrading any of
  them into component authority would mint authority from an untrusted
  channel.

## Blocker (exact)

No proven server-owned producer exists for per-run
`component-authority-records`: the binding repository is project-DB scoped
and browser-independent, and nothing in the chat request may be trusted to
supply or select those records.

## Evidence paths

- `app/lib/engineering/component-authority.ts`
- `app/lib/engineering/tool-bindings-readonly.ts` (read.component-authority)
- `app/lib/agent/context.ts` (`buildAgentResourceBundle` — seals no
  component-authority-records envelope)
- `artifacts/ai-control-plane-b09/agent-exposed-tool-manifest.csv`
  (EXCLUDED row with this blocker)

Enforced by tests: the runtime availability matrix proves
`component-authority.inspect` absent even from the FULL context case, and
resource-aware discovery can never advertise it while its required resource
is unsupplied.
