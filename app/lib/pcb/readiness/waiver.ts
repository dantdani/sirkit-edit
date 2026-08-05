import { canonicalJson } from "../revision";
import { stableHash } from "../smart-routing/hash";
import {
  PCB_FABRICATION_CLAIM,
  READINESS_POLICY_VERSION,
  type ReadinessCheckCode,
  type ReleaseWaiver,
} from "./types";

export interface CreateReleaseWaiverInput {
  checkCodes: ReadinessCheckCode[];
  diagnosticCodes: string[];
  componentIds?: string[];
  netStableIds?: string[];
  objectIds?: string[];
  reason: string;
  actor?: string;
  designRevision: string;
  manufacturingProfileId: string;
  manufacturingProfileVersion: number;
  createdAt?: string;
}

/** Explicit, revision-bound authorization for a non-verified engineering artifact. */
export function createReleaseWaiver(input: CreateReleaseWaiverInput): ReleaseWaiver {
  if (input.reason.trim().length < 8) throw new Error("Engineering override reason must contain at least 8 characters.");
  if (input.checkCodes.length === 0) throw new Error("Engineering override must name at least one readiness check.");
  if (input.diagnosticCodes.length === 0) throw new Error("Engineering override must name the exact diagnostic codes being accepted.");
  const body = {
    schemaVersion: "sirkit.release-waiver.v1" as const,
    claim: PCB_FABRICATION_CLAIM,
    checkCodes: [...new Set(input.checkCodes)].sort(),
    diagnosticCodes: [...new Set(input.diagnosticCodes)].sort(),
    componentIds: [...new Set(input.componentIds ?? [])].sort(),
    netStableIds: [...new Set(input.netStableIds ?? [])].sort(),
    objectIds: [...new Set(input.objectIds ?? [])].sort(),
    reason: input.reason.trim(),
    ...(input.actor ? { actor: input.actor } : {}),
    designRevision: input.designRevision,
    policyVersion: READINESS_POLICY_VERSION,
    manufacturingProfileId: input.manufacturingProfileId,
    manufacturingProfileVersion: input.manufacturingProfileVersion,
    createdAt: input.createdAt ?? new Date().toISOString(),
    permits: "engineering_prototype_export" as const,
    invalidation: "any_semantic_design_change" as const,
  };
  const text = canonicalJson(body);
  return { ...body, id: `waiver1-${stableHash(`a\0${text}`)}${stableHash(`b\0${text}`)}` };
}
