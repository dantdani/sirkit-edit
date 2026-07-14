/**
 * Stage 17 Phase D gate: the board digest stays ≤ 20 KB on the 600-instance
 * demo (size printed), carries net classes + width histograms + padstack
 * usage, and caps selection detail at 50 items.
 */

import { describe, it, expect } from "vitest";
import { buildDigest, buildItemIndex } from "../edit/digest";
import { buildRoutedDemo } from "../demo/routed-demo";
import { buildDemoBoard } from "../demo/demo-board";
import { ensureBoardPadstacks } from "../padstack/migrate";
import { selectNet } from "../selection-queries";

describe("buildDigest", () => {
  it("summarizes nets, padstacks and counts on the routed demo", () => {
    const board = buildRoutedDemo();
    ensureBoardPadstacks(board);
    const gnd = board.nets.find((n) => n.name === "GND");
    const digest = buildDigest(board, [{ kind: "via", id: "rd-v1" }], { presetId: "jlcpcb-2l" });

    expect(digest.units).toBe("mm");
    expect(digest.activePreset).toBe("jlcpcb-2l");
    expect(digest.counts.vias).toBe(board.vias.length);
    expect(digest.counts.footprints).toBe(board.footprints.length);

    const gndNet = digest.nets.find((n) => n.id === gnd?.id);
    expect(gndNet).toBeDefined();
    expect(gndNet?.tracks).toBeGreaterThan(0);
    expect(Object.keys(gndNet?.widthsMm ?? {}).length).toBeGreaterThan(0);
    expect(["Default", "Power", "HighCurrent"]).toContain(gndNet?.class);

    expect(digest.padstacks.length).toBeGreaterThanOrEqual(3); // seeded defaults
    const used = digest.padstacks.find((p) => p.used > 0);
    expect(used).toBeDefined();

    expect(digest.selection.count).toBe(1);
    expect(digest.selection.items[0]).toMatchObject({ kind: "via", id: "rd-v1" });
  });

  it("caps selection detail at 50 items and flags truncation", () => {
    const board = buildRoutedDemo();
    const gnd = board.nets.find((n) => n.name === "GND")?.id ?? 1;
    const refs = selectNet(board, gnd);
    const digest = buildDigest(board, refs);
    expect(digest.selection.count).toBe(refs.length);
    expect(digest.selection.items.length).toBeLessThanOrEqual(50);
    expect(digest.selection.truncated).toBe(refs.length > 50);
  });

  it("stays under 20 KB on the 600-instance demo (gate; size printed)", () => {
    const board = buildDemoBoard("high");
    ensureBoardPadstacks(board);
    const digest = buildDigest(board, [], { presetId: "jlcpcb-2l" });
    const size = JSON.stringify(digest).length;
    // eslint-disable-next-line no-console
    console.log(
      `[stage17-d] digest size on high-density demo (${board.footprints.length} footprints): ${size} bytes`,
    );
    expect(size).toBeLessThanOrEqual(20 * 1024);
  });
});

describe("buildItemIndex", () => {
  it("emits one row per selectable item (pads excluded)", () => {
    const board = buildRoutedDemo();
    const index = buildItemIndex(board);
    const expected =
      board.footprints.length +
      board.tracks.length +
      board.vias.length +
      board.zones.length +
      (board.silkItems ?? []).filter((s) => s.kind === "text").length;
    expect(index.length).toBe(expected);
    const track = index.find((i) => i.kind === "track");
    expect(track?.net).toBeDefined();
    expect(track?.widthMm).toBeGreaterThan(0);
    const fp = index.find((i) => i.kind === "footprint");
    expect(fp?.ref).toBeDefined();
  });
});
