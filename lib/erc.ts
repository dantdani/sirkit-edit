/**
 * Deterministic electrical rule check (ERC) on a Build-mode logical netlist.
 *
 * Phase 1 of the PCBSchemaGen-style verification stack (arXiv:2602.00510 —
 * "reward-guided LLM code synthesis with structured verification"): a
 * deterministic, zero-LLM-cost oracle that judges the DESIGN itself, not the
 * drawing. It complements lib/validate-netlist.ts, which only proves the drawn
 * geometry implements the intended netlist — nothing before this checked that
 * the intended netlist is electrically sane.
 *
 * Ported from PCBSchemaGen_v2's error taxonomy + continuous-reward shaping
 * (framework/topo/error_types.py, MIT), re-based onto the KiCad pin electrical
 * types Sirkit's catalog already carries (power_in / power_out / output / …)
 * instead of their per-IC knowledge graph (that KG is Phase 2). Their
 * benchmark-specific rule patches are deliberately NOT ported.
 *
 * Checks (severity):
 *   supply_missing  (critical)  power_in pin with no connection, or on a net
 *                               with no power source
 *   erc_conflict    (critical)  ≥2 push-pull drivers (output/power_out) on one net
 *   supply_short    (critical)  one net carrying two different power rails, or a
 *                               power rail tied to ground
 *   nc_connected    (warning)   a no_connect pin is wired
 *   input_floating  (warning)   an input pin with no connection at all
 *   no_ground       (warning)   multi-component design with no ground reference
 *
 * The report carries a continuous reward in [0.5, 1] (structural validation
 * upstream guarantees the sub-0.5 layers), pin-level error localization, and an
 * LLM-feedback formatter — the pieces a refinement loop needs.
 */

import type { BuildLogicalNetlist } from "./schematic-types";
import { isLabelConnection, inferNetLabelKind } from "./schematic-types";
import { kgEntryFor } from "./kg";

// ─── Error model (ported taxonomy) ───────────────────────────────────────────

export type ErcSeverity = "critical" | "warning";

export type ErcCategory =
  | "supply_missing"
  | "erc_conflict"
  | "supply_short"
  | "nc_connected"
  | "input_floating"
  | "no_ground"
  // KG constraint layer (datasheet-derived, Phase 2)
  | "unconnected_pin"
  | "gate_floating"
  | "differential_short";

export type ErcError = {
  severity: ErcSeverity;
  category: ErcCategory;
  message: string;
  refDes?: string;
  pin?: string;
  net?: string;
  suggestion?: string;
};

export type ErcReport = {
  errors: ErcError[];
  criticalCount: number;
  warningCount: number;
  /** Continuous reward in [0.5, 1]; 1 = clean. */
  reward: number;
  ok: boolean; // no criticals
};

/** Stable signature for recurrence tracking across attempts. */
export function ercFingerprint(e: ErcError): string {
  return `${e.category}:${e.refDes ?? ""}:${e.pin ?? ""}`;
}

// ─── Pin lookup contract ─────────────────────────────────────────────────────

export type ErcPin = { number: string; name: string; type: string };
export type ErcPart = { pins: ErcPin[]; name?: string };

/** Push-pull driver types that conflict when shared on one net. */
const PUSH_PULL = new Set(["output", "power_out"]);
/** Pin types a net can source power from. */
const POWER_SOURCE_TYPES = new Set(["power_out"]);
/** Component roles that can inject power without a power_out pin (battery
 *  holders / USB connectors expose passive pins; regulators vary by symbol). */
const POWER_SOURCE_ROLES = new Set(["source", "connector", "regulator"]);

function findPin(part: ErcPart, token: string): ErcPin | undefined {
  const t = token.trim().toLowerCase();
  return part.pins.find((p) => p.name.toLowerCase() === t || p.number.toLowerCase() === t);
}

// ─── Net construction (union-find over connection endpoints) ─────────────────

type Endpoint = { refDes: string; pin: string } | { ground: true };

function parseEndpoint(ep: string): Endpoint {
  const trimmed = ep.trim();
  if (trimmed.toUpperCase() === "GND") return { ground: true };
  const idx = trimmed.indexOf(".");
  if (idx < 0) return { refDes: trimmed, pin: "" };
  return { refDes: trimmed.slice(0, idx), pin: trimmed.slice(idx + 1) };
}

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
  nodes(): string[] { return [...this.parent.keys()]; }
}

