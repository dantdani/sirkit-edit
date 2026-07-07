# PCB Stage 4 — Netlist bridge + footprint auto-assignment

Schematic → board bridge: "Send to Board" converts the Build schematic into
board state with footprints auto-resolved (hint → package heuristic → queue),
re-sync preserves placement, AI suggestions run on-demand from the queue, and
the board persists on the project record's `pcb` field.

## ⚠️ Pinned contract for Stages 5–12

`FootprintInstance` now carries **`padNets: Record<string, number>`** (pad
number → net id; absent/0 = unconnected). **This is THE pad→net contract for
Stages 5–12** — ratsnest, connectivity, auto-place, routing, and DRC all read
it. Net ids are deterministic: same schematic ⇒ same ids (named nets sorted
alphabetically get 1..k, then unnamed `N$<id>` in stable order). `board.nets`
is rebuilt wholesale each sync; net 0 stays reserved/unconnected.

## New / modified files

- `app/lib/pcb/types.ts` ⚠️ **pinned extension**: `padNets` on `FootprintInstance` (exactly as specced).
- `app/lib/pcb/demo/demo-board.ts` ⚠️ one mechanical line (`padNets: {}`) — the now-required field broke Stage 3's constructor; no behavior change.
- `app/lib/pcb/netlist-bridge.ts` **new** — the bridge (exports below).
- `app/lib/pcb/package-map.ts` **new** — ~25-row package→footprint heuristic (0402–1206 × R/C/L, SOT-23/223, SOIC-8/14/16, TSSOP-14/20, DO-214AC/SMA, LQFP-32/48/64, TO-220, TO-92, 1×N/2×N 2.54 mm headers).
- `app/lib/pcb/board-persistence.ts` **new** — board ⇄ SavedProject.pcb via a `sirkit:currentProjectId` pointer (projects UI isn't wired to lib/persistence yet; first save creates the record).
- `app/api/pcb/assign/suggest/route.ts` **new** — AI suggestions (below).
- `app/components/pcb/PcbEditor.tsx` — empty-state CTA, sync flow + report toast, queue mount, debounced (750 ms) persistence with quota toast; demo only via `?pcbdemo=`, never persisted.
- `app/components/pcb/SyncButton.tsx`, `AssignmentQueue.tsx` **new** — toolbar sync w/ dirty badge; slide-over queue (AI suggest + manual search, pick → staging strip).
- `app/components/pcb/PcbToolbar.tsx` — additive `children?` slot (right-aligned) to mount Sync/queue.
- `app/page.tsx` — one line: `<PcbEditor schematic={{ components, kicadComponents, wires, netLabels }} />`.
- `lib/persistence.ts` — additive `saveProjectPcb(id, pcb): boolean` (reports quota failure; `saveProject` swallows it).
- `vitest.config.ts` — `@` alias mirroring tsconfig (tests can now exercise alias-importing modules).
- `app/lib/pcb/__tests__/netlist-bridge.test.ts` **new** — 6 tests.
- `app/lib/connectivity.ts` — **untouched**; `buildNetUnionFind` was already exported in usable form.

## Exports (netlist-bridge.ts)

```ts
interface NetlistComponent { id; ref; mpn?; value?; package?; footprintHint?; pins: {number; name?}[] }  // pinned verbatim
interface NetlistNet { id: number; name: string; nodes: {componentId; pinNumber}[] }
interface PcbNetlist { components: NetlistComponent[]; nets: NetlistNet[] }
interface SyncReport { added; removed; kept; footprintChanged; unresolved: {componentId; ref; reason}[]; resolvedBy: Record<'hint'|'heuristic'|'manual', number> }  // added/removed/kept are component ids
function buildNetlist(schematic: SchematicState, getPart?: PartLookup): PcbNetlist
function syncFromSchematic(schematic, existing?, opts?: {getPart?, resolver?}): Promise<{board; report; netlist}>
function netlistHash(netlist): string            // dirty-badge hash
function placeNewFootprint(board, inst): PcbBoard // queue picks land in the staging strip
function createFetchFootprintResolver(): FootprintResolver
type PartLookup = (partId) => NetlistPartData | null  // CachedPart satisfies it
```

**Deviations from the pinned sketch** (necessary, announced here):
`syncFromSchematic` is **async** (tiers 1–2 hit the footprint API) and takes an
options bag injecting the parts lookup + API boundary (pure/testable); it also
returns the `netlist` (queue + badge need it). `buildNetlist` gained an
optional `getPart` — schematic state stores only partIds, so pins must come
from the parts cache. One-arg calls work (theory components only).

Semantics: unnamed single-pin roots are NOT nets (pad stays unconnected);
named singletons keep their net. Theory ground → GND net; voltage/current
sources are sim-only (no footprint); theory diode pad 1 = cathode (KiCad).
Pad/pin mismatch at any tier ⇒ unresolved with reason. On re-sync, hint-change
detection is hint-vs-footprintId string compare; resolution failure on a kept
part keeps the old def (never strand placed copper). Removed nets orphan
tracks/vias/zones to netId 0 (Stage 12 flags them). Footprints sorted by id —
part of the idempotence invariant.

## Suggest route contract

`POST /api/pcb/assign/suggest` body `{ component: NetlistComponent }` →
`{ candidates: {footprintId, fullName, confidence, reason}[] }` (≤3).
Single-tool agentic loop (sonnet-4-6, temp 0, `tool_choice: any`, ≤3
`search_footprints` calls wrapping Stage 2's search with padCount filter).
Hard validation: candidate must be a surfaced search hit AND padCount ==
pinCount; invalid entries discarded; total failure → `{candidates: []}` + log.

## Verification

- `pnpm test` — 66/66 (6 new: net-id determinism, sync idempotence via deep-equal, re-sync preserves moved positions + orphans copper to 0, mismatch demotes, heuristic fallback). `pnpm tsc --noEmit` clean.
- E2E (script against the live API, 10 parts: LQFP-48 MCU, SOIC-8 opamp, 0603/0805 R/C, D_SMA, SOT-23, 1×04 header): **10/10 resolved — `resolvedBy: { hint: 8, heuristic: 2, manual: 0 }`**, idempotence OK, U1 moved → stayed at (40,30) mm after re-sync, added R4 staged at (−50.8, 20.6) mm.
- curl (truncated): `POST /api/pcb/assign/suggest` (NE555DR, SOIC-8, 8 pins) →
  `{"candidates":[{"fullName":"Package_SO:SOIC-8_3.9x4.9mm_P1.27mm","confidence":0.97,"reason":"The NE555DR is a standard SOIC-8 package…"},{"fullName":"Package_SO:JEITA_SOIC-8_3.9x4.9mm_P1.27mm","confidence":0.75,…},{"fullName":"Package_SO:SO-8_3.9x4.9mm_P1.27mm","confidence":0.65,…}]}` — all pad count 8.

## TODOs

- Browser-level reload check of persistence still pending a manual click-through (logic unit-level sound; storage path exercised only in code review).
- package-map gaps: electrolytics, crystals (3.2×2.5 etc.), QFN/DFN, USB/JST connectors, SOD-123/323 — all fall to the queue today.
- Pin-count vs pad-count edge: exposed-pad variants (e.g. SOIC-8-EP, 9 pads) always demote to the queue by design.
- Queue state doesn't survive reload (rebuilt on next sync) — fine for MVP.
- `resolvedBy.manual` is surfaced per-pick in the toast, not accumulated into a persisted report.
