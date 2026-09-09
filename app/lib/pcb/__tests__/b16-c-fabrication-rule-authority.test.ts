/**
 * B16-C.4 — Fabrication-rule authority: the via / plated-through-hole
 * annular-ring split and the source-pinned rule profile.
 *
 * Reproduced ambiguity (OD-1): `minAnnularRingMm 0.15` was documented as the
 * VIA ring, checked only on vias, and copied into the release profile as one
 * "minAnnularRing" — while JLCPCB states a separate PTH minimum (recommended
 * 0.25 mm, absolute 0.18 mm). A component pad with a 0.16 mm ring passed DRC,
 * qualification and release. It now fails all three, and the profile a
 * release re-validates carries source URLs, retrieval date, scope and expiry.
 */
import { describe, expect, it } from "vitest";
import { manufacturingConstraintDocument } from "@/app/lib/constraints/manufacturing";
import { DRC_CHECKER_DESCRIPTORS, validateDrcDescriptors } from "@/app/lib/engineering/drc-descriptors";
import { evaluateAutonomousCapability } from "../autonomous/capability-profile";
import { checkPthAnnularRing, checkVia, padAnnularRingNm } from "../drc/checks/geometry";
import { getPreset, PRESETS } from "../drc/presets";
import { buildDrcContext, runDrc } from "../drc/run-drc";
import { MANUFACTURING_PUBLIC_ERRORS } from "../fab/manufacturing-errors";
import { MANUFACTURING_RULE_PROFILE_SCHEMA, manufacturingRuleProfileDigest } from "../fab/release-manifest";
import { buildManufacturingRuleProfile, JLCPCB_2L_RULE_PROFILE_EVIDENCE, QUALIFIED_RULE_PROFILE_IDS, RULE_PROFILE_VALIDITY_DAYS, ruleProfileEvidenceStatus, ruleProfileExpiry } from "../fab/rule-profile";
import { validateNoRuleWeakening } from "../repair/approval-policy";
import { createEmptyBoard, type FootprintDef, type FootprintInstance, type Pad, type PcbBoard } from "../types";
import { mmToNm } from "../units";
import { AUTONOMOUS_GOLDEN_RULES, autonomousGoldenDeclaration, buildAutonomousGoldenBoard } from "./fixtures/autonomous-golden-board";

const JLC = getPreset("jlcpcb-2l");

function thtPad(overrides: Partial<Pad> = {}): Pad {
  return { number: "1", type: "thru_hole", shape: { kind: "circle", radius: mmToNm(0.65) }, at: { x: 0, y: 0 }, rotationDeg: 0, layers: ["copperTop", "copperBottom", "maskTop", "maskBottom"], drill: { diameter: mmToNm(0.98) }, plated: true, ...overrides };
}

function boardWith(pads: Pad[]): PcbBoard {
  const def: FootprintDef = {
    libName: "test", name: "TEST", attributes: { smd: false, throughHole: true, excludeFromPos: false, excludeFromBom: false }, pads, graphics: [],
    courtyardBBox: { minX: mmToNm(-2), minY: mmToNm(-2), maxX: mmToNm(2), maxY: mmToNm(2) }, bodyBBox: { minX: mmToNm(-1), minY: mmToNm(-1), maxX: mmToNm(1), maxY: mmToNm(1) }, models: [], rawSexpr: "",
  };
  const inst: FootprintInstance = { id: "J1", ref: "J1", footprintId: "fp:test", def, at: { x: mmToNm(20), y: mmToNm(20) }, rotationDeg: 0, side: "top", padNets: Object.fromEntries(pads.map((pad, i) => [pad.number, i + 1])) };
  const base = createEmptyBoard();
  return { ...base, outline: { kind: "rect", origin: { x: 0, y: 0 }, width: mmToNm(40), height: mmToNm(40) }, nets: [{ id: 0, name: "" }, ...pads.map((pad, i) => ({ id: i + 1, name: `N${pad.number}` }))], footprints: [inst] };
}

