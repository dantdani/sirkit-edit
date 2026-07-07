"use client";

/**
 * Pixi lifecycle wrapper (PCB Stage 3). Owns exactly one PcbScene per React
 * mount: creates it, mounts it into the ref'd div, and destroys it on unmount.
 * React 19 StrictMode double-mounts are safe — each cycle gets a fresh scene,
 * and a destroy() racing a pending mount() is handled inside the scene.
 *
 * Raw Pixi in a ref'd div by design — react-pixi wrapper libs lag Pixi majors.
 */

import { useEffect, useRef } from "react";
import { createPcbScene, type PcbScene } from "@/app/lib/pcb/render/scene";

export function PcbCanvas({
  onReady,
}: {
  /** Fires with the mounted scene; fires with null when it is torn down. */
  onReady: (scene: PcbScene | null) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const scene = createPcbScene();
    let cancelled = false;
    void scene.mount(el).then(() => {
      if (!cancelled) onReady(scene);
    });
    return () => {
      cancelled = true;
      onReady(null);
      scene.destroy();
    };
  }, [onReady]);

  return <div ref={hostRef} className="absolute inset-0 overflow-hidden" />;
}
