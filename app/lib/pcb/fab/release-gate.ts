import JSZip from "jszip";
import type { AutonomousCapabilityEvaluation, AutonomousDesignDeclaration } from "../autonomous/capability-profile";
import { evaluateAutonomousCapability } from "../autonomous/capability-profile";
import { verifyAutorouteCandidate } from "../autoroute/verification";
import type { DrcPreset } from "../drc/types";
import type { PcbNetlist } from "../netlist-bridge";
import { buildPlacementProblem } from "../placement/problem";
import { validatePlacementCandidate } from "../placement/validator";
import { pcbRevisionId } from "../revision";
import type { PcbBoard } from "../types";
import { outlinePolygon, polygonBBox } from "../zones/geometry";
import { zoneFillIsCurrent } from "../zones/fill-lifecycle";
import { emitGerberJob, type JobFileEntry } from "./native/ancillary";
import { compileNativeFabPackage } from "./native/compiler";
import { groupDrills } from "./native/drill";
import { compileManufacturingIr } from "./native/mir";
import { STRICT_NATIVE_RECIPE } from "./native/recipe";
import { createManufacturingSnapshot } from "./native/snapshot";
import { sha256, stableJson, utf8 } from "./native/stable";
import type { ManufacturingIr, NativeFabCompileInput, NativeFabFile } from "./native/types";
import type { FabPreset } from "./types";
import {
  createManufacturingReleaseManifestV1,
  manufacturingRuleProfileDigest,
  type ManufacturingFileRole,
  type ManufacturingReleaseFile,
  type ManufacturingReleaseManifestV1,
  type ManufacturingReleaseMode,
  type ManufacturingRuleProfile,
} from "./release-manifest";
import { extractAndValidateReleaseArchive, validateFabricationFiles, validateReleaseFileSet, type ManufacturingReadbackResult } from "./validate-package";
import type { QualificationComponentAuthority } from "./qualification-authority";
import type { SchematicAuthorityIdentity } from "./qualification-evidence";

const FIXED_ZIP_DATE = new Date("1980-01-01T00:00:00.000Z");
const BARE_RECIPE = Object.freeze({
  ...STRICT_NATIVE_RECIPE,
  id: "sirkit-mfg01-bare-board",
  version: 1,
  includeGerberDrill: false,
  includeComponentLayers: false,
  includePlacement: false,
  includeBom: false,
});

export interface ManufacturingReleaseLocator {
  tenantId: string;
  projectId: string;
  branchId: string;
  designId: string;
  boardId: string;
  expectedBoardRevision: string;
  expectedBoardDigest: string;
}

export interface ManufacturingComponentAuthority {
  bindingRevision: string;
  footprintLibraryRevision: string;
  mappingRevision: string;
  policyRevision: string;
  assemblyVariantRevision: string;
  digest: string;
}

export interface ManufacturingReleaseAuthority {
  schemaVersion: "sirkit.manufacturing-release-authority.v1";
  tenantId: string;
  projectId: string;
  branchId: string;
  designId: string;
  boardId: string;
  boardRevision: string;
  boardDigest: string;
  board: PcbBoard;
  netlist: PcbNetlist;
  schematic: { revision: string; digest: string };
  rc01: { state: "pass"; evidenceId: string; digest: string; boardRevision: string };
  rc02: {
    state: "complete";
    evidenceId: string;
    digest: string;
    boardRevision: string;
    routePassIds: string[];
    remainingConnections: 0;
    shorts: 0;
    routeBlockingDrcErrors: 0;
  };
  rc03: {
    state: "complete";
    evidenceId: string;
    digest: string;
    boardRevision: string;
    boardDigest: string;
    declaration: AutonomousDesignDeclaration;
    capabilityEvaluation: AutonomousCapabilityEvaluation;
  };
  componentAuthority: ManufacturingComponentAuthority;
  /** [B16.1C §D] the exact binding/footprint/mapping/package tuples the component
   *  authority facets were derived from (server-owned, audit evidence). */
  qualificationAuthority?: QualificationComponentAuthority;
  /** [B16.1C §D] the schematic synchronization identity the board was last applied from. */
  schematicAuthority?: SchematicAuthorityIdentity;
  fabPreset: FabPreset;
  drcPreset: DrcPreset;
  manufacturingRuleProfile: ManufacturingRuleProfile;
  releaseMode: ManufacturingReleaseMode;
  sourceDate: string;
  actor: string;
}

