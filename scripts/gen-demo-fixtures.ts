/**
 * Generates app/lib/pcb/demo/fixtures.ts from Stage 1's .kicad_mod test
 * fixtures, embedding each file as a template-literal string so the PCB demo
 * board works offline with no fetches (Stage 2 runs in parallel — its API may
 * not exist). Run with: `pnpm tsx scripts/gen-demo-fixtures.ts`
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const FIXTURES_DIR = join(process.cwd(), "app", "lib", "pcb", "__tests__", "fixtures");
const OUT_PATH = join(process.cwd(), "app", "lib", "pcb", "demo", "fixtures.ts");

/** Fixture file → the KiCad library it came from (used as FootprintDef.libName). */
const SOURCES: Array<{ file: string; libName: string }> = [
  { file: "LQFP-48_7x7mm_P0.5mm.kicad_mod", libName: "Package_QFP" },
  { file: "R_0805_2012Metric.kicad_mod", libName: "Resistor_SMD" },
  { file: "PinHeader_1x02_P2.54mm_Vertical.kicad_mod", libName: "Connector_PinHeader_2.54mm" },
];

function escapeTemplate(source: string): string {
  return source.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
}

let out = `// GENERATED — do not edit. Regenerate with: pnpm tsx scripts/gen-demo-fixtures.ts
// Embedded copies of Stage 1's .kicad_mod test fixtures for the offline demo
// board (PCB Stage 3). Source of truth: app/lib/pcb/__tests__/fixtures/.

export interface DemoFixture {
  libName: string;
  name: string;
  source: string;
}

export const DEMO_FIXTURES: readonly DemoFixture[] = [
`;

for (const { file, libName } of SOURCES) {
  const source = readFileSync(join(FIXTURES_DIR, file), "utf8");
  const name = file.replace(/\.kicad_mod$/, "");
  out += `  {\n    libName: ${JSON.stringify(libName)},\n    name: ${JSON.stringify(name)},\n    source: \`${escapeTemplate(source)}\`,\n  },\n`;
}
out += `];\n`;

writeFileSync(OUT_PATH, out);
console.log(`[gen-demo-fixtures] wrote ${OUT_PATH} (${SOURCES.length} fixtures)`);
