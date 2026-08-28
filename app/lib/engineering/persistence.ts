import { engineeringDigest, engineeringId } from "./stable";
import type { CanonicalProjectState, DurableTransactionRecord, ProjectPersistenceEnvelope, ProjectRevision } from "./types";

export interface AtomicProjectStore {
  load(projectId: string, branchId: string): Promise<ProjectPersistenceEnvelope | null>;
  initialize(project: CanonicalProjectState, revision: ProjectRevision, buildId: string): Promise<ProjectPersistenceEnvelope>;
  commit(input: { expectedHeadSequence: number; project: CanonicalProjectState; revision: ProjectRevision; record: DurableTransactionRecord; buildId: string }): Promise<ProjectPersistenceEnvelope>;
  backup(projectId: string, branchId: string): Promise<ProjectPersistenceEnvelope>;
  restore(envelope: ProjectPersistenceEnvelope): Promise<ProjectPersistenceEnvelope>;
  /**
   * B06.2 — copy whatever RAW value sits at the project/branch key (valid or
   * corrupt, WITHOUT validation) to a quarantine key so it stays recoverable
   * before a replacement lineage overwrites the primary. Returns true when
   * something was preserved. Quarantine keys are never returned by `load`.
   */
  preserveEnvelope?(projectId: string, branchId: string, label: string): Promise<boolean>;
}

function envelopeKey(projectId: string, branchId: string): string { return `${projectId}\0${branchId}`; }

export function createPersistenceEnvelope(input: { project: CanonicalProjectState; revision: ProjectRevision; transactionLog: DurableTransactionRecord[]; buildId: string; migrationHistory?: ProjectPersistenceEnvelope["migrationHistory"]; lineageId?: string }): ProjectPersistenceEnvelope {
  const snapshotDigest = engineeringDigest(input.project); const logDigest = engineeringDigest(input.transactionLog); const lastRecordDigest = input.transactionLog.at(-1)?.integrityDigest;
  const base = { formatId: "sirkit.project-persistence-envelope.v1" as const, schemaVersion: 1 as const, projectId: input.project.projectId, branchId: input.project.branchId, ...(input.lineageId ? { lineageId: input.lineageId } : {}), canonicalSnapshot: structuredClone(input.project), snapshotRevision: structuredClone(input.revision), transactionLog: structuredClone(input.transactionLog), pinnedAssetManifest: structuredClone(input.project.pinnedAssets), migrationHistory: structuredClone(input.migrationHistory ?? []), createdByBuild: input.buildId };
  const integrityBase = { snapshotDigest, logDigest, ...(lastRecordDigest ? { lastRecordDigest } : {}) };
  return { ...base, integrityManifest: { ...integrityBase, envelopeDigest: engineeringDigest({ ...base, integrityManifest: integrityBase }) } };
}

export function validatePersistenceEnvelope(envelope: ProjectPersistenceEnvelope): string[] {
  const errors: string[] = []; if (envelope.formatId !== "sirkit.project-persistence-envelope.v1" || envelope.schemaVersion !== 1) errors.push("UNSUPPORTED_ENVELOPE_SCHEMA");
  if (engineeringDigest(envelope.canonicalSnapshot) !== envelope.integrityManifest.snapshotDigest) errors.push("SNAPSHOT_DIGEST_MISMATCH");
  if (engineeringDigest(envelope.transactionLog) !== envelope.integrityManifest.logDigest) errors.push("LOG_DIGEST_MISMATCH");
  if (envelope.transactionLog.at(-1)?.integrityDigest !== envelope.integrityManifest.lastRecordDigest) errors.push("LAST_RECORD_DIGEST_MISMATCH");
  let previous: string | undefined; for (const record of envelope.transactionLog) { if (record.previousRecordDigest !== previous) errors.push(`RECORD_CHAIN_MISMATCH:${record.serverSequence}`); const base = { ...record, integrityDigest: undefined }; if (engineeringDigest(base) !== record.integrityDigest) errors.push(`RECORD_DIGEST_MISMATCH:${record.serverSequence}`); previous = record.integrityDigest; }
  const { integrityManifest, ...base } = envelope; const integrityBase = { snapshotDigest: integrityManifest.snapshotDigest, logDigest: integrityManifest.logDigest, ...(integrityManifest.lastRecordDigest ? { lastRecordDigest: integrityManifest.lastRecordDigest } : {}) };
  if (engineeringDigest({ ...base, integrityManifest: integrityBase }) !== integrityManifest.envelopeDigest) errors.push("ENVELOPE_DIGEST_MISMATCH");
  if (envelope.snapshotRevision.projectId !== envelope.projectId || envelope.canonicalSnapshot.projectId !== envelope.projectId || envelope.snapshotRevision.branchId !== envelope.branchId || envelope.canonicalSnapshot.branchId !== envelope.branchId) errors.push("PROJECT_BRANCH_MISMATCH");
  // B06.3: when present, the lineage id must be well-formed (it is also
  // covered by the envelope digest, so tampering fails ENVELOPE_DIGEST_MISMATCH).
  if (envelope.lineageId !== undefined && !/^lin1-[0-9a-f]{8,}$/.test(envelope.lineageId)) errors.push("INVALID_LINEAGE_ID");
  if (envelope.snapshotRevision.headSequence !== envelope.transactionLog.length) errors.push("HEAD_SEQUENCE_LOG_MISMATCH");
  return [...new Set(errors)].sort();
}

