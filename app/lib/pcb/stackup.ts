import type { PcbBoard } from "./types";
import { LAYERS, type LayerId } from "./layers";

export type CopperLayerRole = "signal" | "plane" | "mixed";
export type PreferredDirection = "horizontal" | "vertical" | "any";
export type StackupProfileId = "simple-2" | "signal-plane-4" | "all-signal-4" | "dense-4";

export interface CopperLayer {
  id: Extract<LayerId, "copperTop" | "in1" | "in2" | "copperBottom">;
  name: "F.Cu" | "In1.Cu" | "In2.Cu" | "B.Cu";
  order: number;
  enabled: boolean;
  role: CopperLayerRole;
  autorouteEnabled: boolean;
  preferredDirection: PreferredDirection;
  planeNetId?: number;
  defaultTraceWidthMm?: number;
}

export interface BoardStackup {
  profileId: StackupProfileId;
  copperLayers: CopperLayer[];
  boardThicknessMm: number;
  routing: {
    viasAllowed: boolean;
    fanout: boolean;
    postroute: boolean;
    viaCost: number;
    planeViaCost: number;
    startRipupCost: number;
  };
}

export interface RoutingLayerMapping {
  sirkitLayerId: CopperLayer["id"];
  sirkitName: string;
  dsnName: CopperLayer["name"];
  sesName: CopperLayer["name"];
  physicalOrder: number;
}

const layer = (
  id: CopperLayer["id"],
  name: CopperLayer["name"],
  order: number,
  role: CopperLayerRole,
  autorouteEnabled: boolean,
  preferredDirection: PreferredDirection,
  defaultTraceWidthMm: number,
): CopperLayer => ({
  id,
  name,
  order,
  enabled: true,
  role,
  autorouteEnabled,
  preferredDirection,
  defaultTraceWidthMm,
});

const routingDefaults: BoardStackup["routing"] = {
  viasAllowed: true,
  fanout: false,
  postroute: true,
  viaCost: 50,
  planeViaCost: 5,
  startRipupCost: 100,
};

export const STACKUP_PROFILES: Readonly<Record<StackupProfileId, BoardStackup>> = {
  "simple-2": {
    profileId: "simple-2",
    boardThicknessMm: 1.6,
    routing: routingDefaults,
    copperLayers: [
      layer("copperTop", "F.Cu", 0, "signal", true, "horizontal", 0.25),
      layer("copperBottom", "B.Cu", 1, "signal", true, "vertical", 0.25),
    ],
  },
  "signal-plane-4": {
    profileId: "signal-plane-4",
    boardThicknessMm: 1.6,
    routing: routingDefaults,
    copperLayers: [
      layer("copperTop", "F.Cu", 0, "signal", true, "horizontal", 0.25),
      layer("in1", "In1.Cu", 1, "plane", false, "any", 0.2),
      layer("in2", "In2.Cu", 2, "plane", false, "any", 0.2),
      layer("copperBottom", "B.Cu", 3, "signal", true, "vertical", 0.25),
    ],
  },
  "all-signal-4": {
    profileId: "all-signal-4",
    boardThicknessMm: 1.6,
    routing: routingDefaults,
    copperLayers: [
      layer("copperTop", "F.Cu", 0, "signal", true, "horizontal", 0.25),
      layer("in1", "In1.Cu", 1, "signal", true, "vertical", 0.2),
      layer("in2", "In2.Cu", 2, "signal", true, "horizontal", 0.2),
      layer("copperBottom", "B.Cu", 3, "signal", true, "vertical", 0.25),
    ],
  },
  "dense-4": {
    profileId: "dense-4",
    boardThicknessMm: 1.2,
    routing: { ...routingDefaults, fanout: true, viaCost: 35, planeViaCost: 4 },
    copperLayers: [
      layer("copperTop", "F.Cu", 0, "signal", true, "horizontal", 0.2),
      layer("in1", "In1.Cu", 1, "signal", true, "vertical", 0.18),
      layer("in2", "In2.Cu", 2, "signal", true, "horizontal", 0.18),
      layer("copperBottom", "B.Cu", 3, "signal", true, "vertical", 0.2),
    ],
  },
};

export function cloneStackup(stackup: BoardStackup): BoardStackup {
  return {
    ...stackup,
    routing: { ...stackup.routing },
    copperLayers: stackup.copperLayers.map((candidate) => ({ ...candidate })),
  };
}

export function stackupProfile(profileId: StackupProfileId): BoardStackup {
  return cloneStackup(STACKUP_PROFILES[profileId]);
}

function inferredPlaneNet(board: Pick<PcbBoard, "nets">, layerId: CopperLayer["id"]): number | undefined {
  const preferred = layerId === "in1" ? ["GND", "VSS", "0V"] : ["+3V3", "3V3", "+5V", "5V", "VCC"];
  for (const name of preferred) {
    const net = board.nets.find((candidate) => candidate.name.trim().toUpperCase() === name);
    if (net && net.id !== 0) return net.id;
  }
  return undefined;
}

export function getBoardStackup(board: Pick<PcbBoard, "stackup" | "stackupConfig" | "nets">): BoardStackup {
  const fallback = board.stackup === 4 ? stackupProfile("all-signal-4") : stackupProfile("simple-2");
  const configured = board.stackupConfig;
  const expectedCount = board.stackup;
  const candidate = configured?.copperLayers.length === expectedCount ? cloneStackup(configured) : fallback;
  for (const copper of candidate.copperLayers) {
    if (copper.role === "plane" && copper.planeNetId === undefined) {
      copper.planeNetId = inferredPlaneNet(board, copper.id);
    }
  }
  return candidate;
}

export function setBoardStackupProfile(board: PcbBoard, profileId: StackupProfileId): void {
  const profile = stackupProfile(profileId);
  board.stackup = profile.copperLayers.length as 2 | 4;
  board.stackupConfig = profile;
}

export function routingLayerMappings(board: Pick<PcbBoard, "stackup" | "stackupConfig" | "nets">): RoutingLayerMapping[] {
  return getBoardStackup(board).copperLayers
    .filter((candidate) => candidate.enabled)
    .sort((a, b) => a.order - b.order)
    .map((candidate) => ({
      sirkitLayerId: candidate.id,
      sirkitName: LAYERS.find((definition) => definition.id === candidate.id)?.displayName ?? candidate.id,
      dsnName: candidate.name,
      sesName: candidate.name,
      physicalOrder: candidate.order,
    }));
}

export function copperLayerFor(
  board: Pick<PcbBoard, "stackup" | "stackupConfig" | "nets">,
  id: LayerId,
): CopperLayer | undefined {
  return getBoardStackup(board).copperLayers.find((candidate) => candidate.id === id && candidate.enabled);
}

export function layerIdFromSesName(
  board: Pick<PcbBoard, "stackup" | "stackupConfig" | "nets">,
  name: string,
): CopperLayer["id"] | undefined {
  return routingLayerMappings(board).find((mapping) => mapping.sesName === name)?.sirkitLayerId;
}

export function routableCopperLayers(
  board: Pick<PcbBoard, "stackup" | "stackupConfig" | "nets">,
): CopperLayer[] {
  return getBoardStackup(board).copperLayers.filter(
    (candidate) => candidate.enabled && candidate.autorouteEnabled && candidate.role !== "plane",
  );
}
