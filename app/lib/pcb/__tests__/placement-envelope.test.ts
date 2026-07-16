import { describe, expect, it } from "vitest";
import { buildPlacementEnvelope, selectPlacementEnvelopeSource } from "../autoplace/envelope";
import { makeBoard, makeDef, makeInstance, makePad } from "./autoplace-fixture";
import { mmToNm } from "../units";
import { boardToDsn, writeDsn } from "../dsn/write-dsn";

const sizeMm = (bounds: { minX: number; minY: number; maxX: number; maxY: number }) => ({
  width: (bounds.maxX - bounds.minX) / 1_000_000,
  height: (bounds.maxY - bounds.minY) / 1_000_000,
  centerX: (bounds.minX + bounds.maxX) / 2 / 1_000_000,
  centerY: (bounds.minY + bounds.maxY) / 2 / 1_000_000,
});

describe("placement envelopes", () => {
  it("inflates a 20 x 10 mm courtyard to exactly 23 x 11.5 mm around the same center", () => {
    const definition = makeDef("LARGE", 20, 10, [makePad("1", 0, 0)]);
    const footprint = makeInstance("u1", definition, { x: 30, y: 20 }, { "1": 1 });
    const board = makeBoard(80, 50, [footprint], 1);
    const envelope = buildPlacementEnvelope(board, footprint, { scale: 1.15 });
    expect(sizeMm(envelope.baseBounds)).toEqual({ width: 20, height: 10, centerX: 0, centerY: 0 });
    expect(sizeMm(envelope.scaledBounds)).toEqual({ width: 23, height: 11.5, centerX: 0, centerY: 0 });
    expect(envelope.source.type).toBe("courtyard");
  });

  it("uses the absolute routing/via margin when 15 percent is too small", () => {
    const definition = makeDef("TINY", 1, 1, [makePad("1", 0, 0)]);
    const footprint = makeInstance("r1", definition, { x: 10, y: 10 }, { "1": 1 });
    const board = makeBoard(30, 20, [footprint], 1);
    const envelope = buildPlacementEnvelope(board, footprint, { scale: 1.15 });
    expect(envelope.routingMarginNm).toBeGreaterThanOrEqual(mmToNm(0.5));
    expect(sizeMm(envelope.effectiveBounds).width).toBeGreaterThan(sizeMm(envelope.scaledBounds).width);
  });

  it("rejects a courtyard smaller than the pad field and falls back safely", () => {
    const definition = makeDef("BAD_COURTYARD", 4, 3, [makePad("1", -2, 0), makePad("2", 2, 0)]);
    definition.courtyardBBox = { minX: mmToNm(-0.5), minY: mmToNm(-0.5), maxX: mmToNm(0.5), maxY: mmToNm(0.5) };
    definition.bodyBBox = { minX: mmToNm(-3), minY: mmToNm(-2), maxX: mmToNm(3), maxY: mmToNm(2) };
    expect(selectPlacementEnvelopeSource(definition).type).toBe("body");
  });

  it("does not mutate footprint or emitted manufacturing geometry", () => {
    const definition = makeDef("UNCHANGED", 20, 10, [makePad("1", -2, 0), makePad("2", 2, 0)]);
    const footprint = makeInstance("u1", definition, { x: 30, y: 20 }, { "1": 1, "2": 1 });
    const board = makeBoard(80, 50, [footprint], 1);
    const definitionBefore = JSON.stringify(definition);
    const dsnBefore = writeDsn(boardToDsn(board));
    buildPlacementEnvelope(board, footprint, { scale: 1.15 });
    expect(JSON.stringify(definition)).toBe(definitionBefore);
    expect(writeDsn(boardToDsn(board))).toBe(dsnBefore);
  });
});
