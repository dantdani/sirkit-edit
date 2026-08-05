import type { PcbBoard } from "../types";
import { getBoardStackup } from "../stackup";
import type { DsnBoard, DsnLayerName } from "./types";
import { canonicalReference, schematicEndpointKey, validateReferenceDesignators } from "../integrity";
import { computeElectricalTruth } from "../electrical-truth";
import { resolvePinPadMapping } from "../pin-pad-mapping";
import { stackupPlaneZoneId } from "../zones/plane";
import { zoneFillIsCurrent } from "../zones/fill-lifecycle";

export type DsnValidationSeverity = "error" | "warning";

export interface DsnValidationIssue {
  severity: DsnValidationSeverity;
  code: string;
  message: string;
}

export interface DsnValidationReport {
  ok: boolean;
  sourceRevision: string;
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
  const electricalTruth = computeElectricalTruth(board);
  const enabledLayers = dsn.layers.map((layer) => layer.name);
  const routableLayers = dsn.layers.filter((layer) => layer.autorouteEnabled).map((layer) => layer.name);

  if (!dsn.integrity || dsn.integrity.schemaVersion !== "sirkit.dsn-integrity.v2") {
    error("INTERCHANGE_CONSERVATION_FAILURE", "DSN has no supported electrical conservation manifest.");
  } else {
    for (const loss of dsn.integrity.constraintLoss ?? []) {
      const message = `${loss.message} Constraint IDs: ${loss.constraintIds.join(", ") || "none"}.`;
      if (loss.severity === "error") error("CONSTRAINT_SEMANTIC_LOSS", message);
      else warning("CONSTRAINT_SEMANTIC_LOSS", message);
    }
    if (dsn.integrity.sourceRevision !== electricalTruth.designRevision) {
      error(
        "STALE_ELECTRICAL_REPORT",
        `DSN source revision ${dsn.integrity.sourceRevision} does not match current board revision ${electricalTruth.designRevision}.`,
      );
    }
    const truthNets = new Map(electricalTruth.nets.map((net) => [net.stableNetId, net]));
    const manifestNets = new Map(dsn.integrity.nets.map((net) => [net.stableNetId, net]));
    if (manifestNets.size !== dsn.integrity.nets.length) {
      error("INTERCHANGE_CONSERVATION_FAILURE", "DSN manifest repeats a stable net identity.");
    }
    const serializedNames = dsn.integrity.nets.map((net) => net.serializedName);
    if (new Set(serializedNames).size !== serializedNames.length) {
      error("INTERCHANGE_CONSERVATION_FAILURE", "DSN manifest serializes multiple stable nets to the same external name.");
    }
    for (const [stableNetId, truthNet] of truthNets) {
      const exported = manifestNets.get(stableNetId);
      if (!exported || exported.numericNetId !== truthNet.netId ||
        exported.endpointKeys.join("\0") !== truthNet.endpointKeys.join("\0") ||
        exported.terminalGroupIds.join("\0") !== truthNet.terminalGroupIds.join("\0") ||
        exported.physicalPadInstanceIds.join("\0") !== truthNet.physicalPadInstanceIds.join("\0")) {
        error("INTERCHANGE_CONSERVATION_FAILURE", `DSN manifest does not conserve stable net ${stableNetId}.`);
      }
    }
    for (const stableNetId of manifestNets.keys()) {
      if (!truthNets.has(stableNetId)) error("INTERCHANGE_CONSERVATION_FAILURE", `DSN manifest contains stale stable net ${stableNetId}.`);
    }
    const expectedLayerLedger = expected.map((layer) => `${layer.id}\0${layer.name}`);
    const actualLayerLedger = dsn.integrity.layers.map((layer) => `${layer.layerId}\0${layer.dsnName}`);
    if (expectedLayerLedger.join("\n") !== actualLayerLedger.join("\n")) {
      error("INTERCHANGE_CONSERVATION_FAILURE", "DSN manifest layer identities do not match the current enabled stackup.");
    }
  }

