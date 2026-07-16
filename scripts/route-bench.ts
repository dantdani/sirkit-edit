import { performance } from "node:perf_hooks";
import type { PcbBoard, Track } from "../app/lib/pcb/types";
import { createEmptyBoard } from "../app/lib/pcb/types";
import { mmToNm } from "../app/lib/pcb/units";
import { buildSmartRoutingDemo } from "../app/lib/pcb/demo/smart-routing-demo";
import { adaptBoardToRoutingWorld } from "../app/lib/pcb/smart-routing/world";
import { resolveSmartRoutingRules } from "../app/lib/pcb/smart-routing/rules";
import { routeSmart } from "../app/lib/pcb/smart-routing/engine";
import type { SmartRouteIntent } from "../app/lib/pcb/smart-routing/types";

const P = (x: number, y: number) => ({ x: mmToNm(x), y: mmToNm(y) });

function denseDirectBoard(): PcbBoard {
  const tracks: Track[] = [];
  for (let index = 0; index < 500; index++) {
    const x = 5 + (index % 25) * 3.5;
    const y = 40 + Math.floor(index / 25) * 1.5;
    tracks.push({
      id: `bench-${index}`,
      layer: "copperTop",
      width: mmToNm(0.2),
      start: P(x, y),
      end: P(x + 1, y),
      netId: 2,
    });
  }
  return {
    ...createEmptyBoard(),
    nets: [{ id: 0, name: "" }, { id: 1, name: "BENCH" }, { id: 2, name: "BACKGROUND" }],
    tracks,
  };
}

function benchmark(board: PcbBoard, intent: SmartRouteIntent, iterations: number): number[] {
  const world = adaptBoardToRoutingWorld(board);
  const rules = resolveSmartRoutingRules(board, intent.netId, intent.layer);
  for (let warmup = 0; warmup < 20; warmup++) routeSmart(world, intent, rules);
  const samples: number[] = [];
  for (let index = 0; index < iterations; index++) {
    const started = performance.now();
    routeSmart(world, intent, rules);
    samples.push(performance.now() - started);
  }
  return samples.sort((a, b) => a - b);
}

function percentile(samples: readonly number[], fraction: number): number {
  return samples[Math.min(samples.length - 1, Math.floor(samples.length * fraction))];
}

const directIntent: SmartRouteIntent = {
  schemaVersion: 1,
  netId: 1,
  layer: "copperTop",
  start: P(5, 5),
  end: P(90, 5),
  movementPolicy: "keep-existing-copper-fixed",
  maxCandidates: 4,
};
const walkIntent: SmartRouteIntent = {
  ...directIntent,
  start: P(20, 30),
  end: P(60, 30),
};

const direct = benchmark(denseDirectBoard(), directIntent, 300);
const walk = benchmark(buildSmartRoutingDemo(), walkIntent, 300);
const report = {
  schemaVersion: 1,
  units: "milliseconds",
  direct500Tracks: {
    p50: percentile(direct, 0.5),
    p95: percentile(direct, 0.95),
    max: direct[direct.length - 1],
    target: "p50 < 16 ms",
  },
  walkAroundSingleBlocker: {
    p50: percentile(walk, 0.5),
    p95: percentile(walk, 0.95),
    max: walk[walk.length - 1],
    target: "p95 < 50 ms",
  },
};

console.log(JSON.stringify(report, null, 2));
if (report.direct500Tracks.p50 >= 16) throw new Error("RouteBench: direct-route p50 budget exceeded.");
if (report.walkAroundSingleBlocker.p95 >= 50) throw new Error("RouteBench: walk-around p95 budget exceeded.");
