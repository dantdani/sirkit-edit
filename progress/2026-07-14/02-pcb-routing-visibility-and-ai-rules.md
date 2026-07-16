# PCB Studio — copper visibility, route controls, and AI routing rules

## Request and audit

The upgrade began with a compatibility audit against the 1,295-line PCB Studio
specification. The important discovery was that most load-bearing systems
already existed and should be preserved:

- integer-nanometer board geometry with stable track/via IDs;
- undoable Immer history and typed edit commands;
- tracks with explicit width/layer/net fields;
- via padstack registry with safe local-fork/global-edit behavior;
- per-net classes, IPC-2152 width calculation, DRC, DSN/KiCad export;
- interactive 45-degree routing with a shared live/batch clearance guard;
- schema-validated AI rule deltas and a separate validated AI edit assistant.

The user-facing failures were integration and discoverability defects:

1. `renderCopper` had been implemented but its documented scene integration
   hunk never landed. `PcbScene.setBoard` therefore rendered footprints and the
   outline but no committed tracks or vias.
2. Zone and silk render effects ran before `setBoard`; a footprint rebuild could
   clear their layer containers after they were drawn.
3. The grid was visually stronger than navigation furniture should be, while
   the teal top-copper color collided with the app's selection accent.
4. Track width was editable only after selecting existing copper. There was no
   control for the width or via preset of a route before it started.
5. `useNetClass` and the AI rule endpoint existed but were not mounted in
   `PcbEditor`; `useRouteTool` also omitted the already-designed net-class seam.
6. Class padstacks always replaced rule-delta via dimensions, so an AI/manual
   via override could be stored yet ignored by interactive routing.

## Changes and why

### Authoritative scene rendering

`PcbScene.setBoard` now owns one deterministic render order: footprints,
committed tracks/vias, zone fills, and user silk. The duplicate React effects
were removed. `renderCopper` now owns tracks/vias only; `renderZones` owns zone
intent/fill so a zone is not painted twice. Primitive statistics include every
surface. This is additive to the canonical board and changes no persisted
geometry.

### High-contrast canvas

- background: blue-black;
- minor grid: neutral, 24% alpha;
- major grid: neutral, 58% alpha;
- origin: slate instead of selection teal;
- top copper: coral red;
- bottom copper: bright blue;
- inactive copper alpha: 18%;
- ratsnest: light slate at 62% alpha.

The contrast test requires both copper layers to exceed 3:1 against the major
grid while keeping the minor grid below 1.5:1 against the background. Layer
rows now explain focus/visibility and show an ACTIVE badge. The right column is
scrollable so the added rules surface cannot hide DRC or inspector content.

### Persistent new-route setup

Added optional `PcbBoard.routingPreferences` (no migration required):

- net-class/AI width or exact custom width;
- net-class/AI via or a selected board padstack.

The Route tool shows a floating setup card with common 0.15–2.00 mm presets,
exact custom input, and every governed via padstack. Preferences are written
through board history and persist with normal project saves. Existing tracks
remain unchanged; their multi-selection Width inspector still performs live
DRC preview.

`resolveRoutingProfile` is the single pure resolution path used by the UI and
route engine. A route captures width, clearance, via diameter/drill, and
padstack at its starting pad so settings cannot drift halfway through a route.
The route preview moved from Board Outline into the scene overlay, so hiding
the outline no longer hides in-progress copper.

### Reviewable routing intelligence

Mounted the existing net-class hook in the editor. The panel:

- displays effective class, trace width, and via dimensions for each net;
- runs deterministic name/topology classification as one undoable command;
- asks the AI for trace, clearance, and layer-transition via rules;
- shows scope, dimensions, and rationale before any mutation;
- applies an accepted proposal as one undoable history entry.

The AI prompt now requires power/current recommendations to assess trace and
via together and warn when parallel vias may be required. Validation requires
via diameter/drill to arrive as a pair and preserves at least 0.10 mm annular
ring per side. A per-net AI/manual via override bypasses the seeded class
padstack so the effective recommendation reaches newly placed vias.

## Compatibility

- No existing project field was removed or renamed.
- Legacy boards without routing preferences retain net-class behavior.
- Existing tracks, vias, padstacks, net classes, DRC, exports, history, and
  project storage remain authoritative.
- AI changes are proposals; no board mutation occurs before explicit Apply.
- Existing copper is never resized when the new-route preference changes.

## Verification

- Focused suites: 34 tests pass across renderer contrast/output, routing
  profiles, route-state capture, AI validation/retry, routing controls, and the
  undoable Routing intelligence panel.
- Full repository suite: 466 passed / 9 intentionally environment-gated
  skipped. TypeScript is clean and every new/modified module passes targeted
  ESLint with zero warnings.
- Production Next.js build succeeds. Turbopack still reports the previously
  documented dynamic Java/ngspice executable tracing warnings; no route fails.
- Route preview with 500 background tracks remains below the established 8 ms
  average/p95 budget.
- Browser baseline before the fix showed no committed copper. The same routed
  fixture after the fix shows coral top tracks, blue bottom tracks, via holes,
  zone intent, clear ratsnest lines, and the subdued grid.
- Browser controls successfully selected a 0.75 mm route width and the power
  0.8/0.4 mm padstack without altering existing copper.

## Still intentionally deferred from the master specification

This pass does not mislabel the editor as fully industry-grade. Push-and-shove,
walk-around routing, differential pairs, length tuning, blind/buried/microvias,
arbitrary mechanical outline editing, durable revision/event storage, and
bidirectional sync conflict resolution remain larger phases with acceptance
tests of their own. Their existing seams were preserved rather than replaced
with superficial UI.
