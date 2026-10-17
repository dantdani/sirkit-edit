/**
 * Maps a KiCad library file basename (e.g. "MCU_Espressif") to a single
 * user-facing top-level category (e.g. "Microcontrollers").
 *
 * Two layers: an explicit map for the most common libraries, then prefix-based
 * fallbacks so libraries we haven't enumerated still land somewhere sensible.
 * Anything unmatched becomes "Other".
 */

const MAIN_CATEGORY_MAP: Record<string, string> = {
  // Passives & power
  Device: "Passive Components",
  Switch: "Switches & Relays",
  Relay: "Switches & Relays",
  Battery: "Power Sources",
  Transformer: "Magnetics",
  Ferrite: "Passive Components",

  // Connectors
  Connector: "Connectors",
  Connector_Generic: "Connectors",
  Connector_USB: "Connectors",
  Connector_Audio: "Connectors",
  Connector_RF: "Connectors",

  // Microcontrollers
  MCU_ST_STM32F4: "Microcontrollers",
  MCU_ST_STM32F0: "Microcontrollers",
  MCU_Microchip_ATmega: "Microcontrollers",
  MCU_Microchip_ATtiny: "Microcontrollers",
  MCU_Microchip_PIC16: "Microcontrollers",
  MCU_Espressif: "Microcontrollers",
  MCU_Nordic: "Microcontrollers",
  MCU_RaspberryPi: "Microcontrollers",

  // Analog
  Amplifier_Operational: "Op-Amps",
  Amplifier_Audio: "Op-Amps",
  Comparator: "Comparators",
  Reference_Voltage: "Voltage References",

  // Power management
  Regulator_Linear: "Voltage Regulators",
  Regulator_Switching: "Voltage Regulators",
  Power_Management: "Power Management",
  Power_Protection: "Power Management",

  // Discretes
  Diode: "Diodes",
  Diode_Bridge: "Diodes",
  Diode_Laser: "Diodes",
  LED: "LEDs",
  Transistor_BJT: "Transistors",
  Transistor_FET: "Transistors",
  Transistor_IGBT: "Transistors",

  // Sensors
  Sensor: "Sensors",
  Sensor_Temperature: "Sensors",
  Sensor_Motion: "Sensors",
  Sensor_Humidity: "Sensors",
  Sensor_Current: "Sensors",
  Sensor_Optical: "Sensors",

  // Digital / interface / memory
  Logic_74xx: "Logic",
  Logic_74xgxx: "Logic",
  Logic_CMOS_4000: "Logic",
  Memory_Flash: "Memory",
  Memory_EEPROM: "Memory",
  Memory_RAM: "Memory",
  Interface_UART: "Interface ICs",
  Interface_USB: "Interface ICs",
  Interface_CAN_LIN: "Interface ICs",
  Driver_Motor: "Drivers",
  Driver_LED: "Drivers",
  Driver_FET: "Drivers",
  RF_Module: "RF / Wireless",
  RF_Bluetooth: "RF / Wireless",
  Timer: "Timers & Oscillators",
  Oscillator: "Timers & Oscillators",
};

const PREFIX_RULES: { prefix: string; category: string }[] = [
  { prefix: "MCU_", category: "Microcontrollers" },
  { prefix: "Sensor_", category: "Sensors" },
  { prefix: "Connector", category: "Connectors" },
  { prefix: "Regulator_", category: "Voltage Regulators" },
  { prefix: "Amplifier_", category: "Op-Amps" },
  { prefix: "Comparator", category: "Comparators" },
  { prefix: "Driver_", category: "Drivers" },
  { prefix: "RF_", category: "RF / Wireless" },
  { prefix: "Logic_", category: "Logic" },
  { prefix: "Memory_", category: "Memory" },
  { prefix: "Interface_", category: "Interface ICs" },
  { prefix: "FPGA_", category: "FPGAs" },
  { prefix: "CPLD_", category: "FPGAs" },
  { prefix: "DSP_", category: "Microcontrollers" },
  { prefix: "Diode", category: "Diodes" },
  { prefix: "Transistor_", category: "Transistors" },
  { prefix: "Power_", category: "Power Management" },
  { prefix: "Oscillator", category: "Timers & Oscillators" },
  { prefix: "Timer", category: "Timers & Oscillators" },
  { prefix: "Sensor", category: "Sensors" },
  { prefix: "Connector_", category: "Connectors" },
  { prefix: "4xxx", category: "Logic" },
  { prefix: "74", category: "Logic" },
];

/** Resolve a library basename to its user-facing main category. */
export function categorizeLib(libName: string): string {
  if (libName in MAIN_CATEGORY_MAP) return MAIN_CATEGORY_MAP[libName];
  for (const { prefix, category } of PREFIX_RULES) {
    if (libName.startsWith(prefix)) return category;
  }
  return "Other";
}

