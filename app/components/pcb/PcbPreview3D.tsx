"use client";

/**
 * 3D board preview (PCB Stage 15; [B17-C] driven by the pcb3d VIEW-SESSION
 * bus) — React Three Fiber canvas + overlay controls. Client-only; the whole
 * module (and the three.js dependency graph) is lazy-loaded via
 * `next/dynamic` from PcbEditor, so it never touches the initial bundle.
 *
 * Every control here issues a `pcb3d.*` view command on the bus the editor
 * owns; the scene renders from the bus state (layer visibility, finish,
 * camera preset or focus target). Nothing here is engineering state.
 *
 * Scene space: mm, board in the XY plane, +Z out of the board top, camera
 * `up` = +Z. Orbit to rotate, wheel to zoom, right-drag to pan. Camera
 * presets (Top / Bottom / Iso) and focus targets fly over 300 ms.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import type { PcbBoard } from "@/app/lib/pcb/types";
import { PALETTES, type PaletteId } from "@/app/lib/pcb/3d/palette";
import type { Pcb3dCamera, Pcb3dLayer, Pcb3dViewState } from "@/app/lib/view-session/pcb3d";
import { usePcb3d, type SceneToggles } from "./hooks/usePcb3d";

const PALETTE_LABELS: Record<PaletteId, string> = {
  "green-hasl": "Green · HASL",
  "green-enig": "Green · ENIG",
  "red-hasl": "Red · HASL",
  "blue-enig": "Blue · ENIG",
  "black-enig": "Black · ENIG",
  "purple-enig": "Purple · ENIG",
};

const LAYER_TOGGLES: { layer: Pcb3dLayer; label: string }[] = [
  { layer: "silkTop", label: "Silk top" },
  { layer: "silkBottom", label: "Silk bottom" },
  { layer: "mask", label: "Mask" },
  { layer: "copper", label: "Copper" },
  { layer: "zones", label: "Zones" },
  { layer: "vias", label: "Vias" },
  { layer: "footprints", label: "Parts" },
  { layer: "refdes", label: "Refdes" },
  { layer: "substrate", label: "Board" },
];

const FLY_MS = 300;

interface Framing {
  center: [number, number, number];
  distance: number;
}

function presetPosition(preset: Pcb3dCamera["preset"], f: Framing): THREE.Vector3 {
  const [cx, cy] = f.center;
  const d = f.distance;
  switch (preset) {
    case "top":
      // Tiny y offset keeps the view direction from being parallel to `up`.
      return new THREE.Vector3(cx, cy - d * 0.02, d);
    case "bottom":
      return new THREE.Vector3(cx, cy - d * 0.02, -d);
    case "iso":
    case "custom":
      return new THREE.Vector3(cx + d * 0.55, cy - d * 0.55, d * 0.65);
  }
}

/** Minimal orbit-controls surface (avoids a direct three-stdlib dependency). */
interface ControlsLike {
  target: THREE.Vector3;
  update(): void;
}

/** Flies the camera to the bus's camera state (preset over the board, or a focus framing) over FLY_MS. */
function CameraRig({ camera: view }: { camera: Pcb3dCamera }) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as unknown as ControlsLike | null;
  const anim = useRef<{ from: THREE.Vector3; to: THREE.Vector3; center: [number, number, number]; start: number } | null>(null);
  const lastSeq = useRef(0);

  useEffect(() => {
    if (view.seq === lastSeq.current) return;
    lastSeq.current = view.seq;
    const framing: Framing = { center: [view.targetMm.x, view.targetMm.y, view.targetMm.z], distance: Math.max(view.distanceMm, 4) };
    anim.current = { from: camera.position.clone(), to: presetPosition(view.preset, framing), center: framing.center, start: performance.now() };
  }, [view, camera]);

  useFrame(() => {
    const a = anim.current;
    if (!a) return;
    const t = Math.min((performance.now() - a.start) / FLY_MS, 1);
    const s = t * t * (3 - 2 * t); // smoothstep
    camera.position.lerpVectors(a.from, a.to, s);
    if (controls) {
      controls.target.set(...a.center);
      controls.update();
    } else {
      camera.lookAt(...a.center);
    }
    if (t >= 1) anim.current = null;
  });

  return null;
}

