"use client";

/**
 * usePcb3d (PCB Stage 15) — board → BuiltScene glue.
 *
 * - Throttles board updates to one rebuild per 100 ms (Stage 11's derived
 *   zone-fill writes arrive on the same commit signal, so pours show up
 *   automatically). NO per-frame board reads — the scene is static between
 *   mutations.
 * - Rebuilds geometry only when the (throttled) board or the palette change;
 *   visibility toggles just flip `Object3D.visible` on the existing scene —
 *   the renderer picks that up per frame with zero React work.
 * - Disposes the previous scene's geometries/materials/textures on every
 *   rebuild and on unmount.
 * - Palette persistence: session-only `useState` (localStorage deferred).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { PcbBoard } from "@/app/lib/pcb/types";
import { buildScene, disposeScene } from "@/app/lib/pcb/3d/build-scene";
import { DEFAULT_PALETTE_ID, PALETTES, type PaletteId } from "@/app/lib/pcb/3d/palette";
import type { BuiltScene, SceneParams } from "@/app/lib/pcb/3d/types";

const REBUILD_THROTTLE_MS = 100;

export interface SceneToggles {
  showMask: boolean;
  showSilk: boolean;
  showSilkTop: boolean;
  showSilkBottom: boolean;
  showZones: boolean;
  showFootprints: boolean;
  showRefdes: boolean;
  showCopper: boolean;
  showVias: boolean;
  showSubstrate: boolean;
}

export interface Pcb3dHandle {
  scene: BuiltScene;
  sceneParams: SceneParams;
  setToggle(key: keyof SceneToggles, value: boolean): void;
  paletteId: PaletteId;
  setPaletteId(id: PaletteId): void;
}

/** [B17-C] The scene follows VIEW state supplied by the caller (the pcb3d view-session bus) when given. */
export interface Pcb3dViewInput { toggles: SceneToggles; paletteId: PaletteId }

export function usePcb3d(board: PcbBoard, view?: Pcb3dViewInput): Pcb3dHandle {
  const [localPaletteId, setPaletteId] = useState<PaletteId>(DEFAULT_PALETTE_ID);
  const [localToggles, setToggles] = useState<SceneToggles>({
    showMask: true,
    showSilk: true,
    showSilkTop: true,
    showSilkBottom: true,
    showZones: true,
    showFootprints: true,
    showRefdes: true,
    showCopper: true,
    showVias: true,
    showSubstrate: true,
  });
  const paletteId = view?.paletteId ?? localPaletteId;
  const toggles = view?.toggles ?? localToggles;

  // Throttle: adopt a new board at most every 100 ms.
  const [displayBoard, setDisplayBoard] = useState(board);
  const lastAdoptRef = useRef(0);
  useEffect(() => {
    if (board === displayBoard) return;
    const wait = Math.max(0, REBUILD_THROTTLE_MS - (Date.now() - lastAdoptRef.current));
    const t = setTimeout(() => {
      lastAdoptRef.current = Date.now();
      setDisplayBoard(board);
    }, wait);
    return () => clearTimeout(t);
  }, [board, displayBoard]);

  // Visibility toggles are baked in at build time (the pinned SceneParams
  // flow); a toggle is a rare user action and a rebuild is tens of ms, far
  // simpler than mutating the scene graph behind React's back.
  const sceneParams: SceneParams = useMemo(
    () => ({ palette: PALETTES[paletteId], ...toggles }),
    [paletteId, toggles],
  );
  const scene = useMemo(() => buildScene(displayBoard, sceneParams), [displayBoard, sceneParams]);
  useEffect(() => () => disposeScene(scene), [scene]);

  return {
    scene,
    sceneParams,
    setToggle: (key, value) => setToggles((t) => ({ ...t, [key]: value })),
    paletteId,
    setPaletteId,
  };
}