export type ManufacturingAuthorityLoader = (locator: ManufacturingReleaseLocator) => Promise<ManufacturingReleaseAuthority | null>;

export interface ManufacturingReleaseArtifact {
  releaseId: string;
  filename: string;
  archiveBytes: Uint8Array;
  archiveSha256: string;
  manifest: ManufacturingReleaseManifestV1;
  files: NativeFabFile[];
  validation: ManufacturingReadbackResult;
}

export class ManufacturingReleaseGateError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "ManufacturingReleaseGateError";
  }
}

export function authoritativeBoardDigest(board: PcbBoard): string {
  return `pcb-authority-${sha256(stableJson(board))}`;
}

export function manufacturingComponentAuthorityDigest(authority: Omit<ManufacturingComponentAuthority, "digest">): string {
  return `component-authority-${sha256(stableJson(authority))}`;
}

function fail(code: string, message: string): never {
  throw new ManufacturingReleaseGateError(code, message);
}

function sourceIdentityMatches(locator: ManufacturingReleaseLocator, source: ManufacturingReleaseAuthority): boolean {
  return (["tenantId", "projectId", "branchId", "designId", "boardId"] as const).every((key) => locator[key] === source[key]);
}

function validateRuleProfile(source: ManufacturingReleaseAuthority, widthNm: number, heightNm: number): void {
  const profile = source.manufacturingRuleProfile;
  const content = Object.fromEntries(Object.entries(profile).filter(([key]) => key !== "digest")) as Omit<ManufacturingRuleProfile, "digest">;
  if (profile.schemaVersion !== "sirkit.manufacturing-rule-profile.v1" || profile.digest !== manufacturingRuleProfileDigest(content)) fail("MFG_RULE_PROFILE_DIGEST_INVALID", "Manufacturing rule profile digest is missing or invalid.");
  if (profile.profileId !== source.fabPreset.id || profile.version !== source.fabPreset.version || profile.manufacturer !== source.fabPreset.fab || profile.manufacturer !== source.drcPreset.fab) fail("MFG_RULE_PROFILE_INCOMPATIBLE", "Manufacturing rule, fabrication, and DRC profile identities differ.");
  if (!profile.evidence.sourceRef || !/^\d{4}-\d{2}-\d{2}$/.test(profile.evidence.verifiedAt)) fail("MFG_RULE_PROFILE_EVIDENCE_MISSING", "Manufacturing profile requires a controlled source and verification date.");
  const ageMs = Date.parse(source.sourceDate) - Date.parse(`${profile.evidence.verifiedAt}T00:00:00.000Z`);
  if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > 366 * 24 * 60 * 60 * 1000) fail("MFG_RULE_PROFILE_STALE", "Manufacturing profile evidence is future-dated or older than one year at release time.");
  if (profile.construction.copperLayers !== 2 || source.board.stackup !== 2 || profile.construction.maxBoardWidthMm * 1_000_000 < widthNm || profile.construction.maxBoardHeightMm * 1_000_000 < heightNm) fail("MFG_RULE_PROFILE_CONSTRUCTION_MISMATCH", "Board construction is outside the explicit two-layer manufacturing profile.");
  const rules = source.drcPreset.rules.default;
  const limits = profile.limitsNm;
  const exact = [
    [limits.minTraceWidth, rules.minTrackWidthNm], [limits.minSpace, rules.clearanceNm], [limits.minDrill, rules.minViaDrillNm],
    [limits.minAnnularRing, rules.minAnnularRingNm], [limits.minCopperToEdge, rules.minEdgeClearanceNm], [limits.minSilkscreenClearance, rules.minSilkPadClearanceNm],
  ];
  if (exact.some(([declared, enforced]) => declared !== enforced) || Object.values(limits).some((value) => !Number.isSafeInteger(value) || value < 0)) fail("MFG_RULE_PROFILE_LIMIT_MISMATCH", "Explicit manufacturing limits do not match the enforced DRC profile.");
  if (profile.maskPolicy.componentPads !== "explicit_or_profile_opening" || profile.maskPolicy.defaultViaTenting !== "tented") fail("MFG_MASK_POLICY_UNSUPPORTED", "MFG01 requires explicit component openings and tented default vias.");
  if (Object.values(profile.specialFeatures).some((value) => value !== "unsupported")) fail("MFG_SPECIAL_FEATURE_POLICY_UNSUPPORTED", "MFG01 does not qualify slots, castellations, edge plating, or flex.");
}

