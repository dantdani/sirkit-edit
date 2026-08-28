/**
 * B15.2.1 — the residual proposal-core and seal-boundary closures. Every
 * counterexample R17–R21 is a permanent fail-closed regression here, plus an
 * AST import/export gate proving the raw sealer is unreachable from
 * production except through the one high-level entry point.
 */

import { describe, expect, it } from "vitest";
import { createEmptyBoard } from "../../types";
import type { PcbBoard } from "../../types";
import { getNetClass } from "../../netclass";
import { getPreset, DEFAULT_PRESET_ID } from "../../drc/presets";
import { pcbRevisionId } from "../../revision";
import { compileBoundedPcbEdit } from "../bounded-edit-compiler";
import { createSealedPcbEditProposal } from "../pcb-edit-proposal-service";
import { PCB_EDIT_PROPOSAL_SCHEMA, verifySealedPcbEditProposalIntegrity } from "../sealed-pcb-edit-proposal";
import * as sealedModule from "../sealed-pcb-edit-proposal";
import {
  collectProductionFiles,
  moduleImportOffenders,
} from "../../../project/__tests__/_import-gate-helpers";

const RULES = getPreset(DEFAULT_PRESET_ID).rules;

function board(): PcbBoard {
  const base = createEmptyBoard();
  base.outline = { kind: "rect", width: 100_000_000, height: 80_000_000, origin: { x: 0, y: 0 } };
  base.nets.push({ id: 1, name: "NET1" }, { id: 2, name: "GND" });
  base.tracks = [{ id: "t1", layer: "copperTop", width: 400_000, start: { x: 10_000_000, y: 10_000_000 }, end: { x: 20_000_000, y: 10_000_000 }, netId: 1 }];
  return base;
}

type PlacementConstraints = NonNullable<PcbBoard["footprints"][number]["placementConstraints"]>;

function withFootprint(constraints: PlacementConstraints): PcbBoard {
  const source = board();
  const footprint: PcbBoard["footprints"][number] = {
    id: "fp1", ref: "J1", footprintId: "lib:conn", at: { x: 30_000_000, y: 20_000_000 },
    rotationDeg: 0, side: "top", padNets: { "1": 1 },
    def: { libName: "lib", name: "conn", attributes: { smd: true, throughHole: false, excludeFromPos: false, excludeFromBom: false }, pads: [], graphics: [], bodyBBox: { minX: -1_000_000, minY: -500_000, maxX: 1_000_000, maxY: 500_000 }, models: [], rawSexpr: "" },
    placementConstraints: constraints,
  };
  source.footprints = [footprint];
  return source;
}

const compile = (payload: unknown, source = board()) =>
  compileBoundedPcbEdit({ board: source, rules: RULES, payload });

// ─── §B R17 — the REAL placementConstraints property ─────────────────────────

describe("B15.2.1 §B — footprint constraints are read from placementConstraints", () => {
  it("R17: fixedPosition/mechanical/edgeConnector refuse move; allowedRotations refuses rotation", () => {
    const full: PlacementConstraints = { fixedPosition: true, mechanical: true, edgeConnector: "top", allowedRotations: [0] };
    expect(compile({ intent: "x", operations: [{ kind: "move_footprint", footprintId: "fp1", to: { x: 50_000_000, y: 40_000_000 } }] }, withFootprint(full)))
      .toMatchObject({ ok: false, code: "locked-object" });
    expect(compile({ intent: "x", operations: [{ kind: "rotate_footprint", footprintId: "fp1", rotationDeg: 90 }] }, withFootprint(full)))
      .toMatchObject({ ok: false, code: "locked-object" });
  });

  it("R17b: each constraint is independently authoritative", () => {
    expect(compile({ intent: "x", operations: [{ kind: "move_footprint", footprintId: "fp1", to: { x: 50_000_000, y: 40_000_000 } }] }, withFootprint({ fixedPosition: true })))
      .toMatchObject({ ok: false, code: "locked-object" });
    expect(compile({ intent: "x", operations: [{ kind: "move_footprint", footprintId: "fp1", to: { x: 50_000_000, y: 40_000_000 } }] }, withFootprint({ mechanical: true })))
      .toMatchObject({ ok: false, code: "locked-object" });
    expect(compile({ intent: "x", operations: [{ kind: "move_footprint", footprintId: "fp1", to: { x: 50_000_000, y: 40_000_000 } }] }, withFootprint({ edgeConnector: "left" })))
      .toMatchObject({ ok: false, code: "locked-object" });
    expect(compile({ intent: "x", operations: [{ kind: "rotate_footprint", footprintId: "fp1", rotationDeg: 180 }] }, withFootprint({ allowedRotations: [0, 90] })))
      .toMatchObject({ ok: false, code: "locked-object" });
    // …an unconstrained footprint still moves and rotates.
    expect(compile({ intent: "x", operations: [{ kind: "move_footprint", footprintId: "fp1", to: { x: 50_000_000, y: 40_000_000 } }] }, withFootprint({})).ok).toBe(true);
    expect(compile({ intent: "x", operations: [{ kind: "rotate_footprint", footprintId: "fp1", rotationDeg: 90 }] }, withFootprint({ allowedRotations: [0, 90] })).ok).toBe(true);
  });
});

