# B17-C — PCB 3D semantic control proof

Labels: CONFIRMED = executed and measured on this machine; INFERRED = derived from code reading; PROPOSED = designed, not exercised; RECORDED = written down without a claim.

## What changed (CONFIRMED)

`PcbPreview3D` no longer owns its camera, layer toggles or finish. The PCB editor creates ONE `pcb3d` view session per mount (`app/components/pcb/hooks/usePcb3dViewSession.ts`: a `ViewSessionBus` with identity `{ sessionId (fresh per tab mount), projectId, branchId, editor: "pcb3d" }`, retired when the editor unmounts) and every entry point issues the same `pcb3d.*` command through it:

| entry point | command |
|---|---|
| toolbar "3D preview", palette "Toggle 3D preview", Ctrl+3 | `pcb3d.open` / `pcb3d.close` |
| Escape while open, the panel's close button | `pcb3d.close` |
| overlay presets Top / Iso / Bottom | `pcb3d.camera-preset { preset }` |
| Fit, Reset | `pcb3d.fit-board`, `pcb3d.reset-camera` |
| Focus input + Focus | `pcb3d.focus-component { ref }` |
| layer buttons (Silk top, Silk bottom, Mask, Copper, Zones, Vias, Parts, Refdes, Board) | `pcb3d.set-layer-visible { layer, visible }` |
| finish select | `pcb3d.set-finish { finish }` (the only persisted preference: `localStorage sirkit.workspace.pcb3d.finish`) |
| (tools, B17-F) | `pcb3d.focus-selection { refs }`, `pcb3d.focus-net { netId | name }`, `pcb3d.toggle-layer { layer }` (relative → refuses a stale view), `pcb3d.read-state` |

The command set (`app/lib/view-session/pcb3d.ts`) is pure: a geometry probe over the CURRENT board answers focus questions in scene millimetres (footprint body bounds via `refBBox`, net bounds from pads/tracks/vias on the net); when it cannot answer, the command settles as `VS_UNAVAILABLE` ("model/geometry unavailable: …") — never a pretend focus. Camera state is a preset (or `custom` after a focus) plus a target and framing distance with a sequence number the renderer flies to; a preset after a focus keeps the focus framing; fit/reset clear it. Top and bottom silkscreen are independent scene layers (`SceneParams.showSilkTop/showSilkBottom`; copper, vias and substrate visibility added to the scene builder). Finish never claims a stackup change (the state contains no stackup).

## Tests (CONFIRMED)

- `app/lib/view-session/__tests__/b17-c-pcb3d-commands.test.ts` — 6 cases on a real board: registration + open/close/read-state; presets/fit/reset and the no-board refusal; focus by refdes/id, selection and net with exact framing numbers, unknown targets unavailable, preset-after-focus semantics; every layer independently (silk top/bottom), set-visible rebases, toggle refuses stale; finish is the only persisted preference; the acceptance phrase settles with the exact final state (`open: true, layers.silkTop: false, layers.silkBottom: true, focus J1, camera iso`, view revision 4).
- `b17-b-view-session-bus.test.ts` (12) covers the bus semantics the commands rely on.
- `app/components/pcb/__tests__/pcb3d-view-session.test.tsx` (2) — the editor hook under React StrictMode (see the defects below).
- Static: tsc 0; eslint 0 on the change set (`react-hooks/purity` at `PcbEditor.tsx:1320` is pre-existing in `82ecbf8`). Escape and Ctrl+3 reach the bus through the editor's global-actions ref (`close3d` / `toggle3d`) so the window keydown listener is bound once.

## Browser proof (CONFIRMED — `e2e/pcb-3d-semantic.spec.ts`, since B17-D the first serial scenario of `e2e/semantic-editor.spec.ts`)

Run 3 on 2026-09-09 23:03 local (`pnpm exec playwright test e2e/pcb-3d-semantic.spec.ts`; Chromium 1243 against `next dev` on port 3100 under the fixture runtime; `retries: 0`): **1 passed in 24.3 s** (the test itself 19.0 s). Runs 1 and 2 failed and each exposed a real defect (next section); nothing was retried away.

