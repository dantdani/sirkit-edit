/**
 * Generate app/lib/pcb/silk/hershey-simplex.json from scripts/assets/futural.jhf
 * (Hershey Simplex / "futural" — PUBLIC DOMAIN, the classic NIST stroke font;
 * source: https://github.com/kamalmostafa/hershey-fonts).
 *
 * Run: pnpm tsx scripts/gen-silk-font.ts
 *
 * JHF format, one glyph per line (continuations appended until the declared
 * pair count is satisfied): cols 0-4 glyph id (ignored), cols 5-7 the pair
 * count INCLUDING the bounds pair, then 2-char pairs. First pair = left/right
 * bounds; " R" = pen up; coordinate = charCode − 'R'. Y grows DOWNWARD (same
 * as the PCB model). Glyphs are ASCII-ordered: line N ↔ charCode 32+N.
 *
 * Output: integer coordinates shifted so x=0 at the glyph's left bound and
 * y=0 at the BASELINE, plus per-glyph advance and global cap metrics.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const R = "R".charCodeAt(0);
const SRC = join(__dirname, "assets", "futural.jhf");
const OUT = join(__dirname, "..", "app", "lib", "pcb", "silk", "hershey-simplex.json");

interface RawGlyph {
  left: number;
  right: number;
  strokes: number[][][]; // polylines of [x, y]
}

const rawLines = readFileSync(SRC, "utf8").split(/\r?\n/).filter((l) => l.length > 0);

// Stitch continuation lines: each glyph consumes 8 header chars + 2·count data chars.
const glyphs: RawGlyph[] = [];
for (let i = 0; i < rawLines.length; i++) {
  let line = rawLines[i];
  const count = parseInt(line.slice(5, 8), 10);
  if (!Number.isFinite(count)) throw new Error(`bad header at line ${i + 1}`);
  const needed = 8 + count * 2;
  while (line.length < needed && i + 1 < rawLines.length) line += rawLines[++i];
  if (line.length < needed) throw new Error(`truncated glyph at line ${i + 1}`);

  const left = line.charCodeAt(8) - R;
  const right = line.charCodeAt(9) - R;
  const strokes: number[][][] = [];
  let current: number[][] = [];
  for (let p = 1; p < count; p++) {
    const a = line[8 + p * 2];
    const b = line[9 + p * 2];
    if (a === " " && b === "R") {
      if (current.length > 1) strokes.push(current);
      current = [];
      continue;
    }
    current.push([a.charCodeAt(0) - R, b.charCodeAt(0) - R]);
  }
  if (current.length > 1) strokes.push(current);
  glyphs.push({ left, right, strokes });
}
if (glyphs.length < 95) throw new Error(`expected 95 glyphs, got ${glyphs.length}`);

// Metrics from 'X' (spans exactly cap-top → baseline; unlike Q, no tail).
let baseline = -Infinity;
let capTop = Infinity;
for (const stroke of glyphs["X".charCodeAt(0) - 32].strokes) {
  for (const [, y] of stroke) {
    baseline = Math.max(baseline, y);
    capTop = Math.min(capTop, y);
  }
}
const capHeight = baseline - capTop;

const out: Record<string, unknown> = {};
const table: Record<string, { a: number; s: number[][][] }> = {};
for (let c = 32; c <= 126; c++) {
  const g = glyphs[c - 32];
  table[String.fromCharCode(c)] = {
    a: g.right - g.left, // advance width, font units
    s: g.strokes.map((stroke) => stroke.map(([x, y]) => [x - g.left, y - baseline])),
  };
}
out.name = "Hershey Simplex (futural, public domain)";
out.capHeight = capHeight;
out.glyphs = table;

writeFileSync(OUT, JSON.stringify(out), "utf8");
const size = JSON.stringify(out).length;
console.log(`wrote ${OUT} — ${glyphs.length} glyphs, capHeight ${capHeight} units, ${(size / 1024).toFixed(1)} KB`);
