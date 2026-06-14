/**
 * Schematic netlist validation.
 *
 * Trust the NETLIST, not the picture. After `autoLayoutBuild` draws a schematic,
 * this recomputes the ACTUAL electrical netlist from the rendered geometry — the
 * same coordinate-coincidence union-find that SPICE export and rendering use
 * (`buildNetUnionFind`) — and compares it against the INTENDED logical netlist
 * the model produced. Because the union-find joins pins only at exact shared
 * coordinates, it inherently encodes the hard rules: wires crossing without a
 * shared vertex do NOT connect (no accidental junctions), and a wire endpoint
 * merely *near* a pin (not on its grid point) does NOT connect either.
 *
 * It reports, as hard errors:
 *   • self-short      — a 2-terminal part with both pins on one net the netlist
 *                       keeps separate (unless it's a 0Ω/jumper/net-tie/short).
 *   • unintended-merge— one actual net spanning pins the netlist keeps on
 *                       different nets (an accidental short between components).
 *   • broken-connection — pins the netlist puts on one net that ended up split
 *                       across multiple actual nets (a connection didn't take).
 *   • floating-pin    — a pin the netlist connects to something that ended up
 *                       electrically alone.
 *   • unanchored-label— a net label not sitting on any pin or wire vertex.
 *   • unresolved-pin  — an intended connection references a pin that doesn't
 *                       exist on the placed part.
 */

import type {
  BuildLogicalNetlist,
  LogicalNetlist,
  SchematicState,
  KicadComponentInstance,
  Point,
} from "./schematic-types";
import {
  isLabelConnection,
  inferNetLabelKind,
  netLabelNameKey,
  PIN_NAMES,
} from "./schematic-types";
import type { CachedPart } from "@/app/lib/parts-cache";
import type { KicadPin } from "@/app/lib/kicad/types";
import { UnionFind, buildNetUnionFind } from "@/app/lib/connectivity";
import { kicadPinWorldPos, pinWorldPos, pointKey } from "@/app/lib/geometry";

export type NetlistViolationKind =
  | "self-short"
  | "unintended-merge"
  | "broken-connection"
  | "floating-pin"
  | "unanchored-label"
  | "unresolved-pin";

export type NetlistViolation = {
  kind: NetlistViolationKind;
  message: string;
  /** Canonical pin ids ("refDes.pinNumber") involved, when applicable. */
  pins?: string[];
  refDes?: string;
  /** For broken-connection: true when the split net is the ground net. */
  ground?: boolean;
};

export type NetlistValidation = { ok: boolean; violations: NetlistViolation[] };

const GND_NODE = "##GND##";

// A 2-terminal part is *allowed* to short its own pins when it is a deliberate
// link: 0Ω resistor, jumper, net-tie, solder bridge, test short.
const JUMPER_RE =
  /\b0\s*(r|ohm|ohms|Ω)\b|jumper|net[\s-]?tie|nettie|solder\s*bridge|test\s*short|0[\s-]?ohm|\blink\b|\bshort\b/i;

function isAllowedShort(value: string | undefined, extra = ""): boolean {
  const v = (value ?? "").trim();
  if (/^0(\.0+)?$/.test(v)) return true; // bare "0" / "0.0" Ω link
  return JUMPER_RE.test(`${v} ${extra}`);
}

function findPin(part: CachedPart, token: string): KicadPin | undefined {
  const target = token.trim().toLowerCase();
  if (target === "") return undefined;
  return part.pins.find(
    (p) => p.name.toLowerCase() === target || p.number.toLowerCase() === target,
  );
}

type GeomPin = { pinId: string; refDes: string; point: Point };

/**
 * Validate the drawn schematic (`state`) against the intended netlist (`logical`).
 * `parts` resolves each placed instance's catalog pins.
 */
