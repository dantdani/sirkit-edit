/**
 * [B19-D I5e row 52, from the I5c review] The Specctra DSN handed to the FreeRouting subprocess carries only well-formed tokens.
 *
 * `writeDsn` wrote the board's stackup configuration — copper layer names, preferred directions and routing costs — as bare
 * template text, and its own `q()` escaped only backslash and quote. The stackup comes from the posted board
 * (`getBoardStackup` clones `board.stackupConfig`), so an authenticated autoroute request — or a shared project whose board
 * carries a crafted stackup — could close a list and add nodes to the file FreeRouting reads, or break a quoted net name across
 * lines.
 */
import { describe, expect, it } from "vitest";
import { createEmptyBoard, type FootprintInstance, type PcbBoard } from "../types";
import { mmToNm } from "../units";
import { schematicEndpointKey } from "../integrity";
import { boardToDsn, DsnEmitError, writeDsn } from "../dsn/write-dsn";
import { stackupProfile } from "../stackup";

function instance(id: string, ref: string, x: number): FootprintInstance {
  const endpointKey = schematicEndpointKey(id, "1");
  return {
    id, ref, footprintId: "Audit:OnePad",
    def: {
      libName: "Audit", name: "OnePad",
      attributes: { smd: true, throughHole: false, excludeFromPos: false, excludeFromBom: false },
      pads: [{ number: "1", type: "smd", shape: { kind: "circle", radius: mmToNm(0.5) }, at: { x: 0, y: 0 }, rotationDeg: 0, layers: ["copperTop", "maskTop", "pasteTop"] }],
      graphics: [], bodyBBox: { minX: 0, minY: 0, maxX: mmToNm(1), maxY: mmToNm(1) }, models: [], rawSexpr: "",
    },
    at: { x: mmToNm(x), y: mmToNm(10) }, rotationDeg: 0, side: "top", padNets: { "1": 1 },
    pinPadMappings: [{ componentInstanceId: id, endpointKey, symbolPinNumber: "1", padNumbers: ["1"], mappingKind: "electrical", provenance: "exact-number" }],
  };
}

function board(): PcbBoard {
  const b = createEmptyBoard();
  const a = instance("a", "J1", 10);
  const c = instance("b", "J2", 20);
  b.footprints = [a, c];
  b.nets.push({ id: 1, name: "SIG", stableId: "net:sig", endpointKeys: [a.pinPadMappings![0].endpointKey, c.pinPadMappings![0].endpointKey].sort() });
  b.stackupConfig = structuredClone(stackupProfile("simple-2"));
  return b;
}

const INJECTED = ") (sirkit_injected yes";

function refusal(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  return undefined;
}

describe("[B19-D I5e row 52] stackup tokens are validated before the file is written", () => {
  it.each([
    ["a copper layer name", (b: PcbBoard) => { (b.stackupConfig!.copperLayers[0] as { name: string }).name = `F.Cu${INJECTED}`; }],
    ["a preferred direction", (b: PcbBoard) => { (b.stackupConfig!.copperLayers[0] as { preferredDirection: string }).preferredDirection = `vertical${INJECTED}`; }],
    ["the plane via cost", (b: PcbBoard) => { (b.stackupConfig!.routing as unknown as Record<string, unknown>).planeViaCost = `5${INJECTED}`; }],
    ["the via cost", (b: PcbBoard) => { (b.stackupConfig!.routing as unknown as Record<string, unknown>).viaCost = `50${INJECTED}`; }],
    ["the start ripup cost", (b: PcbBoard) => { (b.stackupConfig!.routing as unknown as Record<string, unknown>).startRipupCost = Number.NaN; }],
  ])("%s outside its vocabulary is refused (DsnEmitError), never written", (_label, mutate) => {
    const b = board();
    mutate(b);
    const error = refusal(() => writeDsn(boardToDsn(b)));
    if (error === undefined) {
      const written = writeDsn(boardToDsn(b));
      expect(written, "written instead of refused").not.toContain("sirkit_injected");
      expect(written, "written instead of refused").not.toMatch(/NaN/);
    }
    expect(error, "must refuse").toBeInstanceOf(DsnEmitError);
  });

  it.each([["newline", "SIG\nX"], ["carriage return", "SIG\rX"], ["NUL", "SIG\u0000X"]])("a net name with a %s is refused, not written across lines", (_label, name) => {
    const b = board();
    b.nets[b.nets.length - 1]!.name = name;
    const error = refusal(() => writeDsn(boardToDsn(b)));
    if (error === undefined) expect(writeDsn(boardToDsn(b)), "the raw name was written").not.toContain(name);
    expect(error).toBeInstanceOf(DsnEmitError);
  });

  it("the committed stackup profiles still write their layers, directions and costs (baselines)", () => {
    for (const profile of ["simple-2", "all-signal-4"] as const) {
      const b = board();
      b.stackup = profile === "simple-2" ? 2 : 4;
      b.stackupConfig = structuredClone(stackupProfile(profile));
      const out = writeDsn(boardToDsn(b));
      expect(out).toContain("(layer F.Cu");
      expect(out).toContain("(layer B.Cu");
      expect(out).toMatch(/\(plane_via_costs \d+(?:\.\d+)?\)/);
      expect(out).not.toContain("sirkit_injected");
    }
  });

  it("a net name with spaces and slashes still writes (baseline)", () => {
    const b = board();
    b.nets[b.nets.length - 1]!.name = "SIG A/B";
    expect(writeDsn(boardToDsn(b))).toContain('"SIG A/B"');
  });

  // [B19-D I5e review] FreeRouting's DSN lexer has no escape inside a quoted string: a backslash is kept as a plain character
  // and the next quote ends the string. The old `\"` escape therefore closed the name, and the rest was read as DSN nodes.
  const BACKSLASH = String.fromCharCode(92);
  it.each([
    ["a net name with a quote", (b: PcbBoard) => { b.nets[b.nets.length - 1]!.name = `SIG" ${INJECTED}) ("`; }],
    ["a net name ending in a backslash", (b: PcbBoard) => { b.nets[b.nets.length - 1]!.name = `SIG${BACKSLASH}`; }],
    ["a pad number with a quote", (b: PcbBoard) => { b.footprints[0]!.def.pads[0]!.number = `1" ${INJECTED}) ("`; }],
  ])("%s is refused (DsnEmitError), never written", (_label, mutate) => {
    const b = board();
    mutate(b);
    const error = refusal(() => writeDsn(boardToDsn(b)));
    if (error === undefined) expect(writeDsn(boardToDsn(b)), "written instead of refused").not.toContain("sirkit_injected");
    expect(error, "must refuse").toBeInstanceOf(DsnEmitError);
  });

  it("a component reference with a quote was already refused by board integrity (baseline)", () => {
    const b = board();
    b.footprints[0]!.ref = `J1" ${INJECTED}) ("`;
    expect(refusal(() => writeDsn(boardToDsn(b)))).toBeInstanceOf(Error);
  });
});
