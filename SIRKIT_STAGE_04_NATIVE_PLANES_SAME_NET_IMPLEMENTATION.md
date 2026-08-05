# Sirkit Stage 4: Native Planes and Same-Net Copper Correctness

Date: 2026-07-17  
Branch: `codex/stage-04-native-planes-same-net`  
Protected working copy: `C:\Users\robsa\Documents\Codex\2026-07-13\do\work\sirkit-edit`

## 1. Outcome

Stage 4 replaces configuration-only plane intent and scattered numeric-net comparisons with two authoritative mechanisms:

1. every assigned stackup plane is materialized as exactly one stable native zone object; and
2. every copper consumer uses one stable-identity-aware pair policy for same-net, different-net, unassigned, and unknown ownership.

Only revision-matched filled regions are conductive. A zone outline, legacy cached fill, dirty fill, failed fill, or late asynchronous result cannot connect pads, satisfy readiness, enter manufacturing geometry, or masquerade as a used plane layer.

The original project at `C:\Users\robsa\sirkit` remains untouched. All implementation and verification occurred in the protected copy above.

## 2. Prerequisite gate

Before implementation, the Stage 1-3 gate passed 82/82 tests. It covered stable identity, pin/pad mapping, locked copper, net reconciliation, electrical truth, readiness, schematic parity, DSN/SES integrity, autoroute verification, fabrication bundles, native fabrication, and release persistence.

No prerequisite was bypassed or replaced.

## 3. Shared copper-pair policy

`app/lib/pcb/copper-policy.ts` is now the common policy boundary. It resolves compact numeric net IDs through the unique persisted stable-net table and returns a typed relation and operation decision.

| Relationship | May electrically touch | Union on actual contact | Ordinary inter-net clearance | Short on contact |
|---|---:|---:|---:|---:|
| same proven stable net | yes | yes | not applicable | no |
| different proven stable nets | no | no | required | yes |
| proven net to unassigned | no | no | conservative | unresolved |
| unassigned to unassigned | no | no | conservative | unresolved |
| missing/ambiguous/unknown identity | no | no | conservative | unresolved |

The decision retains an explicit list of independent manufacturing checks. Track width, edge clearance, via drill, annular ring, keepout, containment, and other manufacturing rules therefore remain active even when ordinary same-net clearance does not apply.

Consumers migrated to the policy include connectivity, DRC/live clearance, manual routing, smart-route obstacle selection, zone fill, island anchoring, autoroute verification, and export preflight. The exact C-06 regression now passes: two same-`3V3` traces separated by 0.048 mm under a 0.127 mm inter-net rule receive no ordinary clearance violation; changing one trace to `GND` produces the expected violation.

## 4. Native plane ownership and lifecycle

An assigned stackup plane is now represented by one generated `Zone`:

- stable ID: `sirkit:stackup-plane:<layerId>`;
- `source: "stackup-plane"`;
- stable `sourceLayerId`;
- stackup-owned layer and numeric/stable-net association;
- deterministic low priority so local user zones can take precedence;
- locked against ordinary zone editing;
- board-outline intent polygon;
- dirty, empty derived fill on creation or assignment/outline change.

`reconcileStackupPlaneZones` is idempotent. It creates a missing generated plane, updates the same object when the assignment or outline changes, removes it when the role/assignment is removed, de-duplicates generated objects, leaves ordinary user zones intact, and reports invalid stable-net ownership instead of guessing.

The PCB stackup/profile, plane-net, and outline UI callbacks run reconciliation inside the same history transaction. Assignment is therefore one auditable undo/redo operation. Legacy stackup assignments migrate to generated intent exactly once.

## 5. Fill provenance and stale-result rejection

Every persisted fill now carries:

- status (`dirty`, `filling`, `current`, `failed`, `unsupported`, or `stale`);
- fill algorithm version;
- deterministic source-input revision;
- deterministic fill hash;
- ordered diagnostics;
- region, hole, island, area, and thermal-access statistics.

The source revision excludes derived regions and timestamps, avoiding a revision cycle. Semantic PCB revision still includes native zone identity, ownership, intent, current fill state/version/hash, and regions.

Fill execution now follows capture, pure compute, compare, and atomic commit. `applyZoneFillCandidate` rejects a result byte-for-byte if the board input changed, the zone disappeared, or its source revision no longer matches. All-zone refill computes every candidate against one immutable revision and applies every resulting status to a clone as one transaction.

Legacy fills without sufficient provenance are cleared and marked dirty. Cached stale polygons may remain inspectable in explicitly labeled AI data, but report zero conductive area and are excluded from render copper, connectivity, DRC zone geometry, route obstacles, KiCad filled polygons, DSN plane certificates, and native manufacturing IR.

## 6. Fill geometry behavior

The existing integer-nanometer polygon engine remains the geometry authority. Stage 4 adds or verifies:

- stable ring/region/hole ordering and winding-independent canonicalization;
- board-outline inset;
- foreign track, via, pad, NPTH, and zone clearance voids;
- conservative unknown/unassigned handling;
- same-proven-net solid or thermal connection behavior;
- thermal relief for same-net pads and vias;
- explicit zone priority with stable-ID tie-breaking;
- copper keepout subtraction;
- connectivity-based island removal;
- optional minimum-island-area and keep-unconnected-island settings;
- deterministic area and access summaries.