function validateSource(locator: ManufacturingReleaseLocator, source: ManufacturingReleaseAuthority): {
  placement: ReturnType<typeof validatePlacementCandidate>;
  verification: ReturnType<typeof verifyAutorouteCandidate>;
  capability: AutonomousCapabilityEvaluation;
  widthNm: number;
  heightNm: number;
} {
  if (!sourceIdentityMatches(locator, source)) fail("MFG_AUTHORITY_SCOPE_MISMATCH", "Loaded authority does not match the requested tenant/project/branch/design/board scope.");
  const boardRevision = pcbRevisionId(source.board);
  const boardDigest = authoritativeBoardDigest(source.board);
  if (source.boardRevision !== boardRevision || source.boardDigest !== boardDigest || locator.expectedBoardRevision !== boardRevision || locator.expectedBoardDigest !== boardDigest) fail("MFG_AUTHORITY_BOARD_MISMATCH", "Authoritative board revision or digest does not match the requested source.");
  if (!source.schematic.revision || !source.schematic.digest || !source.actor || !Number.isFinite(Date.parse(source.sourceDate))) fail("MFG_AUTHORITY_METADATA_INCOMPLETE", "Schematic, deterministic source date, and actor authority are mandatory.");
  if (source.rc01.state !== "pass" || source.rc01.boardRevision !== boardRevision || !source.rc01.evidenceId || !source.rc01.digest) fail("MFG_RC01_EVIDENCE_INVALID", "RC01 parity evidence is missing or stale.");
  if (source.rc02.state !== "complete" || source.rc02.boardRevision !== boardRevision || source.rc02.remainingConnections !== 0 || source.rc02.shorts !== 0 || source.rc02.routeBlockingDrcErrors !== 0 || !source.rc02.routePassIds.length) fail("MFG_RC02_EVIDENCE_INVALID", "RC02 completion evidence is missing, partial, or stale.");
  if (source.rc03.state !== "complete" || source.rc03.boardRevision !== boardRevision || source.rc03.boardDigest !== boardDigest || source.rc03.capabilityEvaluation.phase !== "post_layout" || source.rc03.capabilityEvaluation.status !== "eligible" || source.rc03.capabilityEvaluation.sourceRevision !== boardRevision) fail("MFG_RC03_EVIDENCE_INVALID", "RC03 post-layout capability evidence is missing or stale.");
  const { digest: componentDigest, ...componentContent } = source.componentAuthority;
  if (componentDigest !== manufacturingComponentAuthorityDigest(componentContent) || Object.values(componentContent).some((value) => !value.trim())) fail("MFG_COMPONENT_AUTHORITY_INVALID", "Component binding/footprint/mapping/policy/variant authority is incomplete.");
  if (source.releaseMode === "assembled_pcb") fail("MFG_ASSEMBLY_AUTHORITY_UNAVAILABLE", "Assembled release is blocked until exact approved MPN, population variant, BOM, placement, and paste authority is available.");
  if (source.board.zones.some((zone) => !zoneFillIsCurrent(source.board, zone))) fail("MFG_ZONE_FILL_STALE", "Every conductive zone must have a current fill proof.");
  if (source.board.vias.some((via) => !(via.layers.includes("copperTop") && via.layers.includes("copperBottom")))) fail("MFG_VIA_SPAN_UNSUPPORTED", "Only full top-to-bottom through-vias are releasable in v1.");
  const outline = outlinePolygon(source.board.outline, 16);
  const bounds = polygonBBox(outline);
  const widthNm = bounds.maxX - bounds.minX;
  const heightNm = bounds.maxY - bounds.minY;
  if (outline.length < 3 || widthNm <= 0 || heightNm <= 0) fail("MFG_OUTLINE_INVALID", "A closed non-zero board outline is required.");
  validateRuleProfile(source, widthNm, heightNm);
  const verification = verifyAutorouteCandidate(source.board, source.drcPreset.rules);
  if (verification.status !== "complete" || verification.remainingConnections !== 0 || verification.shorts !== 0 || verification.routeBlockingDrcErrors !== 0) fail("MFG_FINAL_ELECTRICAL_GATE_FAILED", "Final reconstructed connectivity or DRC is not complete.");
  const problem = buildPlacementProblem({ board: source.board, options: { projectId: source.projectId, mode: "preserve_routed" } });
  const placements = Object.fromEntries(problem.board.footprints.map((footprint) => [footprint.id, { position: { ...footprint.at }, rotationDeg: footprint.rotationDeg as 0 | 90 | 180 | 270, side: footprint.side }]));
  const placement = validatePlacementCandidate(problem, placements);
  if (!placement.legal || placement.overlapCount || placement.outsideCount || placement.padOutsideCount) fail("MFG_FINAL_PLACEMENT_GATE_FAILED", "Final placement is not hard-legal.");
  const capability = evaluateAutonomousCapability({
    board: source.board,
    rules: source.drcPreset.rules,
    declaration: source.rc03.declaration,
    phase: "post_layout",
    expectedSourceRevision: boardRevision,
    evidence: { placement: { legal: placement.legal, overlapCount: placement.overlapCount, outsideCount: placement.outsideCount, padOutsideCount: placement.padOutsideCount }, routing: { complete: true, remainingConnections: 0, shorts: 0, routeBlockingDrcErrors: 0 } },
  });
  if (capability.status !== "eligible" || capability.evaluationDigest !== source.rc03.capabilityEvaluation.evaluationDigest) fail("MFG_RC03_RECOMPUTATION_MISMATCH", "Fresh post-layout capability evaluation differs from authoritative RC03 evidence.");
  return { placement, verification, capability, widthNm, heightNm };
}

