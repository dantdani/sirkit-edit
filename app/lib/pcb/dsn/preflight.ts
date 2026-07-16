import type { PcbBoard } from "../types";
import { getBoardStackup } from "../stackup";
import type { DsnBoard, DsnLayerName } from "./types";

export type DsnValidationSeverity = "error" | "warning";

export interface DsnValidationIssue {
  severity: DsnValidationSeverity;
  code: string;
  message: string;
}

export interface DsnValidationReport {
  ok: boolean;
  issues: DsnValidationIssue[];
  enabledLayers: DsnLayerName[];
  routableLayers: DsnLayerName[];
  viaTransitions: Array<{ via: string; from: DsnLayerName; to: DsnLayerName }>;
}

export class DsnPreflightError extends Error {
  constructor(public readonly report: DsnValidationReport) {
    super(report.issues.filter((issue) => issue.severity === "error").map((issue) => issue.message).join(" "));
    this.name = "DsnPreflightError";
  }
}

const finitePoint = (point: { x: number; y: number }): boolean => Number.isFinite(point.x) && Number.isFinite(point.y);

export function validateDsn(board: PcbBoard, dsn: DsnBoard): DsnValidationReport {
  const issues: DsnValidationIssue[] = [];
  const error = (code: string, message: string): void => {
    issues.push({ severity: "error", code, message });
  };
  const warning = (code: string, message: string): void => {
    issues.push({ severity: "warning", code, message });
  };
  const expected = getBoardStackup(board).copperLayers.filter((layer) => layer.enabled).sort((a, b) => a.order - b.order);
  const enabledLayers = dsn.layers.map((layer) => layer.name);
  const routableLayers = dsn.layers.filter((layer) => layer.autorouteEnabled).map((layer) => layer.name);

  if (dsn.layers.length !== expected.length) {
    error("layer-count", `DSN contains ${dsn.layers.length} copper layers; the board stackup requires ${expected.length}.`);
  }
  if (new Set(enabledLayers).size !== enabledLayers.length) error("layer-duplicate", "DSN copper layer names are not unique.");
  expected.forEach((layer, index) => {
    if (dsn.layers[index]?.name !== layer.name) {
      error("layer-order", `Layer ${index + 1} must be ${layer.name}, not ${dsn.layers[index]?.name ?? "missing"}.`);
    }
  });
  for (const layer of dsn.layers) {
    if (layer.autorouteEnabled && !(layer.traceWidthNm > 0)) {
      error("layer-width", `${layer.name} has no positive routing width.`);
    }
    if (layer.role === "plane" && !layer.planeNetName) {
      warning("plane-net", `${layer.name} is a plane but has no assigned net; it will remain unavailable to the autorouter.`);
    }
  }

  if (dsn.boundary.polygon.length < 3 || dsn.boundary.polygon.some((point) => !finitePoint(point))) {
    error("boundary", "The board boundary is missing or contains invalid coordinates.");
  }
  if (dsn.networks.some((net) => net.nodes.length < 2)) {
    warning("single-pin-net", "One or more exported nets have fewer than two routing targets.");
  }
  const pinKeys = new Set(dsn.components.flatMap((component) => component.pins.map((pin) => `${component.ref}\0${pin.padNumber}`)));
  for (const net of dsn.networks) {
    for (const node of net.nodes) {
      if (!pinKeys.has(`${node.componentRef}\0${node.padNumber}`)) {
        error("missing-pin", `${net.name} references missing pin ${node.componentRef}.${node.padNumber}.`);
      }
    }
  }
  for (const rule of dsn.rules) {
    if (!(rule.widthNm > 0)) error("rule-width", "A routing rule has a non-positive trace width.");
    if (!(rule.clearanceNm > 0)) error("rule-clearance", "A routing rule has a non-positive clearance.");
    if (!dsn.vias.some((via) => via.name === rule.viaCandidateName)) {
      error("via-reference", `Routing rule references missing via padstack ${rule.viaCandidateName}.`);
    }
  }

  const viaTransitions = dsn.vias.map((via) => ({ via: via.name, from: via.startLayer, to: via.endLayer }));
  for (const via of dsn.vias) {
    if (!(via.diameterNm > via.drillNm && via.drillNm > 0)) {
      error("via-geometry", `${via.name} must have a positive drill and copper diameter larger than its drill.`);
    }
    if (!enabledLayers.includes(via.startLayer) || !enabledLayers.includes(via.endLayer)) {
      error("via-span", `${via.name} references a layer outside the enabled stackup.`);
    }
    if (via.onLayers.some((layer) => !enabledLayers.includes(layer))) {
      error("via-padstack-layer", `${via.name} contains a copper shape on a disabled layer.`);
    }
  }
  if (routableLayers.length > 1 && dsn.routingSettings.viasAllowed) {
    const connected = new Set<DsnLayerName>();
    const pending: DsnLayerName[] = [routableLayers[0]];
    while (pending.length > 0) {
      const current = pending.pop()!;
      if (connected.has(current)) continue;
      connected.add(current);
      for (const via of dsn.vias) {
        if (!via.onLayers.includes(current)) continue;
        for (const layer of via.onLayers) if (!connected.has(layer)) pending.push(layer);
      }
    }
    const unreachable = routableLayers.filter((layer) => !connected.has(layer));
    if (unreachable.length > 0) {
      error("via-connectivity", `Via padstacks cannot reach ${unreachable.join(", ")}.`);
    }
  }

  return {
    ok: !issues.some((issue) => issue.severity === "error"),
    issues,
    enabledLayers,
    routableLayers,
    viaTransitions,
  };
}

export function assertDsnReady(board: PcbBoard, dsn: DsnBoard): DsnValidationReport {
  const report = validateDsn(board, dsn);
  if (!report.ok) throw new DsnPreflightError(report);
  return report;
}
