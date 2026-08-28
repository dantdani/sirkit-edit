# B10 — Project-Owned PCB/Editor Context Bridge and Truthful Read Activation

B10 connects the assistant's B09 read-only control plane to the EXACT
project-owned PCB working copy displayed by `PcbEditor` — `state.board`
(unsaved edits included), the live selection, and the optional live netlist
— through one atomic, versioned, immutable, generation-owned snapshot. The
registered B05/B05.1 read boundary is unchanged; the browser can finally
reach it truthfully.

## Documents

| Document | Content |
| --- | --- |
| [pre-edit-counterexamples.md](pre-edit-counterexamples.md) | Exact R1–R8 pre-edit evidence |
| [editor-context-bridge-contract.md](editor-context-bridge-contract.md) | Bridge ownership, generations, invalidation, immutability |
| [chat-request-boundary.md](chat-request-boundary.md) | Versioned bounded editorContext contract + server authority semantics |
| [resource-validation-and-provenance.md](resource-validation-and-provenance.md) | Selection/netlist validation, sealing, pinning, integrity coverage |
| [runtime-tool-availability.csv](runtime-tool-availability.csv) | Generated 8-case matrix (real runtime; byte-stable; test-gated) |
| [component-authority-disposition.md](component-authority-disposition.md) | Why component-authority.inspect stays unexposed |
| [provider-schema-entry-gate.md](provider-schema-entry-gate.md) | Entry Gate 0: the properties/items-without-type inference closure |
| [validation-summary.md](validation-summary.md) | Full battery counts, UNKNOWNs, verdict |

## Invariants after B10

- The chat read source is `PcbEditor.state.board` — never `authorityRef`
  (durable server board), never storage reconstruction, never a refetch.
  Unsaved edits are visible to every registered read tool.
- One `EditorContextBridge` per page, generation-locked to project
  hydration: project switch, branch mismatch, unmount, hydration
  replacement, board removal, and retired publications all invalidate;
  captures and publications are immutable deep-frozen clones.
- `/api/chat` accepts ONE versioned atomic `editorContext`
  (`sirkit.editor-context.v1`): actual byte-bounded body (8 MB documented
  limit), exact allowed keys, embedded scope must equal the request scope,
  provenance only `local-working-copy`; the obsolete `boardState` path
  refuses explicitly; the server revalidates the board and recomputes
  every revision and digest — client digests are never authority.
- `sirkit.selection.inspect` is agent-exposed (static set = NINE tools)
  over the sealed selection-snapshot resource: deduped, dead refs removed,
  primary kept only while live, oversized selections rejected (never
  truncated), pinned to the server-computed canonical revision, EMPTY
  strict input (no model-invented refs). An empty current selection is a
  truthful empty result.
- The optional netlist resource seals only with proven schematic-digest
  agreement + full structural/semantic validation; otherwise it alone is
  withheld and readiness reports schematic parity as NOT evaluated.
- Provider discovery is generically resource-aware: a read is advertised
  only when its activated binding's declared `requiredResources` are all
  present in the run's sealed bundle; the gateway/read-service recheck the
  same conditions; missing/invalid resources withhold ONLY the affected
  tools.
- All new context fields participate in `verifyAgentContextIntegrity`
  (recomputed digests) — post-assembly mutation or resource substitution
  fails `context_integrity` before invocation.
- `sirkit.component-authority.inspect` remains unexposed (no proven
  server-owned producer — see the disposition document).
- Entry Gate 0: object-only/array-only schema keywords now require an
  EXPLICIT base type; the properties-without-type object inference is
  removed from normalization.

No mutation, destructive, release, MCP, multi-agent, or automatic
proposal-apply surface was added. B11 was not started.
