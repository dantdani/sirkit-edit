/**
 * [B19-D I5c rows 04, 17, 18] What the KiCad writers put into a file is only ever well-formed tokens.
 *
 *  - row 04: the `.kicad_pcb` emitter wrote `pad.type` unquoted and net ids through `String()`, so a board posted to the public
 *    export route (or handed to the server's kicad-cli fabrication step) could close a list and inject its own nodes.
 *  - row 17: `q()` escaped only backslash and quote; a newline in a text value became a literal line break inside a string.
 *  - row 18: layer and power-symbol tables were looked up with `table[name]`, so `constructor` or `__proto__` crashed the
 *    footprint parser and the schematic export.
 */
import { describe, expect, it, vi } from "vitest";
import { emitFootprint } from "../kicad/emit-footprint";
import { writeKicadPcb } from "../kicad/write-pcb";
import { indent, KicadEmitError, q } from "../kicad/sexpr-emit";
import { BoardIntegrityError } from "../integrity";
import { parseKicadMod } from "../kicad-mod";
import { parseSexpr, type SNode } from "../sexpr";
import { createEmptyBoard, type FootprintInstance, type PcbBoard } from "../types";
import type { PcbNetlist } from "../netlist-bridge";
import { mmToNm } from "../units";

vi.mock("@/app/lib/parts-search", () => ({ getFullPartsByIds: vi.fn(async () => []), getPartsByIds: vi.fn(async () => []), searchParts: vi.fn(async () => []) }));

const netlist: PcbNetlist = { components: [], nets: [] };

function heads(node: SNode, out: string[] = []): string[] {
  if (node.kind !== "list") return out;
  const head = node.items[0];
  if (head?.kind === "symbol") out.push(head.value);
  for (const child of node.items) heads(child, out);
  return out;
}

/** True when every string in the text is closed before its line ends (no literal line break inside a quoted string). */
function noLineBreakInsideStrings(text: string): boolean {
  let inString = false;
  let escaped = false;
  for (const char of text) {
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      else if (char === "\n" || char === "\r") return false;
    } else if (char === '"') inString = true;
  }
  return !inString;
}

/** [review] a refusal must be the writer's own typed refusal — a TypeError from a crash is not a contract */
function refusal(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  return undefined;
}

function expectRefusedOrInert(run: () => string, injectedHead: string): void {
  const error = refusal(run);
  if (error !== undefined) {
    expect(error instanceof KicadEmitError || error instanceof BoardIntegrityError, String(error)).toBe(true);
    return;
  }
  expect(heads(parseSexpr(run()))).not.toContain(injectedHead);
}

function board(): PcbBoard {
  const b = createEmptyBoard();
  b.nets = [{ id: 0, name: "" }, { id: 1, name: "GND" }];
  return b;
}

function resistor(): FootprintInstance {
  const def = parseKicadMod('(footprint "R" (pad "1" smd rect (at 0 0) (size 1 1) (layers "F.Cu")))', "L");
  return { id: "f1", ref: "R1", footprintId: "L:R", at: { x: 0, y: 0 }, rotationDeg: 0, side: "top", padNets: { "1": 1 }, def };
}

describe("[B19-D I5c row 04] a hostile pad type or net id never becomes structure", () => {
  it("an injected pad type is refused or quoted — never a sibling node", () => {
    const inst = resistor();
    (inst.def.pads[0] as { type: string }).type = 'smd rect (at 0 0)) (sirkit_injected yes) (pad "2" smd';
    expectRefusedOrInert(() => emitFootprint(inst, board(), netlist), "sirkit_injected");
  });

  it("an injected pad net id is refused or inert — never a sibling node", () => {
    const inst = resistor();
    inst.padNets = { "1": "1) (sirkit_net_injected yes" as unknown as number };
    expectRefusedOrInert(() => emitFootprint(inst, board(), netlist), "sirkit_net_injected");
  });

  it("board, track and zone net ids are checked the same way through writeKicadPcb", () => {
    const b = board();
    b.nets = [{ id: 0, name: "" }, { id: "1) (sirkit_board_net yes" as unknown as number, name: "GND" }];
    expectRefusedOrInert(() => writeKicadPcb(b, netlist), "sirkit_board_net");
  });

  it.each([
    ["track", (b: PcbBoard, id: number) => { b.tracks = [{ id: "t1", layer: "copperTop", width: 250_000, start: { x: 0, y: 0 }, end: { x: 1_000_000, y: 0 }, netId: id }] as never; }],
    ["via", (b: PcbBoard, id: number) => { b.vias = [{ id: "v1", at: { x: 0, y: 0 }, size: 600_000, drill: 300_000, netId: id, layers: ["copperTop", "copperBottom"] }] as never; }],
    ["zone", (b: PcbBoard, id: number) => { b.zones = [{ id: "z1", layer: "copperTop", netId: id, polygon: [{ x: 0, y: 0 }, { x: 1_000_000, y: 0 }, { x: 1_000_000, y: 1_000_000 }], fill: [] }] as never; }],
  ])("[review] a hostile %s net id is refused or inert", (_kind, place) => {
    const b = board();
    place(b, "1) (sirkit_copper_net yes" as unknown as number);
    expectRefusedOrInert(() => writeKicadPcb(b, netlist), "sirkit_copper_net");
  });

  it("[review] a hostile silk text anchor is refused, never a sibling node (the writer built justify by hand)", () => {
    const b = board();
    b.silkItems = [{ id: "s1", kind: "text", layer: "silkTop", text: "hi", position: { x: 0, y: 0 }, rotationDeg: 0, heightNm: 1_000_000, strokeWidthNm: 150_000, anchor: "left))) (sirkit_injected_silk yes) (x (y", mirror: false } as never];
    const error = refusal(() => writeKicadPcb(b, netlist));
    expect(error).toBeInstanceOf(KicadEmitError);
  });

  it("[review] silk text anchors left, center and right with mirror still emit (baseline)", () => {
    const b = board();
    b.silkItems = (["left", "center", "right"] as const).map((anchor, index) => ({ id: `s${index}`, kind: "text", layer: "silkTop", text: anchor, position: { x: index * 1_000_000, y: 0 }, rotationDeg: 0, heightNm: 1_000_000, strokeWidthNm: 150_000, anchor, mirror: index === 2 })) as never;
    const out = writeKicadPcb(b, netlist);
    expect(out).toContain("(justify left)");
    expect(out).toContain("(justify right mirror)");
    expect(heads(parseSexpr(out)).filter((head) => head === "gr_text")).toHaveLength(3);
  });

  it("a normal footprint emits exactly as before (baseline)", () => {
    const out = emitFootprint(resistor(), board(), netlist);
    expect(out).toContain('(pad "1" smd rect');
    expect(out).toContain('(net 1 "GND")');
  });
});