// ─── [PR-L, 2026-10-17] The search filter's vocabulary (runbook L.6; limit-and-stall-map.md section 4, root cause 2) ─────────
// The catalog's `libraries.main_category` is written only by scripts/ingest-kicad.ts, through `categorizeLib` above, so the names
// that function can return are the WHOLE vocabulary a category filter can match. The Build loop's search tool used to tell the
// model only "e.g. Microcontrollers" while the search compared the model's string exactly against names it never saw, and a miss
// returned nothing. The tool contract (app/lib/prompts.ts) and the search filter (app/lib/parts-search.ts) now take the vocabulary
// and its normalization from here: GENERATED from the two tables above, never hand-copied.

/** Every main category `categorizeLib` can return, in first-seen order: the explicit map's values, the prefix rules', "Other". */
export const MAIN_CATEGORIES: readonly string[] = Object.freeze([
  ...new Set([...Object.values(MAIN_CATEGORY_MAP), ...PREFIX_RULES.map((rule) => rule.category), "Other"]),
]);

/** How a requested category was matched to the vocabulary. An unrecognised request filters NOTHING (an unfiltered search), and the
 *  note says so: a guess the catalog does not hold never silently returns an empty result. */
export interface MainCategoryResolution {
  /** "none": no category asked; "exact": a vocabulary name as given; "normalized": mapped to exactly one name (case, plural,
   *  punctuation, a word or phrase of a category or KiCad library name, or a listed synonym); "unrecognised": no single name fits */
  status: "none" | "exact" | "normalized" | "unrecognised";
  /** the request, trimmed and bounded to 64 characters */
  requested: string | null;
  /** the vocabulary name the search filters on; null = no filter */
  applied: string | null;
  /** for an ambiguous request, the names it could mean (vocabulary order); empty otherwise */
  candidates: readonly string[];
  /** one sentence for the model whenever the request was not used exactly as given; null otherwise */
  note: string | null;
}

/** Common one-word names for a category that no category or library name contains (each target is checked against
 *  MAIN_CATEGORIES by l6-category-vocabulary). Words of the category and library names themselves are derived below. */
const CATEGORY_SYNONYMS: Readonly<Record<string, string>> = {
  resistor: "Passive Components", capacitor: "Passive Components", inductor: "Passive Components", fuse: "Passive Components",
  mosfet: "Transistors", fet: "Transistors",
  ldo: "Voltage Regulators", buck: "Voltage Regulators", boost: "Voltage Regulators",
  imu: "Sensors", accelerometer: "Sensors", gyroscope: "Sensors", gyro: "Sensors", magnetometer: "Sensors", barometer: "Sensors",
  microprocessor: "Microcontrollers", opamp: "Op-Amps",
  crystal: "Timers & Oscillators", xtal: "Timers & Oscillators", resonator: "Timers & Oscillators",
  header: "Connectors", jack: "Connectors", socket: "Connectors", receptacle: "Connectors",
  button: "Switches & Relays", pushbutton: "Switches & Relays",
  wifi: "RF / Wireless", antenna: "RF / Wireless",
  zener: "Diodes", schottky: "Diodes", rectifier: "Diodes", tvs: "Diodes",
};
/** Multi-word synonyms, matched as whole words inside the request. */
const CATEGORY_PHRASE_SYNONYMS: Readonly<Record<string, string>> = {
  "dc dc": "Voltage Regulators", "h bridge": "Drivers", "level shifter": "Logic", "level translator": "Logic",
};
/** Words too generic to name a category on their own. */
const GENERIC_CATEGORY_WORDS: ReadonlySet<string> = new Set(["and", "other", "component", "ic", "device", "generic", "module"]);

function singularWord(word: string): string {
  if (word.length > 4 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.length > 4 && /(?:ch|sh|ss|x)es$/.test(word)) return word.slice(0, -2);
  if (word.length >= 3 && word.endsWith("s") && !/(?:ss|us|is)$/.test(word)) return word.slice(0, -1);
  return word;
}

/** A phrase as a matching key: compatibility-normalized, lower case, each run of other characters one space, each word singular. */
function categoryKey(text: string): string {
  return text.normalize("NFKC").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).map(singularWord).join(" ");
}

function usefulWord(word: string): boolean {
  return !GENERIC_CATEGORY_WORDS.has(word) && !/^\d+$/.test(word);
}

function grouped(pairs: ReadonlyArray<readonly [string, string]>): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const [key, category] of pairs) out.set(key, (out.get(key) ?? new Set<string>()).add(category));
  return out;
}

/** The library side of the tables: every explicit library name and every prefix rule, with the category it files under. */
const LIBRARY_SOURCES: ReadonlyArray<readonly [string, string]> = [
  ...Object.entries(MAIN_CATEGORY_MAP),
  ...PREFIX_RULES.map((rule) => [rule.prefix, rule.category] as const),
];

