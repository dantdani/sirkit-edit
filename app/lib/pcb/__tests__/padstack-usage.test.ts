/**
 * Stage 17 Phase C gate: usage counting drives delete protection and the
 * inspector fork rule's "also update N others" arithmetic.
 */

import { describe, it, expect } from "vitest";
import { buildRoutedDemo } from "../demo/routed-demo";
import { createHistory } from "../history";
import { ensureBoardPadstacks } from "../padstack/migrate";
import { usageCount } from "../padstack/registry";
import { applyEdits } from "../edit/apply";
import { validateCommand } from "../edit/validate";

describe("padstack usage", () => {
  it("counts member vias per padstack", () => {
    const board = buildRoutedDemo();
    ensureBoardPadstacks(board);
    const psId = board.vias[0].padstackId ?? "";
    const members = board.vias.filter((v) => v.padstackId === psId).length;
    expect(usageCount(board, psId)).toBe(members);
    expect(usageCount(board, "ghost")).toBe(0);
    // Seeded defaults with no vias are unused (deletable).
    const unused = (board.padstacks ?? []).find((p) => usageCount(board, p.id) === 0);
    expect(unused).toBeDefined();
  });

  it("blocks delete while used, with the remap-first message", () => {
    const board = buildRoutedDemo();
    ensureBoardPadstacks(board);
    const psId = board.vias[0].padstackId ?? "";
    const used = usageCount(board, psId);
    const errors = validateCommand(board, { op: "delete-padstack", id: psId });
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain(`used by ${used} via`);
    expect(errors[0]).toContain("switch those vias to another padstack first");
  });

  it("usage moves with set-via-padstack and unblocks delete", () => {
    const board = buildRoutedDemo();
    ensureBoardPadstacks(board);
    const history = createHistory(board);
    const psId = history.present.vias[0].padstackId ?? "";
    const memberIds = history.present.vias
      .filter((v) => v.padstackId === psId)
      .map((v) => v.id);

    const target = psId === "via-default" ? "via-power" : "via-default";
    applyEdits(history, [
      { op: "set-via-padstack", viaIds: memberIds, padstackId: target },
    ]);
    expect(usageCount(history.present, psId)).toBe(0);
    expect(usageCount(history.present, target)).toBeGreaterThanOrEqual(memberIds.length);

    const del = applyEdits(history, [{ op: "delete-padstack", id: psId }]);
    expect(del.ok).toBe(true);
  });
});