type Net = {
  /** "refDes.pin" endpoints on this net. */
  pins: string[];
  /** Distinct power-label names on this net (e.g. +3V3, VBUS). */
  powerNames: Set<string>;
  hasGround: boolean;
  /** Any label at all (incl. plain signal labels) — used for display names. */
  labelNames: Set<string>;
};

// ─── Main ────────────────────────────────────────────────────────────────────

export function runErc(
  netlist: BuildLogicalNetlist,
  /** partId → part (the build-loop / validator convention). */
  parts: Map<string, ErcPart>,
): ErcReport {
  const errors: ErcError[] = [];
  const uf = new UF();
  const GROUND = "@GND";

  // Resolve each placed component to its part once.
  const partsByRefDes = new Map<string, ErcPart>();
  for (const c of netlist.components) {
    const p = parts.get(c.partId);
    if (p) partsByRefDes.set(c.refDes, p);
  }

  // Union endpoints into nets; a label name is a shared pseudo-node so all pins
  // carrying the same label join one net (the label-based net system).
  const labelKindByName = new Map<string, string>();
  for (const conn of netlist.connections) {
    if (isLabelConnection(conn)) {
      const name = conn.labelName.trim().toUpperCase();
      const kind = conn.labelKind ?? inferNetLabelKind(name);
      const node = kind === "ground" ? GROUND : `@LBL:${name}`;
      uf.union(`P:${conn.pin.trim()}`, node);
      // ground labels are ground regardless of their text
      if (kind !== "ground") labelKindByName.set(name, kind);
    } else {
      const f = parseEndpoint(conn.from);
      const t = parseEndpoint(conn.to);
      const fk = "ground" in f ? GROUND : `P:${conn.from.trim()}`;
      const tk = "ground" in t ? GROUND : `P:${conn.to.trim()}`;
      if (fk === GROUND && tk === GROUND) continue;
      uf.union(fk, tk);
    }
  }

  // Group nodes into nets.
  const nets = new Map<string, Net>();
  for (const node of uf.nodes()) {
    const root = uf.find(node);
    const net = nets.get(root) ?? { pins: [], powerNames: new Set(), hasGround: false, labelNames: new Set() };
    if (node === GROUND) net.hasGround = true;
    else if (node.startsWith("@LBL:")) {
      const name = node.slice(5);
      net.labelNames.add(name);
      if (labelKindByName.get(name) === "power") net.powerNames.add(name);
    } else net.pins.push(node.slice(2)); // strip "P:"
    nets.set(root, net);
  }

  const netOf = (refDesPin: string): Net | undefined => {
    const key = `P:${refDesPin}`;
    const root = uf.find(key);
    // find() auto-registers unknown keys as singletons; only report real nets.
    return nets.get(root);
  };
  const netName = (net: Net): string =>
    [...net.labelNames][0] ?? (net.hasGround ? "GND" : net.pins.slice(0, 3).join(", "));

  // Connected pin set (for floating checks).
  const connectedPins = new Set<string>();
  for (const net of nets.values()) for (const p of net.pins) connectedPins.add(p.toLowerCase());
  const isConnected = (refDes: string, pin: ErcPin): boolean =>
    connectedPins.has(`${refDes}.${pin.name}`.toLowerCase()) ||
    connectedPins.has(`${refDes}.${pin.number}`.toLowerCase());

  const roleByRefDes = new Map(netlist.components.map((c) => [c.refDes, c.role ?? ""]));

  // Resolve every net endpoint to its pin TYPE (for driver/conflict analysis).
  type TypedPin = { refDes: string; token: string; type: string };
  const typedPinsOf = (net: Net): TypedPin[] => {
    const out: TypedPin[] = [];
    for (const ep of net.pins) {
      const parsed = parseEndpoint(ep);
      if ("ground" in parsed) continue;
      const part = partsByRefDes.get(parsed.refDes);
      const pin = part ? findPin(part, parsed.pin) : undefined;
      if (pin) out.push({ refDes: parsed.refDes, token: parsed.pin, type: pin.type });
    }
    return out;
  };

  /** Does this net have a power source? (label rail, ground, power_out pin, or a
   *  pin belonging to a source/connector/regulator component). */
  const isDriven = (net: Net): boolean => {
    if (net.powerNames.size > 0 || net.hasGround) return true;
    for (const tp of typedPinsOf(net)) {
      if (POWER_SOURCE_TYPES.has(tp.type)) return true;
      if (POWER_SOURCE_ROLES.has(roleByRefDes.get(tp.refDes) ?? "")) return true;
    }
    return false;
  };

  // ── Check 1+5: per-pin checks (supply_missing / input_floating / nc_connected)
  for (const comp of netlist.components) {
    const part = partsByRefDes.get(comp.refDes);
    if (!part) continue;
    for (const pin of part.pins) {
      const token = pin.name !== "~" && pin.name !== "" ? pin.name : pin.number;
      const connected = isConnected(comp.refDes, pin);

      if (pin.type === "power_in") {
        if (!connected) {
          errors.push({
            severity: "critical",
            category: "supply_missing",
            refDes: comp.refDes,
            pin: token,
            message: `${comp.refDes} pin ${token} (power input) is not connected to anything.`,
            suggestion: `Connect ${comp.refDes}.${token} to its supply rail with a "power" label (e.g. +3V3) or a "ground" label.`,
          });
        } else {
          const net =
            netOf(`${comp.refDes}.${pin.name}`) ?? netOf(`${comp.refDes}.${pin.number}`);
          if (net && !isDriven(net)) {
            errors.push({
              severity: "critical",
              category: "supply_missing",
              refDes: comp.refDes,
              pin: token,
              net: netName(net),
              message: `${comp.refDes} pin ${token} (power input) is on net [${netName(net)}] which has no power source.`,
              suggestion: `Attach a power/ground label to this net or wire it to a supply output.`,
            });
          }
        }
      } else if (pin.type === "no_connect" && connected) {
        errors.push({
          severity: "warning",
          category: "nc_connected",
          refDes: comp.refDes,
          pin: token,
          message: `${comp.refDes} pin ${token} is a no-connect pin but has a connection.`,
          suggestion: `Remove connections to ${comp.refDes}.${token}; the datasheet marks it NC.`,
        });
      } else if (pin.type === "input" && !connected) {
        errors.push({
          severity: "warning",
          category: "input_floating",
          refDes: comp.refDes,
          pin: token,
          message: `${comp.refDes} pin ${token} (input) is unconnected.`,
          suggestion: `Drive it, tie it to a defined level, or confirm the datasheet allows it to float.`,
        });
      }
    }
  }

  // ── Check 2: driver conflicts per net ──
  for (const net of nets.values()) {
    const drivers = typedPinsOf(net).filter((tp) => PUSH_PULL.has(tp.type));
    if (drivers.length >= 2) {
      const list = drivers.map((d) => `${d.refDes}.${d.token}`).join(", ");
      errors.push({
        severity: "critical",
        category: "erc_conflict",
        net: netName(net),
        message: `Net [${netName(net)}] has ${drivers.length} push-pull drivers shorted together: ${list}.`,
        suggestion: `Outputs must not drive the same net; keep one driver or isolate them (series R, mux, open-drain).`,
      });
    }
  }

  // ── Check 3: supply shorts ──
  for (const net of nets.values()) {
    if (net.powerNames.size >= 2) {
      errors.push({
        severity: "critical",
        category: "supply_short",
        net: netName(net),
        message: `Power rails [${[...net.powerNames].join(", ")}] are shorted into one net.`,
        suggestion: `Each rail must be its own net; remove the connection joining them.`,
      });
    }
    if (net.powerNames.size >= 1 && net.hasGround) {
      errors.push({
        severity: "critical",
        category: "supply_short",
        net: netName(net),
        message: `Power rail [${[...net.powerNames].join(", ")}] is shorted to ground.`,
        suggestion: `Remove the connection tying this rail to GND.`,
      });
    }
  }

  // ── Check 4: ground presence ──
  if (netlist.components.length >= 2) {
    const anyGround = [...nets.values()].some((n) => n.hasGround);
    if (!anyGround) {
      errors.push({
        severity: "warning",
        category: "no_ground",
        message: `The design has no ground reference anywhere.`,
        suggestion: `Add "ground" labels (GND) on the return pins.`,
      });
    }
  }

  // ── Check 6: per-IC datasheet constraints (KG layer, Phase 2) ──
  // Constraint pins are datasheet names; when a pin doesn't resolve on the actual
  // catalog symbol (name drift), that check is skipped — a false negative is
  // acceptable, asserting another chip's constraints is not. Faults already
  // reported by the pin-type layer (same refDes+pin) are not duplicated.
  const reported = new Set(errors.map((e) => `${e.refDes ?? ""}:${e.pin ?? ""}`));
  const pinNet = (refDes: string, pin: ErcPin): Net | undefined =>
    netOf(`${refDes}.${pin.name}`) ?? netOf(`${refDes}.${pin.number}`);

  for (const comp of netlist.components) {
    const part = partsByRefDes.get(comp.refDes);
    const entry = part ? kgEntryFor(part.name) : null;
    if (!part || !entry) continue;

    const requireConnected = (
      token: string,
      category: ErcCategory,
      what: string,
    ): ErcPin | null => {
      const pin = findPin(part, token);
      if (!pin) return null; // datasheet/symbol name drift — skip
      const pinToken = pin.name !== "~" && pin.name !== "" ? pin.name : pin.number;
      if (!isConnected(comp.refDes, pin) && !reported.has(`${comp.refDes}:${pinToken}`)) {
        reported.add(`${comp.refDes}:${pinToken}`);
        errors.push({
          severity: "critical",
          category,
          refDes: comp.refDes,
          pin: pinToken,
          message: `${comp.refDes} pin ${pinToken}: the ${part.name} datasheet requires ${what}, but it is unconnected.`,
          suggestion: `Connect ${comp.refDes}.${pinToken} per the datasheet's application circuit.`,
        });
      }
      return pin;
    };

    for (const c of entry.constraints) {
      if (c.type === "supply_pair") {
        const vdd = requireConnected(c.vddPin, "supply_missing", `${c.vddPin} to be powered`);
        const gnd = requireConnected(c.gndPin, "supply_missing", `${c.gndPin} to be its supply return`);
        if (vdd && gnd) {
          const vNet = pinNet(comp.refDes, vdd);
          const gNet = pinNet(comp.refDes, gnd);
          if (vNet && gNet && vNet === gNet) {
            errors.push({
              severity: "critical",
              category: "supply_short",
              refDes: comp.refDes,
              message: `${comp.refDes}: supply pin ${c.vddPin} and its return ${c.gndPin} are shorted onto one net.`,
              suggestion: `Separate ${comp.refDes}.${c.vddPin} (rail) from ${comp.refDes}.${c.gndPin} (ground).`,
            });
          }
        }
      } else if (c.type === "must_be_connected") {
        for (const p of c.pins) requireConnected(p, "unconnected_pin", `${p} to be connected`);
      } else if (c.type === "driving_pair") {
        requireConnected(c.gatePin, "gate_floating", `the gate (pin ${c.gatePin}) to be driven`);
      } else if (c.type === "differential_distinct") {
        const resolved = c.pins.map((p) => findPin(part, p)).filter((p): p is ErcPin => !!p);
        if (resolved.length === c.pins.length && resolved.length >= 2) {
          const nets0 = pinNet(comp.refDes, resolved[0]);
          const same = nets0 && resolved.every((p) => pinNet(comp.refDes, p) === nets0);
          if (same) {
            errors.push({
              severity: "critical",
              category: "differential_short",
              refDes: comp.refDes,
              message: `${comp.refDes}: differential pins ${c.pins.join(", ")} are shorted onto one net.`,
              suggestion: `Route ${c.pins.join(" and ")} on separate nets.`,
            });
          }
        }
      }
    }
  }

  const criticalCount = errors.filter((e) => e.severity === "critical").length;
  const warningCount = errors.length - criticalCount;
  return {
    errors,
    criticalCount,
    warningCount,
    reward: computeErcReward(criticalCount, warningCount),
    ok: criticalCount === 0,
  };
}

