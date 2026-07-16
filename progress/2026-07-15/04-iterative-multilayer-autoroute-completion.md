# Iterative multilayer autoroute completion and truthful failure reporting

Date: 2026-07-15

## Root cause

The DSN/SES layer pipeline could represent multilayer copper, but the autoroute
API launched FreeRouting only once. Any partial SES was imported immediately,
so a result such as 8/37 completed connections had no controlled completion
phase. The UI could report how many connections remained, but it did not name
the exact endpoint pair, explain the blocker, or offer a focused repair target.

## What changed

- Added a provider-independent completion controller with at most five global
  passes, three retries per selected net, and two consecutive no-improvement
  passes before stopping. Effort and engine-pass limits increase within those
  bounds.
- The first pass offers all incomplete nets. Later passes export only unresolved
  nets while preserving every human, imported, legacy, or locked track and via.
  Only generated, unlocked copper on a requested net can be replaced.
- Every SES candidate is rebuilt and independently checked against schematic-pad
  connectivity and DRC. It is accepted only for monotonic progress: no complete
  net may be lost, no short may appear, no new physical DRC error may appear,
  and route-blocking DRC cannot regress.
- The best accepted candidate is applied atomically as one autoroute history
  transaction. Cancellation now terminates the Java child process, and a stale
  browser result cannot overwrite a board edited while routing was running.
- Partial is a terminal, truthful status rather than success. Each remaining
  airwire includes net, source/destination reference and pad, midpoint, measured
  pad-access/congestion/layer/DRC blockers, and suggested repair. Clicking it
  focuses and highlights the affected area.
- Added backend CAD tools for connectivity verification, routeability analysis,
  full/selected autoroute, generated-copper rip-up, local placement optimization,
  and zone refill. OpenAI and Anthropic receive the same schemas; neither needs
  to click the browser DOM.

## Safety invariants

- Existing manual and locked copper survives every pass and AI preview.
- No provider can bypass DSN preflight, strict SES parsing, connectivity, DRC,
  stale-revision, preview, or one-transaction apply gates.
- Failure never silently switches engines, mutates the board, or claims complete
  unless completed connections equal required connections.
- Secrets and local runtime artifacts remain ignored and are not project data.

## Verification

- Full repository suite: 545 passed and 9 skipped. TypeScript, the task-specific
  ESLint set, and the optimized Next.js production build passed.
- Completion/API focused suite: 12/12 passed, including bounded no-improvement,
  exact endpoint failures, selected-net retries, protected completed nets, and
  rejection of a connectivity-improving candidate that adds a DRC error.
- Forced two-layer model test: both copper layers, two through vias, complete
  connectivity, zero shorts, and zero DRC errors.
- Real FreeRouting 2.2.4 two-layer fixture: 2/2 connections, six tracks, two
  vias, top and bottom copper used, zero DRC errors, 2.9 seconds. Re-run with
  `npm run pcb:verify-two-layer-vias`.
- Real FreeRouting 2.2.4 four-layer fixture: 2/2 connections with one 30 mm
  route on Inner 1 and one 30 mm route on Inner 2. Re-run with
  `npm run pcb:verify-multilayer`.

## Deliberate boundary

Sirkit does not invent a geometric repair when FreeRouting proves that no legal
path exists. It stops after the bounded attempts, preserves the best board, and
reports the specific airwire and blockers so placement/rules/copper changes are
explicit, previewable, and undoable.
