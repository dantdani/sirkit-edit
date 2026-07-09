"use client";

/**
 * 3D board preview (PCB Stage 15) — React Three Fiber canvas + overlay
 * controls. Client-only; the whole module (and the three.js dependency
 * graph) is lazy-loaded via `next/dynamic` from PcbEditor, so it never
 * touches the initial bundle.
 *
 * Scene space: mm, board in the XY plane, +Z out of the board top, camera
 * `up` = +Z. Orbit to rotate, wheel to zoom, right-drag to pan. Camera
 * presets (Top / Bottom / Iso) fly over 300 ms.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import type { PcbBoard } from "@/app/lib/pcb/types";
import { PALETTES, type PaletteId } from "@/app/lib/pcb/3d/palette";
import { usePcb3d, type SceneToggles } from "./hooks/usePcb3d";

const PALETTE_LABELS: Record<PaletteId, string> = {
  "green-hasl": "Green · HASL",
  "green-enig": "Green · ENIG",
  "red-hasl": "Red · HASL",
  "blue-enig": "Blue · ENIG",
  "black-enig": "Black · ENIG",
  "purple-enig": "Purple · ENIG",
};

const TOGGLES: { key: keyof SceneToggles; label: string }[] = [
  { key: "showMask", label: "Mask" },
  { key: "showSilk", label: "Silk" },
  { key: "showZones", label: "Zones" },
  { key: "showFootprints", label: "Parts" },
  { key: "showRefdes", label: "Refdes" },
];

type PresetId = "top" | "bottom" | "iso";
interface PresetRequest {
  preset: PresetId;
  seq: number;
}

const FLY_MS = 300;

interface Framing {
  center: [number, number, number];
  distance: number;
}

function presetPosition(preset: PresetId, f: Framing): THREE.Vector3 {
  const [cx, cy] = f.center;
  const d = f.distance;
  switch (preset) {
    case "top":
      // Tiny y offset keeps the view direction from being parallel to `up`.
      return new THREE.Vector3(cx, cy - d * 0.02, d);
    case "bottom":
      return new THREE.Vector3(cx, cy - d * 0.02, -d);
    case "iso":
      return new THREE.Vector3(cx + d * 0.55, cy - d * 0.55, d * 0.65);
  }
}

/** Minimal orbit-controls surface (avoids a direct three-stdlib dependency). */
interface ControlsLike {
  target: THREE.Vector3;
  update(): void;
}

/** Flies the camera to a requested preset over FLY_MS (smoothstep lerp). */
function CameraRig({ framing, request }: { framing: Framing; request: PresetRequest | null }) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as unknown as ControlsLike | null;
  const anim = useRef<{ from: THREE.Vector3; to: THREE.Vector3; start: number } | null>(null);
  const lastSeq = useRef(0);

  useEffect(() => {
    if (!request || request.seq === lastSeq.current) return;
    lastSeq.current = request.seq;
    anim.current = {
      from: camera.position.clone(),
      to: presetPosition(request.preset, framing),
      start: performance.now(),
    };
  }, [request, camera, framing]);

  useFrame(() => {
    const a = anim.current;
    if (!a) return;
    const t = Math.min((performance.now() - a.start) / FLY_MS, 1);
    const s = t * t * (3 - 2 * t); // smoothstep
    camera.position.lerpVectors(a.from, a.to, s);
    if (controls) {
      controls.target.set(...framing.center);
      controls.update();
    } else {
      camera.lookAt(...framing.center);
    }
    if (t >= 1) anim.current = null;
  });

  return null;
}

export function PcbPreview3D({ board }: { board: PcbBoard }) {
  const { scene, sceneParams, setToggle, paletteId, setPaletteId } = usePcb3d(board);
  const [preset, setPreset] = useState<PresetRequest | null>(null);

  const framing = useMemo<Framing>(() => {
    const b = scene.boardBoundingBoxMm;
    const span = Math.max(b.maxX - b.minX, b.maxY - b.minY, 10);
    return {
      center: [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, 0],
      distance: span * 1.25,
    };
  }, [scene]);

  const initialCamera = useMemo(
    () => presetPosition("iso", framing).toArray() as [number, number, number],
    // Fixed at mount — presets/orbit own the camera afterwards.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const requestPreset = (p: PresetId): void =>
    setPreset((prev) => ({ preset: p, seq: (prev?.seq ?? 0) + 1 }));

  const background = useMemo(
    () => `#${PALETTES[paletteId].background.toString(16).padStart(6, "0")}`,
    [paletteId],
  );

  return (
    <div className="relative h-full w-full" style={{ background }}>
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
          minDistance={10}
          maxDistance={1000}
          target={framing.center}
        />
        <CameraRig framing={framing} request={preset} />
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

      {/* Overlay controls */}
      <div className="absolute top-2 left-2 flex flex-col gap-1.5 text-xs select-none">
        <select
          aria-label="Board finish"
          value={paletteId}
          onChange={(e) => setPaletteId(e.target.value as PaletteId)}
          className="bg-zinc-900/90 border border-zinc-700 rounded px-1.5 py-1 text-zinc-200 focus:outline-none focus:border-teal-600"
        >
          {(Object.keys(PALETTES) as PaletteId[]).map((id) => (
            <option key={id} value={id}>
              {PALETTE_LABELS[id]}
            </option>
          ))}
        </select>
        <div className="flex flex-wrap gap-1">
          {TOGGLES.map(({ key, label }) => {
            const on = sceneParams[key];
            return (
              <button
                key={key}
                type="button"
                onClick={() => setToggle(key, !on)}
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
              onClick={() => requestPreset(p)}
              className="px-1.5 py-0.5 rounded border border-zinc-700 bg-zinc-900/90 text-zinc-300 hover:text-teal-300 hover:border-teal-700 transition-colors capitalize"
            >
              {p}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
