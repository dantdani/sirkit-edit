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
 *
 * [PR-J, 2026-10-22] Section J increment 2 (OD-255 items 2, 3): the partition is THE project connectivity authority's
 * (app/lib/schematic/project-connectivity.ts): a document without sheets keeps its exact input (the authority's union IS
 * buildNetUnionFind, the first label names a net, every ground kind reads "GND"); a document with sheets is reviewed on its scoped
 * nets, each named once by the authority (a sheet-local net "Power/OUT"; AGND and DGND as the two ground rails they are), and a
 * sheet-structure error refuses (SHEET_HIERARCHY_INVALID). Every sheet is reviewed; one sheet's view is refused.
 */

import type { SchComponentType, SchematicState, Point } from "./schematic-types";
import { PIN_NAMES } from "./schematic-types";
import { boundUntrustedText, boundUntrustedTextOrNull } from "@/app/lib/untrusted-text";
import type { CachedPart } from "@/app/lib/parts-cache";
import { pinWorldPos, kicadPinWorldPos } from "@/app/lib/geometry";
import { resolveProjectConnectivity } from "@/app/lib/schematic/project-connectivity";
import { assertWholeProject, sheetOf } from "@/app/lib/schematic/sheets";

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
  assertWholeProject(state, "review-input");
  const components: ReviewComponent[] = [];
  type Pin = { pinId: string; sheetId: string; point: Point };
  const pins: Pin[] = []; // real-component pins only (ground symbols excluded)

  // [B19-D I5e row 05 + review] every project and catalog string reaches the review model bounded and cleaned, and a pin id is
  // built from the same bounded reference and pin name the component lists (the route matches floating-pin claims against it)
  for (const c of state.components) {
    if (c.type === "ground") continue;
    const names = PIN_NAMES[c.type] ?? [];
    const ref = boundUntrustedText(c.id, 64); // a theory id is a UUID (36 characters) and must stay whole
    components.push({ refDes: ref, description: THEORY_DESC[c.type], value: boundUntrustedText(c.value, 128), mpn: null, pins: names });
    for (const n of names) pins.push({ pinId: `${ref}.${n}`, sheetId: sheetOf(c), point: pinWorldPos(c, n) });
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
        pins.push({ pinId: `${ref}.${names[index]}`, sheetId: sheetOf(k), point: pt });
      });
    }
  }

  // THE project connectivity authority (a document without sheets: the same buildNetUnionFind union as before).
  const connectivity = resolveProjectConnectivity(state, (partId) => parts.get(partId) ?? null);
  if (!connectivity.ok) {
    const error = connectivity.diagnostics.find((item) => item.severity === "error");
    throw new Error(`SHEET_HIERARCHY_INVALID: ${error?.code ?? "SHEET_SET_INVALID"}: ${error?.message ?? "the sheet structure is invalid"}`);
  }
  const strict = connectivity.mode === "multi-sheet";

  // Name/kind per net root: ground (from ground symbols or ground labels) wins,
  // then any net label, else an unnamed signal net. (A document with sheets: the authority's one name per net.)
  const labelByRoot = new Map<string, { name: string; kind: string }>();
  for (const l of state.netLabels ?? []) {
    const root = connectivity.rootAt(sheetOf(l), l.position);
    if (root !== null && !labelByRoot.has(root)) labelByRoot.set(root, { name: boundUntrustedText(l.name, 128), kind: boundUntrustedText(l.kind, 16) });
  }
  const groundRoots = new Set<string>();
  for (const c of state.components) {
    if (c.type === "ground") {
      const root = connectivity.rootAt(sheetOf(c), pinWorldPos(c, "pin"));
      if (root !== null) groundRoots.add(root);
    }
  }
  for (const l of state.netLabels ?? []) {
    if (l.kind === "ground") {
      const root = connectivity.rootAt(sheetOf(l), l.position);
      if (root !== null) groundRoots.add(root);
    }
  }

  const pinsByRoot = new Map<string, string[]>();
  const firstPinOfRoot = new Map<string, Pin>();
  for (const pin of pins) {
    const root = connectivity.rootAt(pin.sheetId, pin.point);
    if (root === null) continue;
    const list = pinsByRoot.get(root);
    if (list) list.push(pin.pinId);
    else { pinsByRoot.set(root, [pin.pinId]); firstPinOfRoot.set(root, pin); }
  }

  const nets: ReviewNet[] = [];
  const floatingPins: string[] = [];
  for (const [root, pinIds] of pinsByRoot) {
    let name: string | null;
    let kind: string;
    if (strict) {
      const first = firstPinOfRoot.get(root)!;
      const net = connectivity.netAt(first.sheetId, first.point);
      name = net?.name ? boundUntrustedText(net.name, 128) : null;
      kind = net?.kind === "ground" ? "ground" : net?.kind === "power" ? "power" : name !== null ? "label" : "signal";
    } else {
      const isGround = groundRoots.has(root);
      const label = labelByRoot.get(root);
      name = isGround ? "GND" : label?.name ?? null;
      kind = isGround ? "ground" : label?.kind ?? "signal";
    }
    nets.push({ name, kind, pins: pinIds.sort() });
    // Floating = a single pin on an unnamed, non-ground net (connects to nothing).
    if (pinIds.length === 1 && name === null) floatingPins.push(pinIds[0]);
  }
  nets.sort((a, b) => (a.name ?? "~").localeCompare(b.name ?? "~"));

  return { components, nets, floatingPins };
}
