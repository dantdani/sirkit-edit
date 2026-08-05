import type { PortableAtomicSnapshot } from "../atomic/types";
import { interfaceDigest, interfaceId } from "./stable";
import type { PinFunctionFactSnapshot, VerifiedPinFunctionFact } from "./types";

export interface Stage5PinFunctionFactRecord {
  recordId: string;
  manufacturerTerminalId: string;
  packagePadId: string;
  logicalPinFunctionId: string;
  alternateFunctionRouteId?: string;
  peripheralClass?: string;
  peripheralInstanceId?: string;
  channelOrLaneId?: string;
  bankId?: string;
  voltageDomainId?: string;
  electricalCapabilities: string[];
  channelCapabilities: string[];
  resourceClaims: string[];
  packageBonded: boolean;
  reserved: boolean;
  errataBlockIds: string[];
  evidenceRefs: string[];
  evidenceState: "source_backed" | "verified" | "inferred" | "conflicting" | "unknown" | "stale";
}

/**
 * Strict adapter from Stage 5 evidence into the CD-4 solver. It never parses a
 * terminal name, symbol label, MPN family, or prose to invent alternate functions.
 */
export function createPinFunctionFactSnapshot(input: { atomic: PortableAtomicSnapshot; packageRevisionId: string; records: Stage5PinFunctionFactRecord[]; errataRevisionIds: string[]; capturedAt: string }): PinFunctionFactSnapshot {
  const atomic = input.atomic; const revision = atomic.atomicRevision;
  if (revision.publicationState !== "published" || !revision.exactPartId || !atomic.exactPart) throw new Error("PIN_FACT_EXACT_PUBLISHED_PART_REQUIRED");
  if (!atomic.footprint || !atomic.mapping || atomic.mapping.state !== "approved" || atomic.mapping.exactPartId !== revision.exactPartId) throw new Error("PIN_FACT_APPROVED_EXACT_MAPPING_REQUIRED");
  if (atomic.mapping.footprintVersionId !== atomic.footprint.versionId || atomic.mapping.symbolVersionId !== atomic.symbol.versionId) throw new Error("PIN_FACT_MAPPING_ASSET_REVISION_MISMATCH");
  const terminalIds = new Set(atomic.mapping.entries.map((entry) => entry.manufacturerTerminalId)); const padIds = new Set(atomic.footprint.pads.map((pad) => pad.id)); const evidenceIds = new Set(atomic.evidence.map((evidence) => evidence.id));
  if (new Set(input.records.map((record) => record.recordId)).size !== input.records.length) throw new Error("PIN_FACT_RECORD_ID_REUSE");
  const facts: VerifiedPinFunctionFact[] = input.records.map((record) => {
    if (!terminalIds.has(record.manufacturerTerminalId) || !padIds.has(record.packagePadId)) throw new Error(`PIN_FACT_TERMINAL_PAD_NOT_IN_EXACT_MAPPING:${record.recordId}`);
    const mappingEntry = atomic.mapping!.entries.find((entry) => entry.manufacturerTerminalId === record.manufacturerTerminalId)!;
    if (!mappingEntry.physicalPadIds.includes(record.packagePadId)) throw new Error(`PIN_FACT_TERMINAL_PAD_MAPPING_MISMATCH:${record.recordId}`);
    if (!record.evidenceRefs.length || record.evidenceRefs.some((id) => !evidenceIds.has(id))) throw new Error(`PIN_FACT_EVIDENCE_INVALID:${record.recordId}`);
    if (!(["source_backed", "verified"] as const).includes(record.evidenceState as "source_backed" | "verified")) throw new Error(`PIN_FACT_EVIDENCE_STATE_REJECTED:${record.recordId}`);
    if (!record.logicalPinFunctionId.trim() || !record.electricalCapabilities.length) throw new Error(`PIN_FACT_FUNCTION_CAPABILITY_REQUIRED:${record.recordId}`);
    return { factId: interfaceId("verified-pin-function-fact", { atomicRevision: revision.id, package: input.packageRevisionId, record }), atomicPartRevisionId: revision.id, exactPartId: revision.exactPartId!, packageRevisionId: input.packageRevisionId, atomicTerminalId: record.manufacturerTerminalId, packagePadId: record.packagePadId, logicalPinFunctionId: record.logicalPinFunctionId, alternateFunctionRouteId: record.alternateFunctionRouteId, peripheralClass: record.peripheralClass, peripheralInstanceId: record.peripheralInstanceId, channelOrLaneId: record.channelOrLaneId, bankId: record.bankId, voltageDomainId: record.voltageDomainId, electricalCapabilities: [...new Set(record.electricalCapabilities)].sort(), channelCapabilities: [...new Set(record.channelCapabilities)].sort(), resourceClaims: [...new Set(record.resourceClaims)].sort(), packageBonded: record.packageBonded, reserved: record.reserved, errataBlockIds: [...new Set(record.errataBlockIds)].sort(), evidenceRefs: [...new Set(record.evidenceRefs)].sort(), evidenceState: record.evidenceState as "source_backed" | "verified" };
  }).sort((a, b) => a.factId.localeCompare(b.factId));
  const base = { snapshotId: interfaceId("pin-function-fact-snapshot", { atomicRevision: revision.id, package: input.packageRevisionId, facts: facts.map((fact) => fact.factId), errata: input.errataRevisionIds.sort() }), atomicPartRevisionId: revision.id, exactPartId: revision.exactPartId, packageRevisionId: input.packageRevisionId, factIds: facts.map((fact) => fact.factId), facts, errataRevisionIds: [...new Set(input.errataRevisionIds)].sort(), sourceDigests: [...new Set(atomic.sourceRecords.map((record) => record.contentHash))].sort(), capturedAt: input.capturedAt };
  return { ...base, deterministicDigest: interfaceDigest(base) };
}

export function validatePinFunctionFactSnapshot(snapshot: PinFunctionFactSnapshot): string[] {
  const errors: string[] = [];
  if (!snapshot.snapshotId || !snapshot.atomicPartRevisionId || !snapshot.exactPartId || !snapshot.packageRevisionId || !snapshot.facts.length) errors.push("PIN_FACT_SNAPSHOT_IDENTITY_INVALID");
  if (snapshot.deterministicDigest !== interfaceDigest({ ...snapshot, deterministicDigest: undefined })) errors.push("PIN_FACT_SNAPSHOT_DIGEST_MISMATCH");
  if (new Set(snapshot.factIds).size !== snapshot.factIds.length || snapshot.factIds.length !== snapshot.facts.length || snapshot.facts.some((fact) => !snapshot.factIds.includes(fact.factId))) errors.push("PIN_FACT_SNAPSHOT_MEMBERSHIP_INVALID");
  if (snapshot.facts.some((fact) => fact.atomicPartRevisionId !== snapshot.atomicPartRevisionId || fact.exactPartId !== snapshot.exactPartId || fact.packageRevisionId !== snapshot.packageRevisionId || !fact.packageBonded || !["source_backed", "verified"].includes(fact.evidenceState) || !fact.evidenceRefs.length)) errors.push("PIN_FACT_SNAPSHOT_UNVERIFIED_FACT");
  return errors.sort();
}

