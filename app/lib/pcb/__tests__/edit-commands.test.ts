/**
 * Stage 17 Phase A gate: edit-command validation + single-entry batching.
 * - validateCommand rejects unknown ids, footprint deletes, NaN/negative dims,
 *   illegal layer targets, locked footprints.
 * - applyEdits commits a whole batch as EXACTLY one history entry; one undo
 *   restores a deep-equal board (seeded random 20-command test).
 */

import { describe, it, expect } from "vitest";
import { buildRoutedDemo } from "../demo/routed-demo";
import { createHistory } from "../history";
import type { PcbBoard } from "../types";
import type { EditCommand, SelectionRef } from "../edit/commands";
import { validateCommand } from "../edit/validate";
import { applyEdits, liveRefs } from "../edit/apply";
import { describeEdits } from "../edit/describe";
import { mulberry32 } from "../autoplace/prng";
import { mmToNm } from "../units";

/** Routed demo + one silk text item (the demo ships without silk). */
function makeBoard(): PcbBoard {
  const board = buildRoutedDemo();
  board.silkItems = [
    {
      kind: "text",
      id: "st-1",
      layer: "silkTop",
      position: { x: mmToNm(5), y: mmToNm(5) },
      text: "hello",
      heightNm: 1_000_000,
      strokeWidthNm: 150_000,
      rotationDeg: 0,
      mirror: false,
      anchor: "left",
    },
  ];
  return board;
}

const ref = (kind: "via" | "track" | "zone" | "text" | "footprint", id: string): SelectionRef => ({
  kind,
  id,
});

describe("validateCommand", () => {
  const board = makeBoard();
  const track = board.tracks[0];
  const fp = board.footprints[0];

  it("accepts a well-formed width edit", () => {
    expect(
      validateCommand(board, { op: "set-track-width", ids: [track.id], widthNm: mmToNm(0.3) }),
    ).toEqual([]);
  });

  it("rejects unknown ids", () => {
    expect(
      validateCommand(board, { op: "set-track-width", ids: ["nope"], widthNm: mmToNm(0.3) }),
    ).toEqual(["No track nope on this board."]);
    expect(
      validateCommand(board, { op: "delete-items", refs: [ref("via", "ghost")] }),
    ).toContain("No via ghost on this board.");
  });

  it("rejects NaN / negative / zero dims", () => {
    for (const bad of [NaN, -1, 0, Infinity]) {
      expect(
        validateCommand(board, { op: "set-track-width", ids: [track.id], widthNm: bad }),
      ).toContain("Track width must be a positive number of nanometers.");
    }
  });

  it("rejects footprint and pad deletes", () => {
    const errors = validateCommand(board, {
      op: "delete-items",
      refs: [ref("footprint", fp.id), { kind: "pad", footprintId: fp.id, padNumber: fp.def.pads[0].number }],
    });
    expect(errors.some((e) => e.includes("Footprints can't be deleted"))).toBe(true);
    expect(errors.some((e) => e.includes("Pads belong to their footprint"))).toBe(true);
  });

  it("rejects illegal layer targets", () => {
    expect(
      validateCommand(board, { op: "set-item-layer", refs: [ref("via", "rd-v1")], layer: "copperTop" }),
    ).toContain("The layer of a via can't be changed — only tracks, zones and text.");
    // in1 doesn't exist on a 2-layer board.
    expect(
      validateCommand(board, { op: "set-item-layer", refs: [ref("track", track.id)], layer: "in1" }),
    ).toContain(`track ${track.id} can only sit on a copper layer of this 2-layer board.`);
    // Text can only go to silk.
    expect(
      validateCommand(board, { op: "set-item-layer", refs: [ref("text", "st-1")], layer: "copperTop" }),
    ).toContain("Text can only sit on a silkscreen layer.");
  });

  it("rejects move/rotate of locked footprints", () => {
    const locked = structuredClone(board);
    locked.footprints[0].locked = true;
    const fpId = locked.footprints[0].id;
    const r = ref("footprint", fpId);
    const refName = locked.footprints[0].ref;
    expect(
      validateCommand(locked, { op: "move-items", refs: [r], deltaNm: { x: 1000, y: 0 } }),
    ).toContain(`${refName} is locked — unlock it before you move it.`);
    expect(
      validateCommand(locked, { op: "rotate-items", refs: [r], quarterTurns: 1 }),
    ).toContain(`${refName} is locked — unlock it before you rotate it.`);
    // Unlocking via props while locked is allowed.
    expect(
      validateCommand(locked, { op: "set-footprint-props", id: fpId, patch: { locked: false } }),
    ).toEqual([]);
    // Rotating via props while locked is not.
    expect(
      validateCommand(locked, {
        op: "set-footprint-props",
        id: fpId,
        patch: { rotationDeg: 90 },
      }),
    ).toContain(`${refName} is locked — unlock it before you move or rotate it.`);
  });

  it("rejects a non-boolean locked value (AI/JSON boundary)", () => {
    expect(
      validateCommand(board, {
        op: "set-footprint-props",
        id: fp.id,
        patch: { locked: "yes" as unknown as boolean },
      }),
    ).toContain("Locked must be true or false.");
  });

  it("rejects unknown zone nets and bad clearances", () => {
    expect(
      validateCommand(board, { op: "set-zone-props", id: "rd-z1", patch: { netId: 99 } }),
    ).toContain("No net 99 on this board.");
    expect(
      validateCommand(board, { op: "set-zone-props", id: "rd-z1", patch: { clearanceNm: -5 } }),
    ).toContain("Zone clearance must be zero or a positive number of nanometers.");
  });

  it("rejects not-yet-implemented and unknown ops", () => {
    expect(
      validateCommand(board, { op: "align", refs: [ref("via", "rd-v1")], mode: "left" }),
    ).toContain("'align' isn't available yet (Stage 17 Phase D).");
    expect(
      validateCommand(board, { op: "create-padstack", padstack: {} as never }),
    ).toContain("'create-padstack' isn't available yet (Stage 17 Phase C).");
    expect(
      validateCommand(board, { op: "explode-board" } as unknown as EditCommand),
    ).toEqual(["Unknown edit command 'explode-board'."]);
  });
});

