import { describe, expect, it } from "vitest";
import { pcbRevisionId } from "../revision";
import { buildSchematicParityCertificate } from "../readiness/parity";
import { stableHash } from "../smart-routing/hash";
import { setBoardStackupProfile } from "../stackup";
import type { PcbBoard } from "../types";
import { mmToNm } from "../units";
import {
  AUTONOMOUS_PCB_CAPABILITY_PROFILE_V1,
  capabilityEvaluationIsCurrent,
  evaluateAutonomousCapability,
  type AutonomousDesignDeclaration,
} from "../autonomous/capability-profile";
import { qualifyAutonomousLayout, type AutonomousRouteExecution, type AutonomousRouteExecutor } from "../autonomous/qualify-layout";
import {
  AUTONOMOUS_GOLDEN_FOOTPRINT_ID,
  AUTONOMOUS_GOLDEN_RULES,
  autonomousGoldenDeclaration,
  autonomousGoldenNetIdentity,
  autonomousGoldenNetlist,
  buildAutonomousGoldenBoard,
  createAutonomousGoldenRealRouter,
} from "./fixtures/autonomous-golden-board";

describe("Autonomous PCB Capability Profile v1", () => {
  it("qualifies the exact low-speed two-layer envelope and enforces measured limits", () => {
    const board = buildAutonomousGoldenBoard();
    const evaluation = evaluateAutonomousCapability({ board, rules: AUTONOMOUS_GOLDEN_RULES, declaration: autonomousGoldenDeclaration() });
    expect(evaluation).toMatchObject({ status: "eligible", profileId: "sirkit.autonomous-pcb-capability.v1", placementMayStart: true, autoroutingMayStart: false });
    expect(evaluation.counts).toEqual({ components: 15, pads: 15, nets: 5, requiredConnections: 10 });
    expect(capabilityEvaluationIsCurrent(evaluation, board)).toBe(true);

    const boundary = structuredClone(board);
    boundary.outline = { kind: "rect", origin: { x: 0, y: 0 }, width: AUTONOMOUS_PCB_CAPABILITY_PROFILE_V1.limits.maxBoardWidthNm, height: AUTONOMOUS_PCB_CAPABILITY_PROFILE_V1.limits.maxBoardHeightNm };
    expect(evaluateAutonomousCapability({ board: boundary, rules: AUTONOMOUS_GOLDEN_RULES, declaration: autonomousGoldenDeclaration() }).status).toBe("eligible");
    if (boundary.outline.kind !== "rect") throw new Error("fixture outline changed");
    boundary.outline.width += 1;
    expect(evaluateAutonomousCapability({ board: boundary, rules: AUTONOMOUS_GOLDEN_RULES, declaration: autonomousGoldenDeclaration() }).blockers.map((item) => item.code)).toContain("CAP_BOARD_LIMIT_EXCEEDED");

    const overCount = buildAutonomousGoldenBoard(26);
    expect(evaluateAutonomousCapability({ board: overCount, rules: AUTONOMOUS_GOLDEN_RULES, declaration: autonomousGoldenDeclaration() }).blockers.map((item) => item.code)).toContain("CAP_COUNT_LIMIT_EXCEEDED");
  });

  it("fails closed for missing/unknown risk authority and stale revisions", () => {
    const board = buildAutonomousGoldenBoard();
    expect(evaluateAutonomousCapability({ board, rules: AUTONOMOUS_GOLDEN_RULES }).status).toBe("incomplete_authority");
    expect(evaluateAutonomousCapability({ board, rules: AUTONOMOUS_GOLDEN_RULES, declaration: autonomousGoldenDeclaration({ electricalClass: "unknown" }) }).status).toBe("incomplete_authority");
    expect(evaluateAutonomousCapability({ board, rules: AUTONOMOUS_GOLDEN_RULES, declaration: autonomousGoldenDeclaration(), expectedSourceRevision: "pcb2-stale" }).status).toBe("invalid");
    const evaluation = evaluateAutonomousCapability({ board, rules: AUTONOMOUS_GOLDEN_RULES, declaration: autonomousGoldenDeclaration() });
    const changed = structuredClone(board);
    if (changed.outline.kind !== "rect") throw new Error("fixture outline changed");
    changed.outline.width += 1;
    expect(capabilityEvaluationIsCurrent(evaluation, changed)).toBe(false);
  });

  it("blocks four-layer/plane, non-through via, BGA/HDI, high-speed/RF/high-voltage, flex, thermal, and missing critical metadata", () => {
    const cases: Array<{ board: PcbBoard; declaration: AutonomousDesignDeclaration; code: string }> = [];
    const four = buildAutonomousGoldenBoard();
    setBoardStackupProfile(four, "signal-plane-4");
    cases.push({ board: four, declaration: autonomousGoldenDeclaration(), code: "CAP_TWO_LAYER_SIGNAL_STACKUP_REQUIRED" });
    const blind = buildAutonomousGoldenBoard();
    blind.vias.push({ id: "blind", at: { x: mmToNm(10), y: mmToNm(10) }, size: mmToNm(0.8), drill: mmToNm(0.4), netId: 1, layers: ["copperTop", "in1"] });
    cases.push({ board: blind, declaration: autonomousGoldenDeclaration(), code: "CAP_VIA_TYPE_UNSUPPORTED" });
    cases.push({ board: buildAutonomousGoldenBoard(), declaration: autonomousGoldenDeclaration({ footprintQualifications: { [AUTONOMOUS_GOLDEN_FOOTPRINT_ID]: { packageClass: "bga_hdi", authority: "proven" } } }), code: "CAP_PACKAGE_UNSUPPORTED" });
    cases.push({ board: buildAutonomousGoldenBoard(), declaration: autonomousGoldenDeclaration({ electricalClass: "high_speed" }), code: "CAP_ELECTRICAL_CLASS_UNSUPPORTED" });
    cases.push({ board: buildAutonomousGoldenBoard(), declaration: autonomousGoldenDeclaration({ electricalClass: "rf" }), code: "CAP_ELECTRICAL_CLASS_UNSUPPORTED" });
    cases.push({ board: buildAutonomousGoldenBoard(), declaration: autonomousGoldenDeclaration({ electricalClass: "high_voltage", safetyClass: "mains_or_safety_critical" }), code: "CAP_SAFETY_CLASS_UNSUPPORTED" });
    cases.push({ board: buildAutonomousGoldenBoard(), declaration: autonomousGoldenDeclaration({ construction: "flex_rigid_flex" }), code: "CAP_CONSTRUCTION_UNSUPPORTED" });
    cases.push({ board: buildAutonomousGoldenBoard(), declaration: autonomousGoldenDeclaration({ currentThermalClass: "high_current_or_thermal_critical" }), code: "CAP_THERMAL_CLASS_UNSUPPORTED" });
    cases.push({ board: buildAutonomousGoldenBoard(), declaration: autonomousGoldenDeclaration({ criticalPlacement: { status: "required_but_missing", constraintIds: [] } }), code: "CAP_CRITICAL_PLACEMENT_METADATA_MISSING" });
    cases.push({ board: buildAutonomousGoldenBoard(), declaration: autonomousGoldenDeclaration({ criticalPlacement: { status: "fully_declared", constraintIds: ["constraint-not-in-active-program"] } }), code: "CAP_CRITICAL_PLACEMENT_CONSTRAINT_STALE" });
    for (const item of cases) expect(evaluateAutonomousCapability({ board: item.board, rules: AUTONOMOUS_GOLDEN_RULES, declaration: item.declaration }).blockers.map((blocker) => blocker.code), item.code).toContain(item.code);
  });
});

