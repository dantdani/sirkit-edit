import { transformPoint } from "../geometry";
import { worldCourtyardBBox } from "../autoplace/geometry";
import type { PcbBoard } from "../types";
import type { PlacementProblem, PlacementTerminalAnchor, PlacementTransform } from "./types";

export function sourcePlacementRecord(problem: PlacementProblem): Record<string, PlacementTransform> {
  return Object.fromEntries(problem.instances.map((instance) => [instance.id, {
    position: { ...instance.sourcePosition },
    rotationDeg: ((((Math.round(instance.sourceRotationDeg / 90) * 90) % 360) + 360) % 360) as 0 | 90 | 180 | 270,
    side: instance.sourceSide,
  }]));
}

export function boardWithPlacement(problem: PlacementProblem, placements: Record<string, PlacementTransform>): PcbBoard {
  const board = structuredClone(problem.board);
  for (const footprint of board.footprints) {
    const placement = placements[footprint.id];
    if (!placement) continue;
    footprint.at = { ...placement.position };
    footprint.rotationDeg = placement.rotationDeg;
    footprint.side = placement.side;
  }
  return board;
}

export function terminalWorldPosition(terminal: PlacementTerminalAnchor, placements: Record<string, PlacementTransform>): { x: number; y: number } {
  const placement = placements[terminal.componentId];
  if (!placement) throw new Error(`Missing placement for terminal component ${terminal.componentId}.`);
  return transformPoint(terminal.localPosition, placement.position, placement.rotationDeg, placement.side === "bottom");
}

export function instanceWorldBounds(problem: PlacementProblem, instanceId: string, placements: Record<string, PlacementTransform>) {
  const instance = problem.instances.find((candidate) => candidate.id === instanceId);
  const placement = placements[instanceId];
  if (!instance || !placement) throw new Error(`Missing placement instance ${instanceId}.`);
  return worldCourtyardBBox(instance.envelopeLocal, placement.position, placement.rotationDeg, placement.side === "bottom");
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}
