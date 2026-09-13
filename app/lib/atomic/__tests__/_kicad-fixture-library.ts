/**
 * [B19-E E4] The committed official KiCad library copies (app/lib/fixture-runtime/blinker/kicad) served as the bundled KiCad
 * library: the real bundled library under data/ is not in the repository. No other test-support import, so a suite can mock
 * the authoring module with it.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { BundledKicadLibrary } from "../authoring";

const KICAD_DIR = join(process.cwd(), "app", "lib", "fixture-runtime", "blinker", "kicad");
const SYMBOL_FILES: Record<string, string> = { "Timer/NE555D": "Timer_NE555.kicad_sym", "Device/R": "R.kicad_sym", "Device/C": "C.kicad_sym", "Device/LED": "LED.kicad_sym", "Connector_Generic/Conn_01x02": "Conn_01x02.kicad_sym" };
const FOOTPRINT_FILES: Record<string, string> = { "Package_SO/SOIC-8_3.9x4.9mm_P1.27mm": "SOIC-8_3.9x4.9mm_P1.27mm.kicad_mod", "Resistor_SMD/R_0805_2012Metric": "R_0805_2012Metric.kicad_mod", "Capacitor_SMD/C_0805_2012Metric": "C_0805_2012Metric.kicad_mod", "LED_SMD/LED_0805_2012Metric": "LED_0805_2012Metric.kicad_mod" };

/** The committed official KiCad library copies, served as the bundled library (line endings normalized, like the catalog). */
export function fixtureKicadLibrary(overrides: { symbols?: Record<string, string | null> } = {}): BundledKicadLibrary & { reads: string[] } {
  const reads: string[] = [];
  const read = (file: string | undefined): string | null => (file ? readFileSync(join(KICAD_DIR, file), "utf8").replace(/\r\n/g, "\n") : null);
  return {
    reads,
    symbolsRevision: "kicad-symbols@bundled",
    footprintsRevision: "kicad-footprints@bundled",
    symbol(library, name) {
      reads.push(`symbol:${library}/${name}`);
      const key = `${library}/${name}`;
      if (overrides.symbols && key in overrides.symbols) return overrides.symbols[key] ?? null;
      return read(SYMBOL_FILES[key]);
    },
    footprint(library, name) {
      reads.push(`footprint:${library}/${name}`);
      return read(FOOTPRINT_FILES[`${library}/${name}`]);
    },
  };
}