describe("B16-C.4 §reproduction — one shared ring passed an unmanufacturable plated hole", () => {
  it("a 0.16 mm plated-pad ring clears the via limit (0.15 mm) and the via check never looked at pads", () => {
    const board = boardWith([thtPad()]); // (1.30 - 0.98) / 2 = 0.16 mm
    const ctx = buildDrcContext(board, JLC.rules);
    expect(padAnnularRingNm(board.footprints[0].def.pads[0])).toBe(160_000);
    expect(160_000).toBeGreaterThanOrEqual(JLC.rules.default.minAnnularRingNm); // the via rule alone would have accepted this pad
    expect(checkVia(ctx)).toEqual([]); // the pre-split check only ever measured vias
    // CONFIRMED against the live JLCPCB capabilities page (2026-09-09): PTH ring recommended >= 0.25 mm, absolute minimum 0.18 mm.
    expect(JLC.rules.default.minPthAnnularRingNm).toBe(250_000);
    const violations = checkPthAnnularRing(ctx);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ kind: "pthAnnularRing", severity: "error", measuredNm: 160_000, thresholdNm: 250_000, items: [{ kind: "pad", instanceId: "J1", padNumber: "1" }], layer: "copperTop" });
    expect(violations[0].summary).toBe("J1.1 plated-hole ring is 0.16 mm; need ≥ 0.25 mm.");
    const full = runDrc(board, JLC.rules, { presetId: "jlcpcb-2l" });
    expect(full.completedChecks).toContain("pth-annular-ring");
    expect(full.violations.filter((v) => v.kind === "pthAnnularRing")).toHaveLength(1);
    expect(full.stats.perCheck.pthAnnularRing).toBe(1);
  });

  it("a compliant 0.35 mm ring, an NPTH hole and an explicitly unplated pad produce nothing", () => {
    const ok = thtPad({ number: "1", shape: { kind: "circle", radius: mmToNm(0.75) }, drill: { diameter: mmToNm(0.8) } }); // 0.35 mm
    const npth = thtPad({ number: "", type: "np_thru_hole", shape: { kind: "circle", radius: mmToNm(0.55) }, drill: { diameter: mmToNm(1.0) }, plated: false });
    const unplated = thtPad({ number: "3", plated: false });
    expect(checkPthAnnularRing(buildDrcContext(boardWith([ok, npth, unplated]), JLC.rules))).toEqual([]);
  });

  it("the via ring rule is unchanged: a 0.6/0.3 via (0.15 mm ring) still passes and 0.14 mm still fails", () => {
    const base = boardWith([]);
    const via = (size: number, drill: number) => ({ id: "v1", at: { x: mmToNm(10), y: mmToNm(10) }, size, drill, layers: ["copperTop", "copperBottom"] as ["copperTop", "copperBottom"], netId: 0 });
    expect(checkVia(buildDrcContext({ ...base, vias: [via(mmToNm(0.6), mmToNm(0.3))] }, JLC.rules)).filter((v) => v.kind === "annularRing")).toEqual([]);
    expect(checkVia(buildDrcContext({ ...base, vias: [via(mmToNm(0.58), mmToNm(0.3))] }, JLC.rules)).filter((v) => v.kind === "annularRing")).toHaveLength(1);
  });
});

describe("B16-C.4 §pad ring measurement", () => {
  it("circle, rectangle with drill offset, slot, and polygon pads measure the narrowest copper", () => {
    expect(padAnnularRingNm(thtPad({ shape: { kind: "circle", radius: mmToNm(0.8) }, drill: { diameter: mmToNm(1.0) } }))).toBe(300_000);
    expect(padAnnularRingNm(thtPad({ shape: { kind: "rect", width: mmToNm(2.0), height: mmToNm(1.6) }, drill: { diameter: mmToNm(1.0), offset: { x: mmToNm(0.2), y: 0 } } }))).toBe(300_000); // x: 0.5 - 0.2, y: 0.3
    expect(padAnnularRingNm(thtPad({ shape: { kind: "oval", width: mmToNm(2.4), height: mmToNm(1.6) }, drill: { diameter: mmToNm(0.8), width: mmToNm(1.6), height: mmToNm(0.8) } }))).toBe(400_000); // slot: x 0.4, y 0.4
    const square = thtPad({ shape: { kind: "polygon", points: [{ x: -mmToNm(1), y: -mmToNm(1) }, { x: mmToNm(1), y: -mmToNm(1) }, { x: mmToNm(1), y: mmToNm(1) }, { x: -mmToNm(1), y: mmToNm(1) }] }, drill: { diameter: mmToNm(1.0) } });
    expect(padAnnularRingNm(square)).toBe(500_000);
    expect(padAnnularRingNm(thtPad({ shape: { kind: "circle", radius: mmToNm(0.4) }, drill: { diameter: mmToNm(1.0) } }))).toBe(-100_000); // breakout is negative, never clamped
    expect(padAnnularRingNm(thtPad({ type: "smd", drill: undefined }))).toBeNull();
  });
});

