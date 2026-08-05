# Stage reports and implementation prompts

Historical per-stage implementation reports, discovery notes, prerequisite
gates, and audits, moved out of the repository root for readability:

- `SIRKIT_CD_01…13_*` — CD workbench stages (requirements → full-flow orchestrator)
- `SIRKIT_STAGE_01…10_*` — PCB editor stages (data integrity → collaboration/persistence)
- `SIRKIT_FOOTPRINT_BINDING_*`, `SIRKIT_ASSIGNMENT_QUEUE_*`, `SIRKIT_MAPPING_*`,
  `SIRKIT_PASSIVE_POLICY_*`, `SIRKIT_PCB_SYNC_*`, `SIRKIT_DEPENDENCY_*`,
  `SIRKIT_FOOTPRINT_RESOLVER_*` — footprint/binding remediation track
- `SIRKIT_PCB_PLACEMENT_ROUTING_AUDIT.md`, `WORKTREE_DIFF_DIAGNOSIS_AND_AGENT_HANDOFF.md` — audits/handoffs

AI-control-plane stage records (B01–B05) live in `../../artifacts/ai-control-plane-*/`.
Repository status and schema notes: `../STATUS.md`, `../SCHEMA.md`.
