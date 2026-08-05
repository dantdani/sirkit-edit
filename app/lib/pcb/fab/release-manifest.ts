import { sha256, stableJson } from "./native/stable";

export type ManufacturingReleaseMode = "bare_pcb" | "assembled_pcb";

export interface ManufacturingRuleProfile {
  schemaVersion: "sirkit.manufacturing-rule-profile.v1";
  profileId: string;
  version: number;
  digest: string;
  manufacturer: string;
  processName: string;
  evidence: { sourceRef: string; verifiedAt: string };
  construction: {
    copperLayers: 2;
    copperThicknessUm: number;
    boardThicknessMm: number;
    material: string;
    maxBoardWidthMm: number;
    maxBoardHeightMm: number;
  };
  limitsNm: {
    minTraceWidth: number;
    minSpace: number;
    minDrill: number;
    minFinishedHole: number;
    minAnnularRing: number;
    minCopperToEdge: number;
    minHoleToEdge: number;
    solderMaskExpansion: number;
    minSolderMaskSliver: number;
    minSilkscreenWidth: number;
    minSilkscreenClearance: number;
  };
  maskPolicy: {
    componentPads: "explicit_or_profile_opening";
    defaultViaTenting: "tented";
  };
  specialFeatures: {
    slots: "unsupported";
    castellations: "unsupported";
    edgePlating: "unsupported";
    flex: "unsupported";
  };
  assembly: { supported: boolean; policyRef?: string };
}

export function manufacturingRuleProfileDigest(profile: Omit<ManufacturingRuleProfile, "digest">): string {
  return `mfg-rule-${sha256(stableJson(profile))}`;
}

export type ManufacturingFileRole =
  | "copper_top"
  | "copper_bottom"
  | "mask_top"
  | "mask_bottom"
  | "silk_top"
  | "silk_bottom"
  | "outline"
  | "pth_drill"
  | "npth_drill"
  | "gerber_job"
  | "readme"
  | "bom"
  | "placement_top"
  | "placement_bottom";

export interface ManufacturingReleaseFile {
  path: string;
  role: ManufacturingFileRole;
  kind: "gerber" | "xnc" | "job" | "readme" | "bom" | "placement";
  mediaType: string;
  bytes: number;
  sha256: string;
  mirLayerId?: string;
  drillGroupId?: string;
}

export interface ManufacturingReleaseManifestV1 {
  schemaVersion: "sirkit.pcb-manufacturing-release.v1";
  releaseId: string;
  manifestContentDigest: string;
  digestDefinition: {
    manifest: "sha256(canonical manifest content with releaseId and manifestContentDigest omitted)";
    archive: "sha256(final normalized ZIP bytes); returned beside the manifest to avoid a cyclic self-hash";
  };
  source: {
    tenantId: string;
    projectId: string;
    branchId: string;
    designId: string;
    boardId: string;
    boardRevision: string;
    boardDigest: string;
    schematicRevision: string;
    schematicDigest: string;
  };
  evidence: {
    rc01: { evidenceId: string; digest: string };
    rc02: { evidenceId: string; digest: string; routePassIds: string[] };
    rc03: { evidenceId: string; digest: string; capabilityProfileId: string; capabilityVersion: number; evaluationDigest: string };
    componentAuthority: {
      bindingRevision: string;
      footprintLibraryRevision: string;
      mappingRevision: string;
      policyRevision: string;
      assemblyVariantRevision: string;
      digest: string;
    };
  };
  manufacturingProfile: ManufacturingRuleProfile;
  tools: {
    exporter: "sirkit-native-fab/1";
    gerberWriter: "sirkit-gerber-x3/2026.05";
    excellonWriter: "sirkit-xnc/2021.11";
    validator: "sirkit-independent-fab-readback/1";
    archive: "sirkit-normalized-zip/1";
  };
  releaseMode: ManufacturingReleaseMode;
  sourceDate: string;
  actor: string;
  board: {
    widthNm: number;
    heightNm: number;
    copperLayers: 2;
    material: string;
    boardThicknessMm: number;
    copperThicknessUm: number;
  };
  counts: {
    components: number;
    pads: number;
    nets: number;
    tracks: number;
    vias: number;
    zones: number;
    platedHoles: number;
    nonPlatedHoles: number;
    remainingConnections: 0;
    shorts: 0;
    blockingDrcErrors: 0;
  };
  readiness: {
    readinessReportId: string;
    capabilityEvaluationDigest: string;
    placementValidatorVersion: string;
    placementLegal: true;
    validationState: "passed";
    readbackDigest: string;
    conservationToleranceNm: number;
  };
  files: ManufacturingReleaseFile[];
  intentionallyAbsent: Array<{ role: ManufacturingFileRole; reason: string }>;
  limitations: string[];
}

type ManifestContent = Omit<ManufacturingReleaseManifestV1, "releaseId" | "manifestContentDigest">;

export function createManufacturingReleaseManifestV1(content: ManifestContent): ManufacturingReleaseManifestV1 {
  const normalized: ManifestContent = {
    ...content,
    evidence: { ...content.evidence, rc02: { ...content.evidence.rc02, routePassIds: [...content.evidence.rc02.routePassIds].sort() } },
    files: [...content.files].sort((left, right) => left.path.localeCompare(right.path)),
    intentionallyAbsent: [...content.intentionallyAbsent].sort((left, right) => left.role.localeCompare(right.role)),
    limitations: [...content.limitations].sort(),
  };
  const manifestContentDigest = `mfg-manifest-${sha256(stableJson(normalized))}`;
  return {
    ...normalized,
    schemaVersion: "sirkit.pcb-manufacturing-release.v1",
    releaseId: `mfg-release-${sha256(`${manifestContentDigest}\0${normalized.source.boardDigest}`).slice(0, 32)}`,
    manifestContentDigest,
  };
}

export function validateManifestContentDigest(manifest: ManufacturingReleaseManifestV1): boolean {
  const manifestContentDigest = manifest.manifestContentDigest;
  const content = Object.fromEntries(Object.entries(manifest).filter(([key]) => key !== "releaseId" && key !== "manifestContentDigest")) as ManifestContent;
  return manifestContentDigest === `mfg-manifest-${sha256(stableJson(content))}`;
}
