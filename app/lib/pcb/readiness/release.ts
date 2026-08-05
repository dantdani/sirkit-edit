import type { PcbBoard } from "../types";
import { canonicalJson, pcbRevisionId } from "../revision";
import { stableHash } from "../smart-routing/hash";
import type {
  ManufacturingReleaseManifest,
  ReadinessReport,
  ReleaseDisposition,
} from "./types";

export class ManufacturingReleaseBlockedError extends Error {
  constructor(
    public readonly code: "STALE_READINESS" | "VERIFIED_RELEASE_DENIED" | "ENGINEERING_OVERRIDE_DENIED",
    message: string,
    public readonly report?: ReadinessReport,
  ) {
    super(message);
    this.name = "ManufacturingReleaseBlockedError";
  }
}

export interface PreparedRelease {
  snapshot: PcbBoard;
  report: ReadinessReport;
  disposition: ReleaseDisposition;
}

export interface PrepareReleaseInput {
  board: PcbBoard;
  disposition: ReleaseDisposition;
  evaluate: (snapshot: PcbBoard) => ReadinessReport;
  priorReport?: ReadinessReport;
  currentDesignRevision?: string;
}

/** Captures and re-evaluates one immutable release snapshot at the use boundary. */
export function prepareManufacturingRelease(input: PrepareReleaseInput): PreparedRelease {
  const snapshot = structuredClone(input.board);
  const snapshotRevision = pcbRevisionId(snapshot);
  if (input.priorReport && (input.priorReport.designRevision !== snapshotRevision || input.priorReport.freshness !== "current")) {
    throw new ManufacturingReleaseBlockedError(
      "STALE_READINESS",
      "The earlier readiness badge does not describe this release snapshot; fresh evaluation is required.",
      input.priorReport,
    );
  }
  if (input.currentDesignRevision && input.currentDesignRevision !== snapshotRevision) {
    throw new ManufacturingReleaseBlockedError(
      "STALE_READINESS",
      "The live design changed before the release snapshot was captured.",
    );
  }
  const report = input.evaluate(snapshot);
  if (report.designRevision !== snapshotRevision || report.freshness !== "current") {
    throw new ManufacturingReleaseBlockedError("STALE_READINESS", "Fresh readiness evidence is not bound to the release snapshot.", report);
  }
  if (input.disposition === "verified_manufacturing_release" &&
    !report.permittedActions.includes("verified_manufacturing_release")) {
    throw new ManufacturingReleaseBlockedError(
      "VERIFIED_RELEASE_DENIED",
      `Verified manufacturing release denied: readiness is ${report.overallState}.`,
      report,
    );
  }
  if (input.disposition === "engineering_prototype_export" &&
    !report.permittedActions.includes("engineering_prototype_export")) {
    throw new ManufacturingReleaseBlockedError(
      "ENGINEERING_OVERRIDE_DENIED",
      "Engineering export requires valid revision-bound waivers for every waivable blocking or incomplete check.",
      report,
    );
  }
  return { snapshot, report, disposition: input.disposition };
}

export interface CreateReleaseManifestInput {
  prepared: PreparedRelease;
  projectIdentity: string;
  exporterVersion: string;
  generatedAt: string;
  actor?: string;
  artifacts: Array<{ path: string; kind: string; bytes: number; sha256: string }>;
}

export function createManufacturingReleaseManifest(input: CreateReleaseManifestInput): ManufacturingReleaseManifest {
  const artifacts = [...input.artifacts].sort((a, b) => a.path.localeCompare(b.path));
  const semantic = {
    projectIdentity: input.projectIdentity,
    disposition: input.prepared.disposition,
    designRevision: input.prepared.report.designRevision,
    readinessReportId: input.prepared.report.reportId,
    policyVersion: input.prepared.report.policyVersion,
    manufacturingProfileId: input.prepared.report.manufacturingProfileId,
    manufacturingProfileVersion: input.prepared.report.manufacturingProfileVersion,
    exporterVersion: input.exporterVersion,
    generatedAt: input.generatedAt,
    artifactHashes: artifacts.map((artifact) => `${artifact.path}:${artifact.sha256}`),
    waiverIds: input.prepared.report.waivers.map((waiver) => waiver.id).sort(),
    constraintProgramHash: input.prepared.report.constraints?.programHash,
    constraintEvaluationHash: input.prepared.report.constraints?.evaluationHash,
  };
  const text = canonicalJson(semantic);
  return {
    schemaVersion: "sirkit.manufacturing-release.v1",
    transactionId: `release1-${stableHash(`a\0${text}`)}${stableHash(`b\0${text}`)}`,
    projectIdentity: input.projectIdentity,
    disposition: input.prepared.disposition,
    verified: input.prepared.disposition === "verified_manufacturing_release",
    designRevision: input.prepared.report.designRevision,
    claim: input.prepared.report.claim,
    readinessState: input.prepared.report.overallState,
    readinessReportId: input.prepared.report.reportId,
    policyVersion: input.prepared.report.policyVersion,
    checkVersions: input.prepared.report.checks.map((check) => ({ code: check.code, version: check.version })),
    manufacturingProfile: {
      id: input.prepared.report.manufacturingProfileId,
      version: input.prepared.report.manufacturingProfileVersion,
    },
    exporterVersion: input.exporterVersion,
    generatedAt: input.generatedAt,
    ...(input.actor ? { actor: input.actor } : {}),
    warnings: input.prepared.report.warnings.map((warning) => warning.code).sort(),
    waiverIds: input.prepared.report.waivers.map((waiver) => waiver.id).sort(),
    ...(input.prepared.report.constraints ? {
      constraintProgramHash: input.prepared.report.constraints.programHash,
      constraintEvaluationHash: input.prepared.report.constraints.evaluationHash,
    } : {}),
    artifacts,
  };
}
