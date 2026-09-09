import { beforeAll, describe, expect, it } from "vitest";
import JSZip from "jszip";
import { qualifyAutonomousLayout, type AutonomousLayoutQualificationResult } from "../autonomous/qualify-layout";
import { getPreset } from "../drc/presets";
import { getFabPreset } from "../fab/presets";
import {
  authoritativeBoardDigest,
  manufacturingComponentAuthorityDigest,
  releaseManufacturingPackage,
  type ManufacturingReleaseArtifact,
  type ManufacturingReleaseAuthority,
  type ManufacturingReleaseLocator,
} from "../fab/release-gate";
import { compileManufacturingIr } from "../fab/native/mir";
import { STRICT_NATIVE_RECIPE } from "../fab/native/recipe";
import { createManufacturingSnapshot } from "../fab/native/snapshot";
import { sha256 } from "../fab/native/stable";
import { manufacturingRuleProfileDigest, type ManufacturingRuleProfile } from "../fab/release-manifest";
import type { NativeFabCompileInput, NativeFabFile } from "../fab/native/types";
import { extractAndValidateReleaseArchive, releasePathIssue, validateFabricationFiles } from "../fab/validate-package";
import { pcbRevisionId } from "../revision";
import { buildSchematicParityCertificate } from "../readiness/parity";
import { setBoardStackupProfile } from "../stackup";
import type { PcbBoard } from "../types";
import { mmToNm } from "../units";
import {
  AUTONOMOUS_GOLDEN_RULES,
  AUTONOMOUS_GOLDEN_SCOPE,
  AUTONOMOUS_GOLDEN_SOURCE_DATE,
  autonomousGoldenDeclaration,
  autonomousGoldenNetIdentity,
  autonomousGoldenNetlist,
  buildAutonomousGoldenBoard,
  buildAutonomousGoldenManufacturingRuleProfile,
  createAutonomousGoldenRealRouter,
} from "./fixtures/autonomous-golden-board";

function authority(result: AutonomousLayoutQualificationResult): ManufacturingReleaseAuthority {
  if (result.status !== "complete" || !result.selectedBoard || !result.selectedRevision || !result.finalCapability) {
    throw new Error(`RC03 authority is incomplete: ${result.status}`);
  }
  const board = result.selectedBoard;
  const boardRevision = result.selectedRevision;
  const boardDigest = authoritativeBoardDigest(board);
  const selectedAttempt = result.attempts.find((attempt) => attempt.candidateId === result.selectedCandidateId && attempt.decision === "complete");
  if (!selectedAttempt?.route) throw new Error("RC03 selected route evidence is missing");
  const parity = buildSchematicParityCertificate(board, boardRevision, autonomousGoldenNetlist(board));
  expect(parity.state, JSON.stringify(parity.diagnostics)).toBe("pass");
  const componentContent = { bindingRevision: "bindings:rc03:1", footprintLibraryRevision: "footprints:rc03:1", mappingRevision: "mappings:rc01:1", policyRevision: "policy:bare-v1", assemblyVariantRevision: "variant:default:1" };
  return {
    schemaVersion: "sirkit.manufacturing-release-authority.v1", ...AUTONOMOUS_GOLDEN_SCOPE, boardRevision, boardDigest, board, netlist: autonomousGoldenNetlist(board),
    schematic: { revision: "schematic:rc03:1", digest: "sha256:schematic-rc03-golden" },
    rc01: { state: "pass", evidenceId: "r05-rc01:golden", digest: "sha256:rc01-golden", boardRevision },
    rc02: { state: "complete", evidenceId: "r05-rc02:golden", digest: "sha256:rc02-golden", boardRevision, routePassIds: selectedAttempt.route.passIds, remainingConnections: 0, shorts: 0, routeBlockingDrcErrors: 0 },
    rc03: { state: "complete", evidenceId: "r05-rc03:golden", digest: "sha256:rc03-golden", boardRevision, boardDigest, declaration: autonomousGoldenDeclaration(), capabilityEvaluation: result.finalCapability },
    componentAuthority: { ...componentContent, digest: manufacturingComponentAuthorityDigest(componentContent) }, fabPreset: getFabPreset("jlcpcb-2l"), drcPreset: getPreset("jlcpcb-2l"), manufacturingRuleProfile: buildAutonomousGoldenManufacturingRuleProfile(), releaseMode: "bare_pcb", sourceDate: AUTONOMOUS_GOLDEN_SOURCE_DATE, actor: "demo-release-agent",
  };
}

function redigest(profile: ManufacturingRuleProfile): ManufacturingRuleProfile {
  const { digest: _digest, ...content } = profile; void _digest;
  return { ...content, digest: manufacturingRuleProfileDigest(content) };
}

