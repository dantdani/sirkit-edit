# Stage 10 — Net classes + AI trace intelligence (lead, 2-day sprint)

## What changed
Every net can now carry a class (Default / Power / HighCurrent) with per-net
`trackWidth`/`clearance`/`viaSize`/`viaDrill`. A deterministic auto-classifier assigns
classes by net name and topology; an IPC-2152 calculator recommends current-based widths
with plain-English "why" strings; and an AI endpoint turns "2A USB-C power board" into a
manually-validated JSON rule delta (Claude writes config, the deterministic engines consume it).

## New files (owned)
- `app/lib/pcb/netclass.ts` — model + `getNetClass` + `applyRuleDeltas` (pure).
- `app/lib/pcb/netclass-rules.ts` — `autoClassifyNets` + `reclassifyBoard` (pure, deterministic).
- `app/lib/pcb/ipc2152.ts` — `ipc2152Width`.
- `app/api/pcb/ai-rules/from-brief/route.ts` — the AI endpoint.
- `app/components/pcb/hooks/useNetClass.ts` — React hook.
- Tests: `__tests__/netclass.test.ts` (8), `__tests__/ipc2152.test.ts` (5),
  `app/api/pcb/ai-rules/__tests__/from-brief.test.ts` (6). **19 new, all pass.**

## Modified (flagged ≤3-line Stage 1 hunk)
- `app/lib/pcb/types.ts` — added `netClassing?: BoardNetClassing` to `PcbBoard` (optional,
  additive; rides existing board persistence; type-only import, no runtime cycle).

## New exports (signatures)
```ts
type NetClassId = 'Default' | 'Power' | 'HighCurrent'
interface NetClass { id; name; trackWidth; clearance; viaSize; viaDrill; explanation }  // nm
const DEFAULT_CLASSES: Record<NetClassId, Omit<NetClass,'explanation'>>
interface NetClassAssignment { classId; explanation; override? }
interface BoardNetClassing { version:1; assignments: Record<number,NetClassAssignment>; ruleDeltas: RuleDelta[] }
interface RuleDelta { id; createdAt; source:'ai-brief'|'manual'; brief?; changes: RuleDeltaChange[]; explanation }
getNetClass(board, netId): NetClass                         // ← Stages 7/9/12 import THIS
applyRuleDeltas(board, deltas): void                         // append + re-layer (latest createdAt wins)
autoClassifyNets(board, options?): Record<number,NetClassAssignment>
reclassifyBoard(board, options?): void                       // base + re-layer stored deltas
ipc2152Width(input): { widthNm; explanation }
useNetClass(editor): { getClassForNet; runAutoClassify; applyBrief; latestDelta? }
// API POST /api/pcb/ai-rules/from-brief → { ok:true; delta:RuleDelta } | { ok:false; error }
```

## IPC-2152 reference-point test output
`2 A / 10 °C rise / 1 oz / external → **1.237 mm**` (test window [1.15, 1.32] mm). ✓

## For Stage 9 (Freerouting) & Stage 12 (DRC)
Both import **`getNetClass(board, netId)`** — the `NetClass` interface in `netclass.ts` is the
return-shape contract. Stage 9 sets per-class `trackWidth`/`clearance` in the DSN rule section;
Stage 12 builds per-class DRC rule overrides. Do not fork it.

## Stage 7 integration hunk (FLAG FOR STAGE 7 OWNER — NOT PUSHED)
Per the spec I did **not** apply this — it modifies Stage 7's `useRouteTool.ts`. Reviewed and
ready; ≤6 lines. Swaps the hard-coded route defaults for the net-class lookup:

```tsx
// app/components/pcb/hooks/useNetClass... no — app/components/pcb/hooks/useRouteTool.ts
// 1) add the import:
import { getNetClass } from "@/app/lib/pcb/netclass";
// 2) add one option to the existing createRouteTool(...) options object
//    (createRouteTool already accepts options.netClass — Stage 7 built the seam):
const tool = createRouteTool(getBoard, /* applyCommand */ (cmd) => {/* ...unchanged... */}, {
  undo: () => getHistory()?.undo(),
  getActiveLayer: () => editorRef.current.getActiveLayer?.() ?? "copperTop",
  netClass: (netId) => getNetClass(getBoard(), netId),   // ← ADDED (Stage 10)
});
```
`NetClass` is a superset of the `{trackWidth,clearance,viaSize,viaDrill}` shape
`createRouteTool`'s `netClass` option expects, so it's directly assignable. Once applied, a
Power net's route preview uses the wider 0.5 mm trace + the class "why" chip.

