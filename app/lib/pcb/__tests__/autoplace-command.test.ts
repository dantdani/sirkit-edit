// AutoPlaceApply command (Stage 8): apply/invert round-trips, deleted-footprint
// safety, and the single-undo history round-trip.

import { describe, it, expect } from "vitest";
import { produce } from "immer";
import type { PcbBoard } from "../types";
import { mmToNm } from "../units";
import { createHistory } from "../history";
import {
  applyAutoPlaceCommand,
  buildAutoPlaceCommand,
  invertAutoPlaceCommand,
  mutateBoardWithAutoPlace,
  type AutoPlaceApplyCommand,
} from "../autoplace/command";
import type { AutoPlaceResult } from "../autoplace/types";
import { makeBoard, makeInstance, makeResistorDef } from "./autoplace-fixture";

function fixtureBoard(): PcbBoard {
  const def = makeResistorDef();
  return makeBoard(
    100,
    80,
    [
      makeInstance("a", def, { x: 10, y: 10 }),
      makeInstance("b", def, { x: 20, y: 10 }, {}, { rotationDeg: 90 }),
      makeInstance("c", def, { x: 30, y: 10 }, {}, { side: "bottom" }),
    ],
    0,
  );
}

function fixturePlacements(): AutoPlaceResult["placements"] {
  return new Map([
    ["a", { position: { x: mmToNm(50), y: mmToNm(40) }, rotationDeg: 90 as const, side: "top" as const }],
    ["b", { position: { x: mmToNm(60), y: mmToNm(40) }, rotationDeg: 0 as const, side: "top" as const }],
    ["c", { position: { x: mmToNm(70), y: mmToNm(40) }, rotationDeg: 270 as const, side: "bottom" as const }],
  ]);
}

const placementState = (b: PcbBoard) =>
  b.footprints.map((f) => ({ id: f.id, at: f.at, rotationDeg: f.rotationDeg, side: f.side }));

describe("AutoPlaceApply command", () => {
  it("apply then invert restores the exact before state", () => {
    const b0 = fixtureBoard();
    const cmd = buildAutoPlaceCommand(b0, fixturePlacements());
    expect(cmd.after).toHaveLength(3);
    const b1 = applyAutoPlaceCommand(b0, cmd);
    expect(b1.footprints.find((f) => f.id === "a")!.at).toEqual({ x: mmToNm(50), y: mmToNm(40) });
    const b2 = applyAutoPlaceCommand(b1, invertAutoPlaceCommand(cmd));
    expect(placementState(b2)).toEqual(placementState(b0));
  });

  it("omits footprints whose placement is unchanged", () => {
    const b0 = fixtureBoard();
    const placements = fixturePlacements();
    placements.set("a", { position: { x: mmToNm(10), y: mmToNm(10) }, rotationDeg: 0, side: "top" });
    const cmd = buildAutoPlaceCommand(b0, placements);
    expect(cmd.after.map((s) => s.id)).toEqual(["b", "c"]);
    expect(cmd.before.map((s) => s.id)).toEqual(["b", "c"]);
  });

  it("applies cleanly when a footprint was deleted since the snapshot", () => {
    const b0 = fixtureBoard();
    const cmd = buildAutoPlaceCommand(b0, fixturePlacements());
    const shrunk = produce(b0, (d) => {
      d.footprints = d.footprints.filter((f) => f.id !== "b");
    });
    const applied = applyAutoPlaceCommand(shrunk, cmd); // no crash, "b" is a no-op
    expect(applied.footprints).toHaveLength(2);
    expect(applied.footprints.find((f) => f.id === "a")!.at).toEqual({ x: mmToNm(50), y: mmToNm(40) });
    expect(applied.footprints.find((f) => f.id === "c")!.side).toBe("bottom");
  });

  it("round-trips through the history stack: apply → undo → redo is identity", () => {
    const b0 = fixtureBoard();
    const cmd: AutoPlaceApplyCommand = buildAutoPlaceCommand(b0, fixturePlacements());
    const h = createHistory(b0);
    h.execute("Auto-place", (draft) => mutateBoardWithAutoPlace(draft, cmd));
    const afterApply = h.present;
    expect(placementState(afterApply)).not.toEqual(placementState(b0));

    h.undo(); // ONE undo reverts the entire batch
    expect(placementState(h.present)).toEqual(placementState(b0));
    expect(h.canUndo).toBe(false);

    h.redo();
    expect(placementState(h.present)).toEqual(placementState(afterApply));
  });
});
