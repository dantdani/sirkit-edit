import { runDrc } from "../../drc/run-drc";
import { outlinePolygon, polygonBBox } from "../../zones/geometry";
import type { PcbBoard } from "../../types";
import type { PcbNetlist } from "../../netlist-bridge";
import { copperItemId, type CopperItemRef } from "../../connectivity-board";
import { STRICT_NATIVE_RECIPE } from "./recipe";
import { deepFreeze, deterministicUuid, safeFabName, sha256, stableJson } from "./stable";
import type {
  FabDiagnostic,
  ManufacturingSnapshot,
  NativeFabCompileInput,
  NativeFabMaskPolicy,
  NativeFabRecipe,
} from "./types";
import { validateReferenceDesignators } from "../../integrity";
import { computeElectricalTruth } from "../../electrical-truth";
import { zoneFillIsCurrent } from "../../zones/fill-lifecycle";

const byStringId = <T extends { id: string }>(a: T, b: T): number => a.id.localeCompare(b.id);

function copperSourceId(item: CopperItemRef): string {
  return copperItemId(item);
}

function canonicalBoard(board: PcbBoard): PcbBoard {
  const copy = structuredClone(board);
  copy.nets.sort((a, b) => a.id - b.id || a.name.localeCompare(b.name));
  copy.footprints.sort((a, b) => a.ref.localeCompare(b.ref, undefined, { numeric: true }) || a.id.localeCompare(b.id));
  copy.tracks.sort(byStringId);
  copy.vias.sort(byStringId);
  copy.zones.sort(byStringId);
  copy.texts.sort(byStringId);
  copy.silkItems?.sort(byStringId);
  copy.padstacks?.sort(byStringId);
  for (const fp of copy.footprints) {
    fp.def.pads.sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }));
    fp.def.graphics = [...fp.def.graphics].sort((a, b) => stableJson(a).localeCompare(stableJson(b)));
  }
  return copy;
}

function canonicalNetlist(netlist: PcbNetlist): PcbNetlist {
  const copy = structuredClone(netlist);
  copy.components.sort((a, b) => a.ref.localeCompare(b.ref, undefined, { numeric: true }) || a.id.localeCompare(b.id));
  for (const component of copy.components) {
    component.pins.sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }));
  }
  copy.nets.sort((a, b) => a.id - b.id || a.name.localeCompare(b.name));
  for (const net of copy.nets) {
    net.nodes.sort((a, b) =>
      a.componentId.localeCompare(b.componentId) ||
      a.pinNumber.localeCompare(b.pinNumber, undefined, { numeric: true }),
    );
  }
  return copy;
}

function validateFiniteNumbers(value: unknown, path: string, diagnostics: FabDiagnostic[]): void {
  if (typeof value === "number" && !Number.isFinite(value)) {
    diagnostics.push({
      code: "SNAPSHOT_NONFINITE_NUMBER",
      severity: "error",
      category: "snapshot",
      message: `${path} is not a finite number`,
    });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((child, i) => validateFiniteNumbers(child, `${path}[${i}]`, diagnostics));
  } else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      validateFiniteNumbers(child, `${path}.${key}`, diagnostics);
    }
  }
}

