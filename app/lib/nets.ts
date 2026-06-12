/**
 * Net classification for the schematic editor.
 *
 * Derives, from the current components + wires, which electrical net each wire
 * belongs to and whether that net is power, ground, or a plain signal. This
 * drives diagram-style rendering: power rails get distinct colors (5V red,
 * 3V3 green, …), ground stays neutral, and power/ground nets get a name label.
 *
 * Nets themselves are not stored — they are recomputed from connectivity
 * (the same union-find the editor and SPICE export use), so this stays in sync
 * with manual edits automatically. Classification is heuristic: pin NAMES win
 * (an explicit "GND" pin is ground even if KiCad typed it `power_in`), with pin
 * TYPE as a fallback.
 */

import type { Point, SchComponent, Wire, KicadComponentInstance } from "@/lib/schematic-types";
import type { KicadPin } from "@/app/lib/kicad/types";
import { buildNetUnionFind } from "./connectivity";
import { pinWorldPos, kicadPinWorldPos, pointKey } from "./geometry";

export type NetClass = "power" | "ground" | "signal";

export type NetLabel = {
  point: Point;
  name: string;
  color: string;
  class: NetClass;
};

export type NetClassification = {
  /** Stroke color for a wire, by the class of the net it sits on. */
  wireColor: (wire: Wire) => string;
  /** One label per power/ground net, at the net's top-left-most wire vertex. */
  labels: NetLabel[];
};

// Neutral (zinc) for everything that isn't a colored power rail. Ground is left
// neutral on purpose — the ground glyph + "GND" label are the cue; coloring it
// too would compete with the rails for attention.
const SIGNAL_COLOR = "#a1a1aa";
const GROUND_COLOR = "#a1a1aa";
const POWER_DEFAULT_COLOR = "#fbbf24"; // amber — an unrecognized rail

// Named rails get distinct colors so e.g. 5V and 3V3 read apart at a glance.
const POWER_RAIL_COLORS: { pattern: RegExp; color: string }[] = [
  { pattern: /(5v|vbus|vin|vsys|vbat)/i, color: "#f87171" }, // higher rails → red
  { pattern: /(3v3|3\.3|2v5|2\.5|1v8|1\.8|1v2)/i, color: "#4ade80" }, // logic rails → green
];

const GND_NAME = /^(gnd\d*|gndd?|agnd|dgnd|pgnd|vss\d*|vee|0v)$/i;
const PWR_NAME = /^(vcc\w*|vdd\w*|vbus|vin|vout|vsys|vbat|vaa|avcc|dvcc|v\+|3v3|3\.3v|5v|1v8|1\.8v|2v5)$/i;

function powerColor(name: string | null): string {
  if (name) {
    for (const r of POWER_RAIL_COLORS) if (r.pattern.test(name)) return r.color;
  }
  return POWER_DEFAULT_COLOR;
}

type Vote = { cls: NetClass; name: string | null };

function classifyKicadPin(pin: KicadPin): Vote | null {
  const name = (pin.name ?? "").trim();
  if (GND_NAME.test(name)) return { cls: "ground", name: "GND" };
  if (PWR_NAME.test(name)) return { cls: "power", name: name.toUpperCase() };
  // Many KiCad GND pins are typed `power_in` too — but the name check above
  // already caught those, so a type-only power pin is a genuine supply pin.
  if (pin.type === "power_in" || pin.type === "power_out") {
    return { cls: "power", name: name ? name.toUpperCase() : null };
  }
  return null;
}

const CLASS_RANK: Record<NetClass, number> = { ground: 2, power: 1, signal: 0 };

function mergeVote(prev: Vote | undefined, next: Vote): Vote {
  if (!prev) return next;
  if (CLASS_RANK[next.cls] > CLASS_RANK[prev.cls]) return next;
  if (CLASS_RANK[next.cls] < CLASS_RANK[prev.cls]) return prev;
  // Same class — prefer the one that carries a (more specific) name.
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
): NetClassification {
  // Gather pin votes + the KiCad pin world positions the union-find needs.
  const kicadPinPoints: Point[] = [];
  const pinVotes: { point: Point; vote: Vote }[] = [];

  for (const inst of kicadComponents) {
    const part = getPart(inst.partId);
    if (!part) continue;
    for (const pin of part.pins) {
      const point = kicadPinWorldPos(inst, pin);
      kicadPinPoints.push(point);
      const vote = classifyKicadPin(pin);
      if (vote) pinVotes.push({ point, vote });
    }
  }

  for (const c of components) {
    if (c.type === "ground") {
      pinVotes.push({ point: pinWorldPos(c, "pin"), vote: { cls: "ground", name: "GND" } });
    } else if (c.type === "voltage-source") {
      const name = c.value.trim() || null;
      pinVotes.push({ point: pinWorldPos(c, "+"), vote: { cls: "power", name } });
    }
  }

  const uf = buildNetUnionFind(components, wires, kicadPinPoints);

  // Reduce votes onto net roots (ground > power > signal; named beats unnamed).
  const rootVote = new Map<string, Vote>();
  for (const { point, vote } of pinVotes) {
    const key = pointKey(point);
    if (!uf.has(key)) continue;
    const root = uf.find(key);
    rootVote.set(root, mergeVote(rootVote.get(root), vote));
  }

  const colorOf = (vote: Vote | undefined): string => {
    if (!vote || vote.cls === "signal") return SIGNAL_COLOR;
    if (vote.cls === "ground") return GROUND_COLOR;
    return powerColor(vote.name);
  };

  const wireColor = (wire: Wire): string => {
    const v0 = wire.vertices[0];
    if (!v0) return SIGNAL_COLOR;
    const key = pointKey(v0);
    if (!uf.has(key)) return SIGNAL_COLOR;
    return colorOf(rootVote.get(uf.find(key)));
  };

  // One label per power/ground net, anchored at its top-left-most wire vertex.
  const repPoint = new Map<string, Point>();
  for (const wire of wires) {
    for (const v of wire.vertices) {
      const key = pointKey(v);
      if (!uf.has(key)) continue;
      const root = uf.find(key);
      const vote = rootVote.get(root);
      if (!vote || vote.cls === "signal") continue;
      const cur = repPoint.get(root);
      if (!cur || v.y < cur.y || (v.y === cur.y && v.x < cur.x)) repPoint.set(root, v);
    }
  }

  const labels: NetLabel[] = [];
  for (const [root, point] of repPoint) {
    const vote = rootVote.get(root)!;
    const name = vote.cls === "ground" ? "GND" : vote.name ?? "PWR";
    labels.push({ point, name, color: colorOf(vote), class: vote.cls });
  }

  return { wireColor, labels };
}
