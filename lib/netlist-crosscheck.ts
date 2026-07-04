/**
 * Netlist cross-verification (Layer-2 "second opinion", advisory).
 *
 * Given TWO independently-generated netlists for the same request — Sirkit's
 * primary netlist and a second opinion (e.g. the SchGen domain model, or a
 * different frontier model) — compute a structured, deterministic comparison and
 * emit ADVISORY findings. The point is NOT to merge them (fusing two possibly-
 * wrong netlists can invent shorts) but to surface where an independent model
 * disagrees, so a reviewer can judge — exactly the Layer-2 review philosophy.
 *
 * Comparison is at the component-CLASS and named-NET level, not exact pin-level
 * edge matching: the two generators use different refDes numbering and part
 * identities, so exact edge isomorphism isn't meaningful, whereas "the domain
 * model includes a decoupling cap / pull-up / rail you don't" is exactly the
 * high-signal accuracy help a fine-tuned model provides. Consensus is a
 * confidence signal, never ground truth — the deterministic validator stays the
 * only blocking gate.
 */

import type { BuildLogicalNetlist } from "./schematic-types";
import { isLabelConnection } from "./schematic-types";

export type ComponentClass =
  | "resistor" | "capacitor" | "inductor" | "ferrite" | "diode" | "led"
  | "transistor" | "crystal" | "connector" | "switch" | "ic" | "other";

export type NormComponent = { refDes: string; klass: ComponentClass; value?: string | null };
export type NormNet = { name: string | null; endpoints: string[] };
export type NormalizedNetlist = { components: NormComponent[]; nets: NormNet[] };

export type CrossFinding = {
  severity: "warning" | "info";
  category: string;
  title: string;
  detail: string;
};

export type CrossCheckResult = {
  findings: CrossFinding[];
  /** 0..1 overlap of component-class multisets (a rough agreement gauge). */
  agreement: number;
  summary: string;
};

// ─── Component classification ────────────────────────────────────────────────

const PREFIX_CLASS: Record<string, ComponentClass> = {
  R: "resistor", C: "capacitor", L: "inductor", FB: "ferrite",
  D: "diode", Q: "transistor", Y: "crystal", X: "crystal",
  J: "connector", P: "connector", SW: "switch", S: "switch", U: "ic",
};

function refDesPrefix(refDes: string): string {
  const m = /^([A-Za-z]+)/.exec(refDes.trim());
  return m ? m[1].toUpperCase() : "";
}

/** Coarse component class from refDes + name/value keywords. */
export function classifyComponent(refDes: string, name?: string | null, value?: string | null): ComponentClass {
  const blob = `${name ?? ""} ${value ?? ""}`.toLowerCase();
  const prefix = refDesPrefix(refDes);

  // LED disambiguation for diode-prefixed / LED-prefixed parts.
  if (prefix === "LED" || (prefix === "D" && (/\bled\b/.test(blob) || blob.includes("light-emit")))) return "led";
  const byPrefix = PREFIX_CLASS[prefix];
  if (byPrefix) return byPrefix;

  // Keyword fallback when the refDes prefix is unusual.
  if (/\bled\b/.test(blob)) return "led";
  if (/resistor/.test(blob)) return "resistor";
  if (/capacitor|\bcap\b/.test(blob)) return "capacitor";
  if (/inductor|choke/.test(blob)) return "inductor";
  if (/ferrite/.test(blob)) return "ferrite";
  if (/crystal|oscillator|resonator/.test(blob)) return "crystal";
  if (/diode|schottky|rectifier/.test(blob)) return "diode";
  if (/mosfet|transistor|\bbjt\b|\bfet\b/.test(blob)) return "transistor";
  if (/connector|header|receptacle|\bjack\b|\bplug\b/.test(blob)) return "connector";
  if (/switch|button/.test(blob)) return "switch";
  return "other";
}

// ─── Building a normalized netlist from Sirkit's BuildLogicalNetlist ─────────

type Parted = { name?: string | null };

