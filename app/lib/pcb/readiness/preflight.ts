import type { PcbBoard } from "../types";
import type { PcbNetlist } from "../netlist-bridge";
import type { DrcRules } from "../drc/types";
import type { FabPreset } from "../fab/types";
import { boardToDsn } from "../dsn/write-dsn";
import { validateDsn } from "../dsn/preflight";
import { writeKicadPcb } from "../kicad/write-pcb";
import { getBoardStackup } from "../stackup";
import { compareDiagnostics, engineeringDiagnostic, type EngineeringDiagnostic } from "../integrity";
import { pcbRevisionId } from "../revision";
import type { ExportPreflightResult } from "./types";
import { resolveNetIdentity } from "../copper-policy";
import { zoneFillIsCurrent } from "../zones/fill-lifecycle";
import { compareCodePoints } from "@/app/lib/stable-compare";

export interface RunExportPreflightInput {
  board: PcbBoard;
  netlist: PcbNetlist;
  fabPreset: FabPreset;
  drcRules: DrcRules;
  exporter: ExportPreflightResult["exporter"];
}

/** Structural/exporter preflight only; electrical truth and DRC remain separate evidence checks. */
export function runExportPreflight(input: RunExportPreflightInput): ExportPreflightResult {
  const diagnostics: EngineeringDiagnostic[] = [];
  const designRevision = pcbRevisionId(input.board);
  const actualCopper = getBoardStackup(input.board).copperLayers
    .filter((layer) => layer.enabled)
    .map((layer) => layer.id)
    .sort();
  const profileCopper = input.fabPreset.layerBundle
    .filter((layer) => layer.enabled && ["copperTop", "in1", "in2", "copperBottom"].includes(layer.layerId))
    .map((layer) => layer.layerId)
    .sort();
  if (actualCopper.join("\0") !== profileCopper.join("\0")) diagnostics.push(engineeringDiagnostic(
    "MANUFACTURING_STACKUP_MISMATCH",
    `Board copper stackup (${actualCopper.join(", ")}) does not match manufacturing profile ${input.fabPreset.id} (${profileCopper.join(", ")}).`,
    { context: { actualCopper, profileCopper }, suggestedActions: ["Choose the matching manufacturing profile or correct the board stackup."] },
  ));

  let fillEvidenceIncomplete = false;
  for (const zone of [...input.board.zones].sort((a, b) => compareCodePoints(a.id, b.id))) {
    const identity = resolveNetIdentity(input.board, zone.netId);
    if (identity.state !== "proven") diagnostics.push(engineeringDiagnostic(
      "ZONE_NET_IDENTITY_UNRESOLVED",
      `Zone ${zone.id} has no unique proven stable-net ownership.`,
      { objectIds: [`zone:${zone.id}`], context: { netId: zone.netId, reason: identity.reason } },
    ));
    if (zoneFillIsCurrent(input.board, zone) && zone.fill.length > 0) continue;
    const failed = zone.fillState?.status === "failed" || zone.fillState?.status === "unsupported";
    fillEvidenceIncomplete ||= !failed;
    diagnostics.push(engineeringDiagnostic(
      failed ? "ZONE_FILL_INVALID" : "ZONE_FILL_UNRESOLVED",
      `Zone ${zone.id} has ${zone.fillState?.status ?? (zone.dirty ? "dirty" : "unproven legacy")} fill evidence and cannot authorize current copper export.`,
      {
        severity: failed ? "error" : "warning",
        objectIds: [`zone:${zone.id}`],
        context: { fillState: zone.fillState, layer: zone.layer, netId: zone.netId },
        suggestedActions: ["Refill zones for the current board revision and rerun export preflight."],
      },
    ));
  }

  try {
    const dsn = boardToDsn(input.board);
    const validation = validateDsn(input.board, dsn);
    for (const issue of validation.issues) diagnostics.push(engineeringDiagnostic(
      issue.code === "INTERCHANGE_CONSERVATION_FAILURE" ? issue.code : `DSN_${issue.code.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`,
      issue.message,
      { severity: issue.severity === "error" ? "error" : "warning" },
    ));
  } catch (error) {
    diagnostics.push(engineeringDiagnostic(
      "EXPORTER_STRUCTURAL_FAILURE",
      `Electrical interchange preflight failed: ${error instanceof Error ? error.message : String(error)}`,
    ));
  }

  try {
    const text = writeKicadPcb(input.board, input.netlist, { drcRules: input.drcRules });
    if (!text.trim().startsWith("(kicad_pcb")) diagnostics.push(engineeringDiagnostic(
      "EXPORTER_STRUCTURAL_FAILURE",
      "KiCad board serialization did not produce a supported board document.",
    ));
  } catch (error) {
    diagnostics.push(engineeringDiagnostic(
      "EXPORTER_STRUCTURAL_FAILURE",
      `${input.exporter} serialization failed: ${error instanceof Error ? error.message : String(error)}`,
    ));
  }

  diagnostics.sort(compareDiagnostics);
  return {
    schemaVersion: "sirkit.pcb-export-preflight.v1",
    exporter: input.exporter,
    exporterVersion: input.exporter === "sirkit-native" ? "sirkit-native-fab/1" : "kicad-assisted/1",
    designRevision,
    manufacturingProfileId: input.fabPreset.id,
    manufacturingProfileVersion: input.fabPreset.version,
    state: diagnostics.some((diagnostic) => diagnostic.severity === "error") ? "fail" : fillEvidenceIncomplete ? "unknown" : "pass",
    diagnostics,
  };
}