describe("B16-C.4 §presets and rule enumerations carry the split", () => {
  it("every preset has a positive PTH ring; only jlcpcb-2l is source-pinned, the others inherit their shared value", () => {
    for (const preset of PRESETS) expect(preset.rules.default.minPthAnnularRingNm, preset.id).toBeGreaterThan(0);
    expect(JLC.version).toBe(2);
    expect(JLC.verifiedAt).toBe("2026-09-09");
    expect(JLC.rules.default.minAnnularRingNm).toBe(150_000);
    for (const id of ["jlcpcb-4l", "pcbway-standard", "oshpark-4l"] as const) expect(getPreset(id).rules.default.minPthAnnularRingNm).toBe(getPreset(id).rules.default.minAnnularRingNm);
    expect([...QUALIFIED_RULE_PROFILE_IDS]).toEqual(["jlcpcb-2l"]);
  });

  it("the manufacturing constraint program compiles a distinct pth_annular_ring constraint", () => {
    const doc = manufacturingConstraintDocument(boardWith([thtPad()]), JLC);
    const pth = doc.constraints.filter((c) => c.kind === "pth_annular_ring");
    const via = doc.constraints.filter((c) => c.kind === "annular_ring");
    expect(pth.map((c) => c.requirement)).toEqual([{ form: "minimum", value: { dimension: "length", value: "250000", unit: "nm" } }]);
    expect(via.map((c) => c.requirement)).toEqual([{ form: "minimum", value: { dimension: "length", value: "150000", unit: "nm" } }]);
    expect(pth[0].id).toBe("manufacturing:jlcpcb-2l:v2:default:minPthAnnularRingNm");
  });

  it("the DRC checker descriptors cover the new kind exactly once and the repair policy refuses lowering it", () => {
    expect(validateDrcDescriptors()).toEqual([]);
    expect(DRC_CHECKER_DESCRIPTORS.find((d) => d.kinds.includes("pthAnnularRing"))?.fullEvaluator).toBe("checkPthAnnularRing");
    const weakened = structuredClone(JLC.rules); weakened.default.minPthAnnularRingNm = 180_000;
    expect(validateNoRuleWeakening(JLC.rules, weakened)).toEqual(["Repair policy forbids lowering default minPthAnnularRingNm."]);
  });
});

