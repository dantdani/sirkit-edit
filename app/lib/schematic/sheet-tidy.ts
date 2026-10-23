/**
 * [PR-J4, 2026-10-23] Runbook section J increment 4 (J.3 item 5: "a tidy operation affects the selected sheet by default"; OD-258
 * item 5): PER-SHEET TIDY, the pure half of POST /api/schematic/layout-critic for a project organised into sheets.
 *
 * Today's flat tidy inverts the WHOLE page into its logical netlist, re-lays it out with the validated auto-layout and hands the page
 * one new flat state (every id re-minted). For a multi-sheet document that would flatten the project, so J2 refused it
 * (SHEETS_TIDY_PENDING). This module tidies ONE sheet and puts it back:
 *
 *  1. `tidySheetRefusal`: the sheet must exist and be a LEAF (OD-258 item 5: a sheet with child blocks refuses
 *     SHEETS_TIDY_BLOCKS_PENDING - blocks and their sheet pins are hand-placed presentation, not re-laid out in this increment);
 *  2. `sheetLogicalNetlist`: the strict whole-project logical netlist (lib/schematic-to-netlist.ts over THE project connectivity)
 *     filtered to the sheet's own parts: a connection to a port is a label named by the PORT, a rail keeps its exact name and kind,
 *     a sheet-local net its own (path-less) name - exactly what the sheet draws;
 *  3. `mergeTidiedSheet`: the re-laid flat page is merged back onto the project with `mergeSheetAfter`: every component is re-identified
 *     BY REFERENCE DESIGNATOR (unique project-wide), so its id and authority fields (atomic revision, symbol / footprint assets, mapping
 *     certificate, selection record) survive and only x / y / rotation change; the sheet's wires and plain labels are replaced (new ids,
 *     as the flat tidy does today); each port anchor (hierarchical label) keeps its id, scope and port and takes the laid-out label's
 *     position (further laid-out labels of the port's name become further anchors of the same port); a global label keeps its scope;
 *     every other sheet is byte-identical;
 *  4. the proof: the project connectivity's pin-to-net partition digest is unchanged and the canonical validator is clean, else the
 *     result is refused (SHEETS_TIDY_NOT_EQUIVALENT) and nothing is applied.
 *
 * Pure: no I/O, no model call (the route owns the admission bound, the model call and the improved / regressed gates). The auto-layout
 * mints wire and label ids with crypto.randomUUID on the server, as the flat tidy always did; component ids never change here.
 */

import type { CachedPart } from "@/app/lib/parts-cache";
import { validateSchematicStateIntegrity } from "@/app/lib/engineering/schematic-model";
import type { SchematicGraphAfter } from "@/app/lib/engineering/schematic-graph";
import { compareCodePoints } from "@/app/lib/stable-compare";
import { autoLayoutBuildValidated, type AutoLayoutOptions } from "@/lib/build-auto-layout";
import { schematicToBuildNetlist } from "@/lib/schematic-to-netlist";
import { ROOT_SHEET_ID, netLabelNameKey, type BuildLogicalConnection, type BuildLogicalNetlist, type KicadComponentInstance, type NetLabel, type SchematicState } from "@/lib/schematic-types";
import type { NetlistValidation } from "@/lib/validate-netlist";
import { resolveProjectConnectivity, type PartPinsLookup } from "./project-connectivity";
import { mergeSheetAfter, projectSheet } from "./sheet-lens";
import { assertWholeProject, sheetOf, sheetsOf } from "./sheets";

export type SheetTidyRefusalCode = "SHEETS_TIDY_SHEET_REQUIRED" | "SHEETS_TIDY_SHEET_UNKNOWN" | "SHEETS_TIDY_BLOCKS_PENDING" | "SHEETS_TIDY_PARTS_UNRESOLVED" | "SHEETS_TIDY_NOT_EQUIVALENT";

export interface SheetTidyRefusal { ok: false; code: SheetTidyRefusalCode; message: string }

const refuse = (code: SheetTidyRefusalCode, message: string): SheetTidyRefusal => ({ ok: false, code, message: `${message} Nothing was sent and nothing changed.` });

/** The sheet Tidy may re-lay out: a named, existing LEAF sheet of a document with sheets (OD-258 item 5); null when the document has no sheets. */
export function tidySheetRefusal(state: SchematicState, sheetId: unknown): SheetTidyRefusal | null {
  if (state.sheets === undefined) return null;
  if (typeof sheetId !== "string" || sheetId.length === 0) return refuse("SHEETS_TIDY_SHEET_REQUIRED", "Tidy re-lays out ONE sheet of a project organised into sheets; the request names no sheet (open the sheet to tidy and try again).");
  const sheets = sheetsOf(state);
  const sheet = sheets.find((item) => item.id === sheetId);
  if (!sheet) return refuse("SHEETS_TIDY_SHEET_UNKNOWN", `Sheet ${sheetId} does not exist in this project.`);
  const blocks = sheets.filter((item) => item.parentId === sheetId);
  if (blocks.length > 0) {
    const where = sheet.parentId === null ? "The overview" : `Sheet "${sheet.name}"`;
    return refuse("SHEETS_TIDY_BLOCKS_PENDING", `${where} holds ${blocks.length} subsystem block${blocks.length === 1 ? "" : "s"} (${blocks.map((item) => item.name).join(", ")}); Tidy re-lays out subsystem sheets without child blocks only - open one of them to tidy it.`);
  }
  return null;
}

