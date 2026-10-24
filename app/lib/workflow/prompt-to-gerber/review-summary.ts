/**
 * B16.1C §F — what a schematic proposal will change, stated for the human
 * review dialog before anything is applied. Pure over schematic states.
 *
 * [PR-J5, 2026-10-23] Runbook J.6.1 (OD-259 item 1): a proposal that carries a sheet tree (a planned generation laid out as sheets,
 * lib/build-sheet-layout.ts) is described as such - the overview and its subsystem sheets with their parts, ports and rails, the
 * interfaces that join them, the incomplete (not designed) sheets - and a current document with sheets names every sheet the apply
 * replaces (one undoable transaction). A flat proposal's lines are byte-identical to before.
 */

import { ROOT_SHEET_ID, netLabelNameKey, type SchematicSheet, type SchematicState } from "@/lib/schematic-types";

export interface SchematicProposalSheetSummary {
  /** the overview's name */
  overview: string;
  children: Array<{ name: string; parts: number; ports: string[]; rails: string[]; incomplete: boolean }>;
  /** port names shared by two or more sheets (sorted) */
  interfaces: string[];
  /** the names of every sheet the apply replaces (document order; empty when the current document has no sheets) */
  replacedSheets: string[];
}

export interface SchematicProposalSummary {
  /** True when the current schematic has content that will be replaced. */
  replaces: boolean;
  currentPartCount: number;
  currentWireCount: number;
  parts: string[];
  partCount: number;
  wireCount: number;
  netLabels: string[];
  headline: string;
  details: string[];
  /** present only for a proposal that carries a sheet tree */
  sheets?: SchematicProposalSheetSummary;
}

function refOf(part: { refDes?: string; id: string; value?: string }): string {
  return `${part.refDes ?? part.id}${part.value ? `=${part.value}` : ""}`;
}

const sheetOf = (entity: { sheetId?: string }): string => entity.sheetId ?? ROOT_SHEET_ID;

/** The sentence naming every sheet of `current` the apply replaces, or null for a document without sheets. */
export function replacedSheetsLine(current: Pick<SchematicState, "sheets">): string | null {
  const names = (current.sheets?.sheets ?? []).map((sheet) => sheet.name.trim());
  if (names.length === 0) return null;
  return `Every existing sheet (${names.join(", ")}) is replaced by the apply (one undoable transaction).`;
}

function describeSheets(next: SchematicState, current: Pick<SchematicState, "sheets">): SchematicProposalSheetSummary | null {
  const tree = next.sheets?.sheets;
  if (!tree) return null;
  const root = tree.find((sheet) => sheet.parentId === null);
  const children = tree.filter((sheet): sheet is SchematicSheet => sheet.parentId !== null).map((sheet) => {
    const parts = (next.kicadComponents ?? []).filter((item) => sheetOf(item) === sheet.id).length + next.components.filter((item) => sheetOf(item) === sheet.id && item.type !== "ground").length;
    const rails = [...new Set((next.netLabels ?? []).filter((label) => sheetOf(label) === sheet.id && (label.kind === "power" || label.kind === "ground")).map((label) => label.name))].sort();
    return { name: sheet.name, parts, ports: (sheet.ports ?? []).map((port) => port.name), rails, incomplete: parts === 0 };
  });
  const portCounts = new Map<string, number>();
  for (const child of children) for (const port of child.ports) { const key = netLabelNameKey(port); portCounts.set(key, (portCounts.get(key) ?? 0) + 1); }
  const interfaces = [...portCounts].filter(([, count]) => count >= 2).map(([key]) => key).sort();
  return { overview: root?.name ?? "Overview", children, interfaces, replacedSheets: (current.sheets?.sheets ?? []).map((sheet) => sheet.name.trim()) };
}

export function describeSchematicProposal(next: SchematicState, current: Pick<SchematicState, "components" | "wires" | "kicadComponents" | "netLabels"> & Partial<Pick<SchematicState, "sheets">>): SchematicProposalSummary {
  const currentPartCount = current.components.length + (current.kicadComponents?.length ?? 0);
  const currentWireCount = current.wires.length + (current.netLabels?.length ?? 0);
  const replaces = currentPartCount > 0 || currentWireCount > 0;
  const parts = [...next.components.map((item) => `${item.id}=${item.value}`), ...(next.kicadComponents ?? []).map(refOf)].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const netLabels = [...new Set((next.netLabels ?? []).map((label) => label.name))].sort();
  const partCount = parts.length, wireCount = next.wires.length;
  const sheets = describeSheets(next, current);
  if (sheets) {
    // [PR-J5, 2026-10-23] a sheeted proposal: the headline and details name the sheets; the replaced-sheets sentence when the current document has them
    const count = sheets.children.length;
    const currentSheets = current.sheets?.sheets?.length ?? 0;
    const headline = replaces
      ? `Replace the current schematic (${currentPartCount} part${currentPartCount === 1 ? "" : "s"}, ${currentWireCount} wire${currentWireCount === 1 ? "" : "s"}/labels${currentSheets > 0 ? `, ${currentSheets} sheet${currentSheets === 1 ? "" : "s"}` : ""}) with the generated ${count}-sheet design?`
      : `Apply the generated design as ${count} subsystem sheet${count === 1 ? "" : "s"}?`;
    const incomplete = sheets.children.filter((child) => child.incomplete);
    const details = [
      `${partCount} part${partCount === 1 ? "" : "s"}: ${parts.join(", ") || "none"}`,
      `${wireCount} wire${wireCount === 1 ? "" : "s"}${netLabels.length ? `, net labels: ${netLabels.join(", ")}` : ""}`,
      `${sheets.overview} + ${count} sheet${count === 1 ? "" : "s"}: ${sheets.children.map((child) => `${child.name} (${child.parts} part${child.parts === 1 ? "" : "s"}${child.ports.length ? `; ports ${child.ports.join(", ")}` : ""}${child.rails.length ? `; rails ${child.rails.join(", ")}` : ""})`).join(", ")}`,
      sheets.interfaces.length > 0 ? `Interfaces: ${sheets.interfaces.join(", ")}` : "Interfaces: none (no port is shared by two sheets)",
      ...(incomplete.length > 0 ? [`Incomplete: ${incomplete.map((child) => child.name).join(", ")} (not designed; ports unbound)`] : []),
      replacedSheetsLine(current) ?? (replaces ? "Every existing component, wire and label on this sheet is removed by the apply (one undoable transaction)." : "Nothing existing is removed."),
    ];
    return { replaces, currentPartCount, currentWireCount, parts, partCount, wireCount, netLabels, headline, details, sheets };
  }
  const headline = replaces ? `Replace the current schematic (${currentPartCount} part${currentPartCount === 1 ? "" : "s"}, ${currentWireCount} wire${currentWireCount === 1 ? "" : "s"}/labels) with the generated one?` : "Apply the generated schematic to the empty sheet?";
  const details = [
    `${partCount} part${partCount === 1 ? "" : "s"}: ${parts.join(", ") || "none"}`,
    `${wireCount} wire${wireCount === 1 ? "" : "s"}${netLabels.length ? `, net labels: ${netLabels.join(", ")}` : ""}`,
    replaces ? "Every existing component, wire and label on this sheet is removed by the apply (one undoable transaction)." : "Nothing existing is removed.",
  ];
  return { replaces, currentPartCount, currentWireCount, parts, partCount, wireCount, netLabels, headline, details };
}
