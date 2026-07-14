/**
 * Stage 17 Phase C gate: load-time padstack migration.
 * - idempotent (run twice → deep-equal),
 * - legacy vias reuse a dims-matching padstack or get an `Auto <o>/<d>` one,
 * - dims NEVER change: resolveVia outputs are identical pre/post migration,
 *   and both the KiCad and DSN exports byte-compare (uuids normalized — the
 *   KiCad emitter mints fresh uuids per emit by design).
 */

import { describe, it, expect } from "vitest";
import { buildRoutedDemo } from "../demo/routed-demo";
import { ensureBoardPadstacks, migrateViaPadstacks } from "../padstack/migrate";
import { seedDefaultPadstacks, DEFAULT_PADSTACKS } from "../padstack/defaults";
import { getPadstack, resolveVia } from "../padstack/registry";
import { writeKicadPcb, netlistFromBoard } from "../kicad/write-pcb";
import { boardToDsn, writeDsn } from "../dsn/write-dsn";
import { mmToNm } from "../units";

/** The KiCad emitter mints a fresh uuid per emit — normalize before diffing. */
function stripUuids(pcb: string): string {
  return pcb.replace(/\(uuid "[^"]*"\)/g, '(uuid "X")');
}

describe("padstack migration", () => {
  it("seeds the three class defaults exactly once", () => {
    const board = buildRoutedDemo();
    expect(seedDefaultPadstacks(board)).toBe(true);
    expect(board.padstacks?.map((p) => p.id)).toEqual([
      "via-default",
      "via-power",
      "via-highcurrent",
    ]);
    expect(seedDefaultPadstacks(board)).toBe(false); // second run: no-op
    expect(board.padstacks?.length).toBe(DEFAULT_PADSTACKS.length);
  });

  it("assigns every legacy via a dims-matching padstack without changing dims", () => {
    const board = buildRoutedDemo();
    const dimsBefore = board.vias.map((v) => ({ id: v.id, size: v.size, drill: v.drill }));
    ensureBoardPadstacks(board);
    for (const via of board.vias) {
      expect(via.padstackId).toBeDefined();
      const ps = getPadstack(board, via.padstackId ?? "");
      expect(ps).toBeDefined();
      expect(ps?.outerNm).toBe(via.size);
      expect(ps?.drillNm).toBe(via.drill);
    }
    expect(board.vias.map((v) => ({ id: v.id, size: v.size, drill: v.drill }))).toEqual(
      dimsBefore,
    );
  });

  it("auto-creates 'Auto <outer>/<drill>' for dims no padstack covers", () => {
    const board = buildRoutedDemo();
    board.vias[0].size = mmToNm(0.55);
    board.vias[0].drill = mmToNm(0.25);
    ensureBoardPadstacks(board);
    const ps = getPadstack(board, board.vias[0].padstackId ?? "");
    expect(ps?.name).toBe("Auto 0.55/0.25");
    // A second via with the SAME odd dims reuses the auto padstack.
    const clone = buildRoutedDemo();
    clone.vias[0].size = mmToNm(0.55);
    clone.vias[0].drill = mmToNm(0.25);
    clone.vias[1].size = mmToNm(0.55);
    clone.vias[1].drill = mmToNm(0.25);
    ensureBoardPadstacks(clone);
    expect(clone.vias[0].padstackId).toBe(clone.vias[1].padstackId);
  });

  it("is idempotent: a second run changes nothing (deep-equal)", () => {
    const board = buildRoutedDemo();
    ensureBoardPadstacks(board);
    const once = structuredClone(board);
    expect(ensureBoardPadstacks(board)).toBe(false);
    expect(migrateViaPadstacks(board)).toBe(false);
    expect(board).toEqual(once);
  });

  it("resolveVia outputs are identical pre/post migration (render-identical)", () => {
    const pre = buildRoutedDemo();
    const post = buildRoutedDemo();
    ensureBoardPadstacks(post);
    for (let i = 0; i < pre.vias.length; i++) {
      const a = resolveVia(pre, pre.vias[i]);
      const b = resolveVia(post, post.vias[i]);
      expect(b.outerNm).toBe(a.outerNm);
      expect(b.drillNm).toBe(a.drillNm);
    }
  });

  it("KiCad + DSN exports byte-compare pre/post migration", () => {
    const pre = buildRoutedDemo();
    const post = buildRoutedDemo();
    ensureBoardPadstacks(post);

    const kicadPre = stripUuids(writeKicadPcb(pre, netlistFromBoard(pre)));
    const kicadPost = stripUuids(writeKicadPcb(post, netlistFromBoard(post)));
    expect(kicadPost).toBe(kicadPre);

    const dsnPre = writeDsn(boardToDsn(pre));
    const dsnPost = writeDsn(boardToDsn(post));
    expect(dsnPost).toBe(dsnPre); // DSN never reads padstackId — exact match
  });
});
