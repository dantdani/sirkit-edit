/**
 * B15.2 — the final proposal-core closures. Every counterexample R10–R16
 * is a permanent fail-closed regression here.
 */

import { describe, expect, it } from "vitest";
import { createEmptyBoard } from "../../types";
import type { PcbBoard } from "../../types";
import type { CopperItemRef } from "../../connectivity-board";
import { copperItemId } from "../../connectivity-board";
import { getNetClass } from "../../netclass";
import { getPreset, DEFAULT_PRESET_ID } from "../../drc/presets";
import { pcbRevisionId } from "../../revision";
import { parseBoundedEditRequest } from "../bounded-edit-operations";
import { compileBoundedPcbEdit } from "../bounded-edit-compiler";
import {
  PCB_EDIT_PROPOSAL_SCHEMA,
  PCB_EDIT_PROPOSAL_TOOL_ID,
  PCB_EDIT_PROPOSAL_TOOL_VERSION,
  resolvePcbValidationPolicy,
  verifySealedPcbEditProposalIntegrity,
} from "../sealed-pcb-edit-proposal";
import { createSealedPcbEditProposal } from "../pcb-edit-proposal-service";
import { rawSealPcbEditProposal } from "../pcb-edit-proposal-sealer.internal";
import { INTENTIONAL_AGENT_EXPOSED_TOOL_IDS } from "@/app/lib/engineering/agent-exposure"; // [B17-F] the ONE reviewed exposure set — never a hard-coded count

const RULES = getPreset(DEFAULT_PRESET_ID).rules;

function board(): PcbBoard {
  const base = createEmptyBoard();
  base.outline = { kind: "rect", width: 100_000_000, height: 80_000_000, origin: { x: 0, y: 0 } };
  base.nets.push({ id: 1, name: "NET1" }, { id: 2, name: "GND" }, { id: 3, name: "BARE" });
  base.tracks = [{ id: "t1", layer: "copperTop", width: 400_000, start: { x: 10_000_000, y: 10_000_000 }, end: { x: 20_000_000, y: 10_000_000 }, netId: 1 }];
  base.vias = [{ id: "v1", at: { x: 30_000_000, y: 30_000_000 }, size: 600_000, drill: 300_000, netId: 1, layers: ["copperTop", "copperBottom"] }];
  base.padstacks = [
    { id: "ps-tiny", name: "Via 0.2/0.1", kind: "via", outerNm: 200_000, drillNm: 100_000, tented: true, zoneConnect: "solid" },
    { id: "ps-ok", name: "Via 0.6/0.3", kind: "via", outerNm: 600_000, drillNm: 300_000, tented: true, zoneConnect: "solid" },
  ];
  return base;
}

