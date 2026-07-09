// Zone history commands (PCB Stage 11): apply/invert round-trips, deep-copy
// isolation (mutating a command's zone never mutates the board), and the
// dirty-on-apply semantics that hand fill recomputation to useZoneFills.

import { describe, expect, it } from "vitest";
import { mmToNm } from "../units";
import type { Vec2 } from "../geometry";
import type { PcbBoard, Zone } from "../types";
import { createEmptyBoard } from "../types";
import {
  applyZoneCommand,
  invertZoneCommand,
  cloneZone,
  type ZoneCommand,
} from "../zones/command";

const mm = (v: number): number => mmToNm(v);
const v2 = (xMm: number, yMm: number): Vec2 => ({ x: mm(xMm), y: mm(yMm) });

let zoneN = 0;
function gndZone(overrides?: Partial<Zone>): Zone {
  return {
    id: `zc-${++zoneN}`,
    layer: "copperTop",
    netId: 1,
    polygon: [v2(0, 0), v2(20, 0), v2(20, 20), v2(0, 20)],
    appearance: "solid",
    connection: "thermal",
    fill: [],
    dirty: true,
    ...overrides,
  };
}

function boardWithZone(zone: Zone): PcbBoard {
  const b = createEmptyBoard();
  b.nets.push({ id: 1, name: "GND" });
  b.zones.push(zone);
  return b;
}

const zoneKey = (z: Zone): string => JSON.stringify([z.id, z.layer, z.netId, z.polygon]);

describe("zone commands", () => {
  it("AddZone → undo → redo restores the zone set exactly", () => {
    const base = createEmptyBoard();
    const zone = gndZone();
    const add: ZoneCommand = { kind: "AddZone", zone };

    const after = applyZoneCommand(base, add);
    expect(after.zones.map(zoneKey)).toEqual([zoneKey(zone)]);
    expect(after.zones[0].dirty).toBe(true);

    const undone = applyZoneCommand(after, invertZoneCommand(add));
    expect(undone.zones).toHaveLength(0);

    const redone = applyZoneCommand(undone, add);
    expect(redone.zones.map(zoneKey)).toEqual(after.zones.map(zoneKey));
  });

  it("AddZone deep-copies: mutating the command's zone does not touch the board", () => {
    const base = createEmptyBoard();
    const zone = gndZone();
    const after = applyZoneCommand(base, { kind: "AddZone", zone });
    zone.polygon[0].x = mm(99);
    zone.netId = 42;
    expect(after.zones[0].polygon[0].x).toBe(0);
    expect(after.zones[0].netId).toBe(1);
  });

  it("EditZone swaps by id and is self-inverse", () => {
    const before = gndZone({ dirty: false });
    const after = cloneZone(before);
    after.netId = 2;
    after.polygon = [v2(0, 0), v2(30, 0), v2(30, 30), v2(0, 30)];
    const board = boardWithZone(before);
    board.nets.push({ id: 2, name: "VCC" });

    const edit: ZoneCommand = { kind: "EditZone", id: before.id, before, after };
    const edited = applyZoneCommand(board, edit);
    expect(edited.zones[0].netId).toBe(2);
    expect(edited.zones[0].dirty).toBe(true); // model change → re-fill

    const reverted = applyZoneCommand(edited, invertZoneCommand(edit));
    expect(zoneKey(reverted.zones[0])).toBe(zoneKey(before));
  });

  it("DeleteZone removes by id; its inverse re-adds the exact zone", () => {
    const zone = gndZone();
    const board = boardWithZone(zone);
    const del: ZoneCommand = { kind: "DeleteZone", before: zone };

    const deleted = applyZoneCommand(board, del);
    expect(deleted.zones).toHaveLength(0);

    const restored = applyZoneCommand(deleted, invertZoneCommand(del));
    expect(restored.zones.map(zoneKey)).toEqual([zoneKey(zone)]);
  });

  it("cloneZone deep-copies fill regions", () => {
    const zone = gndZone();
    zone.fill = [
      {
        outer: [v2(0, 0), v2(10, 0), v2(10, 10)],
        holes: [[v2(2, 2), v2(4, 2), v2(4, 4)]],
        boundingBox: { minX: 0, minY: 0, maxX: mm(10), maxY: mm(10) },
        areaNm2: 123,
      },
    ];
    const copy = cloneZone(zone);
    copy.fill[0].outer[0].x = 999;
    copy.fill[0].holes[0][0].y = 999;
    expect(zone.fill[0].outer[0].x).toBe(0);
    expect(zone.fill[0].holes[0][0].y).toBe(mm(2));
  });
});
