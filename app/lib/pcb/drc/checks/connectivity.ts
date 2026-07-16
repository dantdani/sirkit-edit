// Unconnected copper (#10) + shorts (#10) — PCB Stage 12. Pure read of Stage 6's
// BoardConnectivity: `.orphans` → unconnected warnings, `.shorts` → short errors.

import type { PcbBoard } from "../../types";
import type { LayerId } from "../../layers";
import type { CopperItemRef } from "../../connectivity-board";
import type { DrcCheckContext, DrcViolation } from "../types";
import { refKey, refLocation, violationId } from "../format";

function refWord(ref: CopperItemRef): string {
  if (ref.kind === "zone-region") return "zone"; // Stage 11
  return ref.kind === "pad" ? "pad" : ref.kind === "via" ? "via" : "trace";
}

function refNet(board: PcbBoard, ref: CopperItemRef): number {
  if (ref.kind === "track") return board.tracks.find((t) => t.id === ref.id)?.netId ?? 0;
  if (ref.kind === "via") return board.vias.find((v) => v.id === ref.id)?.netId ?? 0;
  if (ref.kind === "zone-region") return board.zones.find((z) => z.id === ref.zoneId)?.netId ?? 0; // Stage 11
  return board.footprints.find((f) => f.id === ref.instanceId)?.padNets[ref.padNumber] ?? 0;
}

function refLayer(board: PcbBoard, ref: CopperItemRef): LayerId | undefined {
  if (ref.kind === "track") return board.tracks.find((t) => t.id === ref.id)?.layer;
  if (ref.kind === "via") return board.vias.find((v) => v.id === ref.id)?.layers[0];
  if (ref.kind === "zone-region") return board.zones.find((z) => z.id === ref.zoneId)?.layer; // Stage 11
  return undefined;
}

function netName(board: PcbBoard, netId: number): string {
  const name = board.nets.find((n) => n.id === netId)?.name;
  return name && name.trim() ? name : `net ${netId}`;
}

export function checkUnconnectedAndShorts(ctx: DrcCheckContext): DrcViolation[] {
  const { board, connectivity } = ctx;
  const out: DrcViolation[] = [];

  for (const net of connectivity.nets.values()) {
    if (net.complete) continue;
    const airwires = connectivity.airwires.filter((wire) => wire.netId === net.netId);
    const remaining = Math.max(airwires.length, net.clusters.length - 1, 1);
    const firstWire = airwires[0];
    const firstRef = net.clusters.flat().find((ref) => ref.kind === "pad") ?? net.clusters.flat()[0];
    const location = firstWire
      ? { x: Math.round((firstWire.from.x + firstWire.to.x) / 2), y: Math.round((firstWire.from.y + firstWire.to.y) / 2) }
      : firstRef
        ? refLocation(board, firstRef)
        : { x: 0, y: 0 };
    const padRefs = net.clusters
      .flat()
      .filter((ref): ref is Extract<CopperItemRef, { kind: "pad" }> => ref.kind === "pad")
      .map((ref) => {
        const footprint = board.footprints.find((item) => item.id === ref.instanceId);
        return `${footprint?.ref ?? ref.instanceId}.${ref.padNumber}`;
      });
    out.push({
      id: violationId("incompleteNet", firstRef ? [firstRef] : [], remaining, 0, String(net.netId)),
      kind: "incompleteNet",
      severity: "error",
      items: firstRef ? [firstRef] : [],
      location,
      measuredNm: remaining,
      thresholdNm: 0,
      summary: `${netName(board, net.netId)} is incomplete: ${remaining} connection${remaining === 1 ? "" : "s"} remain.`,
      detail: `${netName(board, net.netId)} still has ${net.clusters.length} disconnected copper groups${padRefs.length > 0 ? ` across ${padRefs.join(", ")}` : ""}. Finish the highlighted airwire connections before manufacturing.`,
    });
  }

  for (const [a, b] of connectivity.shorts) {
    const items = [a, b];
    const na = netName(board, refNet(board, a));
    const nb = netName(board, refNet(board, b));
    out.push({
      id: violationId("short", items, 0, 0, [refKey(a), refKey(b)].sort().join("|")),
      kind: "short",
      severity: "error",
      items,
      layer: refLayer(board, a) ?? refLayer(board, b),
      location: refLocation(board, a),
      measuredNm: 0,
      thresholdNm: 0,
      summary: `Short: ${na} touches ${nb} (${refWord(a)} ↔ ${refWord(b)}).`,
      detail: `Copper on ${na} is touching copper on ${nb}, so the two nets are electrically joined. Reroute one of them or remove the crossing.`,
    });
  }

  for (const ref of connectivity.orphans) {
    const items = [ref];
    const net = refNet(board, ref);
    const where = net === 0 ? "isn't assigned to a net" : `is not connected to the rest of ${netName(board, net)}`;
    out.push({
      id: violationId("unconnected", items, 0, 0, refKey(ref)),
      kind: "unconnected",
      severity: "warning",
      items,
      layer: refLayer(board, ref),
      location: refLocation(board, ref),
      measuredNm: 0,
      thresholdNm: 0,
      summary: `Unconnected ${refWord(ref)} that ${where}.`,
      detail: `This ${refWord(ref)} ${where} and connects to nothing else. It's likely a leftover stub — delete it or route it to its net.`,
    });
  }

  return out;
}