const CATEGORY_BY_KEY: ReadonlyMap<string, string> = new Map(MAIN_CATEGORIES.map((category) => [categoryKey(category), category] as const));

/** Word -> categories, by precedence: a category name's own words, then the listed synonyms, then KiCad library-name words (three
 *  characters or more). A word a higher layer holds is never re-read from a lower one, so "led" is LEDs (the category name), not
 *  Drivers (the library Driver_LED). A word with two categories inside its layer is ambiguous. */
const CATEGORY_WORDS: ReadonlyMap<string, ReadonlySet<string>> = (() => {
  const names = grouped(MAIN_CATEGORIES.flatMap((category) => categoryKey(category).split(" ").filter(usefulWord).map((word) => [word, category] as const)));
  const synonyms = grouped(Object.entries(CATEGORY_SYNONYMS).map(([word, category]) => [categoryKey(word), category] as const));
  const libraries = grouped(LIBRARY_SOURCES.flatMap(([library, category]) => categoryKey(library).split(" ").filter((word) => usefulWord(word) && word.length >= 3).map((word) => [word, category] as const)));
  const words = new Map<string, ReadonlySet<string>>(libraries);
  for (const [word, categories] of synonyms) words.set(word, categories);
  for (const [word, categories] of names) words.set(word, categories);
  return words;
})();

/** Phrase -> categories: multi-word category names, the phrase synonyms, and two-word library names in either word order
 *  ("Driver_Motor" -> "driver motor" and "motor driver"). A phrase with two categories is ambiguous. */
const CATEGORY_PHRASES: ReadonlyMap<string, ReadonlySet<string>> = grouped([
  ...MAIN_CATEGORIES.map((category) => [categoryKey(category), category] as const).filter(([key]) => key.includes(" ")),
  ...Object.entries(CATEGORY_PHRASE_SYNONYMS).map(([phrase, category]) => [categoryKey(phrase), category] as const),
  ...LIBRARY_SOURCES.flatMap(([library, category]) => {
    const words = categoryKey(library).split(" ").filter(usefulWord);
    return words.length === 2 ? [[`${words[0]} ${words[1]}`, category] as const, [`${words[1]} ${words[0]}`, category] as const] : [];
  }),
]);

function inVocabularyOrder(categories: Iterable<string>): string[] {
  const wanted = new Set(categories);
  return MAIN_CATEGORIES.filter((category) => wanted.has(category));
}

/**
 * Resolve a requested category against the catalog's vocabulary: a name as given ("exact"); exactly one name after case, plural
 * and punctuation folding, or through a phrase, a word or a synonym ("normalized"); otherwise "unrecognised", which the search runs
 * WITHOUT a filter. Phrases are tried before single words, and a word that names one category outweighs words that name several.
 */
export function resolveMainCategory(requested: string | null | undefined): MainCategoryResolution {
  const raw = typeof requested === "string" ? requested.trim() : "";
  if (raw === "") return { status: "none", requested: null, applied: null, candidates: [], note: null };
  const shown = raw.length > 64 ? `${raw.slice(0, 63)}…` : raw;
  if (MAIN_CATEGORIES.includes(raw)) return { status: "exact", requested: shown, applied: raw, candidates: [], note: null };
  const key = categoryKey(raw);
  const normalized = (applied: string): MainCategoryResolution => ({
    status: "normalized", requested: shown, applied, candidates: [],
    note: `Category "${shown}" is not a catalog category name; searched the "${applied}" category.`,
  });
  const keyed = CATEGORY_BY_KEY.get(key);
  if (keyed) return normalized(keyed);
  const padded = ` ${key} `;
  const byPhrase = new Set<string>();
  for (const [phrase, categories] of CATEGORY_PHRASES) if (padded.includes(` ${phrase} `)) for (const category of categories) byPhrase.add(category);
  const decisive = new Set<string>();
  const ambiguous = new Set<string>();
  if (byPhrase.size === 0) {
    for (const word of key.split(" ")) {
      const categories = CATEGORY_WORDS.get(word);
      if (!categories) continue;
      for (const category of categories) (categories.size === 1 ? decisive : ambiguous).add(category);
    }
  }
  const implied = byPhrase.size > 0 ? byPhrase : decisive.size > 0 ? decisive : ambiguous;
  if (implied.size === 1 && (byPhrase.size > 0 || decisive.size > 0)) return normalized([...implied][0]!);
  const candidates = inVocabularyOrder(implied);
  return {
    status: "unrecognised", requested: shown, applied: null, candidates,
    note: candidates.length > 0
      ? `Category "${shown}" was not recognised as one catalog category (it could mean ${candidates.join(" or ")}); searched without a category filter.`
      : `Category "${shown}" was not recognised; searched without a category filter. The catalog's categories are: ${MAIN_CATEGORIES.join(", ")}.`,
  };
}
