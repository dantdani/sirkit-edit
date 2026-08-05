import { selectionDigest, selectionId } from "./stable";
import type { ReconciliationCertificate } from "./types";

export function createReconciliationCertificate(input: Omit<ReconciliationCertificate, "certificateId" | "deterministicDigest"> & { certificateId?: string }): ReconciliationCertificate {
  if (!input.atomicPartRevisionId || !input.exactPackageRevisionId || !input.sourceProblemDigest) throw new Error("CD6_RECONCILIATION_IDENTITY_INCOMPLETE");
  const base = structuredClone({ ...input, exactTerminalOrResourceRefs: [...input.exactTerminalOrResourceRefs].sort(), expandedRoleRequirementIds: [...input.expandedRoleRequirementIds].sort(), blockerIds: [...input.blockerIds].sort(), downstreamObligationIds: [...input.downstreamObligationIds].sort(), certificateId: input.certificateId ?? selectionId("reconciliation", input) });
  return { ...base, deterministicDigest: selectionDigest(base) };
}
export function validateReconciliationCertificate(value: ReconciliationCertificate, expected: { atomicPartRevisionId: string; exactPackageRevisionId: string; kind: ReconciliationCertificate["kind"] }): string[] { const errors: string[] = []; if (value.atomicPartRevisionId !== expected.atomicPartRevisionId || value.exactPackageRevisionId !== expected.exactPackageRevisionId || value.kind !== expected.kind) errors.push("CD6_RECONCILIATION_SCOPE_MISMATCH"); if (!value.sourceProblemDigest || !value.exactTerminalOrResourceRefs.length) errors.push("CD6_RECONCILIATION_PROOF_INCOMPLETE"); if (value.state === "pass" && value.blockerIds.length) errors.push("CD6_RECONCILIATION_PASS_WITH_BLOCKERS"); if (value.deterministicDigest !== selectionDigest({ ...value, deterministicDigest: undefined })) errors.push("CD6_RECONCILIATION_DIGEST_MISMATCH"); return errors.sort(); }