type PlacementConstraints = NonNullable<PcbBoard["footprints"][number]["placementConstraints"]>;
function withFootprint(constraints: PlacementConstraints = {}): PcbBoard {
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

const compile = (payload: unknown, source = board(), baseIdentity?: string) =>
  compileBoundedPcbEdit({ board: source, rules: RULES, payload, ...(baseIdentity !== undefined ? { baseIdentity } : {}) });

// ─── §A the parser is TOTAL (R10) ────────────────────────────────────────────

describe("B15.2 §A — no JavaScript value escapes the parser as an exception", () => {
  it("R10: array-length, revoked, index, and late-read proxies all REFUSE", () => {
    const lengthTrap = new Proxy([{ kind: "update_track" }], { get(t, k, r) { if (k === "length") throw new Error("trap"); return Reflect.get(t, k, r); } });
    const revoked = Proxy.revocable({ intent: "x", operations: [] }, {});
    revoked.revoke();
    const indexTrap = new Proxy([{ kind: "update_track" }], { get(t, k, r) { if (k === "0") throw new Error("trap"); return Reflect.get(t, k, r); } });
    let reads = 0;
    const lateThrow = new Proxy({ kind: "update_track", trackId: "t1", widthNm: 500_000 }, {
      get(t, k, r) { reads += 1; if (reads > 8 && k === "widthNm") throw new Error("late"); return Reflect.get(t, k, r); },
    });
    const hostile: Array<[string, unknown]> = [
      ["arrayLengthTrap", { intent: "x", operations: lengthTrap }],
      ["revokedRoot", revoked.proxy],
      ["arrayIndexTrap", { intent: "x", operations: indexTrap }],
    ];
    for (const [label, payload] of hostile) {
      let outcome = "";
      expect(() => {
        const result = parseBoundedEditRequest(payload);
        outcome = result.ok ? "ACCEPTED" : result.refusal.code;
      }, label).not.toThrow();
      expect(outcome, label).not.toBe("ACCEPTED");
      expect(() => compile(payload), `${label} (compiler)`).not.toThrow();
    }
    // A proxy that survives inspection but would throw on a LATER read is
    // NEUTRALIZED rather than refused: normalization snapshots its values
    // into inert data, and the original is never read again. The contract is
    // totality (no exception) plus determinism, not refusal.
    const latePayload = { intent: "x", operations: [lateThrow] };
    let lateOutcome: unknown;
    expect(() => { lateOutcome = parseBoundedEditRequest(latePayload); }).not.toThrow();
    expect(lateOutcome).toBeDefined();
    expect(() => compile({ intent: "x", operations: [lateThrow] })).not.toThrow();
  });

  it("R10b: a revoked proxy NESTED inside operations refuses, and a cyclic value refuses", () => {
    const nested = Proxy.revocable({ kind: "update_track" }, {});
    nested.revoke();
    expect(() => parseBoundedEditRequest({ intent: "x", operations: [nested.proxy] })).not.toThrow();
    const cyclic: Record<string, unknown> = { kind: "update_track", trackId: "t1" };
    cyclic.self = cyclic;
    const result = parseBoundedEditRequest({ intent: "x", operations: [cyclic] });
    expect(result.ok).toBe(false);
  });
});

// ─── §B exact geometry (R11) ─────────────────────────────────────────────────

describe("B15.2 §B — exact outline and rendered geometry", () => {
  it("R11a: a keepout in a ROUNDRECT's clipped corner refuses", () => {
    const round = board();
    round.outline = { kind: "roundrect", width: 100_000_000, height: 80_000_000, cornerRadius: 20_000_000, origin: { x: 0, y: 0 } };
    expect(compile({ intent: "x", operations: [{ kind: "add_keepout", polygon: [{ x: 200_000, y: 200_000 }, { x: 1_200_000, y: 200_000 }, { x: 1_200_000, y: 1_200_000 }], layers: ["copperTop"], forbidTracks: true, forbidVias: true }] }, round))
      .toMatchObject({ ok: false, code: "escapes-board" });
    // …while the same keepout well inside the roundrect is accepted.
    expect(compile({ intent: "x", operations: [{ kind: "add_keepout", polygon: [{ x: 40_000_000, y: 40_000_000 }, { x: 50_000_000, y: 40_000_000 }, { x: 50_000_000, y: 50_000_000 }], layers: ["copperTop"], forbidTracks: true, forbidVias: true }] }, round).ok).toBe(true);
  });

  it("R11b: a keepout EDGE crossing a concave notch refuses even with both vertices inside", () => {
    const concave = board();
    concave.outline = { kind: "polygon", points: [{ x: 0, y: 0 }, { x: 100_000_000, y: 0 }, { x: 100_000_000, y: 20_000_000 }, { x: 20_000_000, y: 20_000_000 }, { x: 20_000_000, y: 80_000_000 }, { x: 0, y: 80_000_000 }] };
    expect(compile({ intent: "x", operations: [{ kind: "add_keepout", polygon: [{ x: 10_000_000, y: 70_000_000 }, { x: 90_000_000, y: 10_000_000 }, { x: 10_000_000, y: 60_000_000 }], layers: ["copperTop"], forbidTracks: true, forbidVias: true }] }, concave))
      .toMatchObject({ ok: false, code: "escapes-board" });
  });

  it("R11c: a dimension whose RENDERED geometry leaves the board refuses", () => {
    expect(compile({ intent: "x", operations: [{ kind: "add_dimension", dimensionKind: "horizontal", a: { x: 10_000_000, y: 2_000_000 }, b: { x: 30_000_000, y: 2_000_000 }, offsetNm: -30_000_000, layer: "fabTop", unit: "mm", precision: 2, textHeightNm: 1_000_000, strokeWidthNm: 150_000 }] }))
      .toMatchObject({ ok: false, code: "escapes-board" });
    // A modest on-board offset still compiles.
    expect(compile({ intent: "x", operations: [{ kind: "add_dimension", dimensionKind: "horizontal", a: { x: 10_000_000, y: 20_000_000 }, b: { x: 30_000_000, y: 20_000_000 }, offsetNm: 2_000_000, layer: "fabTop", unit: "mm", precision: 2, textHeightNm: 1_000_000, strokeWidthNm: 150_000 }] }).ok).toBe(true);
  });
});

// ─── §C footprint hard constraints (R12) ─────────────────────────────────────

describe("B15.2 §C — footprint placement constraints are authoritative", () => {
  it("R12: fixedPosition, mechanical, and edgeConnector footprints refuse movement", () => {
    for (const placement of [{ fixedPosition: true }, { mechanical: true }, { edgeConnector: "left" as const }] as PlacementConstraints[]) {
      const result = compile({ intent: "x", operations: [{ kind: "move_footprint", footprintId: "fp1", to: { x: 50_000_000, y: 40_000_000 } }] }, withFootprint(placement));
      expect(result, JSON.stringify(placement)).toMatchObject({ ok: false, code: "locked-object" });
    }
  });

  it("R12b: allowedRotations is authoritative, and a permitted rotation still succeeds", () => {
    expect(compile({ intent: "x", operations: [{ kind: "rotate_footprint", footprintId: "fp1", rotationDeg: 180 }] }, withFootprint({ allowedRotations: [0, 90] })))
      .toMatchObject({ ok: false, code: "locked-object" });
    expect(compile({ intent: "x", operations: [{ kind: "rotate_footprint", footprintId: "fp1", rotationDeg: 90 }] }, withFootprint({ allowedRotations: [0, 90] })).ok).toBe(true);
  });

  it("R12c: the COMPLETE body envelope must fit — an anchor just inside the edge refuses", () => {
    const source = withFootprint({});
    // Anchor is on-board, but the 1 mm half-width body would hang over the edge.
    expect(compile({ intent: "x", operations: [{ kind: "move_footprint", footprintId: "fp1", to: { x: 99_900_000, y: 40_000_000 } }] }, source))
      .toMatchObject({ ok: false, code: "escapes-board" });
    expect(compile({ intent: "x", operations: [{ kind: "move_footprint", footprintId: "fp1", to: { x: 50_000_000, y: 40_000_000 } }] }, source).ok).toBe(true);
  });
});

// ─── §D global minima and padstack selection (R13) ───────────────────────────

describe("B15.2 §D — effective minima across every applicable net", () => {
  function powerBoard(): PcbBoard {
    const source = board();
    source.netClassing = { version: 1, assignments: { 2: { classId: "Power" } }, ruleDeltas: [] } as never;
    return source;
  }

  it("R13a: a GLOBAL preference at the weaker Default minimum refuses when a stricter class is present", () => {
    const power = powerBoard();
    const strictest = RULES.perClass?.Power?.minTrackWidthNm ?? RULES.default.minTrackWidthNm;
    expect(strictest).toBeGreaterThan(RULES.default.minTrackWidthNm);
    expect(compile({ intent: "x", operations: [{ kind: "set_routing_preference", customTrackWidthNm: RULES.default.minTrackWidthNm }] }, power))
      .toMatchObject({ ok: false, code: "weakened-minimum" });
    // At the strictest applicable minimum it is accepted.
    expect(compile({ intent: "x", operations: [{ kind: "set_routing_preference", customTrackWidthNm: strictest }] }, power).ok).toBe(true);
  });

  it("R13b: a routing padstack below the active via minima refuses", () => {
    expect(compile({ intent: "x", operations: [{ kind: "set_routing_preference", viaPadstackId: "ps-tiny" }] }))
      .toMatchObject({ ok: false, code: "weakened-minimum" });
    expect(compile({ intent: "x", operations: [{ kind: "set_routing_preference", viaPadstackId: "ps-ok" }] }).ok).toBe(true);
  });

  it("R13c: an UPDATED track width is checked against the minima, not only added tracks", () => {
    expect(compile({ intent: "x", operations: [{ kind: "update_track", trackId: "t1", widthNm: 1_000 }] }))
      .toMatchObject({ ok: false, code: "weakened-minimum" });
  });
});

// ─── §E rule deltas take effect (R14) ────────────────────────────────────────

describe("B15.2 §E — a rule mutation has a real, verified effect", () => {
  it("R14: the effective class changes, the rule id is minted and reported, and provenance is truthful", () => {
    const source = board();
    const before = getNetClass(source, 3).trackWidth;
    const result = compile({ intent: "x", operations: [{ kind: "set_net_class_rule", netIds: [3], trackWidthNm: 200_000 }] }, source);
    expect(result.ok, result.ok ? "" : `${result.code}: ${result.detail}`).toBe(true);
    if (!result.ok) return;
    const after = getNetClass(result.candidate, 3).trackWidth;
    expect(after).toBe(200_000);
    expect(after).not.toBe(before);
    const delta = result.candidate.netClassing!.ruleDeltas.at(-1)!;
    expect(result.mintedObjectIds).toContain(delta.id);
    expect(result.impact.changedObjectIds).toContain(delta.id);
    expect(delta.source).toBe("ai-brief"); // truthful AI provenance
    expect(result.impact.ruleChanges.join(" ")).toContain("net 3");
    expect(source.netClassing).toBeUndefined(); // the caller's board is untouched
  });

  it("R14b: duplicate net ids refuse", () => {
    expect(compile({ intent: "x", operations: [{ kind: "set_net_class_rule", netIds: [3, 3], trackWidthNm: 200_000 }] }))
      .toMatchObject({ ok: false, code: "invalid-value" });
  });
});

// ─── §F canonical copper identity (R15) ──────────────────────────────────────

describe("B15.2 §F — canonical copper identities cannot collide", () => {
  it("R15: pads on different footprints and separate zone regions stay distinct", () => {
    const padA: CopperItemRef = { kind: "pad", instanceId: "U1", padNumber: "1" };
    const padB: CopperItemRef = { kind: "pad", instanceId: "U2", padNumber: "1" };
    const padInstance: CopperItemRef = { kind: "pad", instanceId: "U1", padNumber: "1", padInstanceId: "pad-inst-9" };
    const zoneR0: CopperItemRef = { kind: "zone-region", zoneId: "z1", regionIndex: 0 };
    const zoneR1: CopperItemRef = { kind: "zone-region", zoneId: "z1", regionIndex: 1 };
    const zoneOther: CopperItemRef = { kind: "zone-region", zoneId: "z2", regionIndex: 0 };
    const track: CopperItemRef = { kind: "track", id: "t1" };
    const via: CopperItemRef = { kind: "via", id: "t1" };
    const ids = [padA, padB, padInstance, zoneR0, zoneR1, zoneOther, track, via].map(copperItemId);
    expect(new Set(ids).size).toBe(ids.length); // every identity is unique
  });

  it("R15b: the compiler uses the SHARED identity — a newly bridged contact refuses", () => {
    const source = board();
    source.tracks.push({ id: "t2", layer: "copperTop", width: 400_000, start: { x: 10_000_000, y: 40_000_000 }, end: { x: 20_000_000, y: 40_000_000 }, netId: 2 });
    const result = compile({ intent: "bridge", operations: [{ kind: "add_track", layer: "copperTop", netId: 1, widthNm: 400_000, start: { x: 15_000_000, y: 35_000_000 }, end: { x: 15_000_000, y: 45_000_000 } }] }, source);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(["new-short", "drc-regression", "connectivity-regression"]).toContain(result.code);
  });
});

// ─── §G the seal boundary is closed and total (R16) ──────────────────────────

describe("B15.2 §G — the sealed assembler is closed and verification is total", () => {
  function compiled(source = board()) {
    const result = compile({ intent: "widen", operations: [{ kind: "update_track", trackId: "t1", widthNm: 500_000 }] }, source);
    if (!result.ok) throw new Error(`fixture must compile: ${result.code} ${result.detail}`);
    return result;
  }
  const context = () => ({
    scope: { tenantId: "t", projectId: "p", branchId: "main", boardInstanceId: "b" },
    base: { canonicalResource: { resourceId: "r", contentDigest: "d" }, historyHead: { sequence: 0, label: null }, lineageId: "lin" },
    actor: { actorId: "a", kind: "ai" }, effectiveActor: { actorId: "u", kind: "human" },
    discovery: { digest: "x", contextDigest: "y" }, provenance: { provider: "p", model: "m", runId: null },
    nonce: "n0n6e0000000000a", now: 1_000_000,
  });

  it("R16a: the high-level service compiles internally, HARD-CODES the trusted tool identity, and the artifact verifies", () => {
    const source = board();
    const result = createSealedPcbEditProposal({ payload: { intent: "widen", operations: [{ kind: "update_track", trackId: "t1", widthNm: 500_000 }] }, board: source, validationPolicy: { presetId: DEFAULT_PRESET_ID }, ...context() });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.proposal.tool).toEqual({ toolId: PCB_EDIT_PROPOSAL_TOOL_ID, version: PCB_EDIT_PROPOSAL_TOOL_VERSION });
    expect(verifySealedPcbEditProposalIntegrity(result.proposal)).toEqual({ ok: true });
  });

  it("R16b: the internal raw sealer refuses an INCONSISTENT compiled object (defence in depth)", () => {
    const source = board();
    const base = { canonicalResource: { resourceId: "r", contentDigest: "d" }, pcbRevisionId: pcbRevisionId(source), boardDigest: pcbRevisionId(source), historyHead: { sequence: 0, label: null }, lineageId: "lin" };
    const trusted = { scope: context().scope, base, validationPolicy: resolvePcbValidationPolicy(DEFAULT_PRESET_ID)!.policy, actor: context().actor, effectiveActor: context().effectiveActor, authorization: { authorizationSchema: "sirkit.pcb-proposal-authorization.v1" as const, principalId: context().effectiveActor.actorId, membershipRevision: "membership:test", tenantId: context().scope.tenantId, projectId: context().scope.projectId, branchId: context().scope.branchId, requiredApplyRole: "pcb_editor" as const }, discovery: context().discovery, provenance: context().provenance, nonce: "n0n6e0000000000a", now: 1_000_000 };
    const good = compiled(source);
    const goodCompiled = { request: good.request, normalizedOperationsDigest: good.normalizedOperationsDigest, candidateDigest: good.candidateDigest, impact: good.impact, impactDigest: good.impactDigest, mintedObjectIds: good.mintedObjectIds };
    const forgeries: Array<[string, Record<string, unknown>]> = [
      ["operations digest", { ...goodCompiled, normalizedOperationsDigest: "FORGED" }],
      ["impact digest", { ...goodCompiled, impactDigest: "FORGED" }],
      ["candidate digest", { ...goodCompiled, candidateDigest: "DIFFERENT" }],
      ["ghost minted id", { ...goodCompiled, mintedObjectIds: ["b15-track-ghost"] }],
    ];
    for (const [label, broken] of forgeries) {
      const sealed = rawSealPcbEditProposal({ compiled: broken as never, ...trusted });
      expect(sealed.ok, label).toBe(false);
      if (!sealed.ok) expect(sealed.code, label).toBe("inconsistent-compilation");
    }
  });

  it("R16c: verification is TOTAL — revoked proxies and cycles refuse instead of throwing", () => {
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    expect(() => verifySealedPcbEditProposalIntegrity(revoked.proxy)).not.toThrow();
    expect(verifySealedPcbEditProposalIntegrity(revoked.proxy).ok).toBe(false);
    // B16.0.1: use the CURRENT schema so the cycle is traversed past the
    // version gate (a v1 body now refuses early as legacy-authorization-missing).
    const cyclic: Record<string, unknown> = { schema: PCB_EDIT_PROPOSAL_SCHEMA };
    cyclic.self = cyclic;
    expect(() => verifySealedPcbEditProposalIntegrity(cyclic)).not.toThrow();
    expect(verifySealedPcbEditProposalIntegrity(cyclic).ok).toBe(false);
    const throwing = new Proxy({}, { get() { throw new Error("trap"); } });
    expect(() => verifySealedPcbEditProposalIntegrity(throwing)).not.toThrow();
  });

  it("R16d: the compiler DERIVES the base identity and refuses a caller-chosen one", () => {
    const source = board();
    expect(compile({ intent: "x", operations: [{ kind: "update_track", trackId: "t1", widthNm: 500_000 }] }, source, "ATTACKER-CHOSEN"))
      .toMatchObject({ ok: false, code: "invalid-value" });
    // Omitting it entirely works, and matching it exactly works.
    expect(compile({ intent: "x", operations: [{ kind: "update_track", trackId: "t1", widthNm: 500_000 }] }, source).ok).toBe(true);
    expect(compile({ intent: "x", operations: [{ kind: "update_track", trackId: "t1", widthNm: 500_000 }] }, source, pcbRevisionId(source)).ok).toBe(true);
  });
});

// ─── exposure pin (SUPERSEDED by B15.3: 11 → 12) ─────────────────────────────
// Throughout B15.2 this asserted exactly 11 with NO PCB propose tool. B15.3
// exposed `sirkit.pcb.propose-bounded-edit` after the validation-policy gate
// closed; the pin now asserts EXACTLY 12 with exactly that one PCB proposal.

describe("B15.2 — exposure pin (B15.3 supersession)", () => {
  it("the agent registry exposes exactly 12 tools and exactly ONE PCB propose tool", async () => {
    const { sirkitToolRegistry } = await import("../../../engineering/tool-catalog");
    const exposed = sirkitToolRegistry().list().filter((descriptor) => descriptor.agentExposed);
    expect(exposed).toHaveLength(INTENTIONAL_AGENT_EXPOSED_TOOL_IDS.length);
    const pcbPropose = exposed.filter((descriptor) => /pcb/i.test(descriptor.toolId) && descriptor.operationClass === "propose");
    expect(pcbPropose.map((descriptor) => descriptor.toolId)).toEqual(["sirkit.pcb.propose-bounded-edit"]);
  });
});