describe("applyEdits", () => {
  it("applies a batch as exactly ONE history entry and undoes deep-equal", () => {
    const board = makeBoard();
    const original = structuredClone(board);
    const history = createHistory(board);
    const track = board.tracks[0];

    const result = applyEdits(history, [
      { op: "set-track-width", ids: [track.id], widthNm: mmToNm(0.5) },
      { op: "move-items", refs: [ref("via", "rd-v1")], deltaNm: { x: mmToNm(1), y: 0 } },
      { op: "set-zone-props", id: "rd-z1", patch: { connect: "solid" } },
    ]);

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(history.present.tracks[0].width).toBe(mmToNm(0.5));
    expect(history.present.zones[0].connection).toBe("solid");
    expect(history.present.zones[0].dirty).toBe(true);

    expect(history.canUndo).toBe(true);
    history.undo();
    expect(history.canUndo).toBe(false); // exactly one entry for the batch
    expect(history.present).toEqual(original);
  });

  it("rejects the whole batch when ANY command is invalid", () => {
    const board = makeBoard();
    const history = createHistory(board);
    const track = board.tracks[0];
    const result = applyEdits(history, [
      { op: "set-track-width", ids: [track.id], widthNm: mmToNm(0.5) },
      { op: "set-track-width", ids: ["ghost"], widthNm: mmToNm(0.5) },
    ]);
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(["No track ghost on this board."]);
    expect(history.canUndo).toBe(false);
    expect(history.present.tracks[0].width).toBe(track.width); // untouched
  });

  it("seeded random 20-command batch: one entry, undo restores deep-equal", () => {
    const board = makeBoard();
    const original = structuredClone(board);
    const history = createHistory(board);
    const rand = mulberry32(0x5eed);
    const pickFrom = <T>(arr: T[]): T => arr[Math.floor(rand() * arr.length)];

    const cmds: EditCommand[] = [];
    for (let i = 0; i < 20; i++) {
      switch (Math.floor(rand() * 7)) {
        case 0:
          cmds.push({
            op: "set-track-width",
            ids: [pickFrom(board.tracks).id],
            widthNm: Math.round(mmToNm(0.2) + rand() * mmToNm(0.8)),
          });
          break;
        case 1:
          cmds.push({
            op: "move-items",
            refs: [ref("via", pickFrom(board.vias).id)],
            deltaNm: { x: Math.round(rand() * mmToNm(2)), y: Math.round(rand() * mmToNm(2)) },
          });
          break;
        case 2:
          cmds.push({
            op: "rotate-items",
            refs: [ref("footprint", pickFrom(board.footprints).id)],
            quarterTurns: rand() < 0.5 ? 1 : -1,
          });
          break;
        case 3:
          cmds.push({
            op: "set-zone-props",
            id: "rd-z1",
            patch: { clearanceNm: Math.round(rand() * mmToNm(0.5)) },
          });
          break;
        case 4:
          cmds.push({
            op: "set-item-layer",
            refs: [ref("track", pickFrom(board.tracks).id)],
            layer: rand() < 0.5 ? "copperTop" : "copperBottom",
          });
          break;
        case 5:
          cmds.push({
            op: "set-text-props",
            id: "st-1",
            patch: { sizeNm: Math.round(mmToNm(0.8) + rand() * mmToNm(1)) },
          });
          break;
        default:
          cmds.push({
            op: "set-footprint-props",
            id: pickFrom(board.footprints).id,
            patch: { rotationDeg: pickFrom([0, 90, 180, 270]) },
          });
      }
    }

    const result = applyEdits(history, cmds);
    expect(result.ok).toBe(true);
    const after = structuredClone(history.present);

    expect(history.canUndo).toBe(true);
    history.undo();
    expect(history.canUndo).toBe(false); // the 20 commands were ONE entry
    expect(history.present).toEqual(original);

    history.redo();
    expect(history.present).toEqual(after);
  });

  it("silk text mirror follows the layer (bottom silk reads through the board)", () => {
    const board = makeBoard();
    const history = createHistory(board);

    applyEdits(history, [
      { op: "set-item-layer", refs: [ref("text", "st-1")], layer: "silkBottom" },
    ]);
    let item = history.present.silkItems?.[0];
    expect(item?.kind === "text" && item.layer).toBe("silkBottom");
    expect(item?.kind === "text" && item.mirror).toBe(true);

    applyEdits(history, [
      { op: "set-text-props", id: "st-1", patch: { layer: "silkTop" } },
    ]);
    item = history.present.silkItems?.[0];
    expect(item?.kind === "text" && item.mirror).toBe(false);
  });

  it("delete-items removes copper/zones/silk text and undoes cleanly", () => {
    const board = makeBoard();
    const original = structuredClone(board);
    const history = createHistory(board);
    const track = board.tracks[0];

    const result = applyEdits(history, [
      {
        op: "delete-items",
        refs: [ref("track", track.id), ref("via", "rd-v2"), ref("zone", "rd-z1"), ref("text", "st-1")],
      },
    ]);
    expect(result.ok).toBe(true);
    expect(history.present.tracks.some((t) => t.id === track.id)).toBe(false);
    expect(history.present.vias.some((v) => v.id === "rd-v2")).toBe(false);
    expect(history.present.zones.length).toBe(0);
    expect(history.present.silkItems?.length).toBe(0);

    // liveRefs prunes what's gone.
    const refs: SelectionRef[] = [ref("track", track.id), ref("via", "rd-v1")];
    expect(liveRefs(history.present, refs)).toEqual([ref("via", "rd-v1")]);

    history.undo();
    expect(history.present).toEqual(original);
  });
});

