// BOM CSV emission (PCB Stage 14).
//
// Auto-groups: one row per (footprint name, value) tuple — refs comma-joined
// and naturally sorted, quantity = instance count. Values/MPNs come from the
// synced netlist (Stage 4); a board without one (demo boards) groups by
// footprint alone with empty value columns. No live part-sourcing calls here
// (pinned): if the netlist carries an MPN it passes through, else the column
// is empty.
//
// CSV format: RFC 4180 (quote fields containing , " or newlines, double
// internal quotes), CRLF line endings, UTF-8 WITHOUT a BOM byte — some fab
// parsers choke on the marker (test asserts byte 0 !== 0xEF).

import type { PcbBoard } from "../types";
import { assertValidBoardReferences } from "../integrity";
import type { PcbNetlist } from "../netlist-bridge";
import type { BomColumn } from "./types";
import { compareNatural } from "@/app/lib/stable-compare";

export interface BomRow {
  refs: string; // "R7,R8,R9"
  quantity: number;
  value: string;
  footprint: string;
  mpn: string; // empty if unknown
  supplier: string; // empty for MVP
  supplierPart: string; // empty for MVP
  description: string; // footprint metadata when present
}

const HEADERS: Record<BomColumn, string> = {
  refs: "Designator",
  quantity: "Quantity",
  value: "Value",
  footprint: "Footprint",
  mpn: "MPN",
  supplier: "Supplier",
  supplierPart: "Supplier Part",
  description: "Description",
};

const numericCompare = (a: string, b: string): number =>
  compareNatural(a, b, { caseInsensitive: true });

export function computeBomRows(board: PcbBoard, netlist: PcbNetlist): BomRow[] {
  assertValidBoardReferences(board);
  const componentById = new Map(netlist.components.map((c) => [c.id, c]));

  interface Group {
    footprint: string;
    value: string;
    refs: string[];
    mpn: string;
    description: string;
  }
  const groups = new Map<string, Group>();

  for (const inst of board.footprints) {
    if (inst.def.attributes.excludeFromBom) continue;
    const component = componentById.get(inst.id);
    const value = component?.value ?? "";
    const footprint = inst.def.name;
    const key = JSON.stringify([footprint, value]);
    let group = groups.get(key);
    if (!group) {
      group = { footprint, value, refs: [], mpn: "", description: inst.def.description ?? "" };
      groups.set(key, group);
    }
    group.refs.push(inst.ref);
    if (!group.mpn && component?.mpn) group.mpn = component.mpn;
    if (!group.description && inst.def.description) group.description = inst.def.description;
  }

  return [...groups.values()]
    .map((g): BomRow => {
      const refs = [...g.refs].sort(numericCompare);
      return {
        refs: refs.join(","),
        quantity: refs.length,
        value: g.value,
        footprint: g.footprint,
        mpn: g.mpn,
        supplier: "",
        supplierPart: "",
        description: g.description,
      };
    })
    .sort(
      (a, b) =>
        numericCompare(a.footprint, b.footprint) ||
        numericCompare(a.value, b.value) ||
        numericCompare(a.refs, b.refs),
    );
}

/** RFC 4180 field escaping. */
export function csvField(value: string | number): string {
  const s = String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function emitBomCsv(rows: BomRow[], columns: BomColumn[]): string {
  const lines = [columns.map((c) => csvField(HEADERS[c])).join(",")];
  for (const row of rows) {
    lines.push(columns.map((c) => csvField(row[c])).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}