describe("B16-C.4 §source-pinned rule profile", () => {
  it("builds a v2 profile whose limits equal the enforced preset and whose evidence carries URL, retrieval, scope and expiry", () => {
    const profile = buildManufacturingRuleProfile({ presetId: "jlcpcb-2l", evidence: JLCPCB_2L_RULE_PROFILE_EVIDENCE });
    expect(profile.schemaVersion).toBe(MANUFACTURING_RULE_PROFILE_SCHEMA);
    expect(profile).toMatchObject({ profileId: "jlcpcb-2l", version: 2, manufacturer: "JLCPCB" });
    expect(profile.limitsNm.minViaAnnularRing).toBe(150_000);
    expect(profile.limitsNm.minPthAnnularRing).toBe(250_000);
    expect(profile.evidence.sourceRefs).toEqual(["https://jlcpcb.com/capabilities/pcb-capabilities"]);
    expect(profile.evidence.retrievedAt).toBe("2026-09-09");
    expect(profile.evidence.expiresAt).toBe("2027-09-09");
    expect(ruleProfileExpiry("2026-09-09")).toBe("2027-09-09");
    expect(RULE_PROFILE_VALIDITY_DAYS).toBe(365);
    expect(profile.evidence.scope).toContain("1-2 layer");
    expect(profile.evidence.notes.some((note) => note.includes("absolute minimum 0.18 mm"))).toBe(true);
    const { digest, ...content } = profile;
    expect(digest).toBe(manufacturingRuleProfileDigest(content));
    expect(() => buildManufacturingRuleProfile({ presetId: "pcbway-standard", evidence: JLCPCB_2L_RULE_PROFILE_EVIDENCE })).toThrow(/RULE_PROFILE_NOT_QUALIFIED/);
  });

  it("evidence status is a pure function of the evidence window and the instant", () => {
    const evidence = JLCPCB_2L_RULE_PROFILE_EVIDENCE;
    expect(ruleProfileEvidenceStatus(evidence, "2026-09-09T00:00:00.000Z")).toBe("ok");
    expect(ruleProfileEvidenceStatus(evidence, "2027-09-09T23:59:59.000Z")).toBe("ok"); // the expiry date itself is valid
    expect(ruleProfileEvidenceStatus(evidence, "2027-09-10T00:00:00.000Z")).toBe("expired");
    expect(ruleProfileEvidenceStatus(evidence, "2026-09-08T00:00:00.000Z")).toBe("not_yet_valid");
    expect(ruleProfileEvidenceStatus({ ...evidence, expiresAt: "2028-01-01" }, "2026-10-01T00:00:00.000Z")).toBe("invalid_window");
    expect(ruleProfileEvidenceStatus({ ...evidence, sourceRefs: [] }, "2026-10-01T00:00:00.000Z")).toBe("missing");
    expect(ruleProfileEvidenceStatus({ ...evidence, sourceRefs: ["ftp://nowhere"] }, "2026-10-01T00:00:00.000Z")).toBe("missing");
    expect(ruleProfileEvidenceStatus(undefined, "2026-10-01T00:00:00.000Z")).toBe("missing");
  });

  it("the release refusal catalog names the retired schema and the expiry distinctly (422, bounded)", () => {
    expect(MANUFACTURING_PUBLIC_ERRORS.MFG_RULE_PROFILE_SCHEMA_RETIRED.status).toBe(422);
    expect(MANUFACTURING_PUBLIC_ERRORS.MFG_RULE_PROFILE_EXPIRED.status).toBe(422);
  });
});

describe("B16-C.4 §qualification refuses a footprint below the PTH ring before placement", () => {
  it("RC03 capability evaluation reports CAP_PTH_ANNULAR_RING_BELOW_PROFILE; a compliant golden board stays eligible", () => {
    const golden = buildAutonomousGoldenBoard(3);
    const eligible = evaluateAutonomousCapability({ board: golden, rules: AUTONOMOUS_GOLDEN_RULES, declaration: autonomousGoldenDeclaration() });
    expect(eligible.blockers.map((b) => b.code)).not.toContain("CAP_PTH_ANNULAR_RING_BELOW_PROFILE");
    const narrow = structuredClone(golden);
    narrow.footprints[0].def = { ...narrow.footprints[0].def, pads: narrow.footprints[0].def.pads.map((pad) => ({ ...pad, drill: { diameter: mmToNm(1.18) } })) }; // (1.5 - 1.18) / 2 = 0.16 mm
    const refused = evaluateAutonomousCapability({ board: narrow, rules: AUTONOMOUS_GOLDEN_RULES, declaration: autonomousGoldenDeclaration() });
    const blocker = refused.blockers.find((b) => b.code === "CAP_PTH_ANNULAR_RING_BELOW_PROFILE");
    expect(blocker).toBeDefined();
    expect(blocker?.category).toBe("unsupported");
    expect(blocker?.message).toContain("0.160 mm annular ring");
    expect(refused.status).toBe("unsupported");
    expect(refused.placementMayStart).toBe(false);
  });
});
