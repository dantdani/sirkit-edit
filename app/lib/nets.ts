/**
 * Net classification for the schematic editor.
 *
 * Derives, from the current components + wires + net labels, which electrical
 * net each wire belongs to and whether that net is power, ground, a plain
 * signal, or unknown (floating). This drives diagram-style rendering: power
 * nets render red, ground stays grey, signals teal, and floating wires
 * neutral.
 *
 * Nets themselves are not stored — they are recomputed from connectivity
 * (the same union-find the editor and SPICE export use), so this stays in sync
 * with manual edits automatically. Classification is heuristic: pin NAMES win
 * (an explicit "GND" pin is ground even if KiCad typed it `power_in`), with pin
 * TYPE as a fallback. Net labels vote too: a "ground"-kind label grounds its
 * net; a "power"-kind label (or a power-named one) marks it as power.
 */

import type { NetLabel as SchNetLabel, Point, SchComponent, Wire, KicadComponentInstance } from "@/lib/schematic-types";
import type { KicadPin } from "@/app/lib/kicad/types";
import { buildNetUnionFind } from "./connectivity";
import { pinWorldPos, kicadPinWorldPos, pointKey } from "./geometry";

export type NetRole = "power" | "ground" | "signal" | "unknown";

export type RailLabel = {
  point: Point;
  name: string;
  color: string;
  role: NetRole;
};

export type NetClassification = {
  /** Net role of the net a wire sits on. */
  wireRole: (wire: Wire) => NetRole;
  /** Stroke color for a wire, by the role of the net it sits on. */
  wireColor: (wire: Wire) => string;
  /** Net role at an arbitrary world point (pin site, label anchor, vertex). */
  roleAt: (point: Point) => NetRole;
  /** One derived label per power/ground net that has no explicit NetLabel. */
  labels: RailLabel[];
};

// Spec palette: power red, ground grey, signal teal, unknown neutral.
export const NET_ROLE_COLORS: Record<NetRole, string> = {
  power: "#ef4444",   // red-500
  ground: "#71717a",  // zinc-500
  signal: "#14b8a6",  // teal-500
  unknown: "#a1a1aa", // zinc-400
};

const GND_NAME = /^(gnd\d*|gndd?|agnd|dgnd|pgnd|egnd|vss\d*|vee|0v?|0)$/i;
const PWR_NAME = /^(vcc\w*|vdd\w*|vbus|vin|vsys|vbat|vaa|avcc|dvcc|v\+|\+?\d+v\d*|\+?\d+\.\d+v?)$/i;

type Vote = { role: NetRole; name: string | null };

function classifyKicadPin(pin: KicadPin): Vote | null {
  const name = (pin.name ?? "").trim();
  if (GND_NAME.test(name)) return { role: "ground", name: "GND" };
  if (PWR_NAME.test(name)) return { role: "power", name: name.toUpperCase() };
  // Many KiCad GND pins are typed `power_in` too — but the name check above
  // already caught those, so a type-only power pin is a genuine supply pin.
  if (pin.type === "power_in" || pin.type === "power_out") {
    return { role: "power", name: name ? name.toUpperCase() : null };
  }
  return null;
}

function classifyNetLabel(label: SchNetLabel): Vote | null {
  const name = label.name.trim().toUpperCase();
  if (label.kind === "ground" || GND_NAME.test(name)) return { role: "ground", name: "GND" };
  if (label.kind === "power" || PWR_NAME.test(name)) return { role: "power", name };
  return null; // generic signal label — its net stays "signal"
}

const ROLE_RANK: Record<NetRole, number> = { ground: 3, power: 2, signal: 1, unknown: 0 };

function mergeVote(prev: Vote | undefined, next: Vote): Vote {
  if (!prev) return next;
  if (ROLE_RANK[next.role] > ROLE_RANK[prev.role]) return next;
  if (ROLE_RANK[next.role] < ROLE_RANK[prev.role]) return prev;
  // Same role — prefer the one that carries a (more specific) name.
  if (!prev.name && next.name) return next;
  return prev;
}

/**
 * Classify every net in the schematic. `getPart` resolves a placed KiCad
 * instance's catalog data (pins); pass the client parts cache.
 */