export class InMemoryAtomicProjectStore implements AtomicProjectStore {
  private readonly envelopes = new Map<string, ProjectPersistenceEnvelope>();
  constructor(private readonly fault?: (phase: "before_commit" | "after_commit_before_ack") => void) {}
  async load(projectId: string, branchId: string): Promise<ProjectPersistenceEnvelope | null> { const value = this.envelopes.get(envelopeKey(projectId, branchId)); return value ? structuredClone(value) : null; }
  async initialize(project: CanonicalProjectState, revision: ProjectRevision, buildId: string): Promise<ProjectPersistenceEnvelope> { const key = envelopeKey(project.projectId, project.branchId); const existing = this.envelopes.get(key); if (existing) return structuredClone(existing); const envelope = createPersistenceEnvelope({ project, revision, transactionLog: [], buildId }); this.envelopes.set(key, envelope); return structuredClone(envelope); }
  async commit(input: { expectedHeadSequence: number; project: CanonicalProjectState; revision: ProjectRevision; record: DurableTransactionRecord; buildId: string }): Promise<ProjectPersistenceEnvelope> {
    this.fault?.("before_commit"); const key = envelopeKey(input.project.projectId, input.project.branchId); const current = this.envelopes.get(key); if (!current) throw new Error("PROJECT_NOT_INITIALIZED");
    const duplicate = current.transactionLog.find((record) => record.transaction.clientOperationId === input.record.transaction.clientOperationId); if (duplicate) return structuredClone(current);
    if (current.snapshotRevision.headSequence !== input.expectedHeadSequence) throw new Error(`STORE_HEAD_MISMATCH:${current.snapshotRevision.headSequence}`);
    // B06.3: the envelope is the EXCLUSIVE lineage authority — commits carry
    // the lineage forward so it survives every head advancement.
    const envelope = createPersistenceEnvelope({ project: input.project, revision: input.revision, transactionLog: [...current.transactionLog, input.record], buildId: input.buildId, migrationHistory: current.migrationHistory, ...(current.lineageId ? { lineageId: current.lineageId } : {}) }); this.envelopes.set(key, envelope); this.fault?.("after_commit_before_ack"); return structuredClone(envelope);
  }
  async backup(projectId: string, branchId: string): Promise<ProjectPersistenceEnvelope> { const envelope = await this.load(projectId, branchId); if (!envelope) throw new Error("PROJECT_NOT_FOUND"); return envelope; }
  async restore(envelope: ProjectPersistenceEnvelope): Promise<ProjectPersistenceEnvelope> { const errors = validatePersistenceEnvelope(envelope); if (errors.length) throw new Error(`RESTORE_INTEGRITY_FAILED:${errors.join(",")}`); const clone = structuredClone(envelope); this.envelopes.set(envelopeKey(envelope.projectId, envelope.branchId), clone); return structuredClone(clone); }
  /** B06.2 quarantine — raw copy, no validation, never visible to load(). */
  async preserveEnvelope(projectId: string, branchId: string, label: string): Promise<boolean> {
    const value = this.envelopes.get(envelopeKey(projectId, branchId));
    if (value === undefined) return false;
    this.envelopes.set(`${envelopeKey(projectId, branchId)}\0quarantine\0${label}`, structuredClone(value));
    return true;
  }
  /** Test-only inspection of quarantined raw values. */
  quarantined(projectId: string, branchId: string): ProjectPersistenceEnvelope[] {
    const prefix = `${envelopeKey(projectId, branchId)}\0quarantine\0`;
    return [...this.envelopes.entries()].filter(([key]) => key.startsWith(prefix)).map(([, value]) => structuredClone(value));
  }
  /** Test-only backdoor to plant a raw (possibly corrupt) value. */
  unsafeSetRaw(projectId: string, branchId: string, value: ProjectPersistenceEnvelope): void {
    this.envelopes.set(envelopeKey(projectId, branchId), structuredClone(value));
  }
}

export function nextDurableRecord(input: Omit<DurableTransactionRecord, "integrityDigest" | "persistenceCommitId">): DurableTransactionRecord {
  const persistenceCommitId = engineeringId("commit", { transactionId: input.transaction.transactionId, sequence: input.serverSequence, result: input.resultingRevision?.canonicalStateDigest }); const base = { ...input, persistenceCommitId };
  return { ...base, integrityDigest: engineeringDigest({ ...base, integrityDigest: undefined }) };
}