function prefixed(snapshot: ReturnType<typeof createManufacturingSnapshot>["snapshot"], basename: string): string {
  const root = snapshot.fabPreset.zipRootFolder?.replace(/^\/+|\/+$/g, "");
  return root ? `${root}/${basename}` : basename;
}

function layerSuffix(snapshot: ReturnType<typeof createManufacturingSnapshot>["snapshot"], layerId: string, sourceLayer?: string): string {
  const preset = snapshot.fabPreset.layerBundle.find((entry) => entry.layerId === sourceLayer);
  if (preset) return preset.fileSuffix;
  if (layerId === "edge") return "-Profile.gbr";
  return `-${layerId}.gbr`;
}

function roleForLayer(id: string): ManufacturingFileRole | undefined {
  return ({ copperTop: "copper_top", copperBottom: "copper_bottom", maskTop: "mask_top", maskBottom: "mask_bottom", silkTop: "silk_top", silkBottom: "silk_bottom", edge: "outline" } as Record<string, ManufacturingFileRole>)[id];
}

function packageFiles(input: NativeFabCompileInput, compiled: Awaited<ReturnType<typeof compileNativeFabPackage>>, mir: ManufacturingIr): { files: NativeFabFile[]; records: ManufacturingReleaseFile[] } {
  const { snapshot } = createManufacturingSnapshot(input);
  const byPath = new Map(compiled.files.map((file) => [file.path, file]));
  const files: NativeFabFile[] = [];
  const records: ManufacturingReleaseFile[] = [];
  const take = (path: string, role: ManufacturingFileRole, metadata: { mirLayerId?: string; drillGroupId?: string } = {}): void => {
    const file = byPath.get(path);
    if (!file || file.bytes.byteLength === 0) fail("MFG_NATIVE_OUTPUT_MISSING", `Native compiler omitted ${role} at ${path}.`);
    files.push(file);
    records.push({ path, role, kind: file.kind as ManufacturingReleaseFile["kind"], mediaType: file.mediaType, bytes: file.bytes.byteLength, sha256: file.sha256, ...metadata });
  };
  // [B16.1C §E] the Gerber job file must describe exactly the members this
  // release ships. The native compiler lists every layer it compiled (for a
  // bare-board release that includes a paste layer the release gate never
  // packages), so the job file is regenerated here from the SHIPPED entries —
  // the independent archive verifier (and any board house) cross-checks it.
  const jobEntries: JobFileEntry[] = [];
  for (const layer of mir.layers) {
    const role = roleForLayer(layer.id);
    if (!role) continue;
    const basename = `${snapshot.boardName}${layerSuffix(snapshot, layer.id, layer.sourceLayer)}`;
    take(prefixed(snapshot, basename), role, { mirLayerId: layer.id });
    jobEntries.push({ path: basename, fileFunction: layer.fileFunction, filePolarity: layer.polarity, fileFormat: "Gerber" });
  }
  for (const group of groupDrills(mir)) {
    const basename = `${snapshot.boardName}-${group.id}.xnc`;
    take(prefixed(snapshot, basename), group.plated ? "pth_drill" : "npth_drill", { drillGroupId: group.id });
    jobEntries.push({ path: basename, fileFunction: group.fileFunction, fileFormat: "XNC" });
  }
  const jobPath = prefixed(snapshot, `${snapshot.boardName}.gbrjob`);
  const jobBytes = utf8(emitGerberJob(snapshot, mir, jobEntries));
  const jobFile: NativeFabFile = { path: jobPath, kind: "job", mediaType: "application/json", bytes: jobBytes, sha256: sha256(jobBytes) };
  files.push(jobFile);
  records.push({ path: jobPath, role: "gerber_job", kind: "job", mediaType: jobFile.mediaType, bytes: jobBytes.byteLength, sha256: jobFile.sha256 });
  const readmePath = prefixed(snapshot, "README.txt");
  const readmeBytes = utf8([
    `${snapshot.boardName} - verified Sirkit MFG01 bare-board package`,
    `Authoritative PCB revision: ${pcbRevisionId(input.board)}`,
    `Manufacturing profile: ${input.maskPolicy?.sourceProfileDigest ?? "missing"}`,
    "Coordinates: millimetres, board lower-left origin, +X right, +Y up; Gerber bottom files use fabrication-view coordinates without viewer mirroring.",
    "No manufacturer upload/order has been performed. External board-house DFM and physical prototype review remain mandatory.",
    "See release-manifest.json for exact provenance, checksums, intentional absences, and limitations.",
    "",
  ].join("\r\n"));
  const readme: NativeFabFile = { path: readmePath, kind: "readme", mediaType: "text/plain", bytes: readmeBytes, sha256: sha256(readmeBytes) };
  files.push(readme);
  records.push({ path: readmePath, role: "readme", kind: "readme", mediaType: readme.mediaType, bytes: readme.bytes.byteLength, sha256: readme.sha256 });
  return { files: files.sort((a, b) => a.path.localeCompare(b.path)), records: records.sort((a, b) => a.path.localeCompare(b.path)) };
}

