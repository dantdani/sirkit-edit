import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { SchematicState, NetLabel } from "@/lib/schematic-types";
import type { KicadPin } from "@/app/lib/kicad/types";
import { parseKicadMod } from "../kicad-mod";
import { mmToNm } from "../units";
import type { PcbBoard, Track } from "../types";
import {
  buildNetlist,
  netlistHash,
  syncFromSchematic,
  type FootprintResolver,
  type PartLookup,
} from "../netlist-bridge";
import type { FootprintSearchHit } from "../footprint-api-types";

function readFixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), "utf-8");
}

// ─── Fake footprint resolver over the real fixture files ────────────────────

const FIXTURES: Record<string, { file: string; libName: string }> = {
  "Resistor_SMD:R_0805_2012Metric": { file: "R_0805_2012Metric.kicad_mod", libName: "Resistor_SMD" },
  "Package_QFP:LQFP-48_7x7mm_P0.5mm": { file: "LQFP-48_7x7mm_P0.5mm.kicad_mod", libName: "Package_QFP" },
  "Connector_PinHeader_2.54mm:PinHeader_1x02_P2.54mm_Vertical": {
    file: "PinHeader_1x02_P2.54mm_Vertical.kicad_mod",
    libName: "Connector_PinHeader_2.54mm",
  },
};

function fakeResolver(): FootprintResolver {
  const byFullName = new Map<string, { hit: FootprintSearchHit; libName: string; rawSexpr: string }>();
  for (const [fullName, { file, libName }] of Object.entries(FIXTURES)) {
    const rawSexpr = readFixture(file);
    const def = parseKicadMod(rawSexpr, libName);
    byFullName.set(fullName, {
      libName,
      rawSexpr,
      hit: {
        id: `id-${fullName}`,
        libName,
        name: def.name,
        fullName,
        description: def.description ?? null,
        padCount: def.pads.length,
        attrSmd: def.attributes.smd,
        attrTht: def.attributes.throughHole,
        bodyBBox: def.bodyBBox,
        score: 1,
      },
    });
  }
  return {
    async resolve(fullName) {
      return byFullName.get(fullName)?.hit ?? null;
    },
    async detail(id) {
      for (const v of byFullName.values()) {
        if (v.hit.id === id) return { libName: v.libName, rawSexpr: v.rawSexpr };
      }
      return null;
    },
  };
}

// ─── Theory fixture: R-R-C divider chain, diode+inductor branch, labels ──────
// R1(100,100) R2(200,100) C1(300,100) D1(200,200) L1(300,200) + ground.
// Nets: +3V3=[C1.2] GND=[R1.1] VOUT=[C1.1,D1.2,R2.2] N$4=[D1.1,L1.1]
// N$5=[R1.2,R2.1]; L1.2 is unconnected (no net).

function label(id: string, x: number, y: number, name: string, kind: NetLabel["kind"]): NetLabel {
  return { id, position: { x, y }, name, kind, orientation: 0 };
}

function theoryFixture(): SchematicState {
  return {
    components: [
      { id: "r1", type: "resistor", x: 100, y: 100, rotation: 0, value: "10k" },
      { id: "r2", type: "resistor", x: 200, y: 100, rotation: 0, value: "4k7" },
      { id: "c1", type: "capacitor", x: 300, y: 100, rotation: 0, value: "100n" },
      { id: "d1", type: "diode", x: 200, y: 200, rotation: 0, value: "1N4148" },
      { id: "l1", type: "inductor", x: 300, y: 200, rotation: 0, value: "10u" },
      { id: "gnd1", type: "ground", x: 100, y: 200, rotation: 0, value: "" },
    ],
    wires: [
      { id: "w1", vertices: [{ x: 130, y: 100 }, { x: 170, y: 100 }] }, // R1.2–R2.1
      { id: "w2", vertices: [{ x: 230, y: 100 }, { x: 270, y: 100 }] }, // R2.2–C1.1
      { id: "w3", vertices: [{ x: 70, y: 100 }, { x: 70, y: 180 }, { x: 100, y: 180 }] }, // R1.1–gnd
      { id: "w4", vertices: [{ x: 230, y: 200 }, { x: 270, y: 200 }] }, // D1.1–L1.1
    ],
    netLabels: [
      label("nl1", 230, 100, "VOUT", "label"),
      label("nl2", 330, 100, "+3V3", "power"),
      label("nl3", 170, 200, "VOUT", "label"), // D1 anode joins VOUT by name
    ],
  };
}