export function createManufacturingSnapshot(
  input: NativeFabCompileInput,
): { snapshot: ManufacturingSnapshot; diagnostics: FabDiagnostic[] } {
  const diagnostics: FabDiagnostic[] = [];
  const board = canonicalBoard(input.board);
  const netlist = canonicalNetlist(input.netlist);
  const recipe: NativeFabRecipe = structuredClone(input.recipe ?? STRICT_NATIVE_RECIPE);
  const maskPolicy: NativeFabMaskPolicy = structuredClone(input.maskPolicy ?? {
    schemaVersion: "sirkit.native-mask-policy.v1",
    defaultComponentPadsOpen: false,
    defaultExpansionNm: 0,
    defaultViaTenting: "tented",
    sourceProfileDigest: "legacy-explicit-pad-layers-only",
  });
  const boardName = safeFabName(input.boardName);

  validateFiniteNumbers(board, "board", diagnostics);
  if (!Number.isSafeInteger(maskPolicy.defaultExpansionNm) || maskPolicy.defaultExpansionNm < 0 || !maskPolicy.sourceProfileDigest) diagnostics.push({
    code: "SNAPSHOT_MASK_POLICY_INVALID",
    severity: "error",
    category: "snapshot",
    message: "Native mask policy requires a non-negative integer expansion and an exact source-profile digest.",
  });

  for (const diagnostic of validateReferenceDesignators(board.footprints)) {
    diagnostics.push({
      code: diagnostic.code,
      severity: diagnostic.severity,
      category: "snapshot",
      message: diagnostic.summary,
      sourceIds: diagnostic.componentIds,
    });
  }

  for (const zone of board.zones) {
    if (!zoneFillIsCurrent(board, zone) || zone.fill.length === 0) {
      diagnostics.push({
        code: "SNAPSHOT_STALE_ZONE_FILL",
        severity: "error",
        category: "snapshot",
        message: `Copper zone ${zone.id} has a stale or absent fill. Refill it in the editor before export.`,
        sourceIds: [zone.id],
      });
    }
  }

  const electricalTruth = computeElectricalTruth(board);
  for (const unknown of electricalTruth.unresolved) {
    diagnostics.push({
      code: unknown.code,
      severity: "warning",
      category: "snapshot",
      message: unknown.summary,
      sourceIds: unknown.objectIds,
    });
  }
  const drc = runDrc(board, input.drcPreset.rules, {
    presetId: input.drcPreset.id,
    electricalReport: electricalTruth,
  });
  for (const violation of drc.violations) {
    diagnostics.push({
      code: `DRC_${violation.kind.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`,
      severity: violation.severity,
      category: "drc",
      message: violation.summary,
      sourceIds: violation.items.map(copperSourceId),
    });
  }

  const outline = outlinePolygon(board.outline, 16);
  const bbox = polygonBBox(outline);
  if (outline.length < 3 || bbox.maxX <= bbox.minX || bbox.maxY <= bbox.minY) {
    diagnostics.push({
      code: "SNAPSHOT_INVALID_OUTLINE",
      severity: "error",
      category: "geometry",
      message: "The board outline must be a non-zero closed polygon.",
    });
  }

  const sourceHash = sha256(
    stableJson({
      board,
      netlist,
      fabPreset: input.fabPreset,
      drcPreset: input.drcPreset,
      recipe,
      maskPolicy,
      boardName,
    }),
  );
  const revisionId = `rev-${sourceHash.slice(0, 16)}`;
  const sameCoordinatesId = deterministicUuid(sourceHash);

  const snapshot: ManufacturingSnapshot = {
    schemaVersion: "sirkit.manufacturing-snapshot.v2",
    boardName,
    sourceHash,
    revisionId,
    sameCoordinatesId,
    board: deepFreeze(board),
    netlist: deepFreeze(netlist),
    fabPreset: deepFreeze(structuredClone(input.fabPreset)),
    drcPreset: deepFreeze(structuredClone(input.drcPreset)),
    recipe: deepFreeze(recipe),
    maskPolicy: deepFreeze(maskPolicy),
    electricalTruth: deepFreeze(electricalTruth),
    planeCertificates: deepFreeze(board.zones.flatMap((zone) => {
      const net = board.nets.find((candidate) => candidate.id === zone.netId);
      if (zone.source !== "stackup-plane" || !net?.stableId || !zoneFillIsCurrent(board, zone) || !zone.fillState?.fillHash) return [];
      return [{
        zoneId: zone.id,
        stableNetId: net.stableId,
        layerId: zone.layer,
        sourceRevision: zone.fillState.sourceRevision,
        algorithmVersion: zone.fillState.algorithmVersion,
        fillHash: zone.fillState.fillHash,
        regionCount: zone.fill.length,
        holeCount: zone.fill.reduce((sum, region) => sum + region.holes.length, 0),
        filledAreaNm2: zone.fill.reduce((sum, region) => sum + region.areaNm2, 0),
        representationId: `native:${zone.layer}:${zone.id}`,
        status: "current" as const,
        unsupportedConstructs: [],
      }];
    }).sort((a, b) => a.zoneId.localeCompare(b.zoneId))),
    transform: {
      originXNm: bbox.minX,
      originYNm: bbox.maxY,
      boardWidthNm: bbox.maxX - bbox.minX,
      boardHeightNm: bbox.maxY - bbox.minY,
    },
  };
  return { snapshot: deepFreeze(snapshot) as ManufacturingSnapshot, diagnostics };
}

export function toManufacturingPoint(
  snapshot: ManufacturingSnapshot,
  point: { x: number; y: number },
): { x: number; y: number } {
  return {
    x: point.x - snapshot.transform.originXNm,
    y: snapshot.transform.originYNm - point.y,
  };
}