export function validateSchematicNetlist(
  logical: BuildLogicalNetlist,
  state: SchematicState,
  parts: Map<string, CachedPart>,
): NetlistValidation {
  const violations: NetlistViolation[] = [];

  const instByRef = new Map<string, { inst: KicadComponentInstance; part: CachedPart }>();
  for (const inst of state.kicadComponents ?? []) {
    const part = parts.get(inst.partId);
    if (part) instByRef.set(inst.refDes, { inst, part });
  }
  const logicalByRef = new Map(logical.components.map((c) => [c.refDes, c]));

  // ── Geometry pins + actual electrical partition ─────────────────────────────
  const geomPins: GeomPin[] = [];
  const pinsByRef = new Map<string, GeomPin[]>();
  const kicadPinPoints: Point[] = [];
  for (const [refDes, { inst, part }] of instByRef) {
    for (const pin of part.pins) {
      const point = kicadPinWorldPos(inst, pin);
      const gp: GeomPin = { pinId: `${refDes}.${pin.number}`, refDes, point };
      geomPins.push(gp);
      kicadPinPoints.push(point);
      const list = pinsByRef.get(refDes);
      if (list) list.push(gp);
      else pinsByRef.set(refDes, [gp]);
    }
  }

  const auf = buildNetUnionFind(
    state.components,
    state.wires,
    kicadPinPoints,
    state.netLabels ?? [],
  );
  const aRootOf = new Map<string, string>();
  for (const g of geomPins) {
    const k = pointKey(g.point);
    aRootOf.set(g.pinId, auf.has(k) ? auf.find(k) : `solo:${g.pinId}`);
  }

  // ── Intended electrical partition (union-find over pin ids + net nodes) ──────
  const iuf = new UnionFind();
  const intendedConnected = new Set<string>(); // pins the netlist joins to something

  const resolvePinId = (endpoint: string): string | null => {
    const t = endpoint.trim();
    if (t.toUpperCase() === "GND") return GND_NODE;
    const idx = t.indexOf(".");
    const refDes = idx < 0 ? t : t.slice(0, idx);
    const token = idx < 0 ? "" : t.slice(idx + 1);
    const entry = instByRef.get(refDes);
    if (!entry) return null;
    const pin = findPin(entry.part, token);
    if (!pin) return null;
    return `${refDes}.${pin.number}`;
  };

  for (const conn of logical.connections) {
    if (isLabelConnection(conn)) {
      const id = resolvePinId(conn.pin);
      if (id === null) {
        violations.push({ kind: "unresolved-pin", message: `label "${conn.labelName}" references unknown pin "${conn.pin}".` });
        continue;
      }
      const kind = conn.labelKind ?? inferNetLabelKind(conn.labelName);
      const node = kind === "ground" ? GND_NODE : `##LBL:${netLabelNameKey(conn.labelName)}##`;
      iuf.union(id, node);
      if (id !== GND_NODE) intendedConnected.add(id);
    } else {
      const a = resolvePinId(conn.from);
      const b = resolvePinId(conn.to);
      if (a === null || b === null) {
        violations.push({ kind: "unresolved-pin", message: `wire "${conn.from}" → "${conn.to}" references an unknown pin.` });
        continue;
      }
      iuf.union(a, b);
      if (a !== GND_NODE) intendedConnected.add(a);
      if (b !== GND_NODE) intendedConnected.add(b);
    }
  }
  const iRootOf = (pinId: string): string => (iuf.has(pinId) ? iuf.find(pinId) : `solo:${pinId}`);
  const groundRoot = iuf.has(GND_NODE) ? iuf.find(GND_NODE) : null;

  // ── 1/2. self-shorts (2-terminal parts) ─────────────────────────────────────
  const selfShortRoots = new Set<string>();
  for (const [refDes, gps] of pinsByRef) {
    if (gps.length !== 2) continue;
    const [p1, p2] = gps;
    const ar = aRootOf.get(p1.pinId)!;
    if (ar !== aRootOf.get(p2.pinId)) continue; // not shorted in the drawing
    if (iRootOf(p1.pinId) === iRootOf(p2.pinId)) continue; // netlist intends them joined
    const lp = logicalByRef.get(refDes);
    const sp = instByRef.get(refDes)?.part;
    if (isAllowedShort(lp?.value, `${sp?.name ?? ""} ${sp?.description ?? ""}`)) continue;
    selfShortRoots.add(ar);
    violations.push({
      kind: "self-short",
      refDes,
      pins: [p1.pinId, p2.pinId],
      message: `${refDes}: both terminals sit on the same net, but the netlist keeps them separate (self-short).`,
    });
  }

  // ── group helpers ───────────────────────────────────────────────────────────
  const groupBy = (rootOf: (id: string) => string): Map<string, string[]> => {
    const m = new Map<string, string[]>();
    for (const g of geomPins) {
      const r = rootOf(g.pinId);
      const list = m.get(r);
      if (list) list.push(g.pinId);
      else m.set(r, [g.pinId]);
    }
    return m;
  };
  const actualGroups = groupBy((id) => aRootOf.get(id)!);
  const intendedGroups = groupBy(iRootOf);

  // ── 6a. unintended merges (one actual net spans ≥2 EXPLICIT intended nets) ──
  // Only nets the netlist actually defines count. A pin the netlist never
  // mentions (NC/spare, or one of an IC's many shared power/ground pins it
  // didn't individually address) isn't "kept on a different net", so it can't,
  // by itself, constitute a merge — otherwise every ground net with an
  // unaddressed pin would false-positive.
  for (const [root, pinIds] of actualGroups) {
    if (pinIds.length < 2 || selfShortRoots.has(root)) continue;
    const explicitRoots = new Set(
      pinIds.map(iRootOf).filter((r) => !r.startsWith("solo:")),
    );
    if (explicitRoots.size > 1) {
      const offenders = pinIds.filter((id) => !iRootOf(id).startsWith("solo:"));
      violations.push({
        kind: "unintended-merge",
        pins: offenders,
        message: `Net merges pins the netlist keeps on different nets: ${offenders.join(", ")}.`,
      });
    }
  }

  // ── 6b. broken connections (one intended net split across ≥2 actual nets) ────
  for (const [root, pinIds] of intendedGroups) {
    if (root.startsWith("solo:") || pinIds.length < 2) continue;
    const actualRoots = new Set(pinIds.map((id) => aRootOf.get(id)!));
    if (actualRoots.size > 1) {
      violations.push({
        kind: "broken-connection",
        pins: pinIds,
        ground: groundRoot !== null && root === groundRoot,
        message: `Pins that should share one net are split across ${actualRoots.size} nets: ${pinIds.join(", ")}.`,
      });
    }
  }

  // ── 6c. floating required pins ───────────────────────────────────────────────
  for (const g of geomPins) {
    if (!intendedConnected.has(g.pinId)) continue;
    const ar = aRootOf.get(g.pinId)!;
    const groupSize = actualGroups.get(ar)?.length ?? 1;
    if (groupSize <= 1) {
      violations.push({
        kind: "floating-pin",
        pins: [g.pinId],
        refDes: g.refDes,
        message: `${g.pinId} is connected in the netlist but ended up electrically floating.`,
      });
    }
  }

  // ── 5. net labels must be anchored to a pin or wire vertex ──────────────────
  const anchorKeys = new Set<string>();
  for (const g of geomPins) anchorKeys.add(pointKey(g.point));
  for (const c of state.components) {
    // Theory components in build output are just the shared ground symbol.
    anchorKeys.add(pointKey(pinWorldPos(c, "pin")));
  }
  for (const w of state.wires) for (const v of w.vertices) anchorKeys.add(pointKey(v));
  for (const label of state.netLabels ?? []) {
    if (!anchorKeys.has(pointKey(label.position))) {
      violations.push({
        kind: "unanchored-label",
        message: `Net label "${label.name}" at (${label.position.x},${label.position.y}) is not on any pin or wire.`,
      });
    }
  }

  return { ok: violations.length === 0, violations };
}

