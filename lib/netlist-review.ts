/**
 * Builds the ground-truth input for the Layer-2 LLM design review.
 *
 * Layer 1 (validate-netlist.ts) is the deterministic, blocking structural check:
 * does the geometry match the intended netlist. Layer 2 is an LLM that reviews
 * the *electrical sensibility* of the circuit (missing pull-ups, decoupling,
 * current-limiting, floating enable pins, undriven power, …) — things a topology
 * equality check can't see.
 *
 * To keep the LLM grounded (and its claims verifiable), we feed it the EXACT net
 * partition computed deterministically from the schematic — the same
 * coordinate-coincidence union-find everything else uses — plus an explicit list
 * of genuinely floating pins. The model is told this is ground truth.
 */

import type { SchComponentType, SchematicState, Point } from "./schematic-types";
import { PIN_NAMES } from "./schematic-types";
import { boundUntrustedText, boundUntrustedTextOrNull } from "@/app/lib/untrusted-text";
import type { CachedPart } from "@/app/lib/parts-cache";
import { buildNetUnionFind } from "@/app/lib/connectivity";
import { pinWorldPos, kicadPinWorldPos, pointKey } from "@/app/lib/geometry";

const THEORY_DESC: Record<SchComponentType, string> = {
  resistor: "Resistor",
  capacitor: "Capacitor",
  inductor: "Inductor",
  diode: "Diode/LED",
  "voltage-source": "Voltage source",
  "current-source": "Current source",
  ground: "Ground",
};

export type ReviewComponent = {
  refDes: string;
  description: string;
  value: string;
  mpn: string | null;
  pins: string[];
};
export type ReviewNet = {
  name: string | null; // null for an unnamed wire net
  kind: string; // "power" | "ground" | "signal"
  pins: string[]; // "refDes.pinName"
};
export type ReviewInput = {
  components: ReviewComponent[];
  nets: ReviewNet[];
  /** Pins that connect to nothing — the verifiable subset of "floating" claims. */
  floatingPins: string[];
};

export function buildReviewInput(state: SchematicState, parts: Map<string, CachedPart>): ReviewInput {
  const components: ReviewComponent[] = [];
  type Pin = { pinId: string; point: Point };
  const pins: Pin[] = []; // real-component pins only (ground symbols excluded)
  const kicadPinPoints: Point[] = [];

  // [B19-D I5e row 05 + review] every project and catalog string reaches the review model bounded and cleaned, and a pin id is
  // built from the same bounded reference and pin name the component lists (the route matches floating-pin claims against it)
  for (const c of state.components) {
    if (c.type === "ground") continue;
    const names = PIN_NAMES[c.type] ?? [];
    const ref = boundUntrustedText(c.id, 64); // a theory id is a UUID (36 characters) and must stay whole
    components.push({ refDes: ref, description: THEORY_DESC[c.type], value: boundUntrustedText(c.value, 128), mpn: null, pins: names });
    for (const n of names) pins.push({ pinId: `${ref}.${n}`, point: pinWorldPos(c, n) });
  }
  for (const k of state.kicadComponents ?? []) {
    const part = parts.get(k.partId);
    const names = part ? part.pins.map((p) => boundUntrustedText(p.name || p.number, 64)) : [];
    const ref = boundUntrustedText(k.refDes, 32);
    components.push({
      refDes: ref,
      description: boundUntrustedText(part?.name ?? "part", 128),
      value: boundUntrustedText(k.value, 128),
      mpn: boundUntrustedTextOrNull(part?.mpn ?? null, 128),
      pins: names,
    });
    if (part) {
      part.pins.forEach((p, index) => {
        const pt = kicadPinWorldPos(k, p);
        pins.push({ pinId: `${ref}.${names[index]}`, point: pt });
        kicadPinPoints.push(pt);
      });
    }
  }

  const uf = buildNetUnionFind(state.components, state.wires, kicadPinPoints, state.netLabels ?? []);

  // Name/kind per net root: ground (from ground symbols or ground labels) wins,
  // then any net label, else an unnamed signal net.
  const labelByRoot = new Map<string, { name: string; kind: string }>();
  for (const l of state.netLabels ?? []) {
    const k = pointKey(l.position);
    if (uf.has(k) && !labelByRoot.has(uf.find(k))) labelByRoot.set(uf.find(k), { name: boundUntrustedText(l.name, 128), kind: boundUntrustedText(l.kind, 16) });
  }
  const groundRoots = new Set<string>();
  for (const c of state.components) {
    if (c.type === "ground") {
      const k = pointKey(pinWorldPos(c, "pin"));
      if (uf.has(k)) groundRoots.add(uf.find(k));
    }
  }
  for (const l of state.netLabels ?? []) {
    if (l.kind === "ground") {
      const k = pointKey(l.position);
      if (uf.has(k)) groundRoots.add(uf.find(k));
    }
  }

  const pinsByRoot = new Map<string, string[]>();
  for (const pin of pins) {
    const k = pointKey(pin.point);
    if (!uf.has(k)) continue;
    const root = uf.find(k);
    const list = pinsByRoot.get(root);
    if (list) list.push(pin.pinId);
    else pinsByRoot.set(root, [pin.pinId]);
  }

  const nets: ReviewNet[] = [];
  const floatingPins: string[] = [];
  for (const [root, pinIds] of pinsByRoot) {
    const isGround = groundRoots.has(root);
    const label = labelByRoot.get(root);
    const name = isGround ? "GND" : label?.name ?? null;
    const kind = isGround ? "ground" : label?.kind ?? "signal";
    nets.push({ name, kind, pins: pinIds.sort() });
    // Floating = a single pin on an unnamed, non-ground net (connects to nothing).
    if (pinIds.length === 1 && !isGround && !label) floatingPins.push(pinIds[0]);
  }
  nets.sort((a, b) => (a.name ?? "~").localeCompare(b.name ?? "~"));

  return { components, nets, floatingPins };
}