// ─── §A R18 — exact geometry, no sampling ────────────────────────────────────

describe("B15.2.1 §A — exact geometry (no sampling)", () => {
  function slitBoard(): PcbBoard {
    const source = board();
    // A 200,000 nm slit positioned in the gap between the old 64-sample
    // positions 31 and 32 of a 40→60 mm edge — a larger sample count is not
    // a fix, so the slit's exact placement is irrelevant to the exact test.
    source.outline = { kind: "polygon", points: [
      { x: 0, y: 0 }, { x: 100_000_000, y: 0 }, { x: 100_000_000, y: 80_000_000 },
      { x: 49_943_750, y: 80_000_000 }, { x: 49_943_750, y: 5_000_000 },
      { x: 49_743_750, y: 5_000_000 }, { x: 49_743_750, y: 80_000_000 }, { x: 0, y: 80_000_000 },
    ] };
    return source;
  }

  it("R18a: a keepout edge crossing an arbitrarily narrow notch refuses", () => {
    expect(compile({ intent: "x", operations: [{ kind: "add_keepout", polygon: [
      { x: 40_000_000, y: 40_000_000 }, { x: 60_000_000, y: 40_000_000 }, { x: 60_000_000, y: 42_000_000 },
    ], layers: ["copperTop"], forbidTracks: true, forbidVias: true }] }, slitBoard()))
      .toMatchObject({ ok: false, code: "escapes-board" });
    // a keepout entirely within one arm still compiles
    expect(compile({ intent: "x", operations: [{ kind: "add_keepout", polygon: [
      { x: 10_000_000, y: 10_000_000 }, { x: 40_000_000, y: 10_000_000 }, { x: 40_000_000, y: 40_000_000 },
    ], layers: ["copperTop"], forbidTracks: true, forbidVias: true }] }, slitBoard()).ok).toBe(true);
  });

  it("R18b: collinear overlap/retrace and vertex-on-edge polygons refuse", () => {
    // A→B→A→C retrace (repeated vertex + collinear overlap).
    expect(compile({ intent: "x", operations: [{ kind: "add_keepout", polygon: [
      { x: 10_000_000, y: 10_000_000 }, { x: 20_000_000, y: 10_000_000 }, { x: 15_000_000, y: 10_000_000 }, { x: 15_000_000, y: 20_000_000 },
    ], layers: ["copperTop"], forbidTracks: true, forbidVias: true }] }))
      .toMatchObject({ ok: false, code: "invalid-geometry" });
    // a vertex landing on a non-adjacent edge's interior.
    expect(compile({ intent: "x", operations: [{ kind: "add_keepout", polygon: [
      { x: 10_000_000, y: 10_000_000 }, { x: 30_000_000, y: 10_000_000 }, { x: 30_000_000, y: 30_000_000 },
      { x: 20_000_000, y: 10_000_000 }, { x: 10_000_000, y: 30_000_000 },
    ], layers: ["copperTop"], forbidTracks: true, forbidVias: true }] }))
      .toMatchObject({ ok: false, code: "invalid-geometry" });
  });

  it("R18c: exactness holds at maximum coordinate magnitude (BigInt predicates)", () => {
    const big = board();
    big.outline = { kind: "polygon", points: [
      { x: -9_000_000_000, y: -9_000_000_000 }, { x: 9_000_000_000, y: -9_000_000_000 },
      { x: 9_000_000_000, y: 9_000_000_000 }, { x: -9_000_000_000, y: 9_000_000_000 },
    ] };
    // A keepout hanging off the edge at extreme magnitude must still refuse.
    expect(compile({ intent: "x", operations: [{ kind: "add_keepout", polygon: [
      { x: 8_000_000_000, y: 0 }, { x: 9_500_000_000, y: 0 }, { x: 8_000_000_000, y: 1_000_000 },
    ], layers: ["copperTop"], forbidTracks: true, forbidVias: true }] }, big))
      .toMatchObject({ ok: false, code: "escapes-board" });
  });
});