- Journey: the shared `e2e/fixture-journey.ts` bootstraps the synchronized blinker board (prompt → approve → request review → reviewer approves → editor sync → apply → `awaiting_qualification`, frozen clock, deterministic ids), then the toolbar's "3D preview" button issues `pcb3d.open`. The panel root reports the bus state as `data-view` and the three.js scene graph's visibility flags as `data-scene`, so the proof reads both the semantic state and the rendered scene, not one or the other.
- Assertions, in order: open `true` with `silkTop`/`silkBottom` `true` in the bus AND the scene → click "Silk top" → bus `silkTop:false, silkBottom:true`; scene `silkTop:false, silkBottom:true`; the buttons' `aria-pressed` false/true → type `J1`, Focus → bus focus `{ kind: "component", ref: "J1" }`, the panel shows `focus: J1`, camera preset becomes `custom` → Iso → preset `iso` with the camera sequence advanced by exactly one (a flight happened) and the FINAL state `{ open: true, layers: { silkTop: false, silkBottom: true, mask: true, copper: true }, focus: J1, camera: iso }`; scene `silkTop:false, silkBottom:true, copper:true, footprints:true`; zero refusal notices → type `U9`, Focus → the notice reads `VS_UNAVAILABLE — model/geometry unavailable: component U9 is not on the board` and the focus is still J1 (a bounded refusal, never a pretend focus) → screenshot `evidence/pcb-3d-acceptance.png` (the open sheet with "Silk top" released, `focus: J1`, the U9 refusal, the wrapped toolbar).

## Defects the proof found (CONFIRMED, fixed in this checkpoint)

1. **Unreachable toolbar controls (run 1).** At the 1280×720 viewport the PCB toolbar's right-hand controls (3D preview, layer panel, shortcuts) painted underneath the right inspector column, so the click was intercepted for the full five-minute budget. A control that cannot be reached is a silent control (the B17-A target), and the source-level inventory cannot see it. Fix: the toolbar wraps inside its own column (`flex-wrap min-w-0` in `PcbToolbar.tsx`).
2. **StrictMode retired the view session before first use (run 2).** `usePcb3dViewSession` retired its bus in the effect cleanup. React StrictMode — on in development, where every browser proof runs — executes that cleanup once at mount and re-mounts with the SAME state, so the kept bus was already `editor-closed`; the toolbar's `pcb3d.open` was refused `VS_SESSION_RETIRED`, and because the toolbar discards command results nothing was shown: the sheet simply never opened. Fix (`usePcb3dViewSession.ts`): the editor-side session owner replaces a bus that was retired before the editor is live — retirement stays final on the bus (the B17-B contract is unchanged); the hook just never keeps a retired bus for a live editor — and the owner is itself the store React subscribes to, so a replacement notifies the same subscribers. Regression test `app/components/pcb/__tests__/pcb3d-view-session.test.tsx` (under `StrictMode`: the first toggle opens the view, a real unmount retires the session, an unknown component refuses `VS_UNAVAILABLE`): fails against the previous hook (the view stays closed; the refusal is `VS_SESSION_RETIRED`), passes now, and runs in the CI `prompt-to-gerber` list. Same trap class as B16-C.5's disposed lifecycle owners.

## Observation (RECORDED)

Run 1's dev server logged `Error: aborted { code: 'ECONNRESET' }` as `uncaughtException` three times right after the physical-binding POSTs and immediately before the reviewer reload — the browser's navigation aborted in-flight requests; the server kept serving and the journey continued. Runs 2 and 3 did not log it. Not a functional failure of the flow; kept on the B17 validation watch list for CI logs.

## Bounded (RECORDED)

- Focus geometry is the footprint's body bounds / the net's copper bounds on the 2D board; no 3D model bounds (placeholders only) — the "model/geometry unavailable" result covers refdes not on the board, empty selections, nets without copper and no board.
- The camera flight is rendered by the React Three Fiber rig from the bus state; the browser proof verifies the bus state and the scene graph's visibility flags plus a screenshot, not pixel geometry.
- Keyboard: Ctrl+3 and Escape go through the same commands; orbit/zoom/pan by mouse remain OrbitControls interaction (camera preset becomes stale as `custom` only after a bus focus — a manual orbit is not reported to the bus; PROPOSED for B17-D's canvas parity).
