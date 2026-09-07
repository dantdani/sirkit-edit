/**
 * B16.1C §D — real evidence digests for the qualification artifact.
 *
 * Reproduced defect (B16.1C pre-edit probe P6): the persisted authority's
 * rc01/rc02/rc03 `digest` fields were the literal string
 * `sha256:<boardRevision>` and the component-authority facets were synthetic
 * `bindings:<boardRevision>` strings — none of them hashed the evidence they
 * claimed to bind, and the release manifest republished them as if they did.
 *
 * Each helper here hashes the ACTUAL evidence object (canonical JSON, sha256)
 * so a changed parity certificate, a different route pass set, or a different
 * capability evaluation changes the digest — and therefore the release identity.
 */

import type { AutonomousCapabilityEvaluation } from "../autonomous/capability-profile";
import type { AutonomousPlacementAttempt } from "../autonomous/qualify-layout";
import type { buildSchematicParityCertificate } from "../readiness/parity";

type SchematicParityCertificate = ReturnType<typeof buildSchematicParityCertificate>;
import { sha256, stableJson } from "./native/stable";

export function rc01ParityEvidenceDigest(parity: SchematicParityCertificate): string {
  return `parity-${sha256(stableJson(parity))}`;
}

export interface Rc02RouteEvidence {
  candidateId: string;
  candidateRevision: string;
  passIds: string[];
  dsnDigests: string[];
  sesDigests: string[];
  routerVersions: string[];
  remainingConnections: number;
  shorts: number;
  routeBlockingDrcErrors: number;
  vias: number;
  routedLengthNm: number;
}

export function rc02RouteEvidence(attempt: AutonomousPlacementAttempt): Rc02RouteEvidence | null {
  if (!attempt.route) return null;
  return {
    candidateId: attempt.candidateId,
    candidateRevision: attempt.route.candidateRevision,
    passIds: [...attempt.route.passIds].sort(),
    dsnDigests: [...attempt.route.dsnDigests].sort(),
    sesDigests: [...attempt.route.sesDigests].sort(),
    routerVersions: [...attempt.route.routerVersions].sort(),
    remainingConnections: attempt.route.remainingConnections,
    shorts: attempt.route.shorts,
    routeBlockingDrcErrors: attempt.route.routeBlockingDrcErrors,
    vias: attempt.route.vias,
    routedLengthNm: attempt.route.routedLengthNm,
  };
}

export function rc02RouteEvidenceDigest(evidence: Rc02RouteEvidence): string {
  return `route-${sha256(stableJson(evidence))}`;
}

export function rc03CapabilityEvidenceDigest(evaluation: AutonomousCapabilityEvaluation): string {
  // The evaluation already carries a canonical digest; bind it under a
  // distinct prefix so the three RC digests are never confusable.
  return `capability-${sha256(evaluation.evaluationDigest)}`;
}

/** The exact schematic identity the board was last synchronized to. */
export interface SchematicAuthorityIdentity {
  revision: string;
  digest: string;
  planId: string;
  snapshotDigest: string;
}