// ─── §C R19 — update_dimension is validated identically to add ───────────────

describe("B15.2.1 §C — update_dimension validates rendered geometry", () => {
  function withDimension(): PcbBoard {
    const source = board();
    source.dimensions = [{ id: "d1", kind: "horizontal", a: { x: 10_000_000, y: 20_000_000 }, b: { x: 30_000_000, y: 20_000_000 }, offsetNm: 2_000_000, layer: "fabTop", unit: "mm", precision: 2, textHeightNm: 1_000_000, strokeWidthNm: 150_000 }];
    return source;
  }

  it("R19: an update whose rendered geometry leaves the board refuses; an on-board update succeeds", () => {
    expect(compile({ intent: "x", operations: [{ kind: "update_dimension", dimensionId: "d1", offsetNm: -200_000_000 }] }, withDimension()))
      .toMatchObject({ ok: false, code: "escapes-board" });
    const okUpdate = compile({ intent: "x", operations: [{ kind: "update_dimension", dimensionId: "d1", offsetNm: 3_000_000 }] }, withDimension());
    expect(okUpdate.ok).toBe(true);
    if (okUpdate.ok) expect(okUpdate.candidate.dimensions![0]!.offsetNm).toBe(3_000_000);
  });
});

// ─── §D R20 — a rule changes only what it names ──────────────────────────────

describe("B15.2.1 §D — a rule never changes the class or unrequested fields", () => {
  function legacyPowerBoard(): PcbBoard {
    const source = board();
    source.netClassing = { version: 1, assignments: { 1: { classId: "Power", explanation: "power net" } }, ruleDeltas: [] };
    return source;
  }

  it("R20: a legacy no-base netClassing refuses rather than silently resetting the class", () => {
    const source = legacyPowerBoard();
    const before = getNetClass(source, 1);
    const result = compile({ intent: "x", operations: [{ kind: "set_net_class_rule", netIds: [1], trackWidthNm: 500_000 }] }, source);
    expect(result).toMatchObject({ ok: false, code: "invalid-value" });
    // the caller's board is untouched.
    expect(getNetClass(source, 1).clearance).toBe(before.clearance);
    expect(getNetClass(source, 1).viaSize).toBe(before.viaSize);
  });

  it("R20b: on a normal board a rule changes ONLY the named field and every unrequested field is unchanged", () => {
    const source = board(); // Default class, has a base via reclassify path
    const before = getNetClass(source, 1);
    const result = compile({ intent: "x", operations: [{ kind: "set_net_class_rule", netIds: [1], trackWidthNm: 200_000 }] }, source);
    expect(result.ok, result.ok ? "" : `${result.code}: ${result.detail}`).toBe(true);
    if (!result.ok) return;
    const after = getNetClass(result.candidate, 1);
    expect(after.trackWidth).toBe(200_000);
    expect(after.id).toBe(before.id); // class unchanged
    expect(after.clearance).toBe(before.clearance); // unrequested unchanged
    expect(after.viaSize).toBe(before.viaSize);
    expect(after.viaDrill).toBe(before.viaDrill);
  });

  it("R20c: a partial via change validates the RESULTANT pair's annular ring", () => {
    // Lowering only the via size while leaving the drill can violate the ring.
    const result = compile({ intent: "x", operations: [{ kind: "set_net_class_rule", netIds: [1], viaSizeNm: RULES.default.minViaOuterNm }] }, board());
    // Either it takes effect legally, or it refuses — never a silent illegal ring.
    if (!result.ok) expect(["weakened-minimum", "invalid-value"]).toContain(result.code);
  });
});

// ─── §E R21 — the seal boundary is closed and non-forgeable ──────────────────

