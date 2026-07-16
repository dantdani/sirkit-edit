# PCB auto-placement and AI DRC repair agent

Date: 2026-07-15

## 1. Modules and files changed

- `app/lib/pcb/autoplace/envelope.ts`, `auto-place.ts`, `routeability.ts`,
  `rotation.ts`, and `types.ts`: virtual placement envelopes, routing margins,
  hard placement constraints, candidate scoring, placement reports, progress,
  and cancellable worker execution.
- `app/lib/pcb/ai/snapshot.ts`, `violation-normalizer.ts`,
  `pcb-tool-service.ts`, and `pcb-tool-schemas.ts`: versioned exact state,
  normalized DRC data, provider-neutral native tools, and view-only adapters.
- `app/lib/pcb/repair/*`: grouping, safety classification, preview, apply,
  verification, bounded repair loop, approval policy, and undo.
- `app/api/pcb/repair/agent/route.ts`: identical OpenAI/Anthropic planning loop.
- `app/api/pcb/autoroute/route.ts` and DSN writer: selected-net reroute while
  protecting unrelated copper.
- `app/components/pcb/PlacementSetup.tsx`, `BoardRepairPanel.tsx`,
  `DrcPanel.tsx`, `PcbEditor.tsx`, and `hooks/usePcbRepair.ts`: user workflow.
- `app/lib/pcb/history.ts`, DRC types/checks, SES import, and board types:
  provenance, exact object IDs, constraints, and append-only events.
- Focused fixtures/tests cover envelope geometry, placement constraints,
  selected-net routing, provider-neutral tools, the 71-error repair, rollback,
  stale revisions, and no-rule-weakening policy.

## 2. Placement-envelope example

A 20.0 x 10.0 mm courtyard becomes a centered 23.0 x 11.5 mm virtual
envelope at the Comfortable 1.15 setting. The source hierarchy is valid
courtyard containing the pad field, body containing the pad field, union of
pads/graphics, then a safe fallback. The effective envelope is the union of
that scaled box and an absolute margin derived from trace width, clearance, via
landing, and manufacturer minimums.

Compact, Comfortable, Spacious, and Custom are 1.10, 1.15, 1.20, and a
user-entered scale. The project stores the selected preset and scale. Placement
reports footprint/pad counts, envelope overlap, blocked escapes, congestion,
required/available area, locked parts preserved, and success/failure.

## 3. Manufacturing geometry proof

Envelope computation is pure and never writes `FootprintDef`, pads, graphics,
tracks, vias, zones, or the board outline. A regression test snapshots the
footprint definition and emitted DSN before analysis and proves both remain
byte-identical afterwards. Board-region resizing remains a separate 10 percent
operation and is allowed only for generated outlines or explicit approval.

## 4. AI snapshot schema

`sirkit.ai-pcb.v1` uses millimeters and includes project/PCB/schematic revision
IDs; board outline; ordered physical stackup; footprints and virtual envelopes;
pads; nets and resolved constraints; tracks/vias with provenance and locks;
zones and fill currency; keepouts; rule sources; exact connectivity; normalized
DRC violations; every copper layer's usage; placement congestion/pad access;
fabrication readiness; and engineering events. The PCB revision is a stable
semantic hash used for stale-plan rejection. Snapshot generation on the
71-error fixture is below the 250 ms gate. Stable-ID snapshot diffing reports
added, removed, and changed engineering objects.

## 5. Tool schema

Both providers receive one `PCB_AI_TOOLS` catalog. It contains board/footprint/
net/track/via/zone inspection, manufacturer/rule explanation, schematic
connectivity, stackup/layer usage, congestion/pad access, event history, DRC and
violation inspection, placement analysis/preview/apply, DRC classification and
planning, repair preview/apply/verify/undo, the bounded repair loop, and
view-only layer/highlight/focus controls. Browser DOM clicking is not part of
the engineering interface. The server AI pass is deliberately read/planning
only; the local validated service owns mutations.

## 6. Safety and approval policy

- No operation may lower an active manufacturer/default rule.
- Human/imported or locked copper is protected and requires explicit approval.
- Fixed, mechanical, and edge-bound footprints are immovable; allowed rotation
  sets are enforced. Existing side is preserved.
- Preview is pure. Apply requires the same PCB revision, a non-regressing DRC
  result, zero new error-level violations, and measurable improvement.