Disconnected proximity is never treated as electrical contact. Connectivity unions only exact supported geometric touches/intersections on a common physical copper layer.

## 7. Electrical truth, DRC, routing, and autorouting

`computeConnectivity` now admits only current proven fill regions. Same-net contact unions; different proven-net contact becomes a short; ambiguous/unassigned contact becomes an explicit unresolved contact and never silently unions.

Stage 2 electrical truth now:

- reports stale/dirty/failed zone fill as `ZONE_FILL_UNRESOLVED`;
- requires the exact generated plane ID/source/layer/net/current fill for plane realization;
- reports ambiguous copper contacts as `COPPER_NET_RELATION_UNRESOLVED`;
- derives connection counts from actual pad-containing conductive clusters.

Clearance DRC and manual route preview use the same pair decision. Pair thresholds resolve the maximum applicable consumer rule, including DRC-preset overrides. Diagnostic language distinguishes different proven nets from conservative unknown ownership.

Manual and smart routing see only current zone regions as copper. Same-net regions can be valid route targets; stale outlines cannot. Keepout and board-edge behavior remains independent.

Post-SES autoroute candidates are refilled against the candidate copper revision before verification. Reapplying protected human copper triggers another atomic refill, preventing baseline fill evidence from being reused after route geometry changes.

## 8. Export and manufacturing conservation

DSN no longer invents a full-board plane directly from stackup metadata. A DSN plane exists only when the exact native generated zone has current fill evidence. Its polygon comes from native plane intent and carries a conservation certificate containing:

- zone stable ID;
- stable net ID;
- Sirkit and DSN layer identity;
- fill source revision, algorithm version, status, and hash;
- region/hole counts and filled area;
- exported representation ID;
- unsupported-construct ledger.

Preflight compares that certificate back to the live native object and rejects mismatches. Additional competing zones on a DSN plane layer are explicitly unsupported by the current DSN subset and cause `UNSUPPORTED_PLANE_PRIORITY_SEMANTICS` instead of silent approximation.

KiCad export emits the native zone once, includes current filled polygons only when their provenance matches, and maps Sirkit priority ordering to deterministic KiCad zone priorities.

Native fabrication accepts only current filled regions. Its immutable snapshot and package manifest carry native plane certificates, while MIR/Gerber region generation defensively skips non-current fill.

Export readiness treats dirty/stale/not-run fill as `unknown`/verification-incomplete, and failed/unsupported fill as a blocking failure. It never promotes an outline or zone count to proof of conductivity.

## 9. UI and AI integration

The multilayer panel now reports track length separately from filled plane area and shows current fill count plus via accesses. A current plane with zero signal tracks is no longer labeled unused.

The AI PCB snapshot exposes source/ownership, priority, current status, fill hash, conductive area, explicitly labeled stale cached area, thermal access count, stable nets, zone IDs, and per-layer fill statuses. It continues to request deterministic operations; it does not fabricate polygons or infer contact from visual proximity.

## 10. Acceptance evidence

Dedicated Stage 4 coverage includes:

- C-05 stable plane creation, update, removal, user-zone coexistence, migration, and undo/redo;
- C-06 same-`3V3` 0.048 mm gap under a 0.127 mm rule, plus different-net control;
- stale fill candidate rejection with no live-board mutation;
- deterministic source revision and fill hash;
- same-net thermal via access into an inner plane;
- actual plane-region connectivity and Stage 2 realization;
- C-11 plane layer usage by area, stable net, zone ID, status, and access;
- keepout subtraction, zone priority, and minimum island area;
- DSN and native conservation certificates;
- post-route refill and cross-consumer revision consistency.

Final verification:

```text
npx vitest run
npx tsc --noEmit
npx eslint <Stage 4 production and test files>
npm run build
```

Results:

- Vitest: 104 files passed, 622 tests passed; 2 files / 9 external integration tests intentionally skipped.
- TypeScript: passed.
- Focused Stage 4 ESLint: passed with zero errors and zero warnings.
- Next.js production build: passed.
- Fill performance gate: routed-demo two-layer fill remained below 300 ms (about 91 ms in the final full run).
- Connectivity performance gate: approximately 4,940 items completed in 20.4 ms best-of-three in the final full run.
- Build retained five known Turbopack dynamic process/file-tracing warnings around FreeRouting/NGSpice; no Stage 4 compilation failure occurred.

## 11. Deliberate limits and follow-on work

- The current `BoardOutline` model has no first-class internal routed-cutout topology. NPTH holes and authored copper keepouts are supported; arbitrary internal board cutouts remain explicitly outside this Stage 4 model rather than being guessed.
- The supported DSN subset does not losslessly encode arbitrary competing local zone priority on a power-plane layer. Preflight blocks that case.
- SES remains route geometry and does not replace native plane intent.
- Fill remains main-thread/synchronous because the measured target remains under the existing 300 ms gate. The revision-bound pure engine is worker-ready if larger boards require it.
- A separate same-net copper-sliver/neck/acute-angle manufacturing rule is not invented here. The shared policy has an explicit independent-rule extension point for Stage 6.
- Stage 4 does not claim signal integrity, power integrity, thermal quality, EMC, field-solver accuracy, or fabricator process qualification.
- FreeRouting success still does not prove why an external engine might return an empty SES; diagnostics preserve phase attribution without overclaiming a root cause.

## 12. Verdict

STAGE 4 COMPLETE