describe("buildNetlist", () => {
  it("derives deterministic net ids: named alphabetical first, then unnamed", () => {
    const netlist = buildNetlist(theoryFixture());

    expect(netlist.components.map((c) => c.ref)).toEqual(["R1", "R2", "C1", "D1", "L1"]);
    expect(netlist.nets).toEqual([
      { id: 1, name: "+3V3", nodes: [{ componentId: "c1", pinNumber: "2" }] },
      { id: 2, name: "GND", nodes: [{ componentId: "r1", pinNumber: "1" }] },
      {
        id: 3,
        name: "VOUT",
        nodes: [
          { componentId: "c1", pinNumber: "1" },
          { componentId: "d1", pinNumber: "2" },
          { componentId: "r2", pinNumber: "2" },
        ],
      },
      {
        id: 4,
        name: "N$4",
        nodes: [
          { componentId: "d1", pinNumber: "1" },
          { componentId: "l1", pinNumber: "1" },
        ],
      },
      {
        id: 5,
        name: "N$5",
        nodes: [
          { componentId: "r1", pinNumber: "2" },
          { componentId: "r2", pinNumber: "1" },
        ],
      },
    ]);
  });

  it("same schematic ⇒ same netlist and hash", () => {
    const a = buildNetlist(theoryFixture());
    const b = buildNetlist(theoryFixture());
    expect(b).toEqual(a);
    expect(netlistHash(b)).toBe(netlistHash(a));
  });
});

// ─── Build-mode fixture: two KiCad resistors ─────────────────────────────────
// Pin 1 at -2.54 mm → 20 px left of origin; pin 2 mirrored.

const R_PINS: KicadPin[] = [
  { number: "1", name: "~", type: "passive", position: { x: -2.54, y: 0 }, orientation: 0, length: 1.27 },
  { number: "2", name: "~", type: "passive", position: { x: 2.54, y: 0 }, orientation: 180, length: 1.27 },
];

const PARTS: Record<string, ReturnType<PartLookup>> = {
  "part-r": {
    pins: R_PINS,
    footprintHint: "Resistor_SMD:R_0805_2012Metric",
    mpn: "RC0805FR-0710KL",
    name: "R_0805",
    description: "Thick film resistor",
  },
  // Hint deliberately names a 48-pad footprint for a 2-pin part.
  "part-mismatch": {
    pins: R_PINS,
    footprintHint: "Package_QFP:LQFP-48_7x7mm_P0.5mm",
    mpn: null,
    name: "weird",
    description: null,
  },
  // No hint; the description carries a package token for the heuristic tier.
  "part-heuristic": {
    pins: R_PINS,
    footprintHint: null,
    mpn: null,
    name: "R_generic",
    description: "Thick film resistor 0805",
  },
};

const getPart: PartLookup = (partId) => PARTS[partId] ?? null;

function buildFixture(): SchematicState {
  return {
    components: [],
    wires: [{ id: "w1", vertices: [{ x: 120, y: 100 }, { x: 180, y: 100 }] }], // ka.2–kb.1
    kicadComponents: [
      { id: "ka", partId: "part-r", x: 100, y: 100, rotation: 0, refDes: "R1", value: "10k" },
      { id: "kb", partId: "part-r", x: 200, y: 100, rotation: 0, refDes: "R2", value: "4k7" },
    ],
    netLabels: [
      label("nl1", 80, 100, "GND", "ground"), // on ka.1
      label("nl2", 220, 100, "OUT", "label"), // on kb.2
    ],
  };
}

