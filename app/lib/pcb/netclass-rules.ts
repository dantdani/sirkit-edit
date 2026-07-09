/**
 * Deterministic net auto-classifier (PCB Stage 10). Pure. Called by
 * `syncFromSchematic` and after any net-name rename to set each net's BASE
 * class from its name and topology. AI/manual rule deltas layer on top
 * separately via `applyRuleDeltas` — this function never reads deltas, so the
 * two concerns stay cleanly separated (see reclassifyBoard for the full flow).
 */

import type { PcbBoard } from "./types";
import type { BoardConnectivity } from "./connectivity-board";
import type { NetClassAssignment } from "./netclass";
import { ensureNetClassing, layerRuleDeltas, cloneAssignments } from "./netclass";

export interface ClassifyOptions {
  /** Topology heuristics (Stage 6 result). Currently instance count comes from
   *  `padNets` directly; reserved for future cluster-aware rules. */
  connectivity?: BoardConnectivity;
  /** instanceId → (padNumber → schematic pin name), from the netlist. Enables
   *  the IC-power-pin topology heuristic (rule 3). Absent on rename-only calls. */
  pinNames?: Record<string, Record<string, string>>;
}

// Rule 1 — HighCurrent by name.
const HIGH_CURRENT_NAME = /^(MOTOR|PWM|POWER_OUT|LOAD)_/i;
// Rule 2 — Power by exact rail name.
const POWER_RAIL_NAME =
  /^(V(CC|DD|CC|BUS|IN|OUT|BAT)|\+[0-9]+V[0-9]*|-\d+V\d*|3V3|5V|12V|24V|USB_V|LDO_OUT)$/i;
// Rule 2 — Power by contained token.
const POWER_CONTAINS = /PWR|VDD|VCC|SUPPLY/i;
// Rule 2 — ground rails (Power-class in our model: same wide-trace need).
const GROUND_NAME = /^(GND|AGND|DGND|VSS)$/i;
// Rule 3 — an IC power pin (by schematic pin name).
const IC_POWER_PIN = /^V(CC|DD|IN|BUS)/i;
// Topology threshold: a net touching this many distinct instances is a rail.
const TOPOLOGY_MIN_INSTANCES = 5;

function classifyByName(name: string): NetClassAssignment | null {
  if (HIGH_CURRENT_NAME.test(name)) {
    return { classId: "HighCurrent", explanation: `Named ${name} — high-current heuristic` };
  }
  if (POWER_RAIL_NAME.test(name) || POWER_CONTAINS.test(name) || GROUND_NAME.test(name)) {
    return { classId: "Power", explanation: `Named ${name} — matches power-net convention` };
  }
  return null;
}

/**
 * Base class for every net (excluding the reserved net 0). Deterministic.
 * Rules, first match wins: HighCurrent-by-name → Power-by-name → Power-by-
 * topology (≥5 instances AND an IC power pin) → Default.
 */
export function autoClassifyNets(
  board: PcbBoard,
  options?: ClassifyOptions,
): Record<number, NetClassAssignment> {
  const pinNames = options?.pinNames;

  // Distinct instances per net, and whether the net touches an IC power pin.
  const instancesByNet = new Map<number, Set<string>>();
  const powerPinNets = new Set<number>();
  for (const inst of board.footprints) {
    for (const [padNumber, netId] of Object.entries(inst.padNets)) {
      if (netId === 0) continue;
      let set = instancesByNet.get(netId);
      if (!set) instancesByNet.set(netId, (set = new Set()));
      set.add(inst.id);
      const pinName = pinNames?.[inst.id]?.[padNumber];
      if (pinName && IC_POWER_PIN.test(pinName)) powerPinNets.add(netId);
    }
  }

  const out: Record<number, NetClassAssignment> = {};
  for (const net of board.nets) {
    if (net.id === 0) continue;
    const name = net.name ?? "";
    const byName = classifyByName(name);
    if (byName) {
      out[net.id] = byName;
      continue;
    }
    const count = instancesByNet.get(net.id)?.size ?? 0;
    if (count >= TOPOLOGY_MIN_INSTANCES && powerPinNets.has(net.id)) {
      out[net.id] = {
        classId: "Power",
        explanation: `Topology: ${count} instances on the net, includes an IC power pin`,
      };
      continue;
    }
    out[net.id] = { classId: "Default", explanation: "Default (no power/high-current signal detected)" };
  }
  return out;
}

/**
 * Full recompute: reset assignments to the auto-classified base, then re-layer
 * the board's stored rule deltas on top. Use after a net-name rename or resync
 * so name-driven classification and AI/manual deltas both stay correct.
 */
export function reclassifyBoard(board: PcbBoard, options?: ClassifyOptions): void {
  const base = autoClassifyNets(board, options);
  const nc = ensureNetClassing(board);
  nc.base = base; // record the pure base so applyRuleDeltas can reset to it
  nc.assignments = cloneAssignments(base);
  layerRuleDeltas(board, nc.ruleDeltas);
}