/**
 * Theory-mode equivalent of validateSchematicNetlist. The idealized netlist uses
 * `componentId.pinName` endpoints (no labels, no GND sentinel — ground is a real
 * `ground` component). All ground-component pins are treated as ONE net in both
 * partitions, matching how SPICE export normalizes every ground to node 0, so
 * multiple ground symbols never read as a spurious split or merge.
 */
export function validateTheoryNetlist(
  logical: LogicalNetlist,
  state: SchematicState,
): NetlistValidation {
  const violations: NetlistViolation[] = [];
  const compById = new Map(state.components.map((c) => [c.id, c]));
  const logicalById = new Map(logical.components.map((c) => [c.id, c]));

  // Geometry pins (theory components expose pins via PIN_NAMES).
  type TPin = { pinId: string; ownerId: string; point: Point; ground: boolean };
  const pins: TPin[] = [];
  const pinsByOwner = new Map<string, TPin[]>();
  for (const c of state.components) {
    for (const name of PIN_NAMES[c.type] ?? []) {
      const tp: TPin = {
        pinId: `${c.id}.${name}`,
        ownerId: c.id,
        point: pinWorldPos(c, name),
        ground: c.type === "ground",
      };
      pins.push(tp);
      const list = pinsByOwner.get(c.id);
      if (list) list.push(tp);
      else pinsByOwner.set(c.id, [tp]);
    }
  }

  // Actual partition, with all ground pins collapsed to one net (SPICE node 0).
  const auf = buildNetUnionFind(state.components, state.wires);
  const rawActual = (p: TPin): string => {
    const k = pointKey(p.point);
    return auf.has(k) ? auf.find(k) : `solo:${p.pinId}`;
  };
  const GND_A = "##GND_ACTUAL##";
  const groundActualRaw = new Set(pins.filter((p) => p.ground).map(rawActual));
  const aRootOf = new Map<string, string>();
  for (const p of pins) {
    const r = rawActual(p);
    aRootOf.set(p.pinId, groundActualRaw.has(r) ? GND_A : r);
  }

  // Intended partition.
  const iuf = new UnionFind();
  const intendedConnected = new Set<string>();
  const resolve = (ep: string): string | null => {
    const t = ep.trim();
    const idx = t.indexOf(".");
    const id = idx < 0 ? t : t.slice(0, idx);
    const pin = idx < 0 ? "" : t.slice(idx + 1);
    const c = compById.get(id);
    if (!c || !(PIN_NAMES[c.type] ?? []).includes(pin)) return null;
    return `${id}.${pin}`;
  };
  for (const conn of logical.connections) {
    const a = resolve(conn.from);
    const b = resolve(conn.to);
    if (a === null || b === null) {
      violations.push({ kind: "unresolved-pin", message: `connection "${conn.from}" → "${conn.to}" references an unknown pin.` });
      continue;
    }
    iuf.union(a, b);
    intendedConnected.add(a);
    intendedConnected.add(b);
  }
  const rawI = (pinId: string): string => (iuf.has(pinId) ? iuf.find(pinId) : `solo:${pinId}`);
  const GND_I = "##GND_INTENDED##";
  const groundIntendedRaw = new Set(pins.filter((p) => p.ground).map((p) => rawI(p.pinId)));
  const iRootOf = (pinId: string): string => {
    const r = rawI(pinId);
    return groundIntendedRaw.has(r) ? GND_I : r;
  };

  const groupBy = (rootOf: (id: string) => string): Map<string, string[]> => {
    const m = new Map<string, string[]>();
    for (const p of pins) {
      const r = rootOf(p.pinId);
      const list = m.get(r);
      if (list) list.push(p.pinId);
      else m.set(r, [p.pinId]);
    }
    return m;
  };
  const actualGroups = groupBy((id) => aRootOf.get(id)!);
  const intendedGroups = groupBy(iRootOf);

  // self-shorts (2-terminal parts; a shorted source is a real error, not a link)
  const selfShortRoots = new Set<string>();
  for (const [ownerId, ps] of pinsByOwner) {
    if (ps.length !== 2) continue;
    const [p1, p2] = ps;
    const ar = aRootOf.get(p1.pinId)!;
    if (ar !== aRootOf.get(p2.pinId)) continue;
    if (iRootOf(p1.pinId) === iRootOf(p2.pinId)) continue;
    if (isAllowedShort(logicalById.get(ownerId)?.value)) continue;
    selfShortRoots.add(ar);
    violations.push({
      kind: "self-short",
      refDes: ownerId,
      pins: [p1.pinId, p2.pinId],
      message: `${ownerId}: both terminals sit on the same net, but the netlist keeps them separate (self-short).`,
    });
  }

  // unintended merges (one actual net spanning ≥2 EXPLICIT intended nets)
  for (const [root, pinIds] of actualGroups) {
    if (pinIds.length < 2 || selfShortRoots.has(root)) continue;
    const explicit = new Set(pinIds.map(iRootOf).filter((r) => !r.startsWith("solo:")));
    if (explicit.size > 1) {
      const offenders = pinIds.filter((id) => !iRootOf(id).startsWith("solo:"));
      violations.push({
        kind: "unintended-merge",
        pins: offenders,
        message: `Net merges pins the netlist keeps on different nets: ${offenders.join(", ")}.`,
      });
    }
  }

  // broken connections (one intended net split across ≥2 actual nets)
  for (const [root, pinIds] of intendedGroups) {
    if (root.startsWith("solo:") || pinIds.length < 2) continue;
    const aroots = new Set(pinIds.map((id) => aRootOf.get(id)!));
    if (aroots.size > 1) {
      violations.push({
        kind: "broken-connection",
        pins: pinIds,
        ground: root === GND_I,
        message: `Pins that should share one net are split across ${aroots.size} nets: ${pinIds.join(", ")}.`,
      });
    }
  }

  // floating required pins
  for (const p of pins) {
    if (!intendedConnected.has(p.pinId)) continue;
    const size = actualGroups.get(aRootOf.get(p.pinId)!)?.length ?? 1;
    if (size <= 1) {
      violations.push({
        kind: "floating-pin",
        pins: [p.pinId],
        refDes: p.ownerId,
        message: `${p.pinId} is connected in the netlist but ended up electrically floating.`,
      });
    }
  }

  return { ok: violations.length === 0, violations };
}