export function classifyNets(
  components: SchComponent[],
  wires: Wire[],
  kicadComponents: KicadComponentInstance[],
  getPart: (partId: string) => { pins: KicadPin[] } | null,
  netLabels: SchNetLabel[] = [],
): NetClassification {
  // Gather pin votes + the KiCad pin world positions the union-find needs.
  const kicadPinPoints: Point[] = [];
  const pinVotes: { point: Point; vote: Vote }[] = [];
  // Every pin site, voting or not — a net touching any pin is at least
  // "signal"; a net touching none (a floating wire) is "unknown".
  const pinSiteKeys = new Set<string>();

  for (const inst of kicadComponents) {
    const part = getPart(inst.partId);
    if (!part) continue;
    for (const pin of part.pins) {
      const point = kicadPinWorldPos(inst, pin);
      kicadPinPoints.push(point);
      pinSiteKeys.add(pointKey(point));
      const vote = classifyKicadPin(pin);
      if (vote) pinVotes.push({ point, vote });
    }
  }

  for (const c of components) {
    if (c.type === "ground") {
      const p = pinWorldPos(c, "pin");
      pinSiteKeys.add(pointKey(p));
      pinVotes.push({ point: p, vote: { role: "ground", name: "GND" } });
    } else if (c.type === "voltage-source") {
      const plus = pinWorldPos(c, "+");
      const minus = pinWorldPos(c, "-");
      pinSiteKeys.add(pointKey(plus));
      pinSiteKeys.add(pointKey(minus));
      const name = c.value.trim() || null;
      pinVotes.push({ point: plus, vote: { role: "power", name } });
    } else {
      for (const pin of ["left", "right", "anode", "cathode", "+", "-"]) {
        const p = pinWorldPos(c, pin);
        // pinWorldPos falls back to the component origin for unknown pin
        // names; only record real pins.
        if (p.x !== c.x || p.y !== c.y) pinSiteKeys.add(pointKey(p));
      }
    }
  }

  for (const label of netLabels) {
    pinSiteKeys.add(pointKey(label.position));
    const vote = classifyNetLabel(label);
    if (vote) pinVotes.push({ point: label.position, vote });
  }

  const uf = buildNetUnionFind(components, wires, kicadPinPoints, netLabels);

  // Net roots that touch at least one pin/label site — these default to
  // "signal" instead of "unknown".
  const rootsWithSites = new Set<string>();
  for (const key of pinSiteKeys) {
    if (uf.has(key)) rootsWithSites.add(uf.find(key));
  }

  // Reduce votes onto net roots (ground > power > signal; named beats unnamed).
  const rootVote = new Map<string, Vote>();
  for (const { point, vote } of pinVotes) {
    const key = pointKey(point);
    if (!uf.has(key)) continue;
    const root = uf.find(key);
    rootVote.set(root, mergeVote(rootVote.get(root), vote));
  }

  const roleOfRoot = (root: string): NetRole => {
    const vote = rootVote.get(root);
    if (vote) return vote.role;
    return rootsWithSites.has(root) ? "signal" : "unknown";
  };

  const roleAt = (point: Point): NetRole => {
    const key = pointKey(point);
    if (!uf.has(key)) return "unknown";
    return roleOfRoot(uf.find(key));
  };

  const wireRole = (wire: Wire): NetRole => {
    const v0 = wire.vertices[0];
    if (!v0) return "unknown";
    return roleAt(v0);
  };

  const wireColor = (wire: Wire): string => NET_ROLE_COLORS[wireRole(wire)];

  // Derived rail-name labels for power/ground nets that carry no explicit
  // NetLabel (explicit labels already render their own name glyph).
  const rootsWithExplicitLabel = new Set<string>();
  for (const label of netLabels) {
    const key = pointKey(label.position);
    if (uf.has(key)) rootsWithExplicitLabel.add(uf.find(key));
  }

  const repPoint = new Map<string, Point>();
  for (const wire of wires) {
    for (const v of wire.vertices) {
      const key = pointKey(v);
      if (!uf.has(key)) continue;
      const root = uf.find(key);
      if (rootsWithExplicitLabel.has(root)) continue;
      const role = roleOfRoot(root);
      if (role !== "power" && role !== "ground") continue;
      const cur = repPoint.get(root);
      if (!cur || v.y < cur.y || (v.y === cur.y && v.x < cur.x)) repPoint.set(root, v);
    }
  }

  const labels: RailLabel[] = [];
  for (const [root, point] of repPoint) {
    const vote = rootVote.get(root)!;
    const name = vote.role === "ground" ? "GND" : vote.name ?? "PWR";
    labels.push({ point, name, color: NET_ROLE_COLORS[vote.role], role: vote.role });
  }

  return { wireRole, wireColor, roleAt, labels };
}
