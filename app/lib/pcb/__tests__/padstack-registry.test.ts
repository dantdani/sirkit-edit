/**
 * Stage 17 Phase C gate: the padstack registry + the four padstack commands.
 * The denormalization invariant is the load-bearing bit: edit-padstack /
 * set-via-padstack update member vias' size/drill in the SAME undo entry.
 */

import { describe, it, expect } from "vitest";
import { buildRoutedDemo } from "../demo/routed-demo";
import { createHistory } from "../history";
import {
  getPadstack,
  addPadstack,
  removePadstack,
  usageCount,
  resolveVia,
  nextPadstackId,
} from "../padstack/registry";
import { ensureBoardPadstacks } from "../padstack/migrate";
import { applyEdits } from "../edit/apply";
import { validateCommand } from "../edit/validate";
import { mmToNm } from "../units";
import type { PadstackInput } from "../padstack/types";

const INPUT: PadstackInput = {
  name: "Test via",
  kind: "via",
  outerNm: mmToNm(0.7),
  drillNm: mmToNm(0.35),
  tented: true,
  zoneConnect: "solid",
};

describe("padstack registry", () => {
  it("adds with deterministic ids and resolves", () => {
    const board = buildRoutedDemo();
    expect(nextPadstackId(board)).toBe("ps-1");
    const a = addPadstack(board, INPUT);
    expect(a.id).toBe("ps-1");
    expect(nextPadstackId(board)).toBe("ps-2");
    expect(getPadstack(board, "ps-1")?.name).toBe("Test via");
  });

  it("resolveVia falls back to via dims for legacy/dangling references", () => {
    const board = buildRoutedDemo();
    const via = board.vias[0];
    expect(resolveVia(board, via)).toEqual({
      outerNm: via.size,
      drillNm: via.drill,
      tented: true,
      zoneConnect: "solid",
    });
    via.padstackId = "ghost"; // dangling
    expect(resolveVia(board, via).outerNm).toBe(via.size);
    const ps = addPadstack(board, INPUT);
    via.padstackId = ps.id;
    expect(resolveVia(board, via).outerNm).toBe(INPUT.outerNm);
  });

  it("removePadstack throws while used", () => {
    const board = buildRoutedDemo();
    const ps = addPadstack(board, INPUT);
    board.vias[0].padstackId = ps.id;
    expect(() => removePadstack(board, ps.id)).toThrow(/used by 1 via/);
    board.vias[0].padstackId = undefined;
    removePadstack(board, ps.id);
    expect(getPadstack(board, ps.id)).toBeUndefined();
  });
});

describe("padstack commands", () => {
  it("create-padstack validates fields", () => {
    const board = buildRoutedDemo();
    expect(validateCommand(board, { op: "create-padstack", padstack: INPUT })).toEqual([]);
    expect(
      validateCommand(board, {
        op: "create-padstack",
        padstack: { ...INPUT, drillNm: INPUT.outerNm },
      }),
    ).toContain("Padstack drill must be smaller than its outer diameter.");
    expect(
      validateCommand(board, { op: "create-padstack", padstack: { ...INPUT, name: " " } }),
    ).toContain("Padstack needs a name.");
    expect(
      validateCommand(board, { op: "create-padstack", padstack: { ...INPUT, outerNm: NaN } }),
    ).toContain("Padstack outer diameter must be a positive number of nanometers.");
  });

  it("edit-padstack updates every member via in the SAME undo entry", () => {
    const board = buildRoutedDemo();
    ensureBoardPadstacks(board);
    const psId = board.vias[0].padstackId;
    expect(psId).toBeDefined();
    expect(board.vias[1].padstackId).toBe(psId); // demo vias share dims
    const history = createHistory(board);
    const before = structuredClone(board);

    const result = applyEdits(history, [
      { op: "edit-padstack", id: psId ?? "", patch: { outerNm: mmToNm(1.0) } },
    ]);
    expect(result.ok).toBe(true);
    // Denormalization: BOTH vias' size followed the padstack.
    expect(history.present.vias[0].size).toBe(mmToNm(1.0));
    expect(history.present.vias[1].size).toBe(mmToNm(1.0));
    expect(getPadstack(history.present, psId ?? "")?.outerNm).toBe(mmToNm(1.0));

    history.undo();
    expect(history.canUndo).toBe(false); // one entry for padstack + vias
    expect(history.present).toEqual(before);
  });

  it("edit-padstack validates the MERGED result (partial patches can't break invariants)", () => {
    const board = buildRoutedDemo();
    ensureBoardPadstacks(board);
    const psId = board.vias[0].padstackId ?? "";
    const ps = getPadstack(board, psId);
    expect(
      validateCommand(board, {
        op: "edit-padstack",
        id: psId,
        patch: { drillNm: (ps?.outerNm ?? 0) + 1 },
      }),
    ).toContain("Padstack drill must be smaller than its outer diameter.");
  });

  it("set-via-padstack retargets and denormalizes", () => {
    const board = buildRoutedDemo();
    ensureBoardPadstacks(board);
    const history = createHistory(board);
    const via = history.present.vias[0];

    const result = applyEdits(history, [
      { op: "set-via-padstack", viaIds: [via.id], padstackId: "via-highcurrent" },
    ]);
    expect(result.ok).toBe(true);
    const after = history.present.vias.find((v) => v.id === via.id);
    expect(after?.padstackId).toBe("via-highcurrent");
    expect(after?.size).toBe(mmToNm(1.2));
    expect(after?.drill).toBe(mmToNm(0.6));
  });

  it("delete-padstack is blocked while used, allowed after remap", () => {
    const board = buildRoutedDemo();
    ensureBoardPadstacks(board);
    const history = createHistory(board);
    const psId = history.present.vias[0].padstackId ?? "";
    const used = usageCount(history.present, psId);
    expect(used).toBeGreaterThan(0);

    const blocked = applyEdits(history, [{ op: "delete-padstack", id: psId }]);
    expect(blocked.ok).toBe(false);
    expect(blocked.errors[0]).toContain("switch those vias to another padstack first");

    const target = psId === "via-default" ? "via-power" : "via-default";
    const remapped = applyEdits(history, [
      {
        op: "set-via-padstack",
        viaIds: history.present.vias.filter((v) => v.padstackId === psId).map((v) => v.id),
        padstackId: target,
      },
      { op: "delete-padstack", id: psId },
    ]);
    expect(remapped.ok).toBe(true); // sequential validation sees the remap
    expect(getPadstack(history.present, psId)).toBeUndefined();
  });

  it("the fork rule batch (create + retarget by predicted id) is ONE undo entry", () => {
    const board = buildRoutedDemo();
    ensureBoardPadstacks(board);
    const history = createHistory(board);
    const before = structuredClone(history.present);
    const via = history.present.vias[0];
    const predicted = nextPadstackId(history.present);

    const result = applyEdits(history, [
      {
        op: "create-padstack",
        padstack: { ...INPUT, name: `Custom for ${via.id}`, outerNm: mmToNm(0.9) },
      },
      { op: "set-via-padstack", viaIds: [via.id], padstackId: predicted },
    ]);
    expect(result.ok).toBe(true);
    const after = history.present.vias.find((v) => v.id === via.id);
    expect(after?.padstackId).toBe(predicted);
    expect(after?.size).toBe(mmToNm(0.9));
    expect(getPadstack(history.present, predicted)?.name).toBe(`Custom for ${via.id}`);

    history.undo();
    expect(history.canUndo).toBe(false); // fork batch = one entry
    expect(history.present).toEqual(before);
  });
});