function togglesFromLayers(layers: Pcb3dViewState["layers"]): SceneToggles {
  return {
    showMask: layers.mask,
    showSilk: layers.silkTop || layers.silkBottom,
    showSilkTop: layers.silkTop,
    showSilkBottom: layers.silkBottom,
    showZones: layers.zones,
    showFootprints: layers.footprints,
    showRefdes: layers.refdes,
    showCopper: layers.copper,
    showVias: layers.vias,
    showSubstrate: layers.substrate,
  };
}

export interface PcbPreview3DProps {
  board: PcbBoard;
  /** The pcb3d view state on the bus. */
  view: Pcb3dViewState;
  /** Issue a pcb3d command (the editor wraps the bus: identity, actor, revision). Resolves to a bounded message on refusal. */
  command: (commandId: string, payload: unknown) => Promise<{ ok: true } | { ok: false; code: string; message: string }>;
}

export function PcbPreview3D({ board, view, command }: PcbPreview3DProps) {
  const toggles = useMemo(() => togglesFromLayers(view.layers), [view.layers]);
  const { scene } = usePcb3d(board, { toggles, paletteId: view.finish });
  const [notice, setNotice] = useState<string | null>(null);
  const [focusDraft, setFocusDraft] = useState("");

  const boardFraming = useMemo<Framing>(() => {
    const b = scene.boardBoundingBoxMm;
    const span = Math.max(b.maxX - b.minX, b.maxY - b.minY, 10);
    return { center: [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, 0], distance: span * 1.25 };
  }, [scene]);

  const initialCamera = useMemo(
    () => presetPosition("iso", boardFraming).toArray() as [number, number, number],
    // Fixed at mount — the bus camera state owns the camera afterwards.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // A camera state with no framing yet (seq 0) frames the whole board.
  const cameraState = useMemo<Pcb3dCamera>(
    () => (view.camera.seq === 0 ? { ...view.camera, targetMm: { x: boardFraming.center[0], y: boardFraming.center[1], z: 0 }, distanceMm: boardFraming.distance } : view.camera),
    [view.camera, boardFraming],
  );

  const issue = async (commandId: string, payload: unknown): Promise<void> => {
    const result = await command(commandId, payload);
    setNotice(result.ok ? null : `${result.code} — ${result.message}`);
  };

  const background = useMemo(() => `#${PALETTES[view.finish].background.toString(16).padStart(6, "0")}`, [view.finish]);

  // Visible-rendering evidence: what the three.js scene graph actually shows (not the bus state).
  const sceneVisibility = useMemo(() => JSON.stringify({
    silkTop: scene.silkTop.visible, silkBottom: scene.silkBottom.visible, mask: scene.mask.visible,
    copper: [...scene.copperMeshesByLayer.values()].every((group) => group.visible), zones: [...scene.copperMeshesByLayer.values()].every((group) => group.children.filter((child) => child.name === "zones").every((child) => child.visible)),
    vias: scene.vias.visible, footprints: scene.footprints.visible, refdes: scene.refdesLabels.visible, substrate: scene.substrate.visible,
  }), [scene]);

  return (
    <div className="relative h-full w-full" style={{ background }} data-testid="pcb3d-panel" data-view={JSON.stringify({ open: view.open, camera: { preset: view.camera.preset, target: view.camera.targetMm, seq: view.camera.seq }, focus: view.focus ? { kind: view.focus.kind, ...(view.focus.kind === "component" ? { ref: view.focus.ref } : view.focus.kind === "net" ? { name: view.focus.name } : { count: view.focus.refs.length }) } : null, layers: view.layers, finish: view.finish })} data-scene={sceneVisibility}>
      <Canvas
        camera={{ position: initialCamera, fov: 40, up: [0, 0, 1], near: 0.1, far: 5000 }}
        dpr={[1, 2]}
      >
        <ambientLight intensity={0.65} />
        <directionalLight position={[80, -120, 160]} intensity={1.1} />
        <directionalLight position={[-60, 80, -120]} intensity={0.35} />
        <OrbitControls
          makeDefault
          enableDamping
          dampingFactor={0.1}
          minDistance={2}
          maxDistance={1000}
          target={boardFraming.center}
        />
        <CameraRig camera={cameraState} />
        <primitive object={scene.substrate} />
        {[...scene.copperMeshesByLayer.entries()].map(([layer, obj]) => (
          <primitive key={layer} object={obj} />
        ))}
        <primitive object={scene.vias} />
        <primitive object={scene.mask} />
        <primitive object={scene.silkTop} />
        <primitive object={scene.silkBottom} />
        <primitive object={scene.footprints} />
        <primitive object={scene.refdesLabels} />
      </Canvas>

      {/* Overlay controls — every one issues a pcb3d view command */}
      <div className="absolute top-2 left-2 flex flex-col gap-1.5 text-xs select-none">
        <select
          aria-label="Board finish"
          data-testid="pcb3d-finish"
          value={view.finish}
          onChange={(e) => void issue("pcb3d.set-finish", { finish: e.target.value })}
          className="bg-zinc-900/90 border border-zinc-700 rounded px-1.5 py-1 text-zinc-200 focus:outline-none focus:border-teal-600"
        >
          {(Object.keys(PALETTES) as PaletteId[]).map((id) => (
            <option key={id} value={id}>
              {PALETTE_LABELS[id]}
            </option>
          ))}
        </select>
        <div className="flex flex-wrap gap-1 max-w-[260px]">
          {LAYER_TOGGLES.map(({ layer, label }) => {
            const on = view.layers[layer];
            return (
              <button
                key={layer}
                type="button"
                aria-label={`${on ? "Hide" : "Show"} ${label.toLowerCase()}`}
                aria-pressed={on}
                data-testid={`pcb3d-layer-${layer}`}
                onClick={() => void issue("pcb3d.set-layer-visible", { layer, visible: !on })}
                className={`px-1.5 py-0.5 rounded border transition-colors ${
                  on
                    ? "border-teal-700 bg-teal-500/15 text-teal-300"
                    : "border-zinc-700 bg-zinc-900/90 text-zinc-500 hover:text-zinc-300"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
        <div className="flex gap-1">
          {(["top", "iso", "bottom"] as const).map((p) => (
            <button
              key={p}
              type="button"
              aria-label={`Camera preset ${p}`}
              data-testid={`pcb3d-preset-${p}`}
              onClick={() => void issue("pcb3d.camera-preset", { preset: p })}
              className={`px-1.5 py-0.5 rounded border bg-zinc-900/90 transition-colors capitalize ${view.camera.preset === p ? "border-teal-700 text-teal-300" : "border-zinc-700 text-zinc-300 hover:text-teal-300 hover:border-teal-700"}`}
            >
              {p}
            </button>
          ))}
          <button type="button" aria-label="Fit board" data-testid="pcb3d-fit" onClick={() => void issue("pcb3d.fit-board", null)} className="px-1.5 py-0.5 rounded border border-zinc-700 bg-zinc-900/90 text-zinc-300 hover:text-teal-300 hover:border-teal-700 transition-colors">Fit</button>
          <button type="button" aria-label="Reset camera" data-testid="pcb3d-reset" onClick={() => void issue("pcb3d.reset-camera", null)} className="px-1.5 py-0.5 rounded border border-zinc-700 bg-zinc-900/90 text-zinc-300 hover:text-teal-300 hover:border-teal-700 transition-colors">Reset</button>
        </div>
        <form
          className="flex gap-1"
          onSubmit={(e) => { e.preventDefault(); if (focusDraft.trim()) void issue("pcb3d.focus-component", { ref: focusDraft.trim() }); }}
        >
          <input
            aria-label="Focus component (reference designator)"
            data-testid="pcb3d-focus-input"
            value={focusDraft}
            onChange={(e) => setFocusDraft(e.target.value)}
            placeholder="Focus J1…"
            className="w-24 bg-zinc-900/90 border border-zinc-700 rounded px-1.5 py-0.5 text-zinc-200 focus:outline-none focus:border-teal-600"
          />
          <button type="submit" aria-label="Focus component" data-testid="pcb3d-focus" className="px-1.5 py-0.5 rounded border border-zinc-700 bg-zinc-900/90 text-zinc-300 hover:text-teal-300 hover:border-teal-700 transition-colors">Focus</button>
        </form>
        {view.focus && (
          <div className="text-[10px] text-teal-200/90" data-testid="pcb3d-focus-state">
            focus: {view.focus.kind === "component" ? view.focus.ref : view.focus.kind === "net" ? `net ${view.focus.name}` : `${view.focus.refs.length} selected`}
          </div>
        )}
        {notice && (
          <div className="max-w-[260px] rounded border border-amber-500/40 bg-zinc-900/95 px-2 py-1 text-[10px] text-amber-200" data-testid="pcb3d-notice">{notice}</div>
        )}
      </div>
    </div>
  );
}
