/**
 * [B19-D I5d review] The operator ingest path acts on extraction issues too.
 *
 * `scripts/ingest-kicad.ts` upserted every symbol `extractLibrary` returned; only the atomic path read the new `issues`, so a
 * duplicated name, a cyclic or dangling `extends` and a cut chain were still ingested silently into the parts catalog.
 */
import { describe, expect, it } from "vitest";
import { extractLibrary, symbolsSafeToIngest } from "../extract";

const lib = (body: string) => `(kicad_symbol_lib (version 20241209) ${body})`;
const pin = (number: string) => `(pin passive line (at 0 0 0) (length 2.54) (name "P") (number "${number}"))`;

describe("[B19-D I5d review] symbols with extraction issues are not ingested", () => {
  it("duplicates, cycles and missing parents are skipped with their codes; a clean symbol is kept", () => {
    const symbols = extractLibrary([lib(`(symbol "OK" ${pin("1")}) (symbol "DUP" ${pin("1")}) (symbol "DUP" ${pin("2")}) (symbol "A" (extends "B")) (symbol "B" (extends "A")) (symbol "ORPHAN" (extends "MISSING"))`)]);
    const { accepted, skipped } = symbolsSafeToIngest(symbols);
    expect(accepted.map((symbol) => symbol.name)).toEqual(["OK"]);
    expect(skipped.map((entry) => entry.name).sort()).toEqual(["A", "B", "DUP", "ORPHAN"]);
    expect(skipped.find((entry) => entry.name === "ORPHAN")!.codes).toEqual(["extends_missing_parent"]);
  });

  it("the ingest script filters through the helper (tripwire)", async () => {
    const { readFileSync } = await import("node:fs");
    expect(readFileSync("scripts/ingest-kicad.ts", "utf8")).toMatch(/symbolsSafeToIngest\(/);
  });
});
