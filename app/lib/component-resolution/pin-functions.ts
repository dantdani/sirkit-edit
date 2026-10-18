/**
 * [PR-M, 2026-10-17] Section M.2.3: the CLOSED vocabulary the unresolved-component resolution reads a symbol's pins and a part's
 * functional class in. Two facts, each derived from trusted catalog / published-symbol evidence and NEVER from a browser pin list,
 * a model's claim, a footprint hint or a pin count:
 *
 *  - the FUNCTIONAL CLASS of a part (a diode, a Schottky, a Zener, a TVS, an LED, a resistor, ...): from the KiCad symbol the catalog
 *    ingested (its library, symbol name, keywords and description; `ki_keywords` in its properties), tried in a fixed precedence so an
 *    "LED diode" is an LED and a "diode Schottky" is a Schottky. An unrecognised part is `unknown` - never guessed;
 *  - the FUNCTION of each pin: for the polar two-terminal classes (every diode class and the LED) the KiCad names of the two terminals
 *    (`K` / `A`, `CATHODE` / `ANODE`, as the KiCad libraries spell them) become `cathode` / `anode`; every other pin keeps its exact
 *    normalised name as its function, and an unnamed pin (`~`, empty) is identified by its number only.
 *
 * A pin-function match is ONE input of the compatibility proof (compatibility.ts), never the proof: the target pin must also be
 * mapped to a pad by the approved mapping certificate, the electrical types must agree and the classes must be the same. Pure and
 * browser-safe.
 */

export const FUNCTIONAL_CLASSES = Object.freeze([
  "diode", "schottky-diode", "zener-diode", "tvs-diode", "led",
  "resistor", "capacitor", "inductor", "transistor", "integrated-circuit", "connector", "unknown",
] as const);
export type FunctionalClass = (typeof FUNCTIONAL_CLASSES)[number];

/** The polar two-terminal classes whose terminals carry an anode / cathode function. */
export const POLAR_TWO_TERMINAL_CLASSES: readonly FunctionalClass[] = Object.freeze(["diode", "schottky-diode", "zener-diode", "tvs-diode", "led"]);

export interface FunctionalClassFacts {
  libraryName?: string | null;
  name?: string | null;
  description?: string | null;
  keywords?: string | null;
  properties?: Readonly<Record<string, string>> | null;
}

export interface FunctionalClassification {
  functionalClass: FunctionalClass;
  /** Which catalog field decided it (e.g. `keywords "diode Schottky"`), bounded; `none` when unknown. */
  evidence: string;
}

const words = (text: string): Set<string> => new Set((text.toLowerCase().match(/[a-z0-9]+/g) ?? []));

/** The rules in precedence order: the first rule whose words appear decides. A rule lists alternative word sets (all words of one set). */
const CLASS_RULES: ReadonlyArray<{ functionalClass: FunctionalClass; any: ReadonlyArray<readonly string[]> }> = Object.freeze([
  { functionalClass: "tvs-diode", any: [["tvs"], ["transient", "voltage", "suppressor"], ["esd", "diode"]] },
  { functionalClass: "zener-diode", any: [["zener"]] },
  { functionalClass: "schottky-diode", any: [["schottky"]] },
  { functionalClass: "led", any: [["led"], ["light", "emitting"]] },
  { functionalClass: "diode", any: [["diode"], ["rectifier"]] },
  { functionalClass: "resistor", any: [["resistor"]] },
  { functionalClass: "capacitor", any: [["capacitor"]] },
  { functionalClass: "inductor", any: [["inductor"], ["choke"]] },
  { functionalClass: "transistor", any: [["mosfet"], ["transistor"], ["bjt"], ["jfet"]] },
  { functionalClass: "connector", any: [["connector"], ["header"]] },
]);

