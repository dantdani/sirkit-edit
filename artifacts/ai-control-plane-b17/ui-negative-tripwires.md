# B17 — UI negative tripwires

Labels: **CONFIRMED** (executed and measured), **INFERRED** (code reading), **PROPOSED** (designed, not exercised), **RECORDED** (written down without a claim), **UNKNOWN**, **BLOCKED-LIVE-QUALIFICATION**.

A negative tripwire is a test that FAILS when a forbidden path appears: a control with no semantic entry point, a silent button, a view command that reaches engineering state, an agent-reachable mutation, a human mirror an agent can issue, a tool exposed by count instead of by review. Every tripwire below is in CI (the `prompt-to-gerber` list of `.github/workflows/deterministic-manufacturing.yml`) unless marked otherwise.

## 1. Every actionable control is registry-backed; no silent or legacy-path button (CONFIRMED — B17-A, `app/lib/engineering/__tests__/b17-a-control-inventory.test.ts`, 6 gates)

| gate | what fails it |
|---|---|
| 1 | a scanned control that matches no classification rule, a rule that matches nothing (stale), or a structurally invalid rule |
| 2 | the committed inventory (`ui-control-inventory.csv`, 573 controls / 58 surfaces) differs from a fresh AST render — a new or changed control must be classified and regenerated to review |
| 3 | a semantic/dispatcher control that names a record the action registry does not have; an `implemented` record with no real entry point (control or route) |
| 4 | a registry record whose sources call a retired route |
| 5 | a control whose handler does nothing that is classified anything but `internal` / `unavailable` — a silent button is a failure, never a class |
| 6 | an `unavailable` control without a visible reason; a rule unreachable by id |

Companion registry gates (`action-registry.test.ts`, `b04-tool-registry.test.ts`): no `partial` record without a precise blocker (B17-E), every `implemented` record cites real sources, the B01 matrices are byte-consistent with the registry.

## 2. No engineering mutation from a view command (CONFIRMED — `app/lib/view-session/__tests__/b17-negative-tripwires.test.ts`)

- **Tripwire 1 — exhaustive dispatch.** Every registered command of the four view sessions (`pcb.*` 25, `pcb3d.*` 12, `schematic.*` 12, `workspace.*` 3) is dispatched on a real bus over a real board with representative payloads AND with garbage (`{ nonsense }`, `null`, a string, a number), as the agent actor and as the human. Outcomes are only `settled` or `refused`; afterwards the board's JSON and `pcbRevisionId` and the schematic sources are byte-identical. The payload table is exhaustive in both directions: a registered command missing from it, or a table entry no command registers, fails the test — a new command cannot slip in untested. Dispatches per run: 518 (49 commands × (representative payloads + 4 garbage variants) × 2 actors, derived from the table itself), of which more than 150 settle — the representative payloads really run, and the board still does not change. Refusals may only be payload / unavailable / stale-revision / role verdicts; an infrastructure refusal (expiry, scope, retirement, unknown command, handler failure) fails the test so the tripwire can never be vacuous. Envelopes are issued on the bus's frozen clock.
- **Tripwire 2 — the human mirror is human-only.** Each editor with an `*.observe` mirror (pcb, schematic, workspace; the 3D view has none) refuses an agent with `VS_ROLE_FORBIDDEN` and its view revision does not move.
- **Tripwire 3 — registry shape.** Every `view-session` tool in the catalog (exposed or not) has `session-state` side effects, authority `none`, approval tier `none`, no expected-revision / lineage requirement and a `bound-view-session` (or unbound) binding — never a mutation binding.
- Bus-level guarantees these rest on (B17-B `b17-b-view-session-bus.test.ts`, 12 gates): scoped identity (a foreign project/branch/editor/session refuses), stale-revision rule per command (`refuse` for relative commands, `rebase` otherwise), single settlement per invocation id, TTL expiry, retirement is final, no authority fields in the envelope.

## 3. Nothing outside the reviewed set reaches the model (CONFIRMED — `b17-f-agent-exposure.test.ts`, `b17-f-view-tools.test.ts`, the 37 re-derived gates in `tool-exposure.md` §6)

- The registry's actual exposure equals `INTENTIONAL_AGENT_EXPOSED_TOOL_IDS` exactly (both sides derived; `agentExposureReport` clean); a tool added to the catalog with `agentExposed: true` but not to the list fails 38 tests.
- No exposed tool is `mutate` / `destructive` / `release`; none matches `qualif`, `\.release$`, `undo-redo`, or the canonical mutation ids; an exposed `view-session` tool must be `bound-view-session` with a non-empty `viewCommands` list of real bus commands and never an `observe`.
- The gateway refuses every non-exposable class outright (`b09-proposals` 34), refuses a widened surface list or a tampered view (context integrity), and a view-session tool without its captured surface (`view_surface_unavailable` / `not_discoverable`).
- Contextual discovery: no 3D tools without `pcb3d-surface`, no layers/measure/reveal without `pcb-surface`, no view tools without a captured view, no routing/placement/read-state without a board, no proposal of any kind to a viewer or commenter, layout candidates only to pcb_editor/project_admin.
- Strict wire schemas: a `minimum`/`maximum` (or any unsupported keyword) in an exposed schema is refused by the B09 generator and by `strictCompatibility` — the tool is excluded with a warning, never forwarded loosely.

## 4. UI / keyboard / tool parity (CONFIRMED)

- Keyboard: Ctrl+3 → `pcb3d.open`/`close` (toggle), Escape → `pcb3d.close` / `pcb.clear-selection` through the editor's global-actions ref (B17-C/D); the browser proof exercises Escape (scenario 4).
- Tool parity: the agent's `sirkit.view.pcb3d`, `canvas-navigation`, `selection.control`, `view.layers`, `reveal-finding`, `measure` map onto the SAME command descriptors the toolbar/palette/panels issue (`serverViewCommands` instantiates them for validation; `viewCommands` ⊆ the bus's registered ids is asserted); the browser proof drives `pcb3d.open`, `pcb3d.set-layer-visible`, `pcb3d.toggle-layer` (stale → refused), `pcb.focus` and `pcb3d.close` through the bridge and observes the same DOM state the human path produces (scenario 5).
- The 3D acceptance scenario (open → hide top silkscreen → focus J1 → isometric) runs through the semantic bus in the browser (scenario 1), asserted on the bus state AND the three.js scene visibility.

## 5. Placement / routing / history negatives (CONFIRMED — B17-E `b17-e-layout-candidates.test.ts`, `b17-e-operation-timeline.test.ts`, B17-F §C)

- A stale, expired, tampered (digest), foreign-generation or foreign-scope layout candidate refuses at apply with zero mutation; the routing candidate's copper is restricted to the requested nets; the agent's candidate re-verifies base revision at intake and again at apply.
- Project undo refuses when the owning history diverged (`DIVERGED_*`), when the latest operation is not undoable, and when nothing exists; it never guesses across stores.
- Authority-shaped proposal arguments (`apply`, `commit`, `generation`, `expectedRevision`, …) refuse by name; unknown footprint/net ids refuse; a viewer's proposal call is `not_discoverable`.

## 6. Where a tripwire is NOT a proof (RECORDED)

- The tripwires prove that no registered path mutates; they do not prove the absence of an unregistered UI path. That is what gate 1.2 (AST inventory equality) and gate 1.5 (silent handler classification) close: an unregistered actionable control cannot be added without regenerating and classifying it.
- A live provider turn is UNKNOWN (U17-1); the tripwires cover the gateway/loop/bridge the route composes.
