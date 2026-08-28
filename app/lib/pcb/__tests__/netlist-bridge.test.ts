import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { SchematicState, NetLabel } from "@/lib/schematic-types";
import type { KicadPin } from "@/app/lib/kicad/types";
import { parseKicadMod } from "../kicad-mod";
import { mmToNm } from "../units";
import type { PcbBoard, Track, Via, Zone } from "../types";
import { createEmptyBoard } from "../types";
import {
  buildNetlist,
  netlistHash,
  syncFromSchematic,
  type FootprintResolver,
  type PartLookup,
} from "../netlist-bridge";
import type { FootprintSearchHit } from "../footprint-api-types";
import { createHistory } from "../history";
import { stackupProfile } from "../stackup";

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

    // B07.1: the netlist ref IS the displayed reference (refDes ?? id) — for
    // legacy components without refDes that is the stable id verbatim, never
    // a positionally synthesized "R1".
    expect(netlist.components.map((c) => c.ref)).toEqual(["r1", "r2", "c1", "d1", "l1"]);
    expect(netlist.nets.map((net) => ({ id: net.id, name: net.name, nodes: net.nodes }))).toEqual([
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
    expect(netlist.nets.map((net) => net.endpointKeys)).toEqual([
      ["c1::2"],
      ["r1::1"],
      ["c1::1", "d1::2", "r2::2"],
      ["d1::1", "l1::1"],
      ["r1::2", "r2::1"],
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
  "part-number-mismatch": {
    pins: [R_PINS[0], { ...R_PINS[1], number: "3" }],
    footprintHint: "Resistor_SMD:R_0805_2012Metric",
    mpn: null,
    name: "mismatched pin numbers",
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
    expect(first.board.nets.map(({ id, name }) => ({ id, name }))).toEqual([
      { id: 0, name: "" },
      { id: 1, name: "GND" },
      { id: 2, name: "OUT" },
      { id: 3, name: "N$3" },
    ]);
    expect(first.board.nets.every((net) => typeof net.stableId === "string")).toBe(true);
    const ka = first.board.footprints.find((f) => f.id === "ka")!;
    const kb = first.board.footprints.find((f) => f.id === "kb")!;
    expect(ka.footprintId).toBe("Resistor_SMD:R_0805_2012Metric");
    expect(ka.padNets).toEqual({ "1": 1, "2": 3 });
    expect(kb.padNets).toEqual({ "1": 3, "2": 2 });
    // Default import is centered inside the 100x80 mm board and spread.
    for (const footprint of first.board.footprints) {
      expect(footprint.at.x).toBeGreaterThan(mmToNm(20));
      expect(footprint.at.x).toBeLessThan(mmToNm(80));
      expect(footprint.at.y).toBeGreaterThan(mmToNm(20));
      expect(footprint.at.y).toBeLessThan(mmToNm(60));
    }
    expect(first.report.placement).toMatchObject({
      mode: "centered",
      spreadOverlaps: true,
      allInsideBoard: true,
      overlapCount: 0,
    });

    // Hard invariant: syncing again with no schematic change is a no-op.
    const second = await syncFromSchematic(s, first.board, { getPart, resolver });
    expect(second.board).toEqual(first.board);
    expect(second.report.added).toEqual([]);
    expect(second.report.kept.sort()).toEqual(["ka", "kb"]);
  });

  it("only leaves new parts in the outside staging strip when explicitly requested", async () => {
    const result = await syncFromSchematic(buildFixture(), undefined, {
      getPart,
      resolver: fakeResolver(),
      placement: { preserveAbsoluteCoordinates: true },
    });
    expect(result.board.footprints.every((footprint) => footprint.at.x < 0)).toBe(true);
    expect(result.report.placement.mode).toBe("preserved-staging");
    expect(result.report.placement.warning).toMatch(/outside the board/);
  });

  it("centers an oversized import but reports that the board cannot contain it", async () => {
    const tiny = createEmptyBoard();
    tiny.outline = { kind: "rect", origin: { x: 0, y: 0 }, width: mmToNm(2), height: mmToNm(2) };
    const result = await syncFromSchematic(buildFixture(), tiny, { getPart, resolver: fakeResolver() });
    expect(result.report.placement.mode).toBe("centered");
    expect(result.report.placement.allInsideBoard).toBe(false);
    expect(result.report.placement.warning).toMatch(/do not fit/);
  });

  it("rejects deletion of a routed net atomically", async () => {
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
    expect(resync.ok).toBe(false);
    expect(resync.report.removed).toEqual(["kb"]);
    expect(resync.report.kept).toEqual(["ka"]);
    expect(resync.board).toBe(edited);
    expect(resync.board).toEqual(edited);
    expect(resync.diagnostics.some((diagnostic) => diagnostic.code === "ROUTED_NET_DELETION_CONFLICT")).toBe(true);
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
    expect(report.unresolved[0].reason).toMatch(/footprint pad|no exact physical pad/);
    expect(report.diagnostics.some((diagnostic) => diagnostic.code === "UNCLASSIFIED_FOOTPRINT_PAD")).toBe(true);
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

  it("C-01 remaps every net-bearing board object when an earlier named net is inserted", async () => {
    const resolver = fakeResolver();
    const first = await syncFromSchematic(buildFixture(), undefined, { getPart, resolver });
    expect(first.ok).toBe(true);
    const outBefore = first.board.nets.find((net) => net.name === "OUT")!;
    const track: Track = {
      id: "out-track", layer: "copperTop", width: mmToNm(0.25),
      start: { x: 0, y: 0 }, end: { x: mmToNm(2), y: 0 }, netId: outBefore.id, locked: true,
    };
    const via: Via = {
      id: "out-via", at: { x: mmToNm(2), y: 0 }, size: mmToNm(0.8), drill: mmToNm(0.4),
      netId: outBefore.id, layers: ["copperTop", "copperBottom"], locked: true,
    };
    const zone: Zone = {
      id: "out-zone", layer: "copperTop", netId: outBefore.id,
      polygon: [{ x: 0, y: 0 }, { x: mmToNm(1), y: 0 }, { x: 0, y: mmToNm(1) }],
      appearance: "solid", connection: "thermal", fill: [], dirty: true,
    };
    const stackupConfig = stackupProfile("signal-plane-4");
    stackupConfig.copperLayers.find((layer) => layer.id === "in1")!.planeNetId = outBefore.id;
    const routingHistory = [{
      schemaVersion: 1 as const, id: "out-route", tool: "smart-route" as const,
      baseWorldRevision: "before", netId: outBefore.id, layer: "copperTop" as const,
      candidateId: "candidate-out", mode: "direct" as const,
      points: [track.start, track.end], segmentIds: [track.id],
      rules: { trackWidthNm: track.width, clearanceNm: 200_000, edgeClearanceNm: 200_000, gridNm: 50_000 },
      score: 1, explanation: "identity remap fixture",
    }];
    const netClassing = {
      version: 1 as const,
      assignments: {},
      ruleDeltas: [{
        id: "out-rule", createdAt: "2026-07-16T00:00:00.000Z", source: "manual" as const,
        explanation: "direct net target",
        changes: [{ appliesTo: { kind: "nets" as const, netIds: [outBefore.id] }, trackWidthNm: 300_000 }],
      }],
    };
    const edited = {
      ...first.board, stackup: 4 as const, stackupConfig, tracks: [track], vias: [via], zones: [zone],
      routingHistory, netClassing,
    };
    const schematic = buildFixture();
    schematic.kicadComponents!.push({
      id: "kc", partId: "part-r", x: 300, y: 200, rotation: 0, refDes: "R3", value: "1k",
    });
    schematic.netLabels!.push(label("nl-a", 280, 200, "A", "label"));

    const synced = await syncFromSchematic(schematic, edited, { getPart, resolver });
    expect(synced.ok).toBe(true);
    const outAfter = synced.board.nets.find((net) => net.name === "OUT")!;
    expect(outAfter.id).not.toBe(outBefore.id);
    expect(outAfter.stableId).toBe(outBefore.stableId);
    expect(synced.board.tracks[0]).toEqual({ ...track, netId: outAfter.id });
    expect(synced.board.vias[0]).toEqual({ ...via, netId: outAfter.id });
    expect(synced.board.zones[0]).toMatchObject({ ...zone, netId: outAfter.id });
    expect(synced.board.stackupConfig?.copperLayers.find((layer) => layer.id === "in1")?.planeNetId).toBe(outAfter.id);
    expect(synced.board.routingHistory?.[0].netId).toBe(outAfter.id);
    expect(synced.board.netClassing?.ruleDeltas[0].changes[0].appliesTo).toEqual({
      kind: "nets", netIds: [outAfter.id],
    });
  });

  it("preserves a routed net stable identity across rename, endpoint growth, and shrink", async () => {
    const resolver = fakeResolver();
    const first = await syncFromSchematic(buildFixture(), undefined, { getPart, resolver });
    const out = first.board.nets.find((net) => net.name === "OUT")!;
    const track: Track = {
      id: "t-identity", layer: "copperTop", width: mmToNm(0.25),
      start: { x: 0, y: 0 }, end: { x: mmToNm(1), y: 0 }, netId: out.id,
    };
    const routed = { ...first.board, tracks: [track] };

    const renamedSchematic = buildFixture();
    renamedSchematic.netLabels!.find((item) => item.id === "nl2")!.name = "RENAMED";
    const renamed = await syncFromSchematic(renamedSchematic, routed, { getPart, resolver });
    expect(renamed.ok).toBe(true);
    const renamedNet = renamed.board.nets.find((net) => net.name === "RENAMED")!;
    expect(renamedNet.stableId).toBe(out.stableId);

    const grownSchematic = structuredClone(renamedSchematic);
    grownSchematic.kicadComponents!.push({
      id: "kc", partId: "part-r", x: 300, y: 200, rotation: 0, refDes: "R3", value: "1k",
    });
    grownSchematic.netLabels!.push(label("nl-grow", 280, 200, "RENAMED", "label"));
    const grown = await syncFromSchematic(grownSchematic, renamed.board, { getPart, resolver });
    expect(grown.ok).toBe(true);
    expect(grown.board.nets.find((net) => net.name === "RENAMED")!.stableId).toBe(out.stableId);

    const shrunk = await syncFromSchematic(renamedSchematic, grown.board, { getPart, resolver });
    expect(shrunk.ok).toBe(true);
    expect(shrunk.board.nets.find((net) => net.name === "RENAMED")!.stableId).toBe(out.stableId);
  });

  it("rejects routed split and merge conflicts without changing the board", async () => {
    const resolver = fakeResolver();
    const first = await syncFromSchematic(buildFixture(), undefined, { getPart, resolver });
    const middle = first.board.nets.find((net) => net.name.startsWith("N$"))!;
    const splitBoard = {
      ...first.board,
      tracks: [{
        id: "middle-track", layer: "copperTop" as const, width: mmToNm(0.25),
        start: { x: 0, y: 0 }, end: { x: mmToNm(1), y: 0 }, netId: middle.id,
      }],
    };
    const splitSchematic = buildFixture();
    splitSchematic.wires = [];
    splitSchematic.netLabels!.push(label("split-a", 120, 100, "A", "label"));
    splitSchematic.netLabels!.push(label("split-b", 180, 100, "B", "label"));
    const split = await syncFromSchematic(splitSchematic, splitBoard, { getPart, resolver });
    expect(split.ok).toBe(false);
    expect(split.board).toBe(splitBoard);
    expect(split.diagnostics.some((diagnostic) => diagnostic.code === "ROUTED_NET_SPLIT_CONFLICT")).toBe(true);

    const gnd = first.board.nets.find((net) => net.name === "GND")!;
    const out = first.board.nets.find((net) => net.name === "OUT")!;
    const mergeBoard = {
      ...first.board,
      tracks: [
        { id: "gnd", layer: "copperTop" as const, width: mmToNm(0.25), start: { x: 0, y: 0 }, end: { x: 1, y: 0 }, netId: gnd.id },
        { id: "out", layer: "copperTop" as const, width: mmToNm(0.25), start: { x: 0, y: 1 }, end: { x: 1, y: 1 }, netId: out.id },
      ],
    };
    const mergeSchematic = buildFixture();
    mergeSchematic.netLabels!.find((item) => item.id === "nl2")!.name = "GND";
    const merge = await syncFromSchematic(mergeSchematic, mergeBoard, { getPart, resolver });
    expect(merge.ok).toBe(false);
    expect(merge.board).toBe(mergeBoard);
    expect(merge.diagnostics.some((diagnostic) => diagnostic.code === "ROUTED_NET_MERGE_CONFLICT")).toBe(true);
  });

  it("C-02 rejects equal-count pin/pad identifier mismatch atomically", async () => {
    const schematic: SchematicState = {
      components: [], wires: [], netLabels: [],
      kicadComponents: [
        { id: "bad", partId: "part-number-mismatch", x: 100, y: 100, rotation: 0, refDes: "R7", value: "1k" },
      ],
    };
    const original = createEmptyBoard();
    const result = await syncFromSchematic(schematic, original, { getPart, resolver: fakeResolver() });
    expect(result.ok).toBe(false);
    expect(result.board).toBe(original);
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "UNMAPPED_SCHEMATIC_PIN")).toBe(true);
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "UNCLASSIFIED_FOOTPRINT_PAD")).toBe(true);
  });

  it("C-04 rejects duplicate canonical references atomically", async () => {
    const schematic = buildFixture();
    schematic.kicadComponents![1].refDes = "r1";
    const original = createEmptyBoard();
    const result = await syncFromSchematic(schematic, original, { getPart, resolver: fakeResolver() });
    expect(result.ok).toBe(false);
    expect(result.board).toBe(original);
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "DUPLICATE_REFERENCE_DESIGNATOR")).toBe(true);
  });

  it("reannotation changes the exported reference while retaining stable component placement and net identity", async () => {
    const resolver = fakeResolver();
    const first = await syncFromSchematic(buildFixture(), undefined, { getPart, resolver });
    const placed = structuredClone(first.board);
    placed.footprints.find((footprint) => footprint.id === "ka")!.at = { x: mmToNm(31), y: mmToNm(27) };
    const oldStableIds = new Map(placed.nets.map((net) => [net.endpointKeys?.join("|"), net.stableId]));
    const schematic = buildFixture();
    schematic.kicadComponents!.find((component) => component.id === "ka")!.refDes = "R9";
    const result = await syncFromSchematic(schematic, placed, { getPart, resolver });
    expect(result.ok).toBe(true);
    const footprint = result.board.footprints.find((candidate) => candidate.id === "ka")!;
    expect(footprint.ref).toBe("R9");
    expect(footprint.at).toEqual({ x: mmToNm(31), y: mmToNm(27) });
    for (const net of result.board.nets) {
      expect(net.stableId).toBe(oldStableIds.get(net.endpointKeys?.join("|")));
    }
  });

  it("successful sync is one undoable identity transaction while failed sync creates no entry", async () => {
    const resolver = fakeResolver();
    const first = await syncFromSchematic(buildFixture(), undefined, { getPart, resolver });
    const history = createHistory(first.board);
    const renamedSchematic = buildFixture();
    renamedSchematic.netLabels!.find((item) => item.id === "nl2")!.name = "RENAMED";
    const renamed = await syncFromSchematic(renamedSchematic, history.present, { getPart, resolver });
    expect(renamed.ok).toBe(true);
    history.execute("Sync schematic to PCB", (draft) => Object.assign(draft, renamed.board));
    expect(history.present.nets.some((net) => net.name === "RENAMED")).toBe(true);
    history.undo();
    expect(history.present.nets.some((net) => net.name === "OUT")).toBe(true);
    history.redo();
    expect(history.present.nets.some((net) => net.name === "RENAMED")).toBe(true);

    const invalid = buildFixture();
    invalid.kicadComponents![1].refDes = "R1";
    const failed = await syncFromSchematic(invalid, history.present, { getPart, resolver });
    expect(failed.ok).toBe(false);
    expect(history.entries).toHaveLength(1);
    expect(history.present).toBe(failed.board); // failed result is the supplied frozen board; no execute occurred
    expect(history.present).toEqual(failed.board);
  });
});