describe("[B19-D I5c row 17] strings never carry a literal line break", () => {
  it("q() escapes newline, carriage return and tab the way KiCad reads them", () => {
    expect(q("line1\nline2\r\tend")).toBe('"line1\\nline2\\r\\tend"');
    expect(q('a"b\\c')).toBe('"a\\"b\\\\c"'); // baseline
  });

  it("a footprint text with a newline stays on one line inside its string", () => {
    const inst = resistor();
    inst.def.graphics = [{ kind: "text", textKind: "user", text: "line1\nline2", at: { x: 0, y: 0 }, rotationDeg: 0, sizeX: mmToNm(1), sizeY: mmToNm(1), thickness: mmToNm(0.15), layer: "silkTop" } as never];
    expect(noLineBreakInsideStrings(emitFootprint(inst, board(), netlist))).toBe(true);
  });

  it("[review] indent never pads a line that continues a quoted string", () => {
    expect(indent('(a "x\ny")\n(b)', 1)).toBe('  (a "x\ny")\n  (b)');
    const lines = indent('(a "x\ny")', 2).split("\n");
    expect(lines[1]).toBe('y")');
  });

  it("[review] the schematic writer's indent keeps a multi-line property value byte-for-byte", async () => {
    const { exportToKicadSch } = await import("@/app/lib/kicad-export");
    const part = { id: "p1", name: "R", libraryName: "Device", symbolRaw: '(symbol "R" (property "Description" "first\nsecond" (at 0 0 0)) (pin passive line (at 0 0 0) (length 2.54) (name "~") (number "1")))', pins: [], datasheet: null, properties: {} };
    const state = { components: [], wires: [], kicadComponents: [{ id: "c1", partId: "p1", x: 100, y: 100, rotation: 0, refDes: "R1", value: "10k" }] };
    const out = exportToKicadSch({ state: state as never, parts: new Map([["p1", part as never]]) });
    expect(out).toContain('"first\nsecond"');
  });

  it("[review] a power label with a newline is escaped in its symbol name", async () => {
    const { exportToKicadSch } = await import("@/app/lib/kicad-export");
    const out = exportToKicadSch({ state: { components: [], wires: [], netLabels: [{ id: "p1", name: "VX\nINJ", position: { x: 100, y: 100 }, orientation: 0, kind: "power" }] } as never, parts: new Map() });
    expect(noLineBreakInsideStrings(out)).toBe(true);
    expect(out).toContain("VX\\nINJ");
  });

  it("a schematic value with a newline is escaped in the exported .kicad_sch", async () => {
    const { exportToKicadSch } = await import("@/app/lib/kicad-export");
    const out = exportToKicadSch({ state: { components: [{ id: "r1", type: "resistor", value: "10k\nINJECT", x: 100, y: 100, rotation: 0 }], wires: [] } as never, parts: new Map() });
    expect(noLineBreakInsideStrings(out)).toBe(true);
    expect(out).toContain("10k\\nINJECT");
  });
});

describe("[B19-D I5c row 18] prototype names are ordinary unknown names", () => {
  it.each(["constructor", "__proto__", "toString"])("a pad on layer %s is dropped with a warning, not a crash", (layer) => {
    const warnings: string[] = [];
    const def = parseKicadMod(`(footprint "F" (pad "1" smd rect (at 0 0) (size 1 1) (layers "${layer}")))`, "L", warnings);
    expect(def.pads[0]!.layers).toEqual([]);
    expect(warnings.join("\n")).toMatch(/layer dropped/);
  });

  it.each(["constructor", "__proto__"])("[review] a .kicad_dru constraint named %s imports nothing and reports the loss", async (kind) => {
    const { importKicadDru } = await import("@/app/lib/constraints/kicad-dru");
    const result = importKicadDru({ text: `(version 1)\n(rule "r" (constraint ${kind} (min 0.2mm)))`, sourceId: "board.kicad_dru", sourceRevision: "1", netNameToStableIds: {} });
    expect(result.document?.constraints ?? []).toEqual([]);
    expect(result.losses.map((loss) => loss.message).join("\n")).toContain(kind);
  });

  it.each(["constructor", "__proto__", "hasOwnProperty"])("a power label named %s exports without a crash", async (name) => {
    const { exportToKicadSch } = await import("@/app/lib/kicad-export");
    const { getPowerSymbol } = await import("@/app/lib/kicad-power-symbols");
    expect(getPowerSymbol(name)).toBeNull();
    const out = exportToKicadSch({ state: { components: [], wires: [], netLabels: [{ id: "p1", name, position: { x: 100, y: 100 }, orientation: 0, kind: "power" }] } as never, parts: new Map() });
    expect(typeof out).toBe("string");
  });
});
