/**
 * [B23-B1] A synthetic, internally consistent bare-board release for the B23-B suites: a few small Gerber, Excellon and job files,
 * the README, and a release manifest built by the release's own `createManufacturingReleaseManifestV1`, so its `releaseId` and
 * `manifestContentDigest` derive exactly as a real release's do; the archive bytes are an opaque stand-in whose SHA-256 is the
 * release's `archiveSha256`. The real pinned 555 release is exercised end to end in `b23-b-outbound-package`.
 *
 * Nothing here writes to disk or reaches the network.
 */
import { buildManufacturingRuleProfile, JLCPCB_2L_RULE_PROFILE_EVIDENCE } from "@/app/lib/pcb/fab/rule-profile";
import { createManufacturingReleaseManifestV1, type ManufacturingFileRole, type ManufacturingReleaseFile, type ManufacturingReleaseManifestV1 } from "@/app/lib/pcb/fab/release-manifest";
import { manufacturingReleaseRecordDigest, type ManufacturingReleaseRecord } from "@/app/lib/pcb/fab/release-ledger";
import type { ManufacturingReleaseArtifact } from "@/app/lib/pcb/fab/release-gate";
import type { NativeFabFile } from "@/app/lib/pcb/fab/native/types";
import { sha256, stableJson, utf8 } from "@/app/lib/pcb/fab/native/stable";

export const SYNTHETIC_SCOPE = { tenantId: "tenant-b23", projectId: "proj-b23", branchId: "branch-b23", designId: "design:proj-b23", boardId: "board:proj-b23" } as const;
export const SYNTHETIC_ACTOR = "u-b23-qualifier";
export const SYNTHETIC_BOARD = { revision: "pcb2-b23b1synthetic01", digest: `pcb-authority-${"b".repeat(64)}` } as const;

const NEWLINE = String.fromCharCode(10);
const file = (path: string, kind: NativeFabFile["kind"], mediaType: string, text: string): NativeFabFile => {
  const bytes = utf8(text);
  return { path, kind, mediaType, bytes, sha256: sha256(bytes) };
};

/** The synthetic release's member files (the manifest is added by `syntheticRelease`), each with its manifest role. */
export function syntheticMembers(variant = ""): Array<{ file: NativeFabFile; role: ManufacturingFileRole }> {
  const gerber = (suffix: string, fn: string): string => ["G04 synthetic*", `%TF.FileFunction,${fn}*%`, `%TF.ProjectId,board-proj-b23,00000000-0000-5000-8000-000000000000,${SYNTHETIC_BOARD.revision}*%`, `G04 ${suffix}${variant}*`, "M02*", ""].join(NEWLINE);
  return [
    { role: "copper_top", file: file("gerber/board-proj-b23.GTL", "gerber", "application/vnd.gerber", gerber("top copper", "Copper,L1,Top")) },
    { role: "copper_bottom", file: file("gerber/board-proj-b23.GBL", "gerber", "application/vnd.gerber", gerber("bottom copper", "Copper,L2,Bot")) },
    { role: "mask_top", file: file("gerber/board-proj-b23.GTS", "gerber", "application/vnd.gerber", gerber("top mask", "Soldermask,Top")) },
    { role: "outline", file: file("gerber/board-proj-b23.GML", "gerber", "application/vnd.gerber", gerber("outline", "Profile,NP")) },
    { role: "pth_drill", file: file("gerber/board-proj-b23-pth-1-2.xnc", "xnc", "text/plain", ["M48", "; #@! TF.FileFunction,Plated,1,2,PTH", "METRIC", "%", "M30", ""].join(NEWLINE)) },
    { role: "gerber_job", file: file("gerber/board-proj-b23.gbrjob", "job", "application/json", `${JSON.stringify({ GeneralSpecs: { ProjectId: { Name: "board-proj-b23" } } }, null, 2)}${NEWLINE}`) },
    { role: "readme", file: file("gerber/README.txt", "readme", "text/plain", "board-proj-b23 - verified Sirkit MFG01 bare-board package\r\nNo manufacturer upload/order has been performed.\r\n") },
  ];
}

export type SyntheticRelease = Pick<ManufacturingReleaseArtifact, "releaseId" | "filename" | "archiveBytes" | "archiveSha256" | "manifest" | "files">;

