// AutorouteImport command (Stage 9): partial-net replacement, single-undo
// restoration, and apply/invert round-trip identity. Pure — no subprocess.

import { describe, it, expect } from "vitest";
import { applyRouteCommand, invertRouteCommand } from "../route-tool.commands";
import { buildAutorouteImportCommand } from "../autoroute/command";
import { createEmptyBoard } from "../types";
import type { PcbBoard, Track } from "../types";
import { mmToNm } from "../units";

function board(netIds: number[]): PcbBoard {
  return {
    ...createEmptyBoard(),
    nets: [{ id: 0, name: "" }, ...netIds.map((id) => ({ id, name: `N${id}` }))],
  };
}

function track(id: string, netId: number, ax: number, ay: number, bx: number, by: number): Track {
  return {
    id,
    layer: "copperTop",
    width: mmToNm(0.25),
    start: { x: mmToNm(ax), y: mmToNm(ay) },
    end: { x: mmToNm(bx), y: mmToNm(by) },
    netId,
  };
}

/** Compare boards as SETS of tracks/vias (filter/re-add loses array order). */
function norm(b: PcbBoard): PcbBoard {
  const byId = (a: { id: string }, c: { id: string }): number => (a.id < c.id ? -1 : a.id > c.id ? 1 : 0);
  return { ...b, tracks: [...b.tracks].sort(byId), vias: [...b.vias].sort(byId) };
}

describe("AutorouteImport", () => {
  const b0: PcbBoard = {
    ...board([1, 2, 3]),
    tracks: [
      track("old-1", 1, 0, 0, 10, 0),
      track("old-2", 2, 0, 5, 10, 5),
      track("old-3", 3, 0, 10, 10, 10),
    ],
  };

  const imported = {
    tracks: [track("new-1", 1, 0, 0, 5, 5), track("new-2", 2, 5, 5, 10, 10)],
    vias: [],
  };
  const cmd = buildAutorouteImportCommand(b0, imported);

  it("computes replacedNetIds and captures the removed copper", () => {
    expect(cmd.kind).toBe("AutorouteImport");
    expect(cmd.replacedNetIds).toEqual([1, 2]);
    expect(cmd.removed.tracks.map((t) => t.id).sort()).toEqual(["old-1", "old-2"]);
  });

  it("(a) apply: nets 1 & 2 keep ONLY the new tracks; net 3 is untouched", () => {
    const b1 = applyRouteCommand(b0, cmd);
    expect(b1.tracks.filter((t) => t.netId === 1).map((t) => t.id)).toEqual(["new-1"]);
    expect(b1.tracks.filter((t) => t.netId === 2).map((t) => t.id)).toEqual(["new-2"]);
    expect(b1.tracks.filter((t) => t.netId === 3).map((t) => t.id)).toEqual(["old-3"]);
    expect(b1.tracks).toHaveLength(3);
  });

  it("(b) invert restores exactly the removed tracks and drops the imported ones", () => {
    const b1 = applyRouteCommand(b0, cmd);
    const b2 = applyRouteCommand(b1, invertRouteCommand(cmd));
    const netTrackIds = (b: PcbBoard, netId: number): string[] =>
      b.tracks.filter((t) => t.netId === netId).map((t) => t.id).sort();
    expect(netTrackIds(b2, 1)).toEqual(["old-1"]);
    expect(netTrackIds(b2, 2)).toEqual(["old-2"]);
    expect(b2.tracks.some((t) => t.id === "new-1" || t.id === "new-2")).toBe(false);
  });

  it("(c) apply → invert round-trip is identity (as sets)", () => {
    const b1 = applyRouteCommand(b0, cmd);
    const b2 = applyRouteCommand(b1, invertRouteCommand(cmd));
    expect(norm(b2)).toEqual(norm(b0));
  });

  it("does not mutate the input board or command arrays", () => {
    const before = b0.tracks.length;
    applyRouteCommand(b0, cmd);
    expect(b0.tracks).toHaveLength(before);
    expect(cmd.tracks.map((t) => t.id)).toEqual(["new-1", "new-2"]);
  });
});
