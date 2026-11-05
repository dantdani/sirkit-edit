/**
 * [PR-J4, 2026-10-23] Section J increment 4 (J.8 item 5): a SIRKIT READER over the exported KiCad hierarchy (format 20250610), not a
 * KiCad run. It parses every exported file with the repository's own S-expression parser (app/lib/pcb/sexpr.ts) and rebuilds the
 * connectivity under KiCad's documented rules, so a test can prove the files connect exactly the pins the project connectivity
 * authority connects (app/lib/schematic/project-connectivity.ts):
 *
 *  - geometry connects per file: a wire end, a symbol pin end, a label anchor or a sheet pin touching another such point, or lying on a
 *    wire segment (its ends or its interior), is connected; wires that merely cross are not;
 *  - `(label ...)` connects by name within its file only; `(global_label ...)` and power symbols (lib_id `power:*`, by their Value)
 *    connect project-wide by exact name (one namespace, as KiCad's);
 *  - `(hierarchical_label "N")` in a child file connects to the `(pin "N" ...)` of the sheet symbol whose Sheetfile names that file;
 *  - a symbol's pin positions come from the file's own embedded `lib_symbols` definitions (every unit), transformed by the symbol's
 *    `(at x y r)` with the editor's rotation convention (app/lib/geometry.ts rotateXY over (x, -y)): the one convention the export is
 *    written with, so a symbol whose definition the file does not embed (a stock-library Theory part) is refused - the oracle never
 *    guesses a pin.
 *
 * Member keys are the authority's `componentId::pinNumber` (app/lib/pcb/integrity.ts schematicEndpointKey); the reference designator
 * of each symbol instance is mapped back to its component id by the caller. Pure: no I/O, no randomness.
 */
import { assertBoundedSExpression } from "@/app/lib/atomic/security";
import { UnionFind } from "@/app/lib/connectivity";
import { rotateXY } from "@/app/lib/geometry";
import { schematicEndpointKey } from "@/app/lib/pcb/integrity";
import { child, children, parseSexpr, type SList, type SNode } from "@/app/lib/pcb/sexpr";
import { compareCodePoints } from "@/app/lib/stable-compare";
import type { Rotation } from "@/lib/schematic-types";

export interface OracleFile { path: string; content: string }

export interface OraclePartition {
  /** Every net with at least one pin: sorted member keys, nets sorted by their first member. Singletons included. */
  nets: string[][];
  /** Every pin the files declare (sorted member keys). */
  pins: string[];
  /** The files read, by path, with the top-level item counts a test may assert. */
  files: Record<string, { symbols: number; powerSymbols: number; wires: number; labels: number; globalLabels: number; hierarchicalLabels: number; sheets: number; sheetPins: number }>;
}

const EPS = 1e-6;
const positionKey = (x: number, y: number): string => `${x.toFixed(3)},${y.toFixed(3)}`;

interface Node { id: string; x: number; y: number }
interface Segment { id: string; ax: number; ay: number; bx: number; by: number }

/** `(x, y)` lies on the closed segment (its ends or its interior). */
function onSegment(x: number, y: number, s: Segment): boolean {
  const cross = (s.bx - s.ax) * (y - s.ay) - (s.by - s.ay) * (x - s.ax);
  if (Math.abs(cross) > EPS) return false;
  return x >= Math.min(s.ax, s.bx) - EPS && x <= Math.max(s.ax, s.bx) + EPS && y >= Math.min(s.ay, s.by) - EPS && y <= Math.max(s.ay, s.by) + EPS;
}

const headOf = (node: SNode): string | null => (node.kind === "list" && node.items[0]?.kind === "symbol" ? node.items[0].value : null);
const text = (node: SNode | undefined): string => { if (!node || node.kind === "list") throw new Error("oracle: expected an atom"); return node.kind === "number" ? node.raw : node.value; };
const numberAt = (list: SList, index: number): number => { const item = list.items[index]; if (!item || item.kind !== "number") throw new Error(`oracle: expected a number at ${index}`); return item.value; };
const property = (list: SList, name: string): string | null => {
  for (const item of children(list, "property")) if (item.items[1] && text(item.items[1]) === name) return text(item.items[2]);
  return null;
};

/** The pins of every embedded library symbol: `Lib:Name` -> [{ number, x, y }] over all unit / body-style sub-symbols. */
function libraryPins(tree: SList): Map<string, Array<{ number: string; x: number; y: number }>> {
  const out = new Map<string, Array<{ number: string; x: number; y: number }>>();
  const libs = child(tree, "lib_symbols");
  if (!libs) return out;
  for (const symbol of children(libs, "symbol")) {
    const libId = text(symbol.items[1]);
    const pins: Array<{ number: string; x: number; y: number }> = [];
    const visit = (node: SNode): void => {
      if (node.kind !== "list") return;
      if (headOf(node) === "pin") {
        const at = child(node, "at");
        const number = child(node, "number");
        if (!at || !number) throw new Error(`oracle: ${libId} has a pin without (at) or (number)`);
        pins.push({ number: text(number.items[1]), x: numberAt(at, 1), y: numberAt(at, 2) });
        return;
      }
      for (const item of node.items) visit(item);
    };
    for (const item of symbol.items) visit(item);
    out.set(libId, pins);
  }
  return out;
}

/**
 * Read the exported hierarchy and return its pin partition. `componentIdOfReference` maps a symbol's Reference back to the project's
 * component id (null refuses the file: an unknown reference is never guessed).
 */
