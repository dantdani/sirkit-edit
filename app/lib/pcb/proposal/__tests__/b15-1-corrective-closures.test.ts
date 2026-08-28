/**
 * B15.1 — the corrective closures. Every counterexample R1–R9 that
 * independent verification raised against the B15 core is a permanent
 * fail-closed regression here.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createEmptyBoard } from "../../types";
import type { PcbBoard } from "../../types";
import { getPreset, DEFAULT_PRESET_ID } from "../../drc/presets";
import { pcbRevisionId } from "../../revision";
import { parseBoundedEditRequest, BOUNDED_EDIT_LIMITS } from "../bounded-edit-operations";
import { compileBoundedPcbEdit, resolveEffectiveMinima } from "../bounded-edit-compiler";
import {
  PCB_EDIT_PROPOSAL_TOOL_ID,
  PCB_EDIT_PROPOSAL_TOOL_VERSION,
  PCB_EDIT_PROPOSAL_TTL_MS,
  verifySealedPcbEditProposalIntegrity,
} from "../sealed-pcb-edit-proposal";
import { createSealedPcbEditProposal } from "../pcb-edit-proposal-service";

const RULES = getPreset(DEFAULT_PRESET_ID).rules;
const MINIMA = resolveEffectiveMinima(RULES);

function board(): PcbBoard {
  const base = createEmptyBoard();
  base.outline = { kind: "rect", width: 100_000_000, height: 80_000_000, origin: { x: 0, y: 0 } };
  base.nets.push({ id: 1, name: "NET1" }, { id: 2, name: "NET2" }, { id: 3, name: "BARE" });
  base.tracks = [{ id: "t1", layer: "copperTop", width: 400_000, start: { x: 10_000_000, y: 10_000_000 }, end: { x: 20_000_000, y: 10_000_000 }, netId: 1 }];
  base.vias = [{ id: "v1", at: { x: 30_000_000, y: 30_000_000 }, size: 600_000, drill: 300_000, netId: 1, layers: ["copperTop", "copperBottom"] }];
  base.routingKeepouts = [{ id: "k1", polygon: [{ x: 50_000_000, y: 50_000_000 }, { x: 60_000_000, y: 50_000_000 }, { x: 60_000_000, y: 60_000_000 }], layers: ["copperTop"], forbidTracks: true, forbidVias: true }];
  base.padstacks = [
    { id: "ps-small", name: "Via 0.6/0.3", kind: "via", outerNm: 600_000, drillNm: 300_000, tented: true, zoneConnect: "solid" },
    { id: "ps-big", name: "Via 1.2/0.6", kind: "via", outerNm: 1_200_000, drillNm: 600_000, tented: true, zoneConnect: "solid" },
  ];
  return base;
}

const concaveBoard = (): PcbBoard => {
  const source = board();
  // L-shaped: the (60,60) notch is inside the bounding box, outside the board.
  source.outline = { kind: "polygon", points: [
    { x: 0, y: 0 }, { x: 100_000_000, y: 0 }, { x: 100_000_000, y: 20_000_000 },
    { x: 20_000_000, y: 20_000_000 }, { x: 20_000_000, y: 80_000_000 }, { x: 0, y: 80_000_000 },
  ] };
  return source;
};

const compile = (payload: unknown, source = board()) =>
  compileBoundedPcbEdit({ board: source, rules: RULES, baseIdentity: pcbRevisionId(source), payload });

// ─── §A parser totality and exactness (R1, R2, R3) ───────────────────────────

describe("B15.1 §A — the input boundary is total and exact", () => {
  it("R1: the byte ceiling is measured in REAL UTF-8 bytes and refuses a 40KB payload", () => {
    const operations = Array.from({ length: 16 }, (_, opIndex) => ({
      kind: "add_keepout",
      name: `keepout-${opIndex}`.padEnd(256, "k"),
      polygon: Array.from({ length: 64 }, (_, vertex) => ({ x: -9_999_999_999 + vertex, y: -9_999_999_999 + vertex })),
      layers: ["copperTop"], forbidTracks: true, forbidVias: true,
    }));
    const payload = { intent: "many keepouts", operations };
    const actualBytes = new TextEncoder().encode(JSON.stringify(payload)).length;
    expect(actualBytes).toBeGreaterThan(BOUNDED_EDIT_LIMITS.maxRequestBytes);
    const parsed = parseBoundedEditRequest(payload);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.refusal.code).toBe("too-large");
  });

  it("R1b: multibyte characters and structural overhead COUNT toward the ceiling", () => {
    // Each 4-byte emoji is one UTF-16 pair; a naive length count would pass.
    const wide = "🙂".repeat(120); // 240 UTF-16 units, 480 UTF-8 bytes
    const operations = Array.from({ length: 16 }, () => ({
      kind: "add_keepout", name: wide,
      polygon: Array.from({ length: 64 }, (_, v) => ({ x: -9_999_999_999 + v, y: -9_999_999_999 + v })),
      layers: ["copperTop"], forbidTracks: true, forbidVias: true,
    }));
    const parsed = parseBoundedEditRequest({ intent: "wide", operations });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.refusal.code).toBe("too-large");
  });

  it("R2: hostile proxy traps REFUSE instead of throwing", () => {
    const traps: Array<[string, unknown]> = [
      ["ownKeys", new Proxy({}, { ownKeys() { throw new Error("trap"); } })],
      ["getPrototypeOf", new Proxy({}, { getPrototypeOf() { throw new Error("trap"); } })],
      ["getOwnPropertyDescriptor", new Proxy({ kind: "update_track" }, { getOwnPropertyDescriptor() { throw new Error("trap"); } })],
      ["get", new Proxy({ kind: "update_track" }, { get() { throw new Error("trap"); } })],
    ];
    for (const [label, hostile] of traps) {
      let refusalCode: string | null = null;
      expect(() => {
        const result = parseBoundedEditRequest({ intent: "x", operations: [hostile] });
        refusalCode = result.ok ? "ACCEPTED" : result.refusal.code;
      }, label).not.toThrow();
      expect(refusalCode, label).toBe("hostile-input");
    }
    // …and the same totality holds at the compiler entry point.
    expect(() => compile({ intent: "x", operations: [new Proxy({}, { ownKeys() { throw new Error("trap"); } })] })).not.toThrow();
  });

  it("R3: update_keepout validates `name` exactly as the add form does", () => {
    for (const name of [123, true, null, "", { evil: 1 }, "x".repeat(BOUNDED_EDIT_LIMITS.maxStringLength + 1)]) {
      const result = compile({ intent: "x", operations: [{ kind: "update_keepout", keepoutId: "k1", name }] });
      expect(result.ok, JSON.stringify(name)).toBe(false);
    }
    const valid = compile({ intent: "x", operations: [{ kind: "update_keepout", keepoutId: "k1", name: "kept-out" }] });
    expect(valid.ok).toBe(true);
    if (valid.ok) expect((valid.candidate.routingKeepouts ?? [])[0]?.name).toBe("kept-out");
  });
});

// ─── §B geometry and structural authority (R4) ───────────────────────────────

describe("B15.1 §B — geometry and structural authority", () => {
  it("R4a: an unsupported dimension layer refuses", () => {
    const result = compile({ intent: "x", operations: [{ kind: "add_dimension", dimensionKind: "aligned", a: { x: 5_000_000, y: 5_000_000 }, b: { x: 15_000_000, y: 5_000_000 }, offsetNm: 1_000_000, layer: "evilLayer", unit: "mm", precision: 2, textHeightNm: 1_000_000, strokeWidthNm: 150_000 }] });
    expect(result).toMatchObject({ ok: false, code: "invalid-layer" });
  });

  it("R4b: degenerate, zero-area, and self-intersecting keepouts refuse", () => {
    const identical = compile({ intent: "x", operations: [{ kind: "add_keepout", polygon: [{ x: 5_000_000, y: 5_000_000 }, { x: 5_000_000, y: 5_000_000 }, { x: 5_000_000, y: 5_000_000 }], layers: ["copperTop"], forbidTracks: true, forbidVias: true }] });
    expect(identical).toMatchObject({ ok: false, code: "invalid-geometry" });
    const collinear = compile({ intent: "x", operations: [{ kind: "add_keepout", polygon: [{ x: 5_000_000, y: 5_000_000 }, { x: 6_000_000, y: 5_000_000 }, { x: 7_000_000, y: 5_000_000 }], layers: ["copperTop"], forbidTracks: true, forbidVias: true }] });
    expect(collinear).toMatchObject({ ok: false, code: "invalid-geometry" });
    const bowtie = compile({ intent: "x", operations: [{ kind: "add_keepout", polygon: [{ x: 5_000_000, y: 5_000_000 }, { x: 15_000_000, y: 15_000_000 }, { x: 15_000_000, y: 5_000_000 }, { x: 5_000_000, y: 15_000_000 }], layers: ["copperTop"], forbidTracks: true, forbidVias: true }] });
    expect(bowtie).toMatchObject({ ok: false, code: "invalid-geometry" });
  });

  it("R4c: the concave-outline notch is OUTSIDE the board for keepouts and dimensions", () => {
    const source = concaveBoard();
    const keepout = compile({ intent: "x", operations: [{ kind: "add_keepout", polygon: [{ x: 60_000_000, y: 60_000_000 }, { x: 70_000_000, y: 60_000_000 }, { x: 70_000_000, y: 70_000_000 }], layers: ["copperTop"], forbidTracks: true, forbidVias: true }] }, source);
    expect(keepout).toMatchObject({ ok: false, code: "escapes-board" });
    const dimension = compile({ intent: "x", operations: [{ kind: "add_dimension", dimensionKind: "aligned", a: { x: 60_000_000, y: 60_000_000 }, b: { x: 70_000_000, y: 70_000_000 }, offsetNm: 1_000_000, layer: "fabTop", unit: "mm", precision: 2, textHeightNm: 1_000_000, strokeWidthNm: 150_000 }] }, source);
    expect(dimension).toMatchObject({ ok: false, code: "escapes-board" });
    // …while a point in the retained arm of the L is still accepted.
    const inside = compile({ intent: "x", operations: [{ kind: "add_keepout", polygon: [{ x: 30_000_000, y: 5_000_000 }, { x: 40_000_000, y: 5_000_000 }, { x: 40_000_000, y: 15_000_000 }], layers: ["copperTop"], forbidTracks: true, forbidVias: true }] }, source);
    expect(inside.ok).toBe(true);
  });

  it("R4d: zero-length tracks and dimensions refuse", () => {
    expect(compile({ intent: "x", operations: [{ kind: "add_track", layer: "copperTop", netId: 1, widthNm: 400_000, start: { x: 5_000_000, y: 5_000_000 }, end: { x: 5_000_000, y: 5_000_000 } }] }))
      .toMatchObject({ ok: false, code: "invalid-geometry" });
    expect(compile({ intent: "x", operations: [{ kind: "add_dimension", dimensionKind: "aligned", a: { x: 5_000_000, y: 5_000_000 }, b: { x: 5_000_000, y: 5_000_000 }, offsetNm: 1_000_000, layer: "fabTop", unit: "mm", precision: 2, textHeightNm: 1_000_000, strokeWidthNm: 150_000 }] }))
      .toMatchObject({ ok: false, code: "invalid-geometry" });
  });
});

// ─── §C fabrication minima (R5) ──────────────────────────────────────────────

describe("B15.1 §C — the ACTIVE fabrication rules are the floor", () => {
  it("R5a: sub-minimum rules refuse on a net with NO existing copper", () => {
    const result = compile({ intent: "x", operations: [{ kind: "set_net_class_rule", netIds: [3], trackWidthNm: 1_000, clearanceNm: 1_000, viaSizeNm: 2_000, viaDrillNm: 1_000 }] });
    expect(result).toMatchObject({ ok: false, code: "weakened-minimum" });
  });

  it("R5b: each minimum is enforced independently, and an at-minimum rule is accepted", () => {
    const cases: Array<[string, Record<string, number>]> = [
      ["trackWidth", { trackWidthNm: MINIMA.minTrackWidthNm - 1 }],
      ["clearance", { clearanceNm: MINIMA.clearanceNm - 1 }],
      ["viaOuter", { viaSizeNm: MINIMA.minViaOuterNm - 1 }],
      ["viaDrill", { viaDrillNm: MINIMA.minViaDrillNm - 1 }],
    ];
    for (const [label, values] of cases) {
      const result = compile({ intent: "x", operations: [{ kind: "set_net_class_rule", netIds: [3], ...values }] });
      expect(result, label).toMatchObject({ ok: false, code: "weakened-minimum" });
    }
    const atMinimum = compile({ intent: "x", operations: [{ kind: "set_net_class_rule", netIds: [3], trackWidthNm: MINIMA.minTrackWidthNm }] });
    expect(atMinimum.ok).toBe(true);
  });

  it("R5c: an annular-ring violation refuses even when outer and drill each pass", () => {
    const outer = MINIMA.minViaOuterNm + 2 * MINIMA.minAnnularRingNm;
    const drill = outer - 2 * MINIMA.minAnnularRingNm + 2; // ring 1 nm short
    const result = compile({ intent: "x", operations: [{ kind: "set_net_class_rule", netIds: [3], viaSizeNm: outer, viaDrillNm: Math.max(drill, MINIMA.minViaDrillNm) }] });
    if (drill >= MINIMA.minViaDrillNm) expect(result).toMatchObject({ ok: false, code: "weakened-minimum" });
  });

  it("R5d: an illegal ROUTING PREFERENCE and an illegal added track refuse", () => {
    expect(compile({ intent: "x", operations: [{ kind: "set_routing_preference", customTrackWidthNm: 1_000 }] }))
      .toMatchObject({ ok: false, code: "weakened-minimum" });
    expect(compile({ intent: "x", operations: [{ kind: "add_track", layer: "copperTop", netId: 1, widthNm: 1_000, start: { x: 25_000_000, y: 25_000_000 }, end: { x: 35_000_000, y: 25_000_000 } }] }))
      .toMatchObject({ ok: false, code: "weakened-minimum" });
  });
});

// ─── §D padstack denormalization (R6) ────────────────────────────────────────

describe("B15.1 §D — the padstack is authoritative for via geometry", () => {
  it("R6a: assigning a padstack updates padstackId, size AND drill atomically", () => {
    const result = compile({ intent: "x", operations: [{ kind: "update_via", viaId: "v1", padstackId: "ps-big" }] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const via = result.candidate.vias.find((item) => item.id === "v1")!;
    expect(via.padstackId).toBe("ps-big");
    expect(via.size).toBe(1_200_000);
    expect(via.drill).toBe(600_000);
  });

  it("R6b: explicit geometry ALONGSIDE a padstack refuses on both add and update", () => {
    expect(compile({ intent: "x", operations: [{ kind: "update_via", viaId: "v1", padstackId: "ps-big", sizeNm: 600_000 }] }))
      .toMatchObject({ ok: false, code: "padstack-conflict" });
    expect(compile({ intent: "x", operations: [{ kind: "add_via", at: { x: 40_000_000, y: 40_000_000 }, netId: 1, sizeNm: 600_000, drillNm: 300_000, layers: ["copperTop", "copperBottom"], padstackId: "ps-big" }] }))
      .toMatchObject({ ok: false, code: "padstack-conflict" });
  });

  it("R6c: add_via WITH a padstack and matching dimensions derives its geometry from the padstack", () => {
    const result = compile({ intent: "x", operations: [{ kind: "add_via", at: { x: 40_000_000, y: 40_000_000 }, netId: 1, sizeNm: 1_200_000, drillNm: 600_000, layers: ["copperTop", "copperBottom"], padstackId: "ps-big" }] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const added = result.candidate.vias[result.candidate.vias.length - 1]!;
    expect(added.padstackId).toBe("ps-big");
    expect(added.size).toBe(1_200_000);
    expect(added.drill).toBe(600_000);
  });

  it("R6d: an unknown padstack refuses", () => {
    expect(compile({ intent: "x", operations: [{ kind: "update_via", viaId: "v1", padstackId: "ps-nope" }] }))
      .toMatchObject({ ok: false, code: "invalid-padstack" });
  });
});

// ─── §E connectivity identity (R8) and §F honest readiness ───────────────────

describe("B15.1 §E/§F — identity-based safety and honest readiness naming", () => {
  it("R8: safety compares stable IDENTITIES, not counts", () => {
    const source = readFileSync(join(process.cwd(), "app/lib/pcb/proposal/bounded-edit-compiler.ts"), "utf8");
    expect(source).toContain("pairKey");
    expect(source).toContain("completionByNet");
    // The count-only comparisons are gone from the shorts/unknown paths.
    expect(/shorts\.length > .*shorts\.length/.test(source)).toBe(false);
    expect(/unknownContacts\.length > .*unknownContacts\.length/.test(source)).toBe(false);
  });

  it("R8b: a swapped short at equal count still refuses (identity, not aggregate)", () => {
    // NET2 copper crossing NET1 copper creates a contact identity that does
    // not exist today — refused even though the board already has none.
    const source = board();
    source.tracks.push({ id: "t2", layer: "copperTop", width: 400_000, start: { x: 10_000_000, y: 40_000_000 }, end: { x: 20_000_000, y: 40_000_000 }, netId: 2 });
    const result = compile({ intent: "bridge", operations: [{ kind: "add_track", layer: "copperTop", netId: 1, widthNm: 400_000, start: { x: 15_000_000, y: 35_000_000 }, end: { x: 15_000_000, y: 45_000_000 } }] }, source);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(["new-short", "drc-regression", "connectivity-regression"]).toContain(result.code);
  });

  it("R8c/F: the impact reports routingCompletion and NEVER calls it readiness", () => {
    const result = compile({ intent: "x", operations: [{ kind: "update_track", trackId: "t1", widthNm: 500_000 }] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.impact.routingCompletion).toBeDefined();
    expect(result.impact.readiness.state).toBe("unavailable");
    expect(typeof result.impact.readiness.reason).toBe("string");
    expect((result.impact as unknown as Record<string, unknown>).readiness).not.toHaveProperty("beforePercent");
  });
});

// ─── §G seal consistency (R7) ────────────────────────────────────────────────

describe("B15.1 §G — the seal certifies what it claims", () => {
  function sealFixture(now = 1_000_000) {
    const source = board();
    const result = createSealedPcbEditProposal({
      payload: { intent: "widen", operations: [{ kind: "update_track", trackId: "t1", widthNm: 500_000 }] },
      board: source, validationPolicy: { presetId: DEFAULT_PRESET_ID },
      scope: { tenantId: "t", projectId: "p", branchId: "main", boardInstanceId: "b" },
      base: { canonicalResource: { resourceId: "r", contentDigest: "d" }, historyHead: { sequence: 0, label: null }, lineageId: "lin" },
      actor: { actorId: "a", kind: "ai" }, effectiveActor: { actorId: "u", kind: "human" },
      discovery: { digest: "x", contextDigest: "y" }, provenance: { provider: "p", model: "m", runId: null },
      nonce: "n0n6e0000000000a", now,
    });
    if (!result.ok) throw new Error(`fixture must seal: ${result.code} ${result.detail}`);
    return { source, proposal: result.proposal };
  }

  it("R7a: an honestly assembled proposal verifies", () => {
    expect(verifySealedPcbEditProposalIntegrity(sealFixture().proposal)).toEqual({ ok: true });
  });

  it("R7b: a FORGED operations digest, impact digest, or candidate digest is DETECTED", () => {
    const { proposal } = sealFixture();
    const forgeries: Array<[string, Record<string, unknown>]> = [
      ["operationsDigest", { ...proposal, operationsDigest: "FORGED" }],
      ["impactDigest", { ...proposal, impactDigest: "FORGED" }],
      ["candidateDigest disagrees with impact", { ...proposal, candidateDigest: "DIFFERENT" }],
      ["operations swapped under a valid-looking body", { ...proposal, operations: [{ kind: "update_track", trackId: "t1", widthNm: 900_000 }] }],
    ];
    for (const [label, forged] of forgeries) {
      const verdict = verifySealedPcbEditProposalIntegrity(forged);
      expect(verdict.ok, label).toBe(false);
      if (!verdict.ok) expect(verdict.code, label).toBe("altered");
    }
  });

  it("R7c: the sealer HARD-CODES the trusted tool identity (a foreign one cannot be constructed)", () => {
    const { proposal } = sealFixture();
    expect(proposal.tool).toEqual({ toolId: PCB_EDIT_PROPOSAL_TOOL_ID, version: PCB_EDIT_PROPOSAL_TOOL_VERSION });
    // A body carrying any other tool identity fails verification outright.
    // [B15.2.2] the refusal now comes from the COMPLETE shape validation,
    // which runs BEFORE any digest is trusted, so the code is "malformed"
    // rather than the later digest-stage "altered". Both are refusals.
    const foreignTool = verifySealedPcbEditProposalIntegrity({ ...proposal, tool: { toolId: "sirkit.evil.tool", version: "9.9.9" } });
    expect(foreignTool.ok).toBe(false);
    if (!foreignTool.ok) expect(["malformed", "altered"]).toContain(foreignTool.code);
  });

  it("R7d: a stretched TTL or inverted validity window is DETECTED", () => {
    const { proposal } = sealFixture();
    expect(verifySealedPcbEditProposalIntegrity({ ...proposal, expiresAt: proposal.createdAt + PCB_EDIT_PROPOSAL_TTL_MS + 1 })).toMatchObject({ ok: false });
    expect(verifySealedPcbEditProposalIntegrity({ ...proposal, expiresAt: proposal.createdAt - 1 })).toMatchObject({ ok: false });
  });

  it("R7e: a minted id absent from the impact report is DETECTED", () => {
    const { proposal } = sealFixture();
    expect(verifySealedPcbEditProposalIntegrity({ ...proposal, mintedObjectIds: ["b15-track-ghost"] })).toMatchObject({ ok: false, code: "altered" });
  });
});

// ─── §K footprint coverage (R9) ──────────────────────────────────────────────

describe("B15.1 §K — footprint move and rotate are EXERCISED (R9)", () => {
  function withFootprint(): PcbBoard {
    const source = board();
    source.footprints = [{
      id: "fp1", ref: "R1", footprintId: "lib:R_0805", at: { x: 30_000_000, y: 20_000_000 },
      rotationDeg: 0, side: "top", padNets: { "1": 1, "2": 2 },
      def: {
        libName: "lib", name: "R_0805", attributes: { smd: true, throughHole: false, excludeFromPos: false, excludeFromBom: false },
        pads: [], graphics: [], bodyBBox: { minX: -1_000_000, minY: -500_000, maxX: 1_000_000, maxY: 500_000 },
        models: [], rawSexpr: "",
      },
    } as never];
    return source;
  }

  it("1. move_footprint SUCCEEDS and moves the anchor in the candidate only", () => {
    const source = withFootprint();
    const snapshot = structuredClone(source);
    const result = compile({ intent: "tidy", operations: [{ kind: "move_footprint", footprintId: "fp1", to: { x: 45_000_000, y: 35_000_000 } }] }, source);
    expect(result.ok, result.ok ? "" : `${result.code}: ${result.detail}`).toBe(true);
    if (!result.ok) return;
    expect(result.candidate.footprints[0]!.at).toEqual({ x: 45_000_000, y: 35_000_000 });
    expect(source).toEqual(snapshot);
    expect(result.impact.changedObjectIds).toContain("fp1");
  });

  it("2. rotate_footprint SUCCEEDS for every allowed quarter turn", () => {
    for (const rotationDeg of [90, 180, 270]) {
      const result = compile({ intent: "rotate", operations: [{ kind: "rotate_footprint", footprintId: "fp1", rotationDeg }] }, withFootprint());
      expect(result.ok, `rotation ${rotationDeg}`).toBe(true);
      if (result.ok) expect(result.candidate.footprints[0]!.rotationDeg).toBe(rotationDeg);
    }
  });

  it("3. a non-quarter-turn rotation, an unknown footprint, a LOCKED footprint, and an off-board move all refuse", () => {
    expect(compile({ intent: "x", operations: [{ kind: "rotate_footprint", footprintId: "fp1", rotationDeg: 45 }] }, withFootprint()))
      .toMatchObject({ ok: false, code: "invalid-value" });
    expect(compile({ intent: "x", operations: [{ kind: "move_footprint", footprintId: "nope", to: { x: 1_000_000, y: 1_000_000 } }] }, withFootprint()))
      .toMatchObject({ ok: false, code: "unknown-object" });
    const locked = withFootprint();
    (locked.footprints[0] as unknown as { locked: boolean }).locked = true;
    expect(compile({ intent: "x", operations: [{ kind: "move_footprint", footprintId: "fp1", to: { x: 45_000_000, y: 35_000_000 } }] }, locked))
      .toMatchObject({ ok: false, code: "locked-object" });
    expect(compile({ intent: "x", operations: [{ kind: "move_footprint", footprintId: "fp1", to: { x: 500_000_000, y: 35_000_000 } }] }, withFootprint()))
      .toMatchObject({ ok: false, code: "escapes-board" });
  });

  it("4. a move into the notch of a CONCAVE outline refuses", () => {
    const source = withFootprint();
    source.outline = concaveBoard().outline;
    expect(compile({ intent: "x", operations: [{ kind: "move_footprint", footprintId: "fp1", to: { x: 60_000_000, y: 60_000_000 } }] }, source))
      .toMatchObject({ ok: false, code: "escapes-board" });
  });
});
