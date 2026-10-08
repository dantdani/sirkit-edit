/**
 * [B24-B2] Power and ground facts (D24-16, OD-205; runbook B24-B :1058 "- power and ground preservation;"). Test-side and pure: it
 * reads the schematic (and a board) it is given, writes nothing and imports no I/O.
 *
 * For every net `classifyNets` (app/lib/nets.ts) rates power or ground it records:
 *  - the net's name: its label names (case-normalized, sorted, joined by "|"), or with no label the derived rail name, or GND / PWR;
 *  - its symbols: the `power`/`ground` net labels on it (`kind:NAME`, lib/schematic-types.ts NetLabelKind);
 *  - its member pins, keyed `componentId:pin` (the stable id and the pin's name or number, never the refDes, so a KiCad rename is no
 *    change);
 *  - on a board, each board net of the same name: its id, its net-class assignment (`board.netClassing`) and its pads.
 *
 * `powerGroundViolations` compares two fact sets under the B2 contract (OD-205 as applied, OD-228 (c)):
 *  - member rule (no exemption): over the surviving components (the target of a sealed delete or replacement excluded, its operation
 *    names it), every power/ground pin keeps its role and exactly its co-members - a pin that leaves, joins, splits off or merges is a
 *    violation;
 *  - net rule: every power/ground net the sealed proposal does not name keeps its role, name, symbols and surviving members; a net is
 *    named when its name or one of its symbols is in the proposal's named set (operation targets or the sealed removedLabelNames);
 *  - board rule: every power/ground board net not named keeps its id, its net-class assignment and its pads.
 */
import type { KicadPin } from "@/app/lib/kicad/types";
import { kicadPinWorldPos, pinWorldPos, pointKey } from "@/app/lib/geometry";
import { buildNetUnionFind } from "@/app/lib/connectivity";
import { classifyNets } from "@/app/lib/nets";
import type { PcbBoard } from "@/app/lib/pcb/types";
import { PIN_NAMES, netLabelNameKey, type Point, type SchematicState } from "@/lib/schematic-types";

export type PowerGroundRole = "power" | "ground";
export interface PowerGroundNetFact {
  readonly role: PowerGroundRole;
  readonly name: string;
  /** `power:NAME` / `ground:NAME` labels on the net, sorted */
  readonly symbols: readonly string[];
  /** `componentId:pin`, sorted */
  readonly members: readonly string[];
}
export interface PowerGroundBoardFact {
  readonly name: string;
  readonly netId: number;
  /** the canonical JSON of `board.netClassing.assignments[netId]`, or "none" */
  readonly netClass: string;
  /** `footprintId:pad`, sorted */
  readonly pads: readonly string[];
}
export interface PowerGroundFacts {
  readonly nets: readonly PowerGroundNetFact[];
  readonly board: readonly PowerGroundBoardFact[] | null;
}
/** KiCad pin data by part id (the catalog the test supplies; the agent's run context carries none). */
export type PinsOf = (partId: string) => readonly KicadPin[] | null;

