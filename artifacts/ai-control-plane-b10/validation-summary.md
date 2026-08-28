# B10 validation summary

> **CORRECTION NOTE (B10.1).** Independent verification found five gaps
> after this stage: (R1) the production publisher died under React Strict
> Mode (one-way liveness ref) — dev runs had no PCB context; (R2) the
> "tsc clean" claim below was FALSE (two errors in the B10 test files —
> the check predated them); (R3) nested authority claims inside scope/
> editorContext.scope/messages were silently ignored; (R4) netlist
> validation proved nothing about the schematic and sealed authority-
> bearing browser fields; (R5) the 8 MB limit fully buffered hostile
> bodies before refusing. All five are closed by B10.1 — see
> `artifacts/ai-control-plane-b10-1/`. The netlist resource is now the
> authority-neutral projection `sirkit.agent-netlist-projection.v1`.
> Historical counterexample evidence below is preserved.

Date: 2026-08-09. Workspace: `C:\Users\robsa\Desktop\sirkit-edit`
(uncommitted working tree authoritative; `C:\Users\robsa\sirkit` untouched;
no GitHub authority).

## New suites

- `app/lib/agent/__tests__/b10-editor-context.test.ts` — 16 tests (§A
  bridge, §B server assembly/integrity, §C selection, §D netlist, §E
  runtime matrix vs the committed artifact, §F exposure + entry gate 0).
- `app/api/chat/__tests__/b10-chat-boundary.test.ts` — 6 tests (byte
  bound, exact keys, obsolete boardState refusal, editorContext envelope,
  valid context activating reads through the production route with a
  controlled adapter, boardless truthful zero-tool run).

All 22 pass.

## Changed production files

`app/lib/agent/editor-context-bridge.ts` (NEW),
`app/lib/agent/netlist-validation.ts` (NEW), `app/lib/agent/contracts.ts`
(selection/netlist + digests on AgentRunContext), `app/lib/agent/context.ts`
(selection verification/resolution, netlist acceptance, digests, bundle
envelopes), `app/lib/agent/gateway.ts` (integrity recomputation of
canonical/schematic/selection/netlist digests), `app/lib/agent/loop.ts`
(`availableResourceKinds` + generic binding-declared resource filter),
`app/lib/agent/provider-tools.ts` (Entry Gate 0),
`app/lib/engineering/tool-catalog.ts` (selection.inspect 1.1.0 exposed,
empty strict input), `app/lib/engineering/tool-bindings-readonly.ts`
(read.selection 1.2.0), `app/api/chat/route.ts` (bounded versioned
editorContext boundary), `app/components/pcb/PcbEditor.tsx` (publisher
effect over boardRef/selectionStore/liveNetlist), `app/page.tsx` (bridge
ownership at hydration + atomic capture in send()),
`scripts/generate-agent-artifacts.ts` (manifest v3 runtime truth),
`scripts/generate-b10-artifacts.ts` (NEW matrix generator).

## Test batteries (exact counts)

| Battery | Result |
| --- | --- |
| Regression gate `b07 b04-tool-registry b08 b06` | **316 passed** (18 files) |
| `b05 app/lib/agent app/api/chat` (incl. 22 B10 + all B09.x) | **169 passed** (12 files) |
| `app/lib/engineering/__tests__` | **450 passed** (26 files) |
| `app/lib/pcb/lifecycle/__tests__` | **20 passed** (2 files) |
| `run-drc` + readiness | **5 passed** |
| Full suite | **2171 passed, 5 failed, 20 skipped** (2196 total; 265/273 files, 3 skipped) |

The 5 full-suite failures are the DOCUMENTED timing-budget family under
parallel load; every one passes isolated: auto-place 8/8, compute-fill
7/7, connectivity-board 10/10, pcb-repair-agent 8/8, route-tool 25/25.
**Zero functional failures.** No performance gate was loosened.

## Static gates

- `npx tsc --noEmit`: clean.
- Scoped ESLint: zero findings on every changed agent/route/catalog/script
  file; `PcbEditor.tsx` stays at its B09.0 ZERO-finding baseline;
  `app/page.tsx` stays at exactly its accepted 14-error baseline.
- Generators re-run byte-stably (verified by second-run diff): B04 registry
  (digest `eng1-3d9e239821f49159`, 9 agent-exposed of 27), B09 manifest v3
  + parity + replay pins, B05/B05.1 replays, B06 fixtures, B10 runtime
  matrix.
- Stale-phrase tripwires, sourceEvidence gate (27/27), runtime-availability
  gate (matrix ↔ real runtime), exact static-set gate (NINE ids): green.
- Exposure discipline: every exposed descriptor is read/propose; no mutate,
  destructive, release, view-session, MCP, multi-agent, or automatic
  proposal-apply surface exists.

## Runtime availability (proven matrix — runtime-tool-availability.csv)

1. No board/schematic/mark → **zero tools**. 2. Schematic+mark, no board →
**proposal only**. 3. Board+schematic+mark+selection → **7 canonical reads
+ selection.inspect + proposal (9)**. 4. Board+schematic+selection, no mark
→ **reads + selection, no proposal**. 5. Board without schematic →
**board-compatible reads + selection (no schematic.inspect, no proposal)**.
6. Invalid netlist → **readiness available; parity NOT evaluated; netlist
withheld**. 7. No selection resource → **selection.inspect absent only**.
8. Full context → **component-authority.inspect still absent** (no proven
producer).

## CONFIRMED / INFERRED / PROPOSED / UNKNOWN

**CONFIRMED**: all eight pre-edit counterexamples closed with permanent
regressions; the working-copy read source (unsaved edits visible; durable
record can never overwrite it); generation-owned invalidation; server
recomputation of all revisions/digests; independent withholding; integrity
coverage of every new field; entry-gate-0 closure; nine-tool static set;
deterministic dual-provider rendering.

**INFERRED**: the 5 full-suite failures are load-induced timing budgets
only (isolated-green, consistent with the documented set since B07.4).

**PROPOSED** (future, NOT started): a server-owned component-authority
producer to activate `component-authority.inspect`; per-message re-capture
of the editor context on multi-turn tool runs (currently one atomic
snapshot per chat request, which is the specified contract).

**UNKNOWN**: live provider model turns — both accounts remain out of
credits; the bridge and tool loop are proven through production modules
with controlled provider adapters (the b10-chat-boundary suite drives the
real route/loop/gateway/assembler). No credits were spent; no provider
configuration changed; no fallback introduced.

## Verdict

B10 is COMPLETE per its stop condition: the assistant can inspect the
current visible PCB state, current selection, DRC, connectivity, and
fabrication readiness through the registered B05/B05.1 read boundary, with
truthful per-resource withholding. Stopped before B11 — no agent-exposed
mutation, automatic proposal application, PCB mutation tools, manufacturing
release, MCP, or multi-agent orchestration exists. Awaiting independent
verification.