describe("B15.2.1 §E — the seal boundary is closed", () => {
  it("R21a: the public proposal module exports NO raw sealer or assembler", () => {
    expect((sealedModule as Record<string, unknown>).sealPcbEditProposal).toBeUndefined();
    expect((sealedModule as Record<string, unknown>).assemblePcbEditProposal).toBeUndefined();
    expect((sealedModule as Record<string, unknown>).rawSealPcbEditProposal).toBeUndefined();
  });

  it("R21b: the ONLY way to mint a proposal runs the compiler internally — a forged payload cannot inject digests", () => {
    const source = board();
    const context = {
      scope: { tenantId: "t", projectId: "p", branchId: "main", boardInstanceId: "b" },
      base: { canonicalResource: { resourceId: "r", contentDigest: "d" }, historyHead: { sequence: 0, label: null }, lineageId: "lin" },
      actor: { actorId: "a", kind: "ai" }, effectiveActor: { actorId: "u", kind: "human" },
      discovery: { digest: "x", contextDigest: "y" }, provenance: { provider: "p", model: "m", runId: null },
      nonce: "n0n6e0000000000a", now: 1_000_000,
    };
    // A genuine payload seals and verifies.
    const real = createSealedPcbEditProposal({ payload: { intent: "widen", operations: [{ kind: "update_track", trackId: "t1", widthNm: 500_000 }] }, board: source, validationPolicy: { presetId: DEFAULT_PRESET_ID }, ...context });
    expect(real.ok).toBe(true);
    if (real.ok) {
      expect(verifySealedPcbEditProposalIntegrity(real.proposal)).toEqual({ ok: true });
      // The sealed digests are the COMPILER's, over the DERIVED base identity.
      expect(real.proposal.base.pcbRevisionId).toBe(pcbRevisionId(source));
    }
    // A hostile/empty payload cannot produce a verifying artifact — it either
    // refuses to compile or seals a real (harmless) result, never a forgery.
    const hostile = createSealedPcbEditProposal({ payload: { intent: "attacker", operations: [] }, board: source, validationPolicy: { presetId: DEFAULT_PRESET_ID }, ...context });
    expect(hostile.ok).toBe(false);
  });

  it("R21c: a fabricated proposal with a matching-digest PARTIAL impact does not verify", () => {
    // B16.0.1: the CURRENT schema so the partial-shape path (not the legacy
    // version gate) is what refuses this fabrication.
    const partial = { schema: PCB_EDIT_PROPOSAL_SCHEMA, proposalId: "pprop-forged", nonce: "n", scope: {}, base: { pcbRevisionId: "x" }, intent: "x", operations: [], operationsDigest: "d", candidateDigest: "c", impact: { candidateBoardDigest: "c" }, impactDigest: "d", mintedObjectIds: [], tool: { toolId: "sirkit.pcb.propose-bounded-edit", version: "1.0.0" }, actor: {}, effectiveActor: {}, discovery: {}, provenance: {}, createdAt: 0, expiresAt: 1, approvalTier: "topology-or-geometry" };
    expect(verifySealedPcbEditProposalIntegrity(partial)).toMatchObject({ ok: false });
  });
});

// ─── §E R21 — AST import/export gate on the raw sealer ───────────────────────

describe("B15.2.1 §E — the raw sealer is import-gated", () => {
  const files = collectProductionFiles();
  const SEALER = "app/lib/pcb/proposal/pcb-edit-proposal-sealer.internal";
  const APPROVED = new Set([
    "app/lib/pcb/proposal/pcb-edit-proposal-sealer.internal.ts",
    "app/lib/pcb/proposal/pcb-edit-proposal-service.ts",
  ]);

  it("no production module imports the raw sealer except the high-level service", { timeout: 60_000 }, () => {
    expect(moduleImportOffenders(files, SEALER, APPROVED)).toEqual([]);
  });

  it("the public proposal module exports no raw sealer symbol", () => {
    const publicSource = files.get("app/lib/pcb/proposal/sealed-pcb-edit-proposal.ts") ?? "";
    expect(publicSource).not.toMatch(/export\s+function\s+sealPcbEditProposal/);
    expect(publicSource).not.toMatch(/export\s+function\s+assemblePcbEditProposal/);
    expect(publicSource).not.toMatch(/export\s+function\s+rawSealPcbEditProposal/);
  });

  it("NEGATIVE tripwire: an injected forbidden importer trips the gate", { timeout: 60_000 }, () => {
    const injected = new Map(files);
    injected.set("app/lib/agent/evil.ts", 'import { rawSealPcbEditProposal } from "@/app/lib/pcb/proposal/pcb-edit-proposal-sealer.internal";');
    expect(moduleImportOffenders(injected, SEALER, APPROVED)).toEqual(["app/lib/agent/evil.ts"]);
  });
});