describe("RC03 real no-edit placement-to-routing qualification", () => {
  it("completes three consecutive golden-board runs and fails stale/partial cases without mutation", async () => {
    const source = buildAutonomousGoldenBoard();
    const sourceBefore = structuredClone(source);
    const router = await createAutonomousGoldenRealRouter();
    const sourceIdentity = autonomousGoldenNetIdentity(source);
    const completed: Awaited<ReturnType<typeof qualifyAutonomousLayout>>[] = [];
    let cachedRoute: AutonomousRouteExecution | undefined;
    for (let runIndex = 1; runIndex <= 3; runIndex += 1) {
      let commits = 0;
      let committedBoard: PcbBoard | undefined;
      const observingRouter: AutonomousRouteExecutor = async (request) => {
        const result = await router(request);
        cachedRoute ??= result;
        return result;
      };
      const result = await qualifyAutonomousLayout({
        board: source,
        rules: AUTONOMOUS_GOLDEN_RULES,
        declaration: autonomousGoldenDeclaration(),
        router: observingRouter,
        seeds: [101, 202, 303],
        placementCandidateCount: 3,
        routedCandidateLimit: 2,
        maxRuntimeMs: 180_000,
        runLabel: `golden-${runIndex}`,
        commitSelected: async (request) => {
          commits += 1;
          committedBoard = structuredClone(request.board);
          return { ok: true, committedRevision: pcbRevisionId(request.board) };
        },
      });
      if (result.status !== "complete") console.log("RC03_GOLDEN_FAILURE", JSON.stringify({ placement: result.attempts.map((attempt) => ({ candidateId: attempt.candidateId, decision: attempt.decision, placement: attempt.placement, route: attempt.route, rejectionReasons: attempt.rejectionReasons })), blockers: result.blockers }));
      expect(result.status, JSON.stringify(result.blockers)).toBe("complete");
      expect(commits).toBe(1);
      expect(result).toMatchObject({ authorityMutated: true, selectedVerification: { status: "complete", remainingConnections: 0, shorts: 0, routeBlockingDrcErrors: 0 }, finalCapability: { status: "eligible" } });
      expect(result.attempts.filter((attempt) => attempt.decision === "complete").length).toBeGreaterThanOrEqual(1);
      expect(result.attempts.find((attempt) => attempt.decision === "complete")?.placement).toMatchObject({ legal: true, overlapCount: 0, outsideCount: 0, padOutsideCount: 0, protectedStatePreserved: true });
      expect(pcbRevisionId(committedBoard!)).toBe(result.selectedRevision);
      const parity = buildSchematicParityCertificate(result.selectedBoard!, result.selectedRevision!, autonomousGoldenNetlist(result.selectedBoard!));
      expect(parity.state, JSON.stringify(parity.diagnostics)).toBe("pass");
      expect(autonomousGoldenNetIdentity(result.selectedBoard!)).toEqual(sourceIdentity);
      expect(source).toEqual(sourceBefore);
      completed.push(result);
      const attempt = result.attempts.find((item) => item.decision === "complete")!;
      console.log(`RC03_GOLDEN_RUN_${runIndex}`, JSON.stringify({ runId: result.runId, placementCandidateId: result.selectedCandidateId, seed: attempt.seed, stableNetIdentityDigest: sourceIdentity.digest, dsnDigests: attempt.route?.dsnDigests, sesDigests: attempt.route?.sesDigests, routerVersions: attempt.route?.routerVersions, routePasses: attempt.route?.passIds, vias: attempt.route?.vias, routedLengthNm: attempt.route?.routedLengthNm, totalRuntimeMs: result.totalElapsedMs, finalRevision: result.selectedRevision, parityDigest: `parity-${stableHash(JSON.stringify(parity))}`, parityState: parity.state, capabilityEvaluationDigest: result.finalCapability?.evaluationDigest }));
    }
    expect(completed).toHaveLength(3);
    if (!cachedRoute) throw new Error("golden route evidence missing");

    const staleRouter: AutonomousRouteExecutor = async () => ({ ...cachedRoute!, sourceRevision: "pcb2-stale" });
    const stale = await qualifyAutonomousLayout({ board: source, rules: AUTONOMOUS_GOLDEN_RULES, declaration: autonomousGoldenDeclaration(), router: staleRouter, seeds: [101], placementCandidateCount: 1, routedCandidateLimit: 1 });
    expect(stale.status).toBe("blocked");
    expect(stale.authorityMutated).toBe(false);
    expect(source).toEqual(sourceBefore);

    const partialRouter: AutonomousRouteExecutor = async () => ({ ...cachedRoute!, completion: { ...cachedRoute!.completion, status: "blocked" } });
    const partial = await qualifyAutonomousLayout({ board: source, rules: AUTONOMOUS_GOLDEN_RULES, declaration: autonomousGoldenDeclaration(), router: partialRouter, seeds: [101], placementCandidateCount: 1, routedCandidateLimit: 1 });
    expect(partial.status).toBe("blocked");
    expect(partial.authorityMutated).toBe(false);
    expect(source).toEqual(sourceBefore);
  }, 300_000);

  it("blocks unsupported, crowded, missing-critical-metadata, and cancelled designs before mutation", async () => {
    let routerCalls = 0;
    const shouldNotRoute: AutonomousRouteExecutor = async () => {
      routerCalls += 1;
      throw new Error("router should not run");
    };
    const four = buildAutonomousGoldenBoard();
    setBoardStackupProfile(four, "signal-plane-4");
    const unsupported = await qualifyAutonomousLayout({ board: four, rules: AUTONOMOUS_GOLDEN_RULES, declaration: autonomousGoldenDeclaration(), router: shouldNotRoute });
    expect(unsupported.status).toBe("blocked");
    const crowded = buildAutonomousGoldenBoard(26);
    const crowdedBefore = structuredClone(crowded);
    expect((await qualifyAutonomousLayout({ board: crowded, rules: AUTONOMOUS_GOLDEN_RULES, declaration: autonomousGoldenDeclaration(), router: shouldNotRoute })).status).toBe("blocked");
    expect(crowded).toEqual(crowdedBefore);
    const missing = await qualifyAutonomousLayout({ board: buildAutonomousGoldenBoard(), rules: AUTONOMOUS_GOLDEN_RULES, declaration: autonomousGoldenDeclaration({ criticalPlacement: { status: "required_but_missing", constraintIds: [] } }), router: shouldNotRoute });
    expect(missing.status).toBe("blocked");
    const controller = new AbortController();
    controller.abort();
    expect((await qualifyAutonomousLayout({ board: buildAutonomousGoldenBoard(), rules: AUTONOMOUS_GOLDEN_RULES, declaration: autonomousGoldenDeclaration(), router: shouldNotRoute, signal: controller.signal })).status).toBe("cancelled");
    expect(routerCalls).toBe(0);
  });
});