- Only affected nets are ripped up/rerouted; unrelated copper is DSN-protected.
- Zones are refilled and connectivity plus DRC rerun after geometry changes.
- Provider failure is surfaced by the shared router; deterministic native
  planning may continue, but the selected AI provider is never silently changed.
- Apply is one history transaction with actor, reason, source violations,
  object IDs, metrics, and transaction ID.
- Auto-placement runs in a dedicated cancellable worker with phase/percentage;
  AI planning and affected-net routing requests use abort signals and expose
  phase, percentage, elapsed time, and Cancel.

## 7. 71-error fixture metrics

The deterministic fixture has 72 pads on one net and 71 generated 0.05 mm
tracks below the JLCPCB resolved minimum. Native DRC reports exactly 71 errors.
The planner produces one `generated_width_mismatch` root-cause group and 71 safe
width fixes. Preview reports 71 -> 0 errors, zero new violations, and does not
mutate the source board. Apply produces 0 errors without changing rules.

## 8. Nets rerouted and components moved

The 71-error fixture needs width correction only, so rerouted nets: none;
components moved: zero. For routing/clearance/connectivity groups, the repair
executor sends only affected numeric net IDs to local FreeRouting, filters its
result back to those nets, and preserves every unrelated track/via. General
auto-placement moves only unconstrained footprints and reports the exact count.
A separate containment fixture previews one local footprint move, refuses apply
without approval, then commits successfully after its exact fix IDs are approved.

## 9. Layer-by-layer inspection

The fixture snapshot contains both enabled copper layers even when hidden in
the UI. Top Copper contains all 71 tracks; Bottom Copper is present with zero
tracks. Layer reports include role, routing policy, track length/count, via and
zone use, violations, and incomplete connectivity. Four-layer boards expose
Top, Inner 1, Inner 2, and Bottom through the same model.

## 10. Connectivity results

The width-only repair preserves the original fully connected 72-pad net and
finishes with zero unrouted connections. Every candidate is evaluated with the
native pad/copper connectivity engine after zone refill and selected-net route
import. The snapshot separately records schematic-parity state so an unknown or
failed parity check cannot be represented as a verified pass.

## 11. Undo and rollback

Apply creates exactly one `pcb_repair` history entry. The fixture test undoes
that transaction and proves all 71 tracks return to 0.05 mm. Stale plans and
previews are rejected after concurrent edits; direct transaction undo is
restricted to the most recent matching transaction.

## 12. Automated verification

- Focused placement/repair/autoroute/readiness suite: 36/36 passed.
- Full repository: 537 passed, 9 skipped. The 500-track interactive route gate
  passed in the full run at p50 8.7 ms and p95 18.8 ms.
- 100-footprint placement: 86 percent shorter ratsnest, no fixture collisions,
  about 0.8 seconds in the final full run.
- TypeScript and touched-file ESLint passed.
- Optimized Next.js production build passed. Turbopack retained the existing
  broad dynamic-process tracing warnings for Java/NGSPICE executables.
- Live browser: Comfortable 15 percent was the default; switching to Spacious
  20 percent worked without refresh and created `Undo Set auto-placement
  spacing`. Native DRC on the intentionally unplaced story board reported 99
  errors, 32 warnings, and 30 unrouted connections, then exposed Board Repair,
  Fix with AI, and all three execution modes. Worker placement visibly changed
  to a percentage-bearing Cancel control, committed as one Undo entry, and Undo
  restored the 40 x 30 mm board. The browser console was clean.

## 13. Known limitations

- DRC repair can automatically edit legal generated widths, remove generated
  dangling copper, replace configured vias, refill zones, reroute affected
  nets, and propose native local moves for board containment or courtyard
  overlap. Footprint moves remain approval-gated and must pass preview DRC.
- Snapshot revisions and history patches support stale detection and replay,
  but there is not yet a standalone user-facing arbitrary snapshot-diff viewer.
- Automatic repair remains bounded to eight iterations. Schematic intent
  errors, impedance-controlled constraints without a resolved profile, and
  ambiguous user-authored geometry stop for explicit review.

## Safety boundary

The original `C:\Users\robsa\sirkit` directory was not modified. All work is in
`C:\Users\robsa\Documents\Codex\2026-07-13\do\work\sirkit-edit`.