/** A consistent release: manifest records equal the member bytes; `archiveSha256` is the SHA-256 of `archiveBytes`. */
export function syntheticRelease(options: { variant?: string; extraRecords?: ManufacturingReleaseFile[] } = {}): SyntheticRelease {
  const members = syntheticMembers(options.variant ?? "");
  const records: ManufacturingReleaseFile[] = [
    ...members.map(({ file: member, role }) => ({ path: member.path, role, kind: member.kind as ManufacturingReleaseFile["kind"], mediaType: member.mediaType, bytes: member.bytes.byteLength, sha256: member.sha256 })),
    ...(options.extraRecords ?? []),
  ];
  const manifest: ManufacturingReleaseManifestV1 = createManufacturingReleaseManifestV1({
    schemaVersion: "sirkit.pcb-manufacturing-release.v1",
    digestDefinition: { manifest: "sha256(canonical manifest content with releaseId and manifestContentDigest omitted)", archive: "sha256(final normalized ZIP bytes); returned beside the manifest to avoid a cyclic self-hash" },
    source: { ...SYNTHETIC_SCOPE, boardRevision: SYNTHETIC_BOARD.revision, boardDigest: SYNTHETIC_BOARD.digest, schematicRevision: "schematic:b23", schematicDigest: "sha256:schematic-b23" },
    evidence: {
      rc01: { evidenceId: "rc01:b23", digest: "parity-b23" },
      rc02: { evidenceId: "rc02:b23", digest: "route-b23", routePassIds: ["pass-1"] },
      rc03: { evidenceId: "rc03:b23", digest: "capability-b23", capabilityProfileId: "sirkit.autonomous-pcb-capability.v1", capabilityVersion: 1, evaluationDigest: "evaluation-b23" },
      componentAuthority: { bindingRevision: "bindings-b23", footprintLibraryRevision: "footprints-b23", mappingRevision: "mappings-b23", policyRevision: "policy-b23", assemblyVariantRevision: "variant-b23", digest: "component-authority-b23" },
    },
    manufacturingProfile: buildManufacturingRuleProfile({ presetId: "jlcpcb-2l", evidence: JLCPCB_2L_RULE_PROFILE_EVIDENCE }),
    tools: { exporter: "sirkit-native-fab/1", gerberWriter: "sirkit-gerber-x3/2026.05", excellonWriter: "sirkit-xnc/2021.11", validator: "sirkit-independent-fab-readback/1", archive: "sirkit-normalized-zip/1" },
    releaseMode: "bare_pcb",
    sourceDate: "2026-09-09T12:00:00.000Z",
    actor: SYNTHETIC_ACTOR,
    board: { widthNm: 20_000_000, heightNm: 15_000_000, copperLayers: 2, material: "FR-4", boardThicknessMm: 1.6, copperThicknessUm: 35 },
    counts: { components: 3, pads: 6, nets: 2, tracks: 4, vias: 0, zones: 0, platedHoles: 2, nonPlatedHoles: 0, remainingConnections: 0, shorts: 0, blockingDrcErrors: 0 },
    readiness: { readinessReportId: "readiness-b23", capabilityEvaluationDigest: "evaluation-b23", placementValidatorVersion: "placement-b23", placementLegal: true, validationState: "passed", readbackDigest: "readback-b23", conservationToleranceNm: 0 },
    files: records,
    intentionallyAbsent: [{ role: "bom", reason: "Bare-board release does not claim assembly authority." }, { role: "placement_top", reason: "Bare-board release does not claim assembly authority." }, { role: "placement_bottom", reason: "Bare-board release does not claim assembly authority." }],
    limitations: ["No manufacturer upload or order was performed."],
  });
  const manifestFile = file("gerber/release-manifest.json", "manifest", "application/json", `${stableJson(manifest, true)}${NEWLINE}`);
  const archiveBytes = utf8(`synthetic-archive:${manifest.releaseId}:${manifest.manifestContentDigest}`);
  return {
    releaseId: manifest.releaseId,
    filename: `board-proj-b23-jlcpcb-2l-${manifest.releaseId.slice(-12)}.zip`,
    archiveBytes,
    archiveSha256: sha256(archiveBytes),
    manifest,
    files: [...members.map(({ file: member }) => member), manifestFile].sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0)),
  };
}

/** The ledger record the release route writes for `release` (same fields, same digest rule). */
export function syntheticLedgerRecord(release: SyntheticRelease, overrides: Partial<Omit<ManufacturingReleaseRecord, "recordDigest">> = {}): ManufacturingReleaseRecord {
  const base = {
    schemaVersion: "sirkit.manufacturing-release-record.v1" as const,
    releaseId: release.releaseId,
    archiveSha256: release.archiveSha256,
    manifestContentDigest: release.manifest.manifestContentDigest,
    filename: release.filename,
    authorityRecordDigest: "sha256:authority-record-b23",
    authorityRevision: 4,
    boardRevision: SYNTHETIC_BOARD.revision,
    boardDigest: SYNTHETIC_BOARD.digest,
    schematicRevision: "schematic:b23",
    componentAuthorityDigest: "qualification-authority-b23",
    actor: "u-b23-admin",
    releasedAt: "2026-09-09T12:30:00.000Z",
    ...overrides,
  };
  return { ...base, recordDigest: manufacturingReleaseRecordDigest(base) };
}
