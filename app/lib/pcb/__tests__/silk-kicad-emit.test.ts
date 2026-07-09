// Silk → KiCad emission (Stage 16 extends Stage 13): gr_text/gr_line/gr_rect/
// gr_circle on the right layers, registered in writeKicadPcb's emit order.

import { describe, it, expect } from "vitest";
import { emitSilkItem } from "../kicad/emit-silk";
import { writeKicadPcb, netlistFromBoard } from "../kicad/write-pcb";
import { parseSexpr, children } from "../sexpr";
import { createEmptyBoard } from "../types";
import type { SilkItem } from "../silk/types";
import { mmToNm } from "../units";

const text: SilkItem = {
  kind: "text",
  id: "s1",
  layer: "silkTop",
  position: { x: mmToNm(10), y: mmToNm(5) },
  text: "sirkit-demo",
  heightNm: mmToNm(1),
  strokeWidthNm: mmToNm(0.15),
  rotationDeg: 0,
  mirror: false,
  anchor: "left",
};

describe("emitSilkItem", () => {
  it("text → gr_text with font size/thickness and justify", () => {
    const out = emitSilkItem(text);
    expect(out).toContain(`(gr_text "sirkit-demo" (at 10.000000 5.000000) (layer "F.SilkS")`);
    expect(out).toContain(`(font (size 1.000000 1.000000) (thickness 0.150000))`);
    expect(out).toContain(`(justify left)`);
    // center anchor and no mirror → no justify block at all
    expect(emitSilkItem({ ...text, anchor: "center" })).not.toContain("justify");
    // bottom-side mirrored text carries the mirror token
    expect(emitSilkItem({ ...text, layer: "silkBottom", mirror: true })).toContain(`(justify left mirror)`);
  });

  it("rotation emits in KiCad degrees, normalized", () => {
    expect(emitSilkItem({ ...text, rotationDeg: 270 })).toContain("(at 10.000000 5.000000 -90.000000)");
  });

  it("line/rect/circle → gr_* with stroke, fill and layer", () => {
    const line: SilkItem = { kind: "line", id: "l", layer: "silkBottom", from: { x: 0, y: 0 }, to: { x: mmToNm(3), y: 0 }, strokeWidthNm: mmToNm(0.2) };
    expect(emitSilkItem(line)).toMatch(
      /^\(gr_line \(start 0\.000000 0\.000000\) \(end 3\.000000 0\.000000\) \(stroke \(width 0\.200000\) \(type solid\)\) \(layer "B\.SilkS"\) \(uuid "[0-9a-f-]+"\)\)$/,
    );
    const rect: SilkItem = { kind: "rect", id: "r", layer: "silkTop", corner1: { x: 0, y: 0 }, corner2: { x: mmToNm(2), y: mmToNm(1) }, strokeWidthNm: mmToNm(0.15), filled: false };
    expect(emitSilkItem(rect)).toContain("(gr_rect (start 0.000000 0.000000) (end 2.000000 1.000000)");
    expect(emitSilkItem(rect)).toContain("(fill none)");
    expect(emitSilkItem({ ...rect, kind: "rect", filled: true } as SilkItem)).toContain("(fill solid)");
    const circle: SilkItem = { kind: "circle", id: "c", layer: "silkTop", center: { x: mmToNm(5), y: mmToNm(5) }, radiusNm: mmToNm(2), strokeWidthNm: mmToNm(0.15), filled: false };
    // radius encoded as a circumference point: end = center + (r, 0)
    expect(emitSilkItem(circle)).toContain("(gr_circle (center 5.000000 5.000000) (end 7.000000 5.000000)");
  });
});

describe("writeKicadPcb silk registration", () => {
  it("board silk items appear in the file; boards without the field still emit", () => {
    const board = { ...createEmptyBoard(), silkItems: [text] };
    const root = parseSexpr(writeKicadPcb(board, netlistFromBoard(board)));
    const texts = children(root, "gr_text");
    expect(texts.length).toBe(1);

    const legacy = createEmptyBoard();
    delete (legacy as { silkItems?: unknown }).silkItems;
    expect(() => writeKicadPcb(legacy, netlistFromBoard(legacy))).not.toThrow();
  });

  it("silk emission is deterministic across runs (UUIDs aside)", () => {
    const board = {
      ...createEmptyBoard(),
      silkItems: [
        { kind: "line", id: "b", layer: "silkTop", from: { x: 0, y: 0 }, to: { x: 1, y: 1 }, strokeWidthNm: 1 } as SilkItem,
        { kind: "line", id: "a", layer: "silkTop", from: { x: 2, y: 2 }, to: { x: 3, y: 3 }, strokeWidthNm: 1 } as SilkItem,
      ],
    };
    const strip = (s: string): string => s.replace(/\(uuid "[0-9a-f-]+"\)/g, "");
    expect(strip(writeKicadPcb(board, netlistFromBoard(board)))).toBe(
      strip(writeKicadPcb(board, netlistFromBoard(board))),
    );
  });
});
