// Silk commands (Stage 16): apply/invert round-trips, deep-copy isolation,
// optional-field creation on pre-Stage-16 boards.

import { describe, it, expect } from "vitest";
import { applySilkCommand, invertSilkCommand, silkCommandLabel } from "../silk/commands";
import type { SilkCommand } from "../silk/commands";
import type { SilkItem, SilkTextItem } from "../silk/types";
import { createEmptyBoard } from "../types";
import type { PcbBoard } from "../types";

const text: SilkTextItem = {
  kind: "text",
  id: "s1",
  layer: "silkTop",
  position: { x: 1_000_000, y: 2_000_000 },
  text: "REV 1.0",
  heightNm: 1_000_000,
  strokeWidthNm: 150_000,
  rotationDeg: 0,
  mirror: false,
  anchor: "left",
};

describe("silk commands", () => {
  it("AddSilk appends; invert deletes; add→invert round-trips exactly", () => {
    const board = createEmptyBoard();
    const add: SilkCommand = { kind: "AddSilk", item: text };
    const after = applySilkCommand(board, add);
    expect(after.silkItems).toHaveLength(1);
    expect(after.silkItems![0]).toEqual(text);
    const restored = applySilkCommand(after, invertSilkCommand(add));
    expect(restored.silkItems).toEqual([]);
  });

  it("EditSilk replaces by id; double-invert is identity", () => {
    const board = applySilkCommand(createEmptyBoard(), { kind: "AddSilk", item: text });
    const moved: SilkItem = { ...text, position: { x: 9, y: 9 } };
    const edit: SilkCommand = { kind: "EditSilk", id: text.id, before: text, after: moved };
    const edited = applySilkCommand(board, edit);
    expect(edited.silkItems![0].kind === "text" && edited.silkItems![0].position).toEqual({ x: 9, y: 9 });
    const back = applySilkCommand(edited, invertSilkCommand(edit));
    expect(back.silkItems![0]).toEqual(text);
    expect(invertSilkCommand(invertSilkCommand(edit))).toEqual(edit);
  });

  it("deep-copies: mutating the command's item never mutates the board", () => {
    const item: SilkTextItem = { ...text, position: { x: 5, y: 5 } };
    const board = applySilkCommand(createEmptyBoard(), { kind: "AddSilk", item });
    item.position.x = 999;
    item.text = "clobbered";
    const stored = board.silkItems![0];
    expect(stored.kind === "text" && stored.position.x).toBe(5);
    expect(stored.kind === "text" && stored.text).toBe("REV 1.0");
  });

  it("pre-Stage-16 boards (no silkItems field) gain the array on first write", () => {
    const legacy = { ...createEmptyBoard() } as PcbBoard;
    delete (legacy as { silkItems?: unknown }).silkItems;
    const after = applySilkCommand(legacy, { kind: "AddSilk", item: text });
    expect(after.silkItems).toHaveLength(1);
  });

  it("labels are human-readable", () => {
    expect(silkCommandLabel({ kind: "AddSilk", item: text })).toBe('Add silk text "REV 1.0"');
    expect(
      silkCommandLabel({
        kind: "DeleteSilk",
        before: { kind: "circle", id: "c", layer: "silkTop", center: { x: 0, y: 0 }, radiusNm: 1, strokeWidthNm: 1, filled: false },
      }),
    ).toBe("Delete silk circle");
  });
});