/** KiCad symbol names of the Device library's generic parts, read exactly (the library naming is the KiCad convention). */
const DEVICE_SYMBOL_CLASS: Readonly<Record<string, FunctionalClass>> = Object.freeze({
  D: "diode", D_Small: "diode", D_Schottky: "schottky-diode", D_Schottky_Small: "schottky-diode", D_Zener: "zener-diode", D_Zener_Small: "zener-diode",
  D_TVS: "tvs-diode", D_TVS_Small: "tvs-diode", LED: "led", LED_Small: "led", R: "resistor", R_Small: "resistor", C: "capacitor", C_Small: "capacitor",
  C_Polarized: "capacitor", L: "inductor", L_Small: "inductor",
});

const bounded = (text: string, max = 80): string => (text.length <= max ? text : `${text.slice(0, max - 1)}…`);

/** The functional class of a catalog part from its ingested KiCad symbol facts (precedence: Device symbol name, keywords, description). */
export function functionalClassOf(facts: FunctionalClassFacts): FunctionalClassification {
  const library = (facts.libraryName ?? "").trim();
  const name = (facts.name ?? "").trim();
  if (library === "Device" && Object.hasOwn(DEVICE_SYMBOL_CLASS, name)) return { functionalClass: DEVICE_SYMBOL_CLASS[name]!, evidence: `KiCad Device symbol "${bounded(name, 40)}"` };
  const sources: Array<[string, string]> = [
    ["keywords", [facts.keywords ?? "", facts.properties?.ki_keywords ?? ""].join(" ").trim()],
    ["description", [facts.description ?? "", facts.properties?.Description ?? ""].join(" ").trim()],
    ["library", library],
  ];
  for (const [field, text] of sources) {
    if (!text) continue;
    const present = words(text);
    for (const rule of CLASS_RULES) {
      if (rule.any.some((set) => set.every((word) => present.has(word)))) return { functionalClass: rule.functionalClass, evidence: `${field} "${bounded(text)}"` };
    }
  }
  if (/^(MCU|Timer|Amplifier|Regulator|Interface|Logic|Memory|Sensor|Driver|Comparator|Analog|Converter)/.test(library)) return { functionalClass: "integrated-circuit", evidence: `KiCad library "${bounded(library, 40)}"` };
  return { functionalClass: "unknown", evidence: "none" };
}

export type PinFunctionKind = "anode" | "cathode" | "named" | "numbered";
export interface PinFunction {
  kind: PinFunctionKind;
  /** The comparison key: `anode`, `cathode`, `name:<NAME>` or `number:<n>`. */
  key: string;
}

const CATHODE_NAMES = new Set(["K", "CATHODE", "KATHODE"]);
const ANODE_NAMES = new Set(["A", "AN", "ANODE"]);

export function normalizedPinName(name: string | null | undefined): string {
  return (name ?? "").trim().toUpperCase();
}

/** One pin's function: anode / cathode for a polar two-terminal class, else its exact normalised name, else its number. */
export function pinFunctionOf(pin: { number: string; name: string | null | undefined }, functionalClass: FunctionalClass): PinFunction {
  const name = normalizedPinName(pin.name);
  if ((POLAR_TWO_TERMINAL_CLASSES as readonly string[]).includes(functionalClass)) {
    if (CATHODE_NAMES.has(name)) return { kind: "cathode", key: "cathode" };
    if (ANODE_NAMES.has(name)) return { kind: "anode", key: "anode" };
  }
  if (name.length > 0 && name !== "~") return { kind: "named", key: `name:${name}` };
  return { kind: "numbered", key: `number:${pin.number.trim()}` };
}

/** KiCad electrical types that are interchangeable for a resolution (passive with passive, power with power, signal with signal). */
export function electricalTypeGroup(type: string | null | undefined): "passive" | "power" | "signal" | "no_connect" | "unspecified" {
  switch ((type ?? "").trim()) {
    case "passive": return "passive";
    case "power_in": case "power_out": return "power";
    case "input": case "output": case "bidirectional": case "tri_state": case "open_collector": case "open_emitter": return "signal";
    case "no_connect": return "no_connect";
    default: return "unspecified";
  }
}
