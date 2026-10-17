/**
 * [PR-L, 2026-10-17] Runbook L.6, limit-and-stall-map.md section 4 (root cause 2): the Build search tool's category argument.
 *
 * Before: the tool told the model only "e.g. Microcontrollers" (prompts.ts) and the search compared the model's string EXACTLY
 * against `libraries.main_category` (parts-search.ts), whose values come only from `categorizeLib` - names the model never saw.
 * "Motor Drivers", "MOSFETs", "Resistors" or "IMU" matched nothing and the search returned a bare [].
 *
 * Now: the vocabulary is generated from `categorizeLib`'s own tables (MAIN_CATEGORIES), the tool's schema lists it as an enum, and
 * `resolveMainCategory` folds case, plurals, punctuation, category and library-name words and phrases, and a short synonym list onto
 * exactly one name - or reports "unrecognised", which the search runs without a filter, with a note. Pure; no database, no provider.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { categorizeLib, MAIN_CATEGORIES, resolveMainCategory } from "../categories";
import { BUILD_SEARCH_PARTS_TOOL } from "@/app/lib/prompts";

const ROOT = join(__dirname, "..", "..", "..", "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

/** The 23 names the stall map lists from `categorizeLib` (limit-and-stall-map.md section 4, the line after the checklist). */
const STALL_MAP_VOCABULARY = [
  "Passive Components", "Switches & Relays", "Power Sources", "Magnetics", "Connectors", "Microcontrollers", "Op-Amps", "Comparators",
  "Voltage References", "Voltage Regulators", "Power Management", "Diodes", "LEDs", "Transistors", "Sensors", "Logic", "Memory",
  "Interface ICs", "Drivers", "RF / Wireless", "Timers & Oscillators", "FPGAs", "Other",
];

/** Real KiCad library basenames (explicit-map and prefix-rule ones), so the derivation is exercised from the function's side too. */
const KICAD_LIBRARIES = [
  "Device", "Switch", "Relay", "Battery", "Transformer", "Ferrite", "Connector", "Connector_Generic", "Connector_USB", "Connector_JST",
  "MCU_ST_STM32F4", "MCU_Microchip_ATmega", "MCU_Espressif", "MCU_Nordic", "MCU_RaspberryPi", "MCU_ST_STM32G4", "Amplifier_Operational",
  "Amplifier_Audio", "Comparator", "Reference_Voltage", "Regulator_Linear", "Regulator_Switching", "Power_Management",
  "Power_Protection", "Diode", "Diode_Bridge", "LED", "Transistor_BJT", "Transistor_FET", "Sensor_Motion", "Sensor_Current",
  "Logic_74xx", "Logic_LevelTranslator", "Memory_Flash", "Interface_UART", "Interface_CAN_LIN", "Driver_Motor", "Driver_FET",
  "RF_Module", "RF_Bluetooth", "Timer", "Oscillator", "FPGA_Lattice", "CPLD_Xilinx", "DSP_Microchip_DSPIC33", "4xxx", "74xx",
  "Mechanical", "Graphic",
];

