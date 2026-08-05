// Throwaway (Stage 16 perf sweep): measure the assertion budgets from prior
// stages on the demo fixtures. Delete after recording in the progress note.
import { buildRoutedDemo } from "../app/lib/pcb/demo/routed-demo";
import { buildStoryDemo } from "../app/lib/pcb/demo/story-demo";
import { runDrc } from "../app/lib/pcb/drc/run-drc";
import { getPreset } from "../app/lib/pcb/drc/presets";
import { computeFill } from "../app/lib/pcb/zones/compute-fill";
import { makeEffectiveClearance } from "../app/lib/pcb/zones/types";
import { makePlaneZone } from "../app/lib/pcb/zones/plane";
import { autoPlace } from "../app/lib/pcb/autoplace/auto-place";
import { buildScene, disposeScene } from "../app/lib/pcb/3d/build-scene";
import { PALETTES, DEFAULT_PALETTE_ID } from "../app/lib/pcb/3d/palette";
import { buildFabBundle } from "../app/lib/pcb/fab/build-bundle";
import { getFabPreset } from "../app/lib/pcb/fab/presets";
import { createEmptyBoard } from "../app/lib/pcb/types";

function timeIt(label: string, budgetMs: number | null, fn: () => void): void {
  // Warm once, then take the best of 3 (JIT noise).
  fn();
  let best = Infinity;
  for (let i = 0; i < 3; i++) {
    const t0 = performance.now();
    fn();
    best = Math.min(best, performance.now() - t0);
  }
  const budget = budgetMs ? ` (budget ${budgetMs} ms${best > budgetMs * 0.8 ? " — WITHIN 20% OF BUDGET" : ""})` : "";
  console.log(`${label}: ${best.toFixed(1)} ms${budget}`);
}

async function main(): Promise<void> {
  const routed = buildRoutedDemo();
  const story = buildStoryDemo();
  const rules = getPreset("jlcpcb-2l").rules;

  timeIt("DRC (routed demo, jlcpcb-2l)", 200, () => void runDrc(routed, rules));

  const plane = makePlaneZone(routed, "copperTop", 1);
  timeIt("Zone fill (full-board GND plane)", 300, () =>
    void computeFill({ board: routed, zone: plane, effectiveClearance: makeEffectiveClearance(routed, plane) }),
  );

  timeIt("Auto-place (story fixture, 16 parts)", 500, () => void autoPlace(story, null));

  timeIt("3D scene build (routed demo)", null, () => {
    const scene = buildScene(routed, {
      palette: PALETTES[DEFAULT_PALETTE_ID],
      showMask: true,
      showSilk: true,
      showZones: true,
      showFootprints: true,
      showRefdes: true,
    });
    disposeScene(scene);
  });

  if (process.env.KICAD_CLI) {
    const t0 = performance.now();
    const result = await buildFabBundle(
      {
        board: createEmptyBoard(),
        netlist: { components: [], nets: [] },
        fabPreset: getFabPreset("jlcpcb-2l"),
        drcPreset: getPreset("jlcpcb-2l"),
        boardName: "perf-demo",
      },
      { cliPath: process.env.KICAD_CLI },
    );
    const ms = performance.now() - t0;
    console.log(`Fab bundle (real kicad-cli): ${ms.toFixed(0)} ms (budget 8000 ms) — ${result.stats.totalBytes} bytes`);
  } else {
    console.log("Fab bundle: skipped (KICAD_CLI not set)");
  }

  console.log(
    process.env.FREEROUTING_JAR
      ? "Autoroute: measure in-app (subprocess)"
      : "Autoroute: skipped (FREEROUTING_JAR not set in this environment)",
  );
}

void main();
