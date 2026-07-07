"use client";

/**
 * On-screen perf HUD (PCB Stage 3) — bottom-left, monospace, zinc-500.
 * Reads scene.stats() twice a second: primitive count, rolling-window average
 * fps, and the worst 60-frame window over the last 10 s. This is the
 * measurement instrument for the Stage 3 perf gate (≥55 fps at ≥10k
 * primitives during continuous pan/zoom).
 */

import { useEffect, useState } from "react";
import type { PcbScene } from "@/app/lib/pcb/render/scene";

export function DebugHud({ scene }: { scene: PcbScene | null }) {
  const [stats, setStats] = useState({ primitives: 0, fpsAvg: 0, fpsMin: 0 });

  useEffect(() => {
    if (!scene) return;
    const id = setInterval(() => setStats(scene.stats()), 500);
    return () => clearInterval(id);
  }, [scene]);

  return (
    <div className="absolute bottom-2 left-2 z-10 pointer-events-none select-none font-mono text-[11px] leading-4 text-zinc-500">
      <div>primitives {stats.primitives.toLocaleString()}</div>
      <div>fpsAvg {stats.fpsAvg.toFixed(1)}</div>
      <div>fpsMin {stats.fpsMin.toFixed(1)}</div>
    </div>
  );
}