async function deterministicArchive(files: NativeFabFile[]): Promise<Uint8Array> {
  const zip = new JSZip();
  for (const file of [...files].sort((left, right) => left.path.localeCompare(right.path))) zip.file(file.path, file.bytes, { date: FIXED_ZIP_DATE, createFolders: false, unixPermissions: 0o100644 });
  return zip.generateAsync({ type: "uint8array", compression: "STORE", platform: "UNIX", streamFiles: false });
}

export async function releaseManufacturingPackage(input: { locator: ManufacturingReleaseLocator; loadAuthority: ManufacturingAuthorityLoader }): Promise<ManufacturingReleaseArtifact> {
  const loaded = await input.loadAuthority(input.locator);
  if (!loaded) fail("MFG_AUTHORITY_NOT_FOUND", "No server-authoritative release source exists for this locator.");
  const source = structuredClone(loaded);
  const sourceAuthorityDigest = sha256(stableJson(source));
  const final = validateSource(input.locator, source);
  const nativeInput: NativeFabCompileInput = {
    board: source.board,
    netlist: source.netlist,
    fabPreset: source.fabPreset,
    drcPreset: source.drcPreset,
    boardName: source.boardId,
    recipe: { ...BARE_RECIPE },
    maskPolicy: { schemaVersion: "sirkit.native-mask-policy.v1", defaultComponentPadsOpen: true, defaultExpansionNm: source.manufacturingRuleProfile.limitsNm.solderMaskExpansion, defaultViaTenting: "tented", sourceProfileDigest: source.manufacturingRuleProfile.digest },
    generatedAt: source.sourceDate,
    projectIdentity: `${source.tenantId}/${source.projectId}/${source.branchId}/${source.designId}/${source.boardId}`,
    actor: source.actor,
    releaseDisposition: "verified_manufacturing_release",
  };
  let compiled: Awaited<ReturnType<typeof compileNativeFabPackage>>;
  try {
    compiled = await compileNativeFabPackage(nativeInput);
  } catch (error) {
    const report = (error as { report?: { blockers?: Array<{ code?: string }>; unknowns?: Array<{ code?: string }> } }).report;
    if (report) fail("MFG_FINAL_READINESS_FAILED", `Fresh fabrication readiness denied release: ${[...(report.blockers ?? []), ...(report.unknowns ?? [])].map((item) => item.code).filter(Boolean).join(", ") || "unspecified readiness blocker"}.`);
    throw error;
  }
  const { snapshot, diagnostics } = createManufacturingSnapshot(nativeInput);
  if (diagnostics.some((item) => item.severity === "error")) fail("MFG_SNAPSHOT_FAILED", "Manufacturing snapshot has blocking diagnostics.");
  const mir = compileManufacturingIr(snapshot);
  if (mir.diagnostics.some((item) => item.severity === "error")) fail("MFG_MIR_FAILED", "Manufacturing IR has blocking diagnostics.");
  const packaged = packageFiles(nativeInput, compiled, mir);
  const readback = validateFabricationFiles({ files: packaged.files, records: packaged.records, mir });
  if (!readback.valid) fail("MFG_READBACK_FAILED", readback.issues[0]?.message ?? "Independent readback failed.");
  const platedHoles = mir.drills.filter((drill) => drill.plated).length;
  const nonPlatedHoles = mir.drills.length - platedHoles;
  const absent: ManufacturingReleaseManifestV1["intentionallyAbsent"] = [];
  if (!mir.layers.some((layer) => layer.id === "silkTop" && layer.primitives.length)) absent.push({ role: "silk_top", reason: "Authoritative board contains no top silkscreen geometry." });
  if (!mir.layers.some((layer) => layer.id === "silkBottom" && layer.primitives.length)) absent.push({ role: "silk_bottom", reason: "Authoritative board contains no bottom silkscreen geometry." });
  if (!nonPlatedHoles) absent.push({ role: "npth_drill", reason: "Authoritative MIR contains no non-plated holes." });
  absent.push({ role: "bom", reason: "Bare-board release does not claim assembly authority." }, { role: "placement_top", reason: "Bare-board release does not claim assembly authority." }, { role: "placement_bottom", reason: "Bare-board release does not claim assembly authority." });
  const manifest = createManufacturingReleaseManifestV1({
    schemaVersion: "sirkit.pcb-manufacturing-release.v1",
    digestDefinition: { manifest: "sha256(canonical manifest content with releaseId and manifestContentDigest omitted)", archive: "sha256(final normalized ZIP bytes); returned beside the manifest to avoid a cyclic self-hash" },
    source: { tenantId: source.tenantId, projectId: source.projectId, branchId: source.branchId, designId: source.designId, boardId: source.boardId, boardRevision: source.boardRevision, boardDigest: source.boardDigest, schematicRevision: source.schematic.revision, schematicDigest: source.schematic.digest },
    evidence: {
      rc01: { evidenceId: source.rc01.evidenceId, digest: source.rc01.digest },
      rc02: { evidenceId: source.rc02.evidenceId, digest: source.rc02.digest, routePassIds: source.rc02.routePassIds },
      rc03: { evidenceId: source.rc03.evidenceId, digest: source.rc03.digest, capabilityProfileId: source.rc03.capabilityEvaluation.profileId, capabilityVersion: source.rc03.capabilityEvaluation.profileVersion, evaluationDigest: source.rc03.capabilityEvaluation.evaluationDigest },
      componentAuthority: source.componentAuthority,
    },
    manufacturingProfile: source.manufacturingRuleProfile,
    tools: { exporter: "sirkit-native-fab/1", gerberWriter: "sirkit-gerber-x3/2026.05", excellonWriter: "sirkit-xnc/2021.11", validator: "sirkit-independent-fab-readback/1", archive: "sirkit-normalized-zip/1" },
    releaseMode: source.releaseMode,
    sourceDate: source.sourceDate,
    actor: source.actor,
    board: { widthNm: final.widthNm, heightNm: final.heightNm, copperLayers: 2, material: source.manufacturingRuleProfile.construction.material, boardThicknessMm: source.manufacturingRuleProfile.construction.boardThicknessMm, copperThicknessUm: source.manufacturingRuleProfile.construction.copperThicknessUm },
    counts: { components: source.board.footprints.length, pads: source.board.footprints.reduce((sum, footprint) => sum + footprint.def.pads.length, 0), nets: source.board.nets.filter((net) => net.id !== 0).length, tracks: source.board.tracks.length, vias: source.board.vias.length, zones: source.board.zones.length, platedHoles, nonPlatedHoles, remainingConnections: 0, shorts: 0, blockingDrcErrors: 0 },
    readiness: { readinessReportId: compiled.readiness.reportId, capabilityEvaluationDigest: final.capability.evaluationDigest, placementValidatorVersion: final.placement.validatorVersion, placementLegal: true, validationState: "passed", readbackDigest: readback.readbackDigest, conservationToleranceNm: 0 },
    files: packaged.records,
    intentionallyAbsent: absent,
    limitations: ["Autonomous capability is limited to sirkit.autonomous-pcb-capability.v1.", "Production authentication and multi-user authorization remain deferred.", "Independent readback is an internal format parser, not third-party board-house DFM.", "No first-pass hardware success is guaranteed.", "No manufacturer upload or order was performed."],
  });
  const manifestPath = prefixed(snapshot, "release-manifest.json");
  const manifestBytes = utf8(`${stableJson(manifest, true)}\n`);
  const manifestFile: NativeFabFile = { path: manifestPath, kind: "manifest", mediaType: "application/json", bytes: manifestBytes, sha256: sha256(manifestBytes) };
  const packageValidation = validateReleaseFileSet({ files: packaged.files, manifest, mir });
  if (!packageValidation.valid) fail("MFG_PACKAGE_VALIDATION_FAILED", packageValidation.issues[0]?.message ?? "Package validation failed.");
  const files = [...packaged.files, manifestFile].sort((a, b) => a.path.localeCompare(b.path));
  const archiveBytes = await deterministicArchive(files);
  const extracted = await extractAndValidateReleaseArchive(archiveBytes);
  const extractedCore: NativeFabFile[] = extracted.files.filter((file) => file.path !== extracted.manifestPath).map((file) => {
    const record = manifest.files.find((item) => item.path === file.path)!;
    return { path: file.path, kind: record.kind, mediaType: record.mediaType, bytes: file.bytes, sha256: sha256(file.bytes) };
  });
  const extractedValidation = validateReleaseFileSet({ files: extractedCore, manifest: extracted.manifest, mir });
  if (!extractedValidation.valid || extractedValidation.readbackDigest !== readback.readbackDigest) fail("MFG_EXTRACTED_REVALIDATION_FAILED", "Extracted archive does not conserve the validated manufacturing package.");
  const reloaded = await input.loadAuthority(input.locator);
  if (!reloaded || sha256(stableJson(reloaded)) !== sourceAuthorityDigest || reloaded.boardRevision !== source.boardRevision || reloaded.boardDigest !== source.boardDigest || pcbRevisionId(reloaded.board) !== source.boardRevision || authoritativeBoardDigest(reloaded.board) !== source.boardDigest) fail("MFG_AUTHORITY_CHANGED_DURING_GENERATION", "Server board authority changed during release; no artifact was published.");
  return { releaseId: manifest.releaseId, filename: `${source.boardId}-${source.fabPreset.id}-${manifest.releaseId.slice(-12)}.zip`, archiveBytes, archiveSha256: sha256(archiveBytes), manifest, files, validation: extractedValidation };
}