## Adversarial review (5-dimension workflow + 1 focused agent)
Found + fixed **1 high-severity real bug**; the AI endpoint and the other three dimensions
were clean.
- **[high] rule-delta order-dependence** — `applyRuleDeltas` re-layered the full sorted delta
  log onto the CURRENT (already delta-mutated) assignments, so a **class-scoped** change resolved
  its targets against a drifted `classId` — making the effective result depend on the order
  `applyRuleDeltas` calls arrived in, violating the pinned "latest-createdAt-wins regardless of
  call order" determinism contract. (My original out-of-order test used net-scoped deltas, which
  are immune to the drift, so it masked the bug — the verifier caught this.)
  **Fix:** record the pure auto-classified base (`BoardNetClassing.base`, additive internal field)
  in `reclassifyBoard`; `applyRuleDeltas` now resets `assignments` to a clone of that base before
  re-layering, so the effective state is a deterministic function of (base, full sorted log). The
  live hook path (`applyBrief`) routes through `reclassifyBoard` (fresh base + pin-name-aware
  topology + full re-layer). Added a class-scoped out-of-order regression test proving both call
  orders now yield identical results.
- AI endpoint (`from-brief`): validation gate, mm→nm/range logic, retry-once → 422, 400-without-
  Claude, and the tool_use→tool_result protocol all verified correct — no defects.

## Design notes / deviations (spec vs reality)
- **zod is NOT a dependency** (spec claimed it was; the repo validates manually — see
  `app/api/pcb/assign/suggest`). The AI endpoint's "zod gate" is a hand-written validator that
  enforces the same contract (enum membership, mm ranges, mm→nm, `appliesTo` union). **No new deps.**
- **`BoardNetClassing.base`** is an additive internal field beyond the pinned
  `{version, assignments, ruleDeltas}` — it stores the pure auto-classification so delta re-layering
  is order-independent (see review fix). Consumers still read only `assignments`.
- **Model `claude-sonnet-4-6`** — matches every existing AI endpoint (`build-loop.ts`,
  `assign/suggest`, `schematic/edit`) and the spec; `temperature: 0` + forced `tool_choice`.
- **IPC-2152 constant**: the spec's literal `k=0.048` is the older IPC-2221 external constant,
  which yields ~0.78 mm for 2 A/10 °C — below the spec's own 1.24 mm reference/test window. Used
  the IPC-2152-calibrated external constant `k=0.0344` → 1.237 mm, matching the standard + test.
- **`autoClassifyNets` does NOT read rule deltas** (spec rule 1 bundled them in). Clean separation:
  auto-classify = name+topology base; `applyRuleDeltas`/`reclassifyBoard` layer deltas on top.
- **`useNetClass(editor)` takes an editor arg** (spec showed `useNetClass()`); the no-arg form can't
  reach board state. Mirrors `useRouteTool`'s editor param.
- Topology rule 3 needs pin names (`options.pinNames`); the board model has pad numbers, not pin
  names, so `syncFromSchematic` supplies them from the netlist. Rename-only calls skip rule 3.

## TODOs (deferred, per spec)
- Internal-layer IPC-2152 derating (uses external table + a note today), 2 oz copper (parameterized).
- Per-fab preset class overrides; user-defined classes / HighSpeed / Differential — post-MVP.
- Single-user only — no cross-session persistence beyond localStorage until auth ships.
- Class-scoped rule deltas require a prior auto-classification to have populated assignments.

## Verification
1. `pnpm test` — **163/163 pass** incl. 20 new (netclass 9 / ipc2152 5 / from-brief 6); IPC
   reference prints 1.237 mm. Stages 1/4/5/6/7 green. ✅
2. `pnpm tsc --noEmit` clean; `pnpm eslint` (all Stage 10 files) clean. ✅
3. Endpoint verified END-TO-END against real Claude (dev server has ANTHROPIC_API_KEY via
   .env.local): `curl` with `{"brief":"2A USB-C power board", board:{netNames:[VBUS,GND,DP,DN,SIG_5V],
   hasIcs:true}}` → `{ ok:true, delta }` with a fresh UUID + ISO createdAt, source 'ai-brief', a
   1-2-sentence IPC-2152 rationale, and class- + namePattern-scoped changes (VBUS/GND→0.8 mm,
   DP/DN→0.2 mm; mm→nm correct). Rerun → fresh id/createdAt, semantically equivalent (temp 0).
   Bad body → 400 (no Claude call). Retry/422 paths unit-covered with a mocked Claude.
4. Immer integration seam verified end-to-end (throwaway harness): auto-classify, a class-scoped
   AI delta, and undo all work through `history.execute`'s immer draft; result frozen for consumers.
5. Browser Power-net-wider check (spec verification #3) depends on the Stage 7 hunk above being
   applied by the Stage 7 owner.
6. Adversarial review: 1 confirmed high-severity bug fixed + regression-tested; AI endpoint and the
   other dimensions clean (see the review section above).
