// Full-file writer (Stage 13): golden fixture match (UUIDs stripped),
// determinism across runs, empty-board validity via the Stage 1 parser.
//
// Regenerate the golden after an intentional format change with:
//   UPDATE_GOLDEN=1 pnpm test kicad-write-pcb
// then re-verify the fixture by opening it in KiCad 8 before committing.

import { describe, it, expect } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { writeKicadPcb, netlistFromBoard } from "../kicad/write-pcb";
import { buildRoutedDemo } from "../demo/routed-demo";
import { createEmptyBoard } from "../types";
import { parseSexpr, child, children, str } from "../sexpr";

const GOLDEN_PATH = fileURLToPath(new URL("./fixtures/routed-demo.kicad_pcb", import.meta.url));

/** UUIDs are fresh per export (pinned) — comparisons strip them. Line endings
 * normalized so a CRLF checkout of the fixture can't fail the diff. */
function stripUuids(text: string): string {
  return text.replace(/\(uuid "[0-9a-fA-F-]+"\)/g, `(uuid "")`).replace(/\r\n/g, "\n");
}

function exportRoutedDemo(): string {
  const board = buildRoutedDemo();
  return writeKicadPcb(board, netlistFromBoard(board));
}

describe("writeKicadPcb", () => {
  it("(a) routed demo matches the golden fixture (UUIDs stripped)", () => {
    const text = exportRoutedDemo();
    if (process.env.UPDATE_GOLDEN) {
      writeFileSync(GOLDEN_PATH, text, "utf8");
      return;
    }
    const golden = readFileSync(GOLDEN_PATH, "utf8");
    expect(stripUuids(text)).toBe(stripUuids(golden));
  });

  it("(b) deterministic: two exports differ only in UUIDs", () => {
    expect(stripUuids(exportRoutedDemo())).toBe(stripUuids(exportRoutedDemo()));
  });

  it("(c) empty board still emits a structurally valid .kicad_pcb", () => {
    const board = createEmptyBoard();
    const text = writeKicadPcb(board, netlistFromBoard(board));
    const root = parseSexpr(text);
    expect(str(root, 0)).toBe("kicad_pcb");
    const version = child(root, "version");
    expect(version && version.items[1]).toMatchObject({ kind: "number", value: 20240108 });
    expect(child(root, "generator")).toBeTruthy();
    expect(child(root, "general")).toBeTruthy();
    expect(child(root, "layers")).toBeTruthy();
    expect(child(root, "setup")).toBeTruthy();
    // net 0 always present; outline = 4 Edge.Cuts lines
    expect(children(root, "net").length).toBeGreaterThanOrEqual(1);
    expect(children(root, "gr_line").length).toBe(4);
  });

  it("routed demo export carries every footprint, track, via, and net", () => {
    const board = buildRoutedDemo();
    const root = parseSexpr(writeKicadPcb(board, netlistFromBoard(board)));
    expect(children(root, "footprint").length).toBe(board.footprints.length);
    expect(children(root, "segment").length).toBe(board.tracks.length);
    expect(children(root, "via").length).toBe(board.vias.length);
    expect(children(root, "net").length).toBe(board.nets.length);
    // Stage 11 landed: every board zone emits (demo zone is dirty → outline only).
    expect(children(root, "zone").length).toBe(board.zones.length);
    // net_class blocks: at least Default
    expect(children(root, "net_class").length).toBeGreaterThanOrEqual(1);
  });

  it("footprints are emitted in ref order (deterministic structure)", () => {
    const text = exportRoutedDemo();
    const refs = [...text.matchAll(/\(property "Reference" "([^"]+)"/g)].map((m) => m[1]);
    expect(refs).toEqual([...refs].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })));
  });
});