export function readKicadHierarchyPartition(files: readonly OracleFile[], componentIdOfReference: (reference: string) => string | null): OraclePartition {
  const uf = new UnionFind();
  const pinNodeIds = new Map<string, string>(); // node id -> member key
  const summary: OraclePartition["files"] = {};
  for (const file of files) {
    assertBoundedSExpression(file.content);
    const tree = parseSexpr(file.content);
    if (headOf(tree) !== "kicad_sch") throw new Error(`oracle: ${file.path} is not a kicad_sch document`);
    const libs = libraryPins(tree);
    const nodes: Node[] = [];
    const segments: Segment[] = [];
    const counts = { symbols: 0, powerSymbols: 0, wires: 0, labels: 0, globalLabels: 0, hierarchicalLabels: 0, sheets: 0, sheetPins: 0 };
    let serial = 0;
    for (const item of tree.items) {
      if (item.kind !== "list") continue;
      switch (headOf(item)) {
        case "symbol": {
          const libId = text(child(item, "lib_id")?.items[1]);
          const at = child(item, "at");
          if (!at) throw new Error(`oracle: ${file.path}: a symbol without (at)`);
          const sx = numberAt(at, 1), sy = numberAt(at, 2);
          const rotation = (at.items.length > 3 ? numberAt(at, 3) : 0) as Rotation;
          const pins = libs.get(libId);
          if (!pins) throw new Error(`oracle: ${file.path}: ${libId} is not embedded in lib_symbols (a stock-library symbol: its pins cannot be read from the file)`);
          const value = property(item, "Value") ?? "";
          const reference = property(item, "Reference") ?? "";
          const power = libId.startsWith("power:");
          if (power) counts.powerSymbols += 1; else counts.symbols += 1;
          const componentId = power ? null : componentIdOfReference(reference);
          if (!power && componentId === null) throw new Error(`oracle: ${file.path}: no component carries the reference ${JSON.stringify(reference)}`);
          for (const pin of pins) {
            const offset = rotateXY(pin.x, -pin.y, rotation);
            const x = sx + offset.x, y = sy + offset.y;
            if (power) { nodes.push({ id: `global:${value}`, x, y }); continue; }
            const member = schematicEndpointKey(componentId!, pin.number);
            const id = `pin:${member}`;
            if (pinNodeIds.has(id)) throw new Error(`oracle: the pin ${member} is written twice`);
            pinNodeIds.set(id, member);
            nodes.push({ id, x, y });
          }
          break;
        }
        case "wire": {
          const pts = child(item, "pts");
          const xy = pts ? children(pts, "xy") : [];
          if (xy.length !== 2) throw new Error(`oracle: ${file.path}: a wire without two points`);
          segments.push({ id: `wire:${file.path}:${serial++}`, ax: numberAt(xy[0]!, 1), ay: numberAt(xy[0]!, 2), bx: numberAt(xy[1]!, 1), by: numberAt(xy[1]!, 2) });
          counts.wires += 1;
          break;
        }
        case "label": case "global_label": case "hierarchical_label": {
          const name = text(item.items[1]);
          const at = child(item, "at");
          if (!at) throw new Error(`oracle: ${file.path}: a label without (at)`);
          const kind = headOf(item);
          const id = kind === "label" ? `local:${file.path}:${name}` : kind === "global_label" ? `global:${name}` : `hier:${file.path}:${name}`;
          if (kind === "label") counts.labels += 1; else if (kind === "global_label") counts.globalLabels += 1; else counts.hierarchicalLabels += 1;
          nodes.push({ id, x: numberAt(at, 1), y: numberAt(at, 2) });
          break;
        }
        case "sheet": {
          const sheetFile = property(item, "Sheetfile");
          if (sheetFile === null) throw new Error(`oracle: ${file.path}: a sheet symbol without Sheetfile`);
          if (!files.some((candidate) => candidate.path === sheetFile)) throw new Error(`oracle: ${file.path}: Sheetfile ${sheetFile} is not among the exported files`);
          counts.sheets += 1;
          for (const pin of children(item, "pin")) {
            const at = child(pin, "at");
            if (!at) throw new Error(`oracle: ${file.path}: a sheet pin without (at)`);
            nodes.push({ id: `hier:${sheetFile}:${text(pin.items[1])}`, x: numberAt(at, 1), y: numberAt(at, 2) });
            counts.sheetPins += 1;
          }
          break;
        }
        default:
          break;
      }
    }
    // geometry: coincident points are one node; a point on a wire (ends or interior) joins the wire; crossing wires stay apart
    const points: Array<{ key: string; x: number; y: number }> = [];
    const seen = new Set<string>();
    const point = (x: number, y: number): string => { const key = `pt:${file.path}:${positionKey(x, y)}`; if (!seen.has(key)) { seen.add(key); points.push({ key, x, y }); } return key; };
    for (const node of nodes) uf.union(node.id, point(node.x, node.y));
    for (const segment of segments) { uf.union(segment.id, point(segment.ax, segment.ay)); uf.union(segment.id, point(segment.bx, segment.by)); }
    for (const segment of segments) for (const candidate of points) if (onSegment(candidate.x, candidate.y, segment)) uf.union(segment.id, candidate.key);
    summary[file.path] = counts;
  }
  const byRoot = new Map<string, string[]>();
  for (const [id, member] of pinNodeIds) { const root = uf.find(id); byRoot.set(root, [...(byRoot.get(root) ?? []), member]); }
  const nets = [...byRoot.values()].map((members) => [...members].sort(compareCodePoints)).sort((a, b) => compareCodePoints(a[0]!, b[0]!));
  return { nets, pins: [...pinNodeIds.values()].sort(compareCodePoints), files: summary };
}