describe("describeEdits", () => {
  const board = makeBoard();

  it("speaks mm and counts", () => {
    const ids = board.tracks.slice(0, 5).map((t) => t.id);
    expect(describeEdits(board, [{ op: "set-track-width", ids, widthNm: mmToNm(0.3) }])).toBe(
      "Set width 0.3 mm on 5 tracks",
    );
    expect(
      describeEdits(board, [{ op: "delete-items", refs: [ref("via", "rd-v1")] }]),
    ).toBe("Delete via");
    expect(
      describeEdits(board, [
        { op: "set-track-width", ids: [ids[0]], widthNm: mmToNm(0.3) },
        { op: "delete-items", refs: [ref("via", "rd-v1")] },
      ]),
    ).toBe("Set width 0.3 mm on 1 track (+1 more edit)");
  });

  it("uses display layer names and net names", () => {
    expect(
      describeEdits(board, [
        { op: "set-item-layer", refs: [ref("track", board.tracks[0].id)], layer: "copperBottom" },
      ]),
    ).toBe("Move track to Bottom Copper");
    const gnd = board.nets.find((n) => n.name === "GND");
    expect(gnd).toBeDefined();
    expect(
      describeEdits(board, [{ op: "set-zone-props", id: "rd-z1", patch: { netId: gnd?.id ?? 1 } }]),
    ).toBe("Set zone net to GND");
  });
});