function locator(source: ManufacturingReleaseAuthority): ManufacturingReleaseLocator {
  return { tenantId: source.tenantId, projectId: source.projectId, branchId: source.branchId, designId: source.designId, boardId: source.boardId, expectedBoardRevision: source.boardRevision, expectedBoardDigest: source.boardDigest };
}

function loader(source: ManufacturingReleaseAuthority) {
  return async (): Promise<ManufacturingReleaseAuthority> => structuredClone(source);
}

function reseal(source: ManufacturingReleaseAuthority, board: PcbBoard): ManufacturingReleaseAuthority {
  const next = structuredClone(source);
  next.board = board;
  next.netlist = autonomousGoldenNetlist(board);
  next.boardRevision = pcbRevisionId(board);
  next.boardDigest = authoritativeBoardDigest(board);
  next.rc01.boardRevision = next.boardRevision;
  next.rc02.boardRevision = next.boardRevision;
  next.rc03.boardRevision = next.boardRevision;
  next.rc03.boardDigest = next.boardDigest;
  next.rc03.capabilityEvaluation.sourceRevision = next.boardRevision;
  return next;
}

let source: ManufacturingReleaseAuthority;
let exactRc03Result: AutonomousLayoutQualificationResult;
let artifactA: ManufacturingReleaseArtifact;

beforeAll(async () => {
  const initial = buildAutonomousGoldenBoard();
  const initialBefore = structuredClone(initial);
  const router = await createAutonomousGoldenRealRouter();
  let commits = 0;
  exactRc03Result = await qualifyAutonomousLayout({
    board: initial,
    rules: AUTONOMOUS_GOLDEN_RULES,
    declaration: autonomousGoldenDeclaration(),
    router,
    seeds: [101, 202, 303],
    placementCandidateCount: 3,
    routedCandidateLimit: 2,
    maxRuntimeMs: 180_000,
    runLabel: "mfg01-u01-exact-authority",
    commitSelected: async (request) => {
      commits += 1;
      return { ok: true, committedRevision: pcbRevisionId(request.board) };
    },
  });
  expect(exactRc03Result.status, JSON.stringify(exactRc03Result.blockers)).toBe("complete");
  expect(commits).toBe(1);
  expect(initial).toEqual(initialBefore);
  source = authority(exactRc03Result);
}, 240_000);

