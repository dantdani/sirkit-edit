/**
 * B11.3 §A / B11.4 §F — the PCB shape descriptor CLI.
 *
 * All generation logic lives in the importable, filesystem-pure builder
 * `pcb-shape-descriptor-build.ts`. This file is the thin command-line shell:
 * it reads the checked-in descriptor, delegates, and writes only in write
 * mode. Tests import the builder directly and never execute this script, so no
 * test can cause a repository path to be written.
 *
 * Modes:
 *   tsx scripts/generate-pcb-shape-descriptor.ts            # regenerate + write
 *   tsx scripts/generate-pcb-shape-descriptor.ts --check    # read-only CI gate
 *   … --entry=<repo-relative path>                          # retarget the walk
 *
 * UNSUPPORTED-SHAPE POLICY (fail closed, never guess): `any`, `unknown`,
 * `never`, functions, classes, intersections, local generics, and any external
 * or opaque type reachable from `PcbBoard` are GENERATION FAILURES. The
 * builder throws, this shell prints the offending path, writes nothing, and
 * exits 2.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  buildPcbShapeDescriptor, comparePcbShapeDescriptor, DEFAULT_ENTRY, DESCRIPTOR_OUT, GenerationFailure,
} from "./pcb-shape-descriptor-build";

const ROOT = process.cwd();
const OUT_FILE = join(ROOT, DESCRIPTOR_OUT);

function readCheckedIn(): string | null {
  try {
    return readFileSync(OUT_FILE, "utf8");
  } catch {
    return null;
  }
}

function main(): void {
  const entryArgument = process.argv.find((argument) => argument.startsWith("--entry="));
  const entry = entryArgument ? entryArgument.slice("--entry=".length) : DEFAULT_ENTRY;
  const options = { root: ROOT, entry };

  if (process.argv.includes("--check")) {
    const result = comparePcbShapeDescriptor(readCheckedIn(), options);
    if (result.ok) {
      console.log(`OK — descriptor matches a fresh type-graph generation (${result.summary}).`);
      return;
    }
    if (result.reason === "unsupported-shape") {
      console.error(`GENERATION FAILED — ${result.detail}`);
      console.error("Fail-closed policy: no descriptor was written. Add a precise, documented adapter or remove the shape.");
      process.exit(2);
    }
    console.error(result.reason === "missing"
      ? `DRIFT — ${DESCRIPTOR_OUT} is missing.`
      : "DRIFT — the checked-in PCB shape descriptor does not match a fresh generation.");
    if (result.summary) console.error(`  fresh: ${result.summary}`);
    console.error("  Run: npx tsx scripts/generate-pcb-shape-descriptor.ts");
    process.exit(1);
  }

  try {
    const built = buildPcbShapeDescriptor(options);
    mkdirSync(dirname(OUT_FILE), { recursive: true });
    writeFileSync(OUT_FILE, built.content, { encoding: "utf8" });
    console.log(`Wrote ${DESCRIPTOR_OUT} — ${built.summary}`);
  } catch (error) {
    if (error instanceof GenerationFailure) {
      console.error(`GENERATION FAILED — ${error.message}`);
      console.error("Fail-closed policy: no descriptor was written. Add a precise, documented adapter or remove the shape.");
      process.exit(2);
    }
    throw error;
  }
}

main();