describe("[PR-L L.6] the vocabulary is generated from categorizeLib, and the search tool's contract lists it", () => {
  it("MAIN_CATEGORIES is exactly the 23 names categorizeLib can return (the stall map's list, same order), frozen", () => {
    expect([...MAIN_CATEGORIES]).toEqual(STALL_MAP_VOCABULARY);
    expect(Object.isFrozen(MAIN_CATEGORIES)).toBe(true);
    // every library's category is in the vocabulary, and the libraries reach every name but none outside it
    const reached = new Set(KICAD_LIBRARIES.map(categorizeLib));
    for (const category of reached) expect(MAIN_CATEGORIES, category).toContain(category);
    expect([...reached].sort()).toEqual([...MAIN_CATEGORIES].sort());
  });

  it("the vocabulary is derived from the two tables in categories.ts, never written out as a list", () => {
    const source = read("app/lib/kicad/categories.ts");
    expect(source).toMatch(/export const MAIN_CATEGORIES: readonly string\[\] = Object\.freeze\(\[\s*\.\.\.new Set\(\[\.\.\.Object\.values\(MAIN_CATEGORY_MAP\), \.\.\.PREFIX_RULES\.map\(\(rule\) => rule\.category\), "Other"\]\),\s*\]\);/);
  });

  it("the search tool's category is an enum of exactly MAIN_CATEGORIES, generated in prompts.ts (no hand-copied list, no lone example)", () => {
    const category = (BUILD_SEARCH_PARTS_TOOL.inputSchema as { properties: { category: { type: string; enum: string[]; description: string } } }).properties.category;
    expect(category.type).toBe("string");
    expect(category.enum).toEqual([...MAIN_CATEGORIES]);
    expect(category.description).toMatch(/one of the catalog's category names/);
    expect(category.description).toMatch(/unrecognised name is searched without a filter/);
    expect(BUILD_SEARCH_PARTS_TOOL.description).toMatch(/categoryNote/);
    const prompts = read("app/lib/prompts.ts");
    expect(prompts).toContain("enum: [...MAIN_CATEGORIES]");
    expect(prompts).not.toContain('description: "Optional category filter, e.g. Microcontrollers"');
    expect(prompts).toContain('import { MAIN_CATEGORIES } from "@/app/lib/kicad/categories";');
  });
});

describe("[PR-L L.6] resolveMainCategory: exactly one catalog name, or no filter with a truthful note", () => {
  it("no category is no filter and no note", () => {
    for (const value of [undefined, null, "", "   "]) expect(resolveMainCategory(value)).toEqual({ status: "none", requested: null, applied: null, candidates: [], note: null });
  });

  it("every vocabulary name is exact; its case, plural and punctuation variants normalize to it", () => {
    for (const name of MAIN_CATEGORIES) {
      expect(resolveMainCategory(name)).toEqual({ status: "exact", requested: name, applied: name, candidates: [], note: null });
      expect(resolveMainCategory(` ${name.toUpperCase()} `).applied, name).toBe(name);
      expect(resolveMainCategory(name.toLowerCase().replace(/[^a-z0-9]+/g, "-")).applied, name).toBe(name);
    }
    expect(resolveMainCategory("microcontroller")).toMatchObject({ status: "normalized", applied: "Microcontrollers" });
    expect(resolveMainCategory("op amp")).toMatchObject({ status: "normalized", applied: "Op-Amps" });
    expect(resolveMainCategory("Timers and Oscillators")).toMatchObject({ status: "normalized", applied: "Timers & Oscillators" });
    expect(resolveMainCategory("RF/Wireless")).toMatchObject({ status: "normalized", applied: "RF / Wireless" });
    expect(resolveMainCategory("LED")).toMatchObject({ status: "normalized", applied: "LEDs" });
    expect(resolveMainCategory("Interface IC")).toMatchObject({ status: "normalized", applied: "Interface ICs" });
  });

  it.each([
    // the stall map's likely model guesses (section 4, "incorrect category filters")
    ["Resistors", "Passive Components"], ["MOSFETs", "Transistors"], ["Motor Drivers", "Drivers"], ["IMU", "Sensors"],
    ["MCU", "Microcontrollers"], ["Regulators", "Voltage Regulators"],
    // library-name words and phrases (generated from categorizeLib's tables) and synonyms
    ["N-channel MOSFET", "Transistors"], ["LED driver", "Drivers"], ["motor driver IC", "Drivers"],
    ["brushed DC motor driver", "Drivers"], ["gate driver", "Drivers"], ["H-bridge", "Drivers"], ["LDO regulator", "Voltage Regulators"],
    ["linear regulator", "Voltage Regulators"], ["DC-DC converter", "Voltage Regulators"], ["buck converter", "Voltage Regulators"],
    ["accelerometer", "Sensors"], ["gyroscope", "Sensors"], ["current sensor", "Sensors"], ["motion sensors", "Sensors"],
    ["ATmega", "Microcontrollers"], ["STM32F4", "Microcontrollers"], ["capacitors", "Passive Components"], ["inductor", "Passive Components"],
    ["crystal oscillator", "Timers & Oscillators"], ["pin header", "Connectors"], ["USB-C connector", "Connectors"], ["JST connector", "Connectors"],
    ["battery", "Power Sources"], ["Schottky diode", "Diodes"], ["bridge rectifier", "Diodes"], ["BJT", "Transistors"], ["EEPROM", "Memory"],
    ["UART transceiver", "Interface ICs"], ["Bluetooth", "RF / Wireless"], ["level shifter", "Logic"], ["push button", "Switches & Relays"],
  ])("%s -> %s (normalized, with a note naming the category searched)", (requested, applied) => {
    const resolution = resolveMainCategory(requested);
    expect(resolution).toEqual({ status: "normalized", requested, applied, candidates: [], note: `Category "${requested}" is not a catalog category name; searched the "${applied}" category.` });
  });

  it.each([
    ["Flight controller", []], ["ESC", []], ["drone", []], ["xyzzy", []],
    ["Power", ["Power Sources", "Power Management"]], ["voltage", ["Voltage References", "Voltage Regulators"]],
    ["USB", ["Connectors", "Interface ICs"]], ["MOSFET driver", ["Transistors", "Drivers"]], ["logic-level MOSFET", ["Transistors", "Logic"]], ["audio", ["Connectors", "Op-Amps"]],
  ] as const)("%s is unrecognised: no filter, and the note says so (candidates %j)", (requested, candidates) => {
    const resolution = resolveMainCategory(requested);
    expect(resolution.status).toBe("unrecognised");
    expect(resolution.applied).toBeNull();
    expect([...resolution.candidates].sort()).toEqual([...candidates].sort());
    expect(resolution.note).toMatch(new RegExp(`^Category "${requested}" was not recognised`));
    expect(resolution.note).toMatch(/searched without a category filter/);
    if (candidates.length === 0) expect(resolution.note).toContain(`The catalog's categories are: ${MAIN_CATEGORIES.join(", ")}.`);
    else for (const candidate of candidates) expect(resolution.note).toContain(candidate);
  });

  it("the echo is bounded: a long request is cut to 64 characters in the resolution and its note", () => {
    const resolution = resolveMainCategory(`${"flight controller ".repeat(20)}`);
    expect(resolution.requested!.length).toBeLessThanOrEqual(64);
    expect(resolution.note!.length).toBeLessThan(700);
  });

  it("whatever is asked, the filter is a vocabulary name or nothing (library names, synonyms and noise)", () => {
    const probes = [...KICAD_LIBRARIES, ...KICAD_LIBRARIES.map((name) => name.replace(/_/g, " ")), "IC", "chip", "module", "component", "device", "other parts", "", "%", "a b c", "Ω", "Ｍｏｔｏｒ Ｄｒｉｖｅｒｓ"];
    for (const probe of probes) {
      const resolution = resolveMainCategory(probe);
      if (resolution.applied !== null) expect(MAIN_CATEGORIES, probe).toContain(resolution.applied);
      for (const candidate of resolution.candidates) expect(MAIN_CATEGORIES, probe).toContain(candidate);
    }
    expect(resolveMainCategory("Ｍｏｔｏｒ Ｄｒｉｖｅｒｓ").applied).toBe("Drivers"); // full-width letters fold (NFKC)
    for (const generic of ["IC", "chip", "module", "component", "device"]) expect(resolveMainCategory(generic).applied, generic).toBeNull();
  });

  it("every listed synonym (word and phrase) names a vocabulary category - read from the source, so a misspelled target fails here", () => {
    const source = read("app/lib/kicad/categories.ts");
    const block = (name: string) => source.slice(source.indexOf(`const ${name}`), source.indexOf("};", source.indexOf(`const ${name}`)));
    const targets = [...`${block("CATEGORY_SYNONYMS")}\n${block("CATEGORY_PHRASE_SYNONYMS")}`.matchAll(/:\s*"([^"]+)"/g)].map((match) => match[1]!);
    expect(targets.length).toBeGreaterThan(30);
    for (const target of targets) expect(MAIN_CATEGORIES, target).toContain(target);
  });
});