class UF {
  private parent = new Map<string, string>();
  find(x: string): string {
    let r = this.parent.get(x);
    if (r === undefined) { this.parent.set(x, x); return x; }
    while (r !== x) { x = r; r = this.parent.get(x) ?? x; }
    return r;
  }
  union(a: string, b: string): void {
    const ra = this.find(a); const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
  keys(): string[] { return [...this.parent.keys()]; }
}

/**
 * Normalize Sirkit's logical netlist: classify each component, and union its
 * connections into nets (wire edges join endpoints; same label name = one net;
 * ground endpoints land on a "GND" net). `parts` optionally supplies part names
 * for better classification.
 */
export function normalizeBuildNetlist(
  netlist: BuildLogicalNetlist,
  parts?: Map<string, Parted>,
): NormalizedNetlist {
  const components: NormComponent[] = netlist.components.map((c) => ({
    refDes: c.refDes,
    klass: classifyComponent(c.refDes, parts?.get(c.partId)?.name, c.value),
    value: c.value,
  }));

  const uf = new UF();
  const labelOf = new Map<string, string>();   // endpoint → net name
  const byLabelName = new Map<string, string[]>(); // net name → endpoints

  for (const conn of netlist.connections) {
    if (isLabelConnection(conn)) {
      const name = conn.labelKind === "ground" ? "GND" : conn.labelName.toUpperCase();
      uf.find(conn.pin); // register
      labelOf.set(conn.pin, name);
      const list = byLabelName.get(name) ?? [];
      list.push(conn.pin);
      byLabelName.set(name, list);
    } else {
      uf.union(conn.from, conn.to);
    }
  }
  // Same label name → same electrical net.
  for (const eps of byLabelName.values()) {
    for (let i = 1; i < eps.length; i++) uf.union(eps[0], eps[i]);
  }

  const groups = new Map<string, NormNet>();
  for (const ep of uf.keys()) {
    if (ep.toUpperCase() === "GND") continue; // pseudo-endpoint
    const root = uf.find(ep);
    const net = groups.get(root) ?? { name: null, endpoints: [] };
    net.endpoints.push(ep);
    const nm = labelOf.get(ep);
    if (nm && (net.name === null || nm === "GND")) net.name = nm;
    groups.set(root, net);
  }
  return { components, nets: [...groups.values()] };
}

// ─── Cross-check ─────────────────────────────────────────────────────────────

function classCounts(nl: NormalizedNetlist): Map<ComponentClass, number> {
  const m = new Map<ComponentClass, number>();
  for (const c of nl.components) m.set(c.klass, (m.get(c.klass) ?? 0) + 1);
  return m;
}

// Classes where "the second opinion has MORE than you" plausibly signals a
// missing support part worth flagging (decoupling/bulk caps, pull-ups, current-
// limit resistors, protection diodes, load caps).
const SUPPORT_CLASSES: Partial<Record<ComponentClass, string>> = {
  capacitor: "decoupling/bulk capacitor",
  resistor: "pull-up/series resistor",
  inductor: "inductor/choke",
  ferrite: "ferrite bead",
  diode: "protection/flyback diode",
  crystal: "crystal/load network",
};

const CLASS_LABEL: Record<ComponentClass, string> = {
  resistor: "resistor", capacitor: "capacitor", inductor: "inductor",
  ferrite: "ferrite bead", diode: "diode", led: "LED", transistor: "transistor",
  crystal: "crystal", connector: "connector", switch: "switch", ic: "IC", other: "part",
};

/**
 * Compare a primary netlist (Sirkit's) against a second opinion. Findings are
 * advisory: component-class count gaps (possible missing/extra support parts) and
 * named-net presence gaps (rails/signals one design references and the other
 * doesn't).
 */
export function crossCheckNetlists(
  primary: NormalizedNetlist,
  second: NormalizedNetlist,
): CrossCheckResult {
  const findings: CrossFinding[] = [];
  const pc = classCounts(primary);
  const sc = classCounts(second);
  const allClasses = new Set<ComponentClass>([...pc.keys(), ...sc.keys()]);

  // Agreement: multiset overlap (sum of min) / (sum of max) over classes.
  let overlap = 0;
  let union = 0;
  for (const k of allClasses) {
    const a = pc.get(k) ?? 0;
    const b = sc.get(k) ?? 0;
    overlap += Math.min(a, b);
    union += Math.max(a, b);
  }
  const agreement = union === 0 ? 1 : overlap / union;

  // Component-class gaps.
  for (const k of allClasses) {
    const p = pc.get(k) ?? 0;
    const s = sc.get(k) ?? 0;
    if (s > p) {
      const support = SUPPORT_CLASSES[k];
      findings.push({
        severity: support ? "warning" : "info",
        category: "Component set",
        title: support
          ? `Possible missing ${support}`
          : `Second opinion has more ${CLASS_LABEL[k]}s`,
        detail: `The independent design includes ${s} ${CLASS_LABEL[k]}(s) vs your ${p}` +
          (support ? ` — check for a missing ${support}.` : `.`),
      });
    } else if (p > s && (p - s) >= 2) {
      findings.push({
        severity: "info",
        category: "Component set",
        title: `You include more ${CLASS_LABEL[k]}s`,
        detail: `Your design has ${p} ${CLASS_LABEL[k]}(s) vs the independent design's ${s}.`,
      });
    }
  }

  // Named-net presence gaps (power rails / labeled signals).
  const names = (nl: NormalizedNetlist) =>
    new Set(nl.nets.map((n) => n.name).filter((n): n is string => !!n && n !== "GND"));
  const pn = names(primary);
  const sn = names(second);
  const onlySecond = [...sn].filter((n) => !pn.has(n));
  if (onlySecond.length > 0) {
    findings.push({
      severity: "info",
      category: "Nets",
      title: "Second opinion references nets you don't",
      detail: `Named nets only in the independent design: ${onlySecond.slice(0, 8).join(", ")}` +
        (onlySecond.length > 8 ? ` (+${onlySecond.length - 8} more)` : "") + ".",
    });
  }

  const summary = findings.length === 0
    ? `Independent second opinion agrees on component set (agreement ${(agreement * 100).toFixed(0)}%).`
    : `Independent second opinion differs on ${findings.length} point(s); component-class agreement ${(agreement * 100).toFixed(0)}%. Advisory — verify before acting.`;

  return { findings, agreement, summary };
}