describe("MFG01 authoritative manufacturing release", () => {
  it("reproduces the legacy handwritten-ID mismatch and proves the shared source is canonical", () => {
    const corrected = buildAutonomousGoldenBoard();
    const legacy = structuredClone(corrected);
    for (const net of legacy.nets) if (net.id !== 0) net.stableId = `net:peripheral:${net.id}`;
    const legacyParity = buildSchematicParityCertificate(legacy, pcbRevisionId(legacy), autonomousGoldenNetlist(corrected));
    expect(legacyParity.state).toBe("fail");
    expect(legacyParity.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(expect.arrayContaining(["NET_MEMBERSHIP_MISMATCH", "STABLE_NET_SET_MISMATCH"]));
    const canonicalParity = buildSchematicParityCertificate(corrected, pcbRevisionId(corrected), autonomousGoldenNetlist(corrected));
    expect(canonicalParity.state, JSON.stringify(canonicalParity.diagnostics)).toBe("pass");
    expect(autonomousGoldenNetIdentity(exactRc03Result.selectedBoard!)).toEqual(autonomousGoldenNetIdentity(corrected));
  });

  it("proves generation/readback/conservation/reproducibility from the exact corrected RC03 authority", async () => {
    artifactA = await releaseManufacturingPackage({ locator: locator(source), loadAuthority: loader(source) });
    const artifactB = await releaseManufacturingPackage({ locator: locator(source), loadAuthority: loader(source) });
    expect(artifactA.archiveBytes).toEqual(artifactB.archiveBytes);
    expect(artifactA.archiveSha256).toBe(artifactB.archiveSha256);
    expect(artifactA.manifest.manifestContentDigest).toBe(artifactB.manifest.manifestContentDigest);
    expect(artifactA.validation).toMatchObject({ valid: true, expectedDrills: 15, parsedDrills: 15 });
    expect(artifactA.manifest.files.map((file) => file.role)).toEqual(expect.arrayContaining(["copper_top", "copper_bottom", "mask_top", "mask_bottom", "outline", "pth_drill", "gerber_job", "readme"]));
    expect(artifactA.manifest.intentionallyAbsent.map((item) => item.role)).toEqual(expect.arrayContaining(["npth_drill", "bom", "placement_top", "placement_bottom"]));
    expect(artifactA.manifest.releaseMode).toBe("bare_pcb");
    const extracted = await extractAndValidateReleaseArchive(artifactA.archiveBytes);
    expect(extracted.manifest.releaseId).toBe(artifactA.releaseId);
    expect(extracted.files).toHaveLength(artifactA.files.length);
    console.log("MFG01_GOLDEN_PACKAGE", JSON.stringify({ releaseId: artifactA.releaseId, rc03RunId: exactRc03Result.runId, selectedCandidateId: exactRc03Result.selectedCandidateId, stableNetIdentityDigest: autonomousGoldenNetIdentity(source.board).digest, capabilityEvaluationDigest: source.rc03.capabilityEvaluation.evaluationDigest, boardRevision: source.boardRevision, boardDigest: source.boardDigest, manifestDigest: artifactA.manifest.manifestContentDigest, archiveSha256: artifactA.archiveSha256, files: artifactA.files.map((file) => ({ path: file.path, kind: file.kind, bytes: file.bytes.byteLength, sha256: file.sha256 })), readbackDigest: artifactA.validation.readbackDigest, gerber: artifactA.validation.gerber, drills: artifactA.validation.drills }));
  }, 120_000);

  it("blocks local, stale, invalid, unsupported, and assembly sources without an artifact", async () => {
    await expect(releaseManufacturingPackage({ locator: locator(source), loadAuthority: async () => null })).rejects.toMatchObject({ code: "MFG_AUTHORITY_NOT_FOUND" });
    await expect(releaseManufacturingPackage({ locator: { ...locator(source), expectedBoardRevision: "pcb2-local" }, loadAuthority: loader(source) })).rejects.toMatchObject({ code: "MFG_AUTHORITY_BOARD_MISMATCH" });
    const assembled = structuredClone(source); assembled.releaseMode = "assembled_pcb";
    await expect(releaseManufacturingPackage({ locator: locator(assembled), loadAuthority: loader(assembled) })).rejects.toMatchObject({ code: "MFG_ASSEMBLY_AUTHORITY_UNAVAILABLE" });
    const badRule = structuredClone(source); badRule.manufacturingRuleProfile.digest = "mfg-rule-corrupt";
    await expect(releaseManufacturingPackage({ locator: locator(badRule), loadAuthority: loader(badRule) })).rejects.toMatchObject({ code: "MFG_RULE_PROFILE_DIGEST_INVALID" });
    // [B16-C.4] a pre-split (v1) profile is refused distinctly from a corrupt digest; expired evidence and a PTH limit that drifted from the enforced preset are refused too.
    const retired = structuredClone(source); (retired.manufacturingRuleProfile as unknown as { schemaVersion: string }).schemaVersion = "sirkit.manufacturing-rule-profile.v1";
    await expect(releaseManufacturingPackage({ locator: locator(retired), loadAuthority: loader(retired) })).rejects.toMatchObject({ code: "MFG_RULE_PROFILE_SCHEMA_RETIRED" });
    const expired = structuredClone(source); expired.manufacturingRuleProfile = redigest({ ...expired.manufacturingRuleProfile, evidence: { ...expired.manufacturingRuleProfile.evidence, retrievedAt: "2025-07-01", expiresAt: "2026-07-01" } });
    await expect(releaseManufacturingPackage({ locator: locator(expired), loadAuthority: loader(expired) })).rejects.toMatchObject({ code: "MFG_RULE_PROFILE_EXPIRED" });
    const pthDrift = structuredClone(source); pthDrift.manufacturingRuleProfile = redigest({ ...pthDrift.manufacturingRuleProfile, limitsNm: { ...pthDrift.manufacturingRuleProfile.limitsNm, minPthAnnularRing: 180_000 } });
    await expect(releaseManufacturingPackage({ locator: locator(pthDrift), loadAuthority: loader(pthDrift) })).rejects.toMatchObject({ code: "MFG_RULE_PROFILE_LIMIT_MISMATCH" });
    const fourBoard = structuredClone(source.board); setBoardStackupProfile(fourBoard, "signal-plane-4");
    const four = reseal(source, fourBoard);
    await expect(releaseManufacturingPackage({ locator: locator(four), loadAuthority: loader(four) })).rejects.toMatchObject({ code: "MFG_RULE_PROFILE_CONSTRUCTION_MISMATCH" });
    const open = structuredClone(source.board); open.tracks = open.tracks.slice(1);
    const unrouted = reseal(source, open);
    await expect(releaseManufacturingPackage({ locator: locator(unrouted), loadAuthority: loader(unrouted) })).rejects.toMatchObject({ code: "MFG_FINAL_ELECTRICAL_GATE_FAILED" });
    const invalidOutline = structuredClone(source.board); invalidOutline.outline = { kind: "rect", origin: { x: 0, y: 0 }, width: 0, height: mmToNm(32) };
    const outline = reseal(source, invalidOutline);
    await expect(releaseManufacturingPackage({ locator: locator(outline), loadAuthority: loader(outline) })).rejects.toMatchObject({ code: "MFG_OUTLINE_INVALID" });
    const staleZoneBoard = structuredClone(source.board); staleZoneBoard.zones.push({ id: "stale", layer: "copperTop", netId: 1, polygon: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }], appearance: "solid", connection: "solid", fill: [], dirty: true });
    const staleZone = reseal(source, staleZoneBoard);
    await expect(releaseManufacturingPackage({ locator: locator(staleZone), loadAuthority: loader(staleZone) })).rejects.toMatchObject({ code: "MFG_ZONE_FILL_STALE" });
  });

  it("detects Gerber, drill, checksum, mapping, archive, and path corruption", async () => {
    expect(artifactA).toBeTruthy();
    const nativeInput: NativeFabCompileInput = { board: source.board, netlist: source.netlist, fabPreset: source.fabPreset, drcPreset: source.drcPreset, boardName: source.boardId, recipe: { ...STRICT_NATIVE_RECIPE, id: "sirkit-mfg01-bare-board", includeGerberDrill: false, includeComponentLayers: false, includePlacement: false, includeBom: false }, maskPolicy: { schemaVersion: "sirkit.native-mask-policy.v1", defaultComponentPadsOpen: true, defaultExpansionNm: source.manufacturingRuleProfile.limitsNm.solderMaskExpansion, defaultViaTenting: "tented", sourceProfileDigest: source.manufacturingRuleProfile.digest }, generatedAt: AUTONOMOUS_GOLDEN_SOURCE_DATE };
    const { snapshot } = createManufacturingSnapshot(nativeInput);
    const mir = compileManufacturingIr(snapshot);
    const core = artifactA.files.filter((file) => file.kind !== "manifest");
    const gerber = core.find((file) => file.kind === "gerber")!;
    const truncatedBytes = new TextEncoder().encode(new TextDecoder().decode(gerber.bytes).replace(/M02\*\s*$/, ""));
    const truncated: NativeFabFile[] = core.map((file) => file.path === gerber.path ? { ...file, bytes: truncatedBytes, sha256: sha256(truncatedBytes) } : file);
    expect(validateFabricationFiles({ files: truncated, records: artifactA.manifest.files, mir }).issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: "GERBER_PARSE_ERROR" })]));
    const drill = core.find((file) => file.kind === "xnc")!;
    const changedDrillBytes = new TextEncoder().encode(new TextDecoder().decode(drill.bytes).replace(/M30\s*$/, ""));
    const changedDrill: NativeFabFile[] = core.map((file) => file.path === drill.path ? { ...file, bytes: changedDrillBytes, sha256: sha256(changedDrillBytes) } : file);
    expect(validateFabricationFiles({ files: changedDrill, records: artifactA.manifest.files, mir }).issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: "XNC_PARSE_ERROR" })]));
    const swapped = artifactA.manifest.files.map((record) => record.role === "copper_top" ? { ...record, mirLayerId: "copperBottom" } : record);
    expect(validateFabricationFiles({ files: core, records: swapped, mir }).valid).toBe(false);
    const zip = await JSZip.loadAsync(artifactA.archiveBytes);
    zip.file(gerber.path, "G04 corrupted*\nM02*\n");
    const corruptArchive = await zip.generateAsync({ type: "uint8array", compression: "STORE" });
    await expect(extractAndValidateReleaseArchive(corruptArchive)).rejects.toThrow("MFG_ARCHIVE_CHECKSUM_MISMATCH");
    const missingZip = await JSZip.loadAsync(artifactA.archiveBytes); missingZip.remove(drill.path);
    await expect(extractAndValidateReleaseArchive(await missingZip.generateAsync({ type: "uint8array", compression: "STORE" }))).rejects.toThrow("MFG_ARCHIVE_FILE_MISSING");
    expect(releasePathIssue("../escape.gbr")).toContain("parent");
    expect(releasePathIssue("C:/escape.gbr")).toContain("absolute");
  });

  it("rechecks authority immediately before publication and returns no stale package", async () => {
    let loads = 0;
    const changed = structuredClone(source); changed.boardDigest = "pcb-authority-changed";
    await expect(releaseManufacturingPackage({ locator: locator(source), loadAuthority: async () => structuredClone(++loads === 1 ? source : changed) })).rejects.toMatchObject({ code: "MFG_AUTHORITY_CHANGED_DURING_GENERATION" });
    expect(loads).toBe(2);
  });
});