describe("syncFromSchematic", () => {
  it("resolves by hint, builds padNets, and is idempotent", async () => {
    const resolver = fakeResolver();
    const s = buildFixture();

    const first = await syncFromSchematic(s, undefined, { getPart, resolver });
    expect(first.report.unresolved).toEqual([]);
    expect(first.report.added.sort()).toEqual(["ka", "kb"]);
    expect(first.report.resolvedBy).toEqual({ hint: 2, heuristic: 0, manual: 0 });

    // Nets: GND=1, OUT=2, N$3 the middle net.
    expect(first.board.nets).toEqual([
      { id: 0, name: "" },
      { id: 1, name: "GND" },
      { id: 2, name: "OUT" },
      { id: 3, name: "N$3" },
    ]);
    const ka = first.board.footprints.find((f) => f.id === "ka")!;
    const kb = first.board.footprints.find((f) => f.id === "kb")!;
    expect(ka.footprintId).toBe("Resistor_SMD:R_0805_2012Metric");
    expect(ka.padNets).toEqual({ "1": 1, "2": 3 });
    expect(kb.padNets).toEqual({ "1": 3, "2": 2 });
    // Staged left of the outline (origin x=0).
    expect(ka.at.x).toBeLessThan(0);

    // Hard invariant: syncing again with no schematic change is a no-op.
    const second = await syncFromSchematic(s, first.board, { getPart, resolver });
    expect(second.board).toEqual(first.board);
    expect(second.report.added).toEqual([]);
    expect(second.report.kept.sort()).toEqual(["ka", "kb"]);
  });

  it("re-sync preserves moved positions and orphans copper of removed nets", async () => {
    const resolver = fakeResolver();
    const first = await syncFromSchematic(buildFixture(), undefined, { getPart, resolver });

    // User moves R1 onto the board and routes a track on net OUT (id 2).
    const movedAt = { x: mmToNm(30), y: mmToNm(40) };
    const track: Track = {
      id: "t1",
      layer: "copperTop",
      width: mmToNm(0.25),
      start: { x: 0, y: 0 },
      end: { x: mmToNm(5), y: 0 },
      netId: 2,
    };
    const edited: PcbBoard = {
      ...first.board,
      footprints: first.board.footprints.map((f) => (f.id === "ka" ? { ...f, at: movedAt } : f)),
      tracks: [track],
    };

    // Schematic edit: R2 and the OUT label are deleted.
    const s = buildFixture();
    s.kicadComponents = s.kicadComponents!.filter((k) => k.id !== "kb");
    s.wires = [];
    s.netLabels = s.netLabels!.filter((l) => l.id !== "nl2");

    const resync = await syncFromSchematic(s, edited, { getPart, resolver });
    expect(resync.report.removed).toEqual(["kb"]);
    expect(resync.report.kept).toEqual(["ka"]);

    const ka = resync.board.footprints.find((f) => f.id === "ka")!;
    expect(ka.at).toEqual(movedAt); // placement survives
    expect(resync.board.footprints).toHaveLength(1);

    // Net OUT is gone; the track is orphaned to net 0, not deleted.
    expect(resync.board.nets.map((n) => n.name)).toEqual(["", "GND"]);
    expect(resync.board.tracks).toEqual([{ ...track, netId: 0 }]);
  });

  it("demotes pad/pin mismatches to unresolved with a reason", async () => {
    const resolver = fakeResolver();
    const s: SchematicState = {
      components: [],
      wires: [],
      kicadComponents: [
        { id: "km", partId: "part-mismatch", x: 100, y: 100, rotation: 0, refDes: "U1", value: "?" },
      ],
      netLabels: [],
    };
    const { board, report } = await syncFromSchematic(s, undefined, { getPart, resolver });
    expect(board.footprints).toEqual([]);
    expect(report.unresolved).toHaveLength(1);
    expect(report.unresolved[0].componentId).toBe("km");
    expect(report.unresolved[0].reason).toContain("48 pads");
    expect(report.unresolved[0].reason).toContain("2 pins");
  });

  it("falls back to the package heuristic when there is no hint", async () => {
    const resolver = fakeResolver();
    const s: SchematicState = {
      components: [],
      wires: [],
      kicadComponents: [
        { id: "kh", partId: "part-heuristic", x: 100, y: 100, rotation: 0, refDes: "R9", value: "1k" },
      ],
      netLabels: [],
    };
    const { board, report } = await syncFromSchematic(s, undefined, { getPart, resolver });
    expect(report.unresolved).toEqual([]);
    expect(report.resolvedBy).toEqual({ hint: 0, heuristic: 1, manual: 0 });
    expect(board.footprints[0].footprintId).toBe("Resistor_SMD:R_0805_2012Metric");
  });
});