const pinRef = (connection: BuildLogicalConnection): string[] => (connection.kind === "label" ? [connection.pin] : [connection.from, connection.to]);
const refDesOf = (endpoint: string): string => endpoint.split(".")[0] ?? endpoint;

/**
 * The logical netlist of ONE sheet: the strict whole-project netlist filtered to the sheet's parts. A label connection stays when its
 * pin is on the sheet; a wire connection when both pins are. Names: a rail (power / ground) keeps its exact name; a net the authority
 * names by a sheet path ("IMU/M1_GATE") takes the path's last segment (the name the sheet's own label carries; a port net is named by
 * its port, so its anchors are re-created by name in the merge). Throws the authority's SHEET_HIERARCHY_INVALID for a broken document.
 */
export function sheetLogicalNetlist(state: SchematicState, sheetId: string, parts: Map<string, CachedPart>): BuildLogicalNetlist {
  assertWholeProject(state, "sheet-tidy");
  const whole = schematicToBuildNetlist(state, parts);
  const onSheet = new Set((state.kicadComponents ?? []).filter((item) => sheetOf(item) === sheetId).map((item) => item.refDes));
  const components = whole.components.filter((component) => onSheet.has(component.refDes));
  const connections = whole.connections
    .filter((connection) => pinRef(connection).every((endpoint) => onSheet.has(refDesOf(endpoint))))
    .map((connection) => (connection.kind === "label" && connection.labelKind !== "power" && connection.labelKind !== "ground" ? { ...connection, labelName: connection.labelName.split("/").pop()! } : connection));
  return { components, connections, explanation: "" };
}

export interface TidiedSheet {
  ok: true;
  /** The WHOLE project with the sheet re-laid out (every other sheet byte-identical). */
  state: SchematicState;
  /** The sheet's instances after the merge (ids kept; x / y / rotation from the layout). */
  instances: KicadComponentInstance[];
  validation: NetlistValidation;
}

/** The anchor templates of a sheet: its hierarchical labels by port name (document order) and its global labels by name. */
function anchorTemplates(view: ReturnType<typeof projectSheet>): { hierarchical: Map<string, NetLabel[]>; global: Map<string, NetLabel> } {
  const hierarchical = new Map<string, NetLabel[]>();
  const global = new Map<string, NetLabel>();
  for (const label of view.netLabels) {
    const key = netLabelNameKey(label.name);
    if (label.scope === "hierarchical") hierarchical.set(key, [...(hierarchical.get(key) ?? []), label]);
    else if (label.scope === "global" && !global.has(key)) global.set(key, label);
  }
  return { hierarchical, global };
}

/**
 * Merge the re-laid flat page of `sheetId` back onto `base` (see the module header) and prove the project connectivity unchanged. The
 * laid-out page must hold exactly the sheet's parts (by reference designator); any other page is refused with nothing changed.
 */