// ─── Continuous reward (ported shaping) ──────────────────────────────────────
//
// Mirrors PCBSchemaGen's layered interpolation: fewer errors in the failing
// layer → closer to the next layer's base reward. Structural validation upstream
// guarantees the sub-0.5 layers (code exists + parses), so the range is [0.5, 1].

const E_MAX = 10; // per-layer normalizing constant

export function computeErcReward(criticalCount: number, warningCount: number): number {
  if (criticalCount > 0) return 0.5 + 0.2 * (1 - Math.min(criticalCount, E_MAX) / E_MAX);
  if (warningCount > 0) return 0.7 + 0.3 * (1 - Math.min(warningCount, E_MAX) / E_MAX);
  return 1.0;
}

// ─── LLM feedback (pin-localized, ported to_feedback format) ─────────────────

export function formatErcFeedback(report: ErcReport): string {
  const lines = report.errors
    .filter((e) => e.severity === "critical")
    .map((e) => `[CRITICAL] ${e.message}${e.suggestion ? `\n  -> Suggestion: ${e.suggestion}` : ""}`);
  return (
    `Electrical rule check failed with ${report.criticalCount} critical error(s):\n` +
    lines.join("\n") +
    `\nFix ONLY these problems and call submit_schematic again — keep every part and connection that is already correct.`
  );
}