/**
 * Reroute fix for `broken-connection` violations: rewrite the wire connections
 * inside each split net as net LABELS sharing one name, so the net reconnects by
 * name regardless of geometry (a wire that didn't physically take → a label that
 * always does). Ground splits relabel as "GND". Merges/self-shorts are geometry
 * faults that relabeling can't fix and are left for the caller to surface.
 */
export function rerouteToLabels(
  netlist: BuildLogicalNetlist,
  parts: Map<string, CachedPart>,
  state: SchematicState,
  violations: NetlistViolation[],
): BuildLogicalNetlist {
  const broken = violations.filter(
    (v): v is NetlistViolation & { pins: string[] } => v.kind === "broken-connection" && !!v.pins,
  );
  if (broken.length === 0) return netlist;

  const instByRef = new Map<string, CachedPart>();
  for (const inst of state.kicadComponents ?? []) {
    const part = parts.get(inst.partId);
    if (part) instByRef.set(inst.refDes, part);
  }
  const resolvePinId = (endpoint: string): string | null => {
    const t = endpoint.trim();
    if (t.toUpperCase() === "GND") return GND_NODE;
    const idx = t.indexOf(".");
    const refDes = idx < 0 ? t : t.slice(0, idx);
    const token = idx < 0 ? "" : t.slice(idx + 1);
    const part = instByRef.get(refDes);
    if (!part) return null;
    const pin = findPin(part, token);
    return pin ? `${refDes}.${pin.number}` : null;
  };

  const implicated = new Set<string>();
  for (const v of broken) for (const p of v.pins) implicated.add(p);

  // Drop wire connections wholly inside an implicated split net.
  const kept = netlist.connections.filter((conn) => {
    if (isLabelConnection(conn)) return true;
    const a = resolvePinId(conn.from);
    const b = resolvePinId(conn.to);
    return !(a !== null && b !== null && implicated.has(a) && implicated.has(b));
  });

  let fixCounter = 0;
  for (const v of broken) {
    const ground = v.ground === true;
    const name = ground ? "GND" : `NET_FIX${++fixCounter}`;
    for (const pinId of v.pins) {
      kept.push({ kind: "label", pin: pinId, labelName: name, labelKind: ground ? "ground" : "label" });
    }
  }

  return { ...netlist, connections: kept };
}
