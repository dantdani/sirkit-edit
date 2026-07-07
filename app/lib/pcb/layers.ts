// Canonical PCB layer table — single source of truth for the whole PCB
// module. Stage 3's layer panel and Stage 13's exporter consume this.
// Product constraint: KiCad layer names never appear in UI; always show
// `displayName`.

export type LayerId =
  | "copperTop"
  | "in1"
  | "in2"
  | "copperBottom"
  | "silkTop"
  | "silkBottom"
  | "maskTop"
  | "maskBottom"
  | "pasteTop"
  | "pasteBottom"
  | "edge"
  | "courtyardTop"
  | "courtyardBottom"
  | "fabTop"
  | "fabBottom";

export interface LayerDef {
  id: LayerId;
  kicadName: string;
  displayName: string;
  kind: "copper" | "silk" | "mask" | "paste" | "edge" | "courtyard" | "fab";
  defaultColor: string;
  defaultVisible: boolean;
}

// in1/in2 always exist in the model; the UI filters them out on 2-layer
// boards (Stage 3's job).
export const LAYERS: readonly LayerDef[] = [
  { id: "copperTop",       kicadName: "F.Cu",     displayName: "Top Copper",        kind: "copper",    defaultColor: "#14b8a6", defaultVisible: true },
  { id: "in1",             kicadName: "In1.Cu",   displayName: "Inner 1",           kind: "copper",    defaultColor: "#f59e0b", defaultVisible: true },
  { id: "in2",             kicadName: "In2.Cu",   displayName: "Inner 2",           kind: "copper",    defaultColor: "#ec4899", defaultVisible: true },
  { id: "copperBottom",    kicadName: "B.Cu",     displayName: "Bottom Copper",     kind: "copper",    defaultColor: "#6366f1", defaultVisible: true },
  { id: "silkTop",         kicadName: "F.SilkS",  displayName: "Top Silkscreen",    kind: "silk",      defaultColor: "#e4e4e7", defaultVisible: true },
  { id: "silkBottom",      kicadName: "B.SilkS",  displayName: "Bottom Silkscreen", kind: "silk",      defaultColor: "#a1a1aa", defaultVisible: false },
  { id: "maskTop",         kicadName: "F.Mask",   displayName: "Top Solder Mask",   kind: "mask",      defaultColor: "#0f766e", defaultVisible: false },
  { id: "maskBottom",      kicadName: "B.Mask",   displayName: "Bottom Solder Mask", kind: "mask",     defaultColor: "#155e75", defaultVisible: false },
  { id: "pasteTop",        kicadName: "F.Paste",  displayName: "Top Paste",         kind: "paste",     defaultColor: "#94a3b8", defaultVisible: false },
  { id: "pasteBottom",     kicadName: "B.Paste",  displayName: "Bottom Paste",      kind: "paste",     defaultColor: "#64748b", defaultVisible: false },
  { id: "edge",            kicadName: "Edge.Cuts", displayName: "Board Outline",    kind: "edge",      defaultColor: "#fbbf24", defaultVisible: true },
  { id: "courtyardTop",    kicadName: "F.CrtYd",  displayName: "Top Courtyard",     kind: "courtyard", defaultColor: "#52525b", defaultVisible: true },
  { id: "courtyardBottom", kicadName: "B.CrtYd",  displayName: "Bottom Courtyard",  kind: "courtyard", defaultColor: "#3f3f46", defaultVisible: false },
  { id: "fabTop",          kicadName: "F.Fab",    displayName: "Top Fab",           kind: "fab",       defaultColor: "#71717a", defaultVisible: false },
  { id: "fabBottom",       kicadName: "B.Fab",    displayName: "Bottom Fab",        kind: "fab",       defaultColor: "#52525b", defaultVisible: false },
];

const BY_KICAD_NAME: ReadonlyMap<string, LayerId> = new Map(
  LAYERS.map((l) => [l.kicadName, l.id]),
);

export function layerFromKicadName(name: string): LayerId | undefined {
  return BY_KICAD_NAME.get(name);
}

/** Copper layers in stack order, top to bottom. */
export const COPPER_LAYERS: readonly LayerId[] = [
  "copperTop",
  "in1",
  "in2",
  "copperBottom",
];
