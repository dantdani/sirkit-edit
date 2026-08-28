# B16.0.24 §E — chat tool & permission proof

- **Tool discovery remains exactly registry-derived**: the callback calls
  `sirkitToolRegistry()` and discovers the exposed toolset from it; no tool is
  hand-added. Gate: chat contains `sirkitToolRegistry()`. **CONFIRMED**.
- **Exactly 12 tools exposed**: the registry gate asserts 12 agent-exposed
  descriptors and that no auth/chat/simulate route is itself agent-exposed.
  Standing b10/b13-2/b14 assert the exact per-run toolsets (board-inspect,
  drc-run, selection-inspect, component-authority.inspect, the replacement/PCB
  proposal tools) unchanged. **CONFIRMED**.
- **Read/propose/mutation permissions unchanged**: the exact chat policy role
  set (`EDITORS`) is enforced by the wrapper's role gate; a viewer → 403
  `AUTH_ROLE_DENIED` (pinned). **CONFIRMED**.
- **Approval remains required for mutation**: proposals arrive as
  `proposal_ready` / `pcb_proposal_ready` events requiring human review at
  apply; the run itself mutates nothing (standing b14/b15-3 assert the
  schematic digest is unchanged across a proposal run). **CONFIRMED**.
- **No manufacturing-release tool becomes exposed**: gate — chat source
  contains no `manufacturing-release`/`certif` string; the 12-tool count is
  unchanged. **CONFIRMED**.
- **Refusal paths make zero provider calls**: the media/size/key/message/scope/
  editorContext refusals and the auth/role refusals all return before the
  provider loop; the §A pins assert `adapterState.started === 0` on the viewer
  refusal. **CONFIRMED**.
- **Valid provider paths invoke exactly once per permitted iteration**: the
  scripted adapter's `start` is called once for a single-turn conversational
  run (pinned `adapterState.started === 1`); the loop's iteration ceiling and
  budget are unchanged. **CONFIRMED**.
