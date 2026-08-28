# B10.1 validation summary

Date: 2026-08-09. Workspace: `C:\Users\robsa\Desktop\sirkit-edit`
(uncommitted working tree authoritative; `C:\Users\robsa\sirkit` untouched;
no GitHub authority; no secrets exposed).

## New suites

- `app/lib/agent/__tests__/b10-1-strict-mode-publisher.test.tsx` — 4 jsdom
  tests mounting the PRODUCTION `useEditorContextPublisher` seam under
  `<StrictMode>` with a real `EditorContextBridge` and a real
  `PcbBoardLifecycleOwner`.
- `app/api/chat/__tests__/b10-1-request-boundary.test.ts` — 10 tests
  (nested claims, revision-hint fail-closed, streaming limit with
  consumed-byte proof, authority-neutral netlist contract).

All 14 pass.

## Changed paths and symbols

`app/lib/agent/use-editor-context-publisher.ts` (NEW —
`useEditorContextPublisher`, `EditorLifecycleSource`),
`app/lib/agent/netlist-validation.ts` (REWRITTEN —
`AGENT_NETLIST_SCHEMA`, `projectAgentNetlist`,
`validateAgentNetlistProjection`, `AgentNetlistProjection/Logical`),
`app/components/pcb/PcbEditor.tsx` (hook adoption; one-way
`bridgeAliveRef` deleted; `publisherScope`/`readEditorContext`),
`app/page.tsx` (unmount-invalidate effect removed),
`app/lib/agent/editor-context-bridge.ts` + `contracts.ts` + `context.ts`
+ `gateway.ts` (netlist projection types/digest schema),
`app/api/chat/route.ts` (`readBoundedBody`, `exactObjectShape`,
`AUTHORITY_CLAIM_KEYS`, complete editorContext contract, revision-hint
recompute), test fixture updates in the two B10 suites,
`scripts/generate-b10-artifacts.ts` (projection fixture).

## Test batteries (exact counts)

| Battery | Result |
| --- | --- |
| Regression gate `b07 b04-tool-registry b08 b06` | **316 passed** (18 files) |
| `b05 app/lib/agent app/api/chat` (incl. 14 B10.1 + 22 B10 + all B09.x) | **183 passed** (14 files) |
| `app/lib/engineering/__tests__` | **450 passed** (26 files) |
| `app/lib/pcb/lifecycle/__tests__` | **20 passed** (2 files) |
| Readiness/parity + run-drc | **5 passed** |
| Full suite | **2180 passed, 10 failed, 20 skipped** (2210 total; 263/275 files, 3 skipped) |

The 10 full-suite failures are ALL load-induced, zero functional:

- 5 = the DOCUMENTED timing-budget family — isolated-green: auto-place
  8/8, compute-fill 7/7, pcb-repair-agent 8/8, route-tool 25/25.
- 5 = parallel-load-only failures of two filesystem-scan tests
  (b09-3 source scan, b03-2 import scan) and three jsdom/route component
  tests (InterfacePlanningWorkspace, assignment-queue-panel — a documented
  flake since B07.3 — and pcb/autoroute route). All five pass isolated AND
  in one grouped rerun (**44/44**), and the scanned invariants were
  re-proven by direct grep against the actual tree (zero production
  mentions of the snapshot resource; only the approved channel importers).

No performance gate was loosened.

## Static gates

- `npx tsc --noEmit`: **genuinely clean** (R2's two test-file errors
  fixed; verified after every edit wave).
- Scoped ESLint over every changed source/test/script: zero findings;
  PcbEditor stays at its zero-finding baseline; page.tsx at exactly its
  accepted 14-error baseline.
- Generators run twice byte-stably: B10 runtime matrix (identical bytes
  across three runs), B09 agent manifest/parity, B04/B05/B06 unchanged
  (registry untouched — NINE exposed tools, digest `eng1-3d9e239821f49159`).
- Runtime tool availability: UNCHANGED from B10 (same nine-tool static
  set, same 8-case matrix — B10.1 changed boundary strictness, not
  availability semantics; the valid-netlist matrix fixture now uses the
  authority-neutral projection).

## CONFIRMED / INFERRED / PROPOSED / UNKNOWN

**CONFIRMED**: all five counterexamples closed with permanent regressions;
StrictMode survival proven by mounting the production seam; nested
authority claims refuse by name; the request limit stops reading at the
ceiling (9 vs 13 pulls); the netlist resource is authority-neutral and
schematic-proven; tsc/lint/generator gates green.

**INFERRED**: the 10 full-suite failures are parallel-load artifacts only
(isolated- and group-green; invariants re-proven by direct inspection).

**PROPOSED** (not started): stabilizing the two filesystem-scan tests
against full-suite load (e.g. retry-on-transient-fs-error); a server-owned
component-authority producer (carried from B10).

**UNKNOWN**: live provider model turns — accounts remain out of credits;
no credits spent, no provider configuration changed, no fallback added
(controlled adapters drive the production route/loop/gateway).

## Verdict

B10.1 is COMPLETE per its stop condition: the production bridge is
reachable in real (StrictMode) development runs, lifecycle ownership is
race-free, the request boundary refuses nested authority claims and reads
boundedly, and the netlist resource is authority-neutral and
schematic-proven. Stopped before B11 — no mutation exposure, manufacturing
release, MCP, or multi-agent orchestration. Awaiting independent
verification.
