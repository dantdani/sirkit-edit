// Byte-identical round-trip of three real KiCad 10 footprint files — the
// contract Stage 13's "re-emit stored footprint with placement rewrites"
// strategy depends on.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { parseSexpr, emitVerbatim, writeSexpr } from "../sexpr";
import type { SNode } from "../sexpr";

const FIXTURES = [
  "R_0805_2012Metric.kicad_mod",
  "LQFP-48_7x7mm_P0.5mm.kicad_mod",
  "PinHeader_1x02_P2.54mm_Vertical.kicad_mod",
];

function readFixture(name: string): string {
  // utf-8 decode preserves CRLF sequences as-is.
  return readFileSync(
    fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)),
    "utf-8",
  );
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf-8").digest("hex");
}

/** Normalize an AST ignoring spans and raw text (invariant (b)). */
function strip(node: SNode): unknown {
  if (node.kind === "list") {
    return { kind: "list", items: node.items.map(strip) };
  }
  return { kind: node.kind, value: node.value };
}

describe("S-expression round-trip", () => {
  for (const name of FIXTURES) {
    it(`round-trips ${name} byte-exactly`, () => {
      const src = readFixture(name);
      const ast = parseSexpr(src);

      const emitted = emitVerbatim(ast, src);
      expect(emitted).toBe(src);

      const srcHash = sha256(src);
      const emittedHash = sha256(emitted);
      // eslint-disable-next-line no-console
      console.log(`${name}\n  source  sha256 ${srcHash}\n  emitted sha256 ${emittedHash}`);
      expect(emittedHash).toBe(srcHash);

      // Canonical re-write must re-parse deeply equal (spans/raw excluded).
      const rewritten = writeSexpr(ast);
      expect(strip(parseSexpr(rewritten))).toEqual(strip(ast));
    });
  }
});
