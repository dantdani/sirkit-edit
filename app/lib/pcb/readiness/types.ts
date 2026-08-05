import type { EngineeringDiagnostic } from "../integrity";

export const READINESS_REPORT_SCHEMA = "sirkit.pcb-readiness.v1" as const;
export const READINESS_POLICY_VERSION = "pcb-fabrication-checks/1.0.0" as const;
export const PCB_FABRICATION_CLAIM = "PCB_FABRICATION_CHECKS" as const;

export type ReadinessClaim = typeof PCB_FABRICATION_CLAIM;
export type ReadinessState = "ready" | "blocked" | "verification_incomplete" | "stale";
export type ReadinessEvidenceState = "pass" | "fail" | "unknown" | "not_run" | "stale" | "unsupported";
export type ReadinessCheckCode =
  | "IDENTITY_INTEGRITY"
  | "SCHEMATIC_PARITY"
  | "PHYSICAL_ASSIGNMENT"
  | "ELECTRICAL_REALIZATION"
  | "ENGINEERING_CONSTRAINTS"
  | "PCB_DRC"
  | "MANUFACTURING_REPRESENTATION"
  | "EXPORT_PREFLIGHT";

export type ReleaseAction =
  | "interchange_export"
  | "verified_manufacturing_release"
  | "create_engineering_override"
  | "engineering_prototype_export";

export interface NetMembershipMismatch {
  endpointKey: string;
  intendedStableNetId?: string;
  assignedStableNetId?: string;
}

export interface SchematicParityCertificate {
  schemaVersion: "sirkit.schematic-pcb-parity.v1";
  designRevision: string;
  schematicRevision?: string;
  source: "authoritative-netlist" | "unavailable";
  state: "pass" | "fail" | "unknown" | "stale";
  intendedComponents: string[];
  assignedComponents: string[];
  physicalOnlyComponents: string[];
  missingComponents: string[];
  extraComponents: string[];
  intendedEndpoints: string[];
  mappedEndpoints: string[];
  missingEndpoints: string[];
  extraEndpoints: string[];
  ambiguousMappings: string[];
  intendedNets: string[];
  assignedNets: string[];
  missingNets: string[];
  extraNets: string[];
  netMembershipMismatches: NetMembershipMismatch[];
  intentionalNoConnects: string[];
  diagnostics: EngineeringDiagnostic[];
}

export interface ExportPreflightResult {
  schemaVersion: "sirkit.pcb-export-preflight.v1";
  exporter: "kicad-assisted" | "sirkit-native";
  exporterVersion: string;
  designRevision: string;
  manufacturingProfileId: string;
  manufacturingProfileVersion: number;
  state: "pass" | "fail" | "unknown" | "not_run" | "stale" | "unsupported";
  diagnostics: EngineeringDiagnostic[];
}

export interface ReleaseWaiver {
  schemaVersion: "sirkit.release-waiver.v1";
  id: string;
  claim: ReadinessClaim;
  checkCodes: ReadinessCheckCode[];
  diagnosticCodes: string[];
  componentIds: string[];
  netStableIds: string[];
  objectIds: string[];
  reason: string;
  actor?: string;
  designRevision: string;
  policyVersion: string;
  manufacturingProfileId: string;
  manufacturingProfileVersion: number;
  createdAt: string;
  permits: "engineering_prototype_export";
  invalidation: "any_semantic_design_change";
}

export interface ReadinessCheckResult {
  code: ReadinessCheckCode;
  version: string;
  required: true;
  state: ReadinessEvidenceState;
  summary: string;
  designRevision: string;
  sourceIds: string[];
  componentIds: string[];
  netStableIds: string[];
  objectIds: string[];
  diagnostics: EngineeringDiagnostic[];
  suggestedActions: string[];
  waivableForEngineeringExport: boolean;
}

export interface ReadinessEvidenceRefs {
  electricalSchema: string;
  drcSchema: string;
  drcCheckVersion: string;
  paritySchema: string;
  exportPreflightSchema: string;
  exporterVersion: string;
  constraintProgramHash?: string;
  constraintEvaluationHash?: string;
}

export interface ReadinessReport {
  schemaVersion: typeof READINESS_REPORT_SCHEMA;
  reportId: string;
  claim: ReadinessClaim;
  claimVersion: "1";
  claimStatement: string;
  limitations: string[];
  overallState: ReadinessState;
  freshness: "current" | "stale";
  designRevision: string;
  policyVersion: string;
  manufacturingProfileId: string;
  manufacturingProfileVersion: number;
  checks: ReadinessCheckResult[];
  parity: SchematicParityCertificate;
  blockers: EngineeringDiagnostic[];
  unknowns: EngineeringDiagnostic[];
  warnings: EngineeringDiagnostic[];
  waivers: ReleaseWaiver[];
  overrideDisposition: "none" | "available" | "authorized" | "denied";
  evidence: ReadinessEvidenceRefs;
  constraints?: {
    programHash: string;
    evaluationHash: string;
    state: "satisfied" | "blocked" | "verification_incomplete" | "stale";
  };
  permittedActions: ReleaseAction[];
  metrics: {
    requiredConnections: number;
    completedConnections: number;
    remainingConnections: number;
    drcErrors: number;
    drcWarnings: number;
  };
}

export interface ReadinessViewModel {
  claim: ReadinessClaim;
  state: ReadinessState;
  label: string;
  detail: string;
  blockerCount: number;
  unknownCount: number;
  warningCount: number;
  remainingConnections: number;
  reportId: string;
  designRevision: string;
}

export type ReleaseDisposition = "verified_manufacturing_release" | "engineering_prototype_export";

export interface ManufacturingReleaseManifest {
  schemaVersion: "sirkit.manufacturing-release.v1";
  transactionId: string;
  projectIdentity: string;
  disposition: ReleaseDisposition;
  verified: boolean;
  designRevision: string;
  claim: ReadinessClaim;
  readinessState: ReadinessState;
  readinessReportId: string;
  policyVersion: string;
  checkVersions: Array<{ code: ReadinessCheckCode; version: string }>;
  manufacturingProfile: { id: string; version: number };
  exporterVersion: string;
  generatedAt: string;
  actor?: string;
  warnings: string[];
  waiverIds: string[];
  constraintProgramHash?: string;
  constraintEvaluationHash?: string;
  artifacts: Array<{ path: string; kind: string; bytes: number; sha256: string }>;
}
