# B08 — PCB Tool Boundary (intentionally closed)

B08 adds NO agent/chat/provider/API/MCP mutation execution:

- `invokeTool` (B05 read-only invocation layer) continues to reject every
  mutation; the tool catalog still exposes 0 agent-executable mutations
  (B04 gates re-verified, artifacts regenerated).
- New/updated mutation commands (pcb.route-copper, pcb.auto-place,
  pcb.autoroute-import, pcb.autonomous-layout, pcb.protection,
  pcb.padstack, pcb.placement-settings, pcb.dimension, pcb.zone,
  pcb.silkscreen-text, pcb.rules, pcb.board-geometry, pcb.assist-edit,
  pcb.board-repair) are editor-session-bound: they execute only through
  `CanonicalEditorSession.commit` / the PCB commit gateway composed with
  the private trusted interactive channel.
- Destructive tiers (pcb.delete-item, pcb.route-copper, pcb.assist-edit)
  keep B03.1 semantics: the trusted channel approves human+ui requests
  only; ai/api/worker callers need an independent approve_proposal
  (b08 §7 T19).
- AI actors remain categorically refused manage_protection /
  edit_stackup_outline / edit_components regardless of role or channel
  (b08 §7 T20).
- Manufacturing release stays categorically refused by the executor
  (release_tier_blocked); MFG01 keeps release authority.
- The interactive editor session actor is the LOCAL HUMAN OWNER
  (project_admin) — set inside the same composition that holds the
  channel; caller-supplied actor/provenance fields still can never
  manufacture authority on channel-less executors.
- `pcb.autonomous-layout` requires an injected autonomous router; the UI
  repair composition supplies none, so the AI repair dispatcher cannot
  reach board mutation through it.