  for (const diagnostic of validateReferenceDesignators(board.footprints)) {
    if (diagnostic.severity === "error") error(diagnostic.code, diagnostic.summary);
    else warning(diagnostic.code, diagnostic.summary);
  }
  const dsnRefs = new Map<string, string[]>();
  for (const component of dsn.components) {
    const canonical = canonicalReference(component.ref);
    const bucket = dsnRefs.get(canonical) ?? [];
    bucket.push(component.componentId ?? component.imageName);
    dsnRefs.set(canonical, bucket);
  }
  for (const [canonical, componentIds] of dsnRefs) {
    if (new Set(componentIds).size > 1) {
      error("DUPLICATE_REFERENCE_DESIGNATOR", `DSN reference '${canonical}' identifies multiple component images.`);
    }
  }
  const boardNetIdByEndpoint = new Map<string, number>();
  for (const net of board.nets) {
    for (const endpointKey of net.endpointKeys ?? []) {
      const previous = boardNetIdByEndpoint.get(endpointKey);
      if (previous !== undefined && previous !== net.id) {
        error("NET_IDENTITY_MISMATCH", `Schematic endpoint ${endpointKey} is claimed by multiple PCB nets.`);
      } else boardNetIdByEndpoint.set(endpointKey, net.id);
    }
  }
  for (const footprint of board.footprints) {
    if (footprint.pinPadMappings === undefined) continue;
    const endpointKeys = new Set<string>();
    for (const mapping of footprint.pinPadMappings) {
      const expectedEndpointKey = schematicEndpointKey(footprint.id, mapping.symbolPinNumber);
      if (mapping.componentInstanceId !== footprint.id || mapping.endpointKey !== expectedEndpointKey) {
        error("PIN_PAD_IDENTITY_MISMATCH", `${footprint.ref}.${mapping.symbolPinNumber} mapping is not bound to exact component/pin identity ${expectedEndpointKey}.`);
      }
      if (endpointKeys.has(mapping.endpointKey)) {
        error("DUPLICATE_PIN_IDENTITY", `${footprint.ref} repeats mapping identity ${mapping.endpointKey}.`);
      }
      endpointKeys.add(mapping.endpointKey);
    }
    const electricalPadNumbers = new Set(footprint.def.pads.filter((pad) => pad.type !== "np_thru_hole").map((pad) => pad.number));
    const result = resolvePinPadMapping({
      id: footprint.id,
      ref: footprint.ref,
      pins: footprint.pinPadMappings.map((mapping) => ({ number: mapping.symbolPinNumber })),
      pinPadMapping: {
        mappings: footprint.pinPadMappings.map((mapping) => ({
          symbolPinNumber: mapping.symbolPinNumber,
          padNumbers: [...mapping.padNumbers],
          mappingKind: mapping.mappingKind,
          provenance: mapping.provenance === "user-explicit" ? "user-explicit" : "library-explicit",
        })),
        footprintPadClassifications: Object.fromEntries(Object.entries(footprint.footprintPadClassifications ?? {})
          .filter(([padNumber]) => electricalPadNumbers.has(padNumber))),
      },
    }, footprint.def, boardNetIdByEndpoint);
    for (const diagnostic of result.diagnostics.filter((item) => item.severity === "error")) {
      error(diagnostic.code, diagnostic.summary);
    }
  }

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
    if (layer.role === "plane" && !layer.plane) {
      const configured = expected.find((candidate) => candidate.name === layer.name);
      if (configured?.planeNetId !== undefined) {
        error("NATIVE_PLANE_UNRESOLVED", `${layer.name} has assigned plane intent but no current native plane certificate.`);
      } else {
        warning("plane-net", `${layer.name} is a plane but has no assigned net; it will remain unavailable to the autorouter.`);
      }
    }
    if (layer.plane) {
      const configured = expected.find((candidate) => candidate.name === layer.name);
      const zone = configured ? board.zones.find((candidate) => candidate.id === stackupPlaneZoneId(configured.id)) : undefined;
      const net = zone ? board.nets.find((candidate) => candidate.id === zone.netId) : undefined;
      if (!configured || configured.role !== "plane" || configured.planeNetId !== zone?.netId
        || zone?.source !== "stackup-plane" || zone.sourceLayerId !== configured.id
        || !zoneFillIsCurrent(board, zone) || zone.fill.length === 0 || !net?.stableId
        || layer.plane.zoneId !== zone.id || layer.plane.stableNetId !== net.stableId
        || layer.plane.sourceRevision !== zone.fillState?.sourceRevision
        || layer.plane.fillHash !== zone.fillState?.fillHash
        || layer.plane.algorithmVersion !== zone.fillState?.algorithmVersion
        || layer.plane.fillStatus !== "current"
        || layer.plane.regionCount !== zone.fill.length
        || layer.plane.holeCount !== zone.fill.reduce((sum, region) => sum + region.holes.length, 0)
        || layer.plane.filledAreaNm2 !== zone.fill.reduce((sum, region) => sum + region.areaNm2, 0)
        || JSON.stringify(layer.plane.polygonNm) !== JSON.stringify(zone.polygon)) {
        error("INTERCHANGE_CONSERVATION_FAILURE", `${layer.name} plane certificate does not match current native plane truth.`);
      }
      if (configured && board.zones.some((candidate) => candidate.layer === configured.id && candidate.id !== zone?.id)) {
        error("UNSUPPORTED_PLANE_PRIORITY_SEMANTICS", `${layer.name} contains additional native zones whose precedence cannot be conserved in the supported DSN plane subset.`);
      }
    }
  }
  const manifestPlanes = dsn.integrity?.planes ?? [];
  const serializedPlanes = dsn.layers.flatMap((layer) => layer.plane ? [{
    layerId: expected.find((candidate) => candidate.name === layer.name)?.id ?? layer.name,
    dsnName: layer.name,
    zoneId: layer.plane.zoneId,
    stableNetId: layer.plane.stableNetId,
    sourceRevision: layer.plane.sourceRevision,
    fillHash: layer.plane.fillHash,
    algorithmVersion: layer.plane.algorithmVersion,
    fillStatus: layer.plane.fillStatus,
    regionCount: layer.plane.regionCount,
    holeCount: layer.plane.holeCount,
    filledAreaNm2: layer.plane.filledAreaNm2,
    exportedRepresentationId: layer.plane.exportedRepresentationId,
    unsupportedConstructs: [...layer.plane.unsupportedConstructs],
  }] : []);
  if (JSON.stringify(manifestPlanes) !== JSON.stringify(serializedPlanes)) {
    error("INTERCHANGE_CONSERVATION_FAILURE", "DSN plane certificates differ from serialized native plane geometry.");
  }

  if (dsn.boundary.polygon.length < 3 || dsn.boundary.polygon.some((point) => !finitePoint(point))) {
    error("boundary", "The board boundary is missing or contains invalid coordinates.");
  }
  if (dsn.networks.some((net) => net.nodes.length < 2)) {
    warning("single-pin-net", "One or more exported nets have fewer than two routing targets.");
  }
  const serializedPinKeys = dsn.components.flatMap((component) => component.pins.map((pin) => `${component.ref}\0${pin.padNumber}`));
  const pinKeys = new Set(serializedPinKeys);
  if (pinKeys.size !== serializedPinKeys.length) error("DUPLICATE_DSN_PIN_KEY", "DSN contains duplicate component/pin serialization keys.");
  const serializedNodeKeys = dsn.networks.flatMap((net) => net.nodes.map((node) => `${node.componentRef}\0${node.padNumber}`));
  if (new Set(serializedNodeKeys).size !== serializedNodeKeys.length) error("DUPLICATE_DSN_NODE_KEY", "DSN assigns one physical component/pin node more than once.");
  for (const net of dsn.networks) {
    for (const node of net.nodes) {
      if (!pinKeys.has(`${node.componentRef}\0${node.padNumber}`)) {
        error("missing-pin", `${net.name} references missing pin ${node.componentRef}.${node.padNumber}.`);
      }
    }
  }

  const expectedByEndpoint = new Map((dsn.integrity?.expectedEndpoints ?? []).map((endpoint) => [endpoint.endpointKey, endpoint]));
  if (expectedByEndpoint.size !== (dsn.integrity?.expectedEndpoints.length ?? 0)) {
    error("DUPLICATE_PIN_IDENTITY", "DSN conservation manifest repeats a schematic endpoint identity.");
  }
  const mappedBoardEndpoints = new Set(
    board.footprints.flatMap((footprint) => (footprint.pinPadMappings ?? []).map((mapping) => mapping.endpointKey)),
  );
  for (const net of board.nets) {
    if (net.id === 0) continue;
    for (const endpointKey of net.endpointKeys ?? []) {
      if (!mappedBoardEndpoints.has(endpointKey)) {
        error("LOST_SCHEMATIC_ENDPOINT", `${net.name || `net${net.id}`} endpoint ${endpointKey} has no persisted pin-to-pad mapping.`);
        continue;
      }
      if (!expectedByEndpoint.has(endpointKey)) {
        error("LOST_SCHEMATIC_ENDPOINT", `${net.name || `net${net.id}`} endpoint ${endpointKey} has no exported physical node.`);
      }
    }
  }
  for (const footprint of board.footprints) {
    if (footprint.pinPadMappings === undefined) continue;
    if (footprint.pinPadMappings.every((mapping) => mapping.provenance === "legacy-inferred")) continue;
    const mappedPads = new Set(footprint.pinPadMappings.flatMap((mapping) => mapping.padNumbers));
    const classifiedPads = new Set(Object.keys(footprint.footprintPadClassifications ?? {}));
    for (const pad of footprint.def.pads) {
      if (pad.type === "np_thru_hole" || mappedPads.has(pad.number) || classifiedPads.has(pad.number)) continue;
      error("UNCLASSIFIED_FOOTPRINT_PAD", `${footprint.ref} footprint pad '${pad.number}' is not accounted for by the persisted mapping.`);
    }
  }
  for (const expectedEndpoint of dsn.integrity?.expectedEndpoints ?? []) {
    const boardNet = board.nets.find((net) => net.id === expectedEndpoint.netId);
    if (!boardNet || (expectedEndpoint.netStableId && boardNet.stableId !== expectedEndpoint.netStableId)) {
      error("NET_IDENTITY_MISMATCH", `Endpoint ${expectedEndpoint.endpointKey} references a stale or missing electrical net identity.`);
      continue;
    }
    const component = dsn.components.find((candidate) =>
      candidate.componentId === expectedEndpoint.componentId || candidate.ref === expectedEndpoint.componentRef,
    );
    if (!component) {
      error("MISSING_EXPORTED_COMPONENT", `Endpoint ${expectedEndpoint.endpointKey} references a missing DSN component.`);
      continue;
    }
    for (const sourcePadNumber of expectedEndpoint.sourcePadNumbers) {
      if (!component.pins.some((pin) => (pin.sourcePadNumber ?? pin.padNumber) === sourcePadNumber)) {
        error("MISSING_EXPORTED_PAD", `${expectedEndpoint.componentRef}.${sourcePadNumber} is required by ${expectedEndpoint.endpointKey} but has no physical DSN pin.`);
      }
    }
    const network = dsn.networks.find((candidate) => candidate.name === expectedEndpoint.netName);
    for (const padNumber of expectedEndpoint.padNumbers) {
      if (!component.pins.some((pin) => pin.padNumber === padNumber)) {
        error("MISSING_EXPORTED_PAD", `${expectedEndpoint.componentRef}.${padNumber} is required by ${expectedEndpoint.endpointKey} but absent from the DSN image.`);
      }
      if (!network?.nodes.some((node) =>
        node.componentRef === expectedEndpoint.componentRef && node.padNumber === padNumber,
      )) {
        error("LOST_SCHEMATIC_ENDPOINT", `${expectedEndpoint.netName} lost required node ${expectedEndpoint.componentRef}.${padNumber}.`);
      }
    }
    for (const padInstanceId of expectedEndpoint.physicalPadInstanceIds) {
      const pin = component.pins.find((candidate) => candidate.padInstanceId === padInstanceId);
      if (!pin || !network?.nodes.some((node) => node.padInstanceId === padInstanceId)) {
        error("INTERCHANGE_CONSERVATION_FAILURE", `${expectedEndpoint.netName} lost physical pad instance ${padInstanceId}.`);
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
  if (dsn.integrity) {
    const actualVias = new Map(dsn.vias.map((via) => [via.name, via]));
    for (const expectedVia of dsn.integrity.viaPadstacks) {
      const via = actualVias.get(expectedVia.name);
      if (!via || via.diameterNm !== expectedVia.diameterNm || via.drillNm !== expectedVia.drillNm ||
        via.onLayers.join("\0") !== expectedVia.onLayers.join("\0")) {
        error("INTERCHANGE_CONSERVATION_FAILURE", `Via padstack ${expectedVia.name} does not match its DSN manifest geometry and layer span.`);
      }
    }
    if (actualVias.size !== dsn.integrity.viaPadstacks.length) {
      error("INTERCHANGE_CONSERVATION_FAILURE", "DSN via padstack count differs from its conservation manifest.");
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
    sourceRevision: electricalTruth.designRevision,
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