export function mergeTidiedSheet(base: SchematicState, sheetId: string, laidOut: SchematicState, lookup: PartPinsLookup, validation: NetlistValidation): TidiedSheet | SheetTidyRefusal {
  assertWholeProject(base, "sheet-tidy");
  const view = projectSheet(base, sheetId);
  const laidOutByRef = new Map((laidOut.kicadComponents ?? []).map((item) => [item.refDes, item] as const));
  const missing = view.kicadComponents.filter((item) => !laidOutByRef.has(item.refDes)).map((item) => item.refDes);
  const extra = [...laidOutByRef.keys()].filter((refDes) => !view.kicadComponents.some((item) => item.refDes === refDes));
  if (missing.length > 0 || extra.length > 0) return refuse("SHEETS_TIDY_NOT_EQUIVALENT", `The re-layout does not hold exactly this sheet's parts (${[...missing.map((ref) => `${ref} missing`), ...extra.map((ref) => `${ref} extra`)].join(", ")}).`);
  // components by reference designator: ids and authority fields kept, only the placement taken
  const instances: KicadComponentInstance[] = view.kicadComponents.map((item) => {
    const placed = laidOutByRef.get(item.refDes)!;
    return item.x === placed.x && item.y === placed.y && item.rotation === placed.rotation ? item : { ...item, x: placed.x, y: placed.y, rotation: placed.rotation };
  });
  // labels: a laid-out label named like one of the sheet's ports becomes that port's anchor (the first keeps the original anchor's id);
  // one named like a global label keeps the global scope; every other label is the laid-out local or rail label
  const templates = anchorTemplates(view);
  const used = new Map<string, number>();
  const takenIds = new Set((base.netLabels ?? []).map((label) => label.id));
  const sortedLabels = [...(laidOut.netLabels ?? [])].sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x || compareCodePoints(a.id, b.id));
  const netLabels: NetLabel[] = sortedLabels.map((label) => {
    const key = netLabelNameKey(label.name);
    const anchors = templates.hierarchical.get(key);
    if (anchors && label.kind === "label") {
      const index = used.get(key) ?? 0;
      used.set(key, index + 1);
      const template = anchors[index] ?? anchors[0]!;
      let id = index < anchors.length ? template.id : `${template.portId}:label:tidy:${index + 1}`;
      for (let suffix = 2; index >= anchors.length && takenIds.has(id); suffix += 1) id = `${template.portId}:label:tidy:${index + 1}:${suffix}`;
      takenIds.add(id);
      return { id, position: { ...label.position }, name: template.name, kind: "label", orientation: label.orientation, scope: "hierarchical", portId: template.portId!, ...(sheetId === ROOT_SHEET_ID ? {} : { sheetId }) };
    }
    const globalTemplate = templates.global.get(key);
    if (globalTemplate && label.kind === "label") return { ...label, name: globalTemplate.name, scope: "global", ...(sheetId === ROOT_SHEET_ID ? {} : { sheetId }) };
    return sheetId === ROOT_SHEET_ID ? label : { ...label, sheetId };
  });
  const after: SchematicGraphAfter = { components: laidOut.components, kicadComponents: instances, wires: laidOut.wires, netLabels };
  const merged = mergeSheetAfter(base, sheetId, after);
  const state: SchematicState = { ...base, components: merged.components ?? base.components, kicadComponents: merged.kicadComponents ?? base.kicadComponents ?? [], wires: merged.wires ?? base.wires, netLabels: merged.netLabels ?? base.netLabels ?? [] };
  // the proof: the same pins connected the same way, and a valid canonical document
  const before = resolveProjectConnectivity(base, lookup);
  const now = resolveProjectConnectivity(state, lookup);
  if (!now.ok) return refuse("SHEETS_TIDY_NOT_EQUIVALENT", `The re-laid sheet leaves the project's connectivity invalid (${now.diagnostics.find((item) => item.severity === "error")?.message ?? "see Sheet connections"}).`);
  if (now.partitionDigest !== before.partitionDigest) {
    const changed = before.pins.filter((pin) => { const was = before.netOfPin(pin.key); const is = now.netOfPin(pin.key); return was && is && was.members.join("\u0000") !== is.members.join("\u0000"); }).map((pin) => pin.key);
    return refuse("SHEETS_TIDY_NOT_EQUIVALENT", `The re-laid sheet would change which pins are connected (${changed.slice(0, 6).join(", ")}${changed.length > 6 ? ", ..." : ""}), so the original layout was kept.`);
  }
  const issues = validateSchematicStateIntegrity(state);
  if (issues.length > 0) return refuse("SHEETS_TIDY_NOT_EQUIVALENT", `The re-laid sheet is not a valid document (${issues[0]}), so the original layout was kept.`);
  // the flat validator reads the sheet alone, so a port net's one pin on this sheet is "floating" to it; the port carries that pin to the
  // other sheets (proven above by the project connectivity), so such a violation is expected and not a reason to keep the old layout
  const refOf = (componentId: string): string => (state.kicadComponents ?? []).find((item) => item.id === componentId)?.refDes ?? componentId;
  const carried = new Set(now.nets.filter((net) => net.portIds.length > 0).flatMap((net) => net.pins.map((pin) => `${refOf(pin.componentId)}.${pin.pinId}`)));
  const violations = validation.violations.filter((violation) => !(violation.kind === "floating-pin" && (violation.pins ?? []).length > 0 && violation.pins!.every((pin) => carried.has(pin))));
  return { ok: true, state, instances, validation: { ok: violations.length === 0, violations } };
}

/**
 * Tidy ONE leaf sheet: its logical netlist, the validated auto-layout with the critic's `spread` hints, and the merge with its proof.
 * The caller (the route) decides whether to apply the result (its improved / regressed gates over `instances`).
 */
export function tidySheet(base: SchematicState, sheetId: string, parts: Map<string, CachedPart>, options?: AutoLayoutOptions): TidiedSheet | SheetTidyRefusal {
  const refusal = tidySheetRefusal(base, sheetId);
  if (refusal) return refusal;
  // a part whose catalog record is not loaded has no pins on either side of the proof, so its connections could vanish unproven: refuse
  const unresolved = [...new Set(projectSheet(base, sheetId).kicadComponents.filter((item) => !parts.has(item.partId)).map((item) => item.refDes))].sort(compareCodePoints);
  if (unresolved.length > 0) return refuse("SHEETS_TIDY_PARTS_UNRESOLVED", `The catalog record of ${unresolved.join(", ")} is not loaded, so the re-layout cannot be proven to keep every connection.`);
  const netlist = sheetLogicalNetlist(base, sheetId, parts);
  const { state: laidOut, validation } = autoLayoutBuildValidated(netlist, parts, 3, options);
  return mergeTidiedSheet(base, sheetId, laidOut, (partId) => parts.get(partId) ?? null, validation);
}