const canonical = (value: unknown): string => JSON.stringify(value, (_key, item: unknown) => (item && typeof item === "object" && !Array.isArray(item) ? Object.fromEntries(Object.entries(item as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : item));

/** The power and ground facts of a schematic (and of a board, when given). Pure. */
export function powerGroundFacts(schematic: SchematicState, board?: PcbBoard, pinsOf: PinsOf = () => null): PowerGroundFacts {
  const components = schematic.components;
  const kicad = schematic.kicadComponents ?? [];
  const labels = schematic.netLabels ?? [];
  const sites: Array<{ point: Point; member: string }> = [];
  const kicadPinPoints: Point[] = [];
  for (const component of components) for (const pin of PIN_NAMES[component.type] ?? []) sites.push({ point: pinWorldPos(component, pin), member: `${component.id}:${pin}` });
  for (const instance of kicad) {
    for (const pin of pinsOf(instance.partId) ?? []) {
      const point = kicadPinWorldPos(instance, pin);
      kicadPinPoints.push(point);
      sites.push({ point, member: `${instance.id}:${pin.number}` });
    }
  }
  const getPart = (partId: string): { pins: KicadPin[] } | null => {
    const pins = pinsOf(partId);
    return pins ? { pins: [...pins] } : null;
  };
  const classification = classifyNets(components, schematic.wires, kicad, getPart, labels);
  const uf = buildNetUnionFind(components, schematic.wires, kicadPinPoints, labels);
  const rootOf = (point: Point): string | null => (uf.has(pointKey(point)) ? uf.find(pointKey(point)) : null);

  const nets = new Map<string, { role: PowerGroundRole; labelNames: Set<string>; symbols: string[]; members: string[] }>();
  const netAt = (point: Point): ReturnType<typeof nets.get> => {
    const role = classification.roleAt(point);
    const root = rootOf(point);
    if ((role !== "power" && role !== "ground") || root === null) return undefined;
    if (!nets.has(root)) nets.set(root, { role, labelNames: new Set(), symbols: [], members: [] });
    return nets.get(root);
  };
  for (const site of sites) netAt(site.point)?.members.push(site.member);
  for (const label of labels) {
    const net = netAt(label.position);
    if (!net) continue;
    net.labelNames.add(netLabelNameKey(label.name));
    if (label.kind === "power" || label.kind === "ground") net.symbols.push(`${label.kind}:${netLabelNameKey(label.name)}`);
  }
  const railName = new Map<string, string>();
  for (const rail of classification.labels) {
    const root = rootOf(rail.point);
    if (root !== null) railName.set(root, netLabelNameKey(rail.name));
  }
  const facts: PowerGroundNetFact[] = [...nets].map(([root, net]) => ({
    role: net.role,
    name: net.labelNames.size > 0 ? [...net.labelNames].sort().join("|") : railName.get(root) ?? (net.role === "ground" ? "GND" : "PWR"),
    symbols: Object.freeze([...net.symbols].sort()),
    members: Object.freeze([...net.members].sort()),
  }));
  const order = (fact: PowerGroundNetFact): readonly string[] => [fact.role, fact.name, canonical(fact)];
  facts.sort((a, b) => {
    const [x, y] = [order(a), order(b)];
    const at = x.findIndex((part, index) => part !== y[index]);
    return at < 0 ? 0 : x[at]! < y[at]! ? -1 : 1;
  });

  let boardFacts: PowerGroundBoardFact[] | null = null;
  if (board) {
    const names = new Set(facts.flatMap((fact) => fact.name.split("|")));
    boardFacts = board.nets
      .filter((net) => net.id !== 0 && names.has(netLabelNameKey(net.name)))
      .map((net) => ({
        name: netLabelNameKey(net.name),
        netId: net.id,
        netClass: board.netClassing?.assignments[net.id] === undefined ? "none" : canonical(board.netClassing.assignments[net.id]),
        pads: Object.freeze(board.footprints.flatMap((footprint) => Object.entries(footprint.padNets ?? {}).filter(([, netId]) => netId === net.id).map(([pad]) => `${footprint.id}:${pad}`)).sort()),
      }))
      .sort((a, b) => a.netId - b.netId);
  }
  return Object.freeze({ nets: Object.freeze(facts), board: boardFacts === null ? null : Object.freeze(boardFacts) });
}

export interface PowerGroundContract {
  /** the components a sealed delete or replacement targets (their pins are excluded from the member rule) */
  readonly targets?: readonly string[];
  /** the net names the sealed proposal names (operation targets, removedLabelNames) */
  readonly named?: readonly string[];
}

/** Every way `after` breaks the power and ground invariant against `before` under the contract; [] when it holds. Pure. */
export function powerGroundViolations(before: PowerGroundFacts, after: PowerGroundFacts, contract: PowerGroundContract = {}): string[] {
  const targets = new Set(contract.targets ?? []);
  const named = new Set((contract.named ?? []).map(netLabelNameKey));
  const surviving = (member: string): boolean => !targets.has(member.slice(0, member.lastIndexOf(":")));
  const isNamed = (fact: PowerGroundNetFact): boolean => fact.name.split("|").some((name) => named.has(name)) || fact.symbols.some((symbol) => named.has(symbol.slice(symbol.indexOf(":") + 1)));
  const violations: string[] = [];

  // member rule: each surviving pin's role and co-members
  const membership = (facts: PowerGroundFacts): Map<string, string> => {
    const map = new Map<string, string>();
    for (const fact of facts.nets) {
      const members = fact.members.filter(surviving);
      for (const member of members) map.set(member, `${fact.role} [${members.join(", ")}]`);
    }
    return map;
  };
  const was = membership(before);
  const now = membership(after);
  for (const pin of [...new Set([...was.keys(), ...now.keys()])].sort()) {
    if (was.get(pin) !== now.get(pin)) violations.push(`member ${pin}: ${was.get(pin) ?? "on no power/ground net"} -> ${now.get(pin) ?? "on no power/ground net"}`);
  }

  // net rule: the nets the proposal does not name
  const netKey = (fact: PowerGroundNetFact): string => canonical({ role: fact.role, name: fact.name, symbols: fact.symbols, members: fact.members.filter(surviving) });
  const kept = (facts: PowerGroundFacts): string[] => facts.nets.filter((fact) => !isNamed(fact)).map(netKey).sort();
  const keptBefore = kept(before);
  const keptAfter = kept(after);
  for (const key of keptBefore.filter((item) => !keptAfter.includes(item))) violations.push(`net changed or lost: ${key}`);
  for (const key of keptAfter.filter((item) => !keptBefore.includes(item))) violations.push(`net changed or gained: ${key}`);

  // board rule: the board nets the proposal does not name
  if (before.board !== null || after.board !== null) {
    const boardKeys = (facts: PowerGroundFacts): string[] => (facts.board ?? []).filter((fact) => !named.has(fact.name)).map((fact) => canonical(fact)).sort();
    const boardBefore = boardKeys(before);
    const boardAfter = boardKeys(after);
    for (const key of boardBefore.filter((item) => !boardAfter.includes(item))) violations.push(`board net changed or lost: ${key}`);
    for (const key of boardAfter.filter((item) => !boardBefore.includes(item))) violations.push(`board net changed or gained: ${key}`);
  }
  return violations;
}
