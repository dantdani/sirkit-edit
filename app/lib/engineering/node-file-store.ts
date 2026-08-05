import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { canonicalJson } from "./stable";
import { createPersistenceEnvelope, validatePersistenceEnvelope, type AtomicProjectStore } from "./persistence";
import type { CanonicalProjectState, DurableTransactionRecord, ProjectPersistenceEnvelope, ProjectRevision } from "./types";

interface StoredFile { schema: "sirkit.atomic-project-file.v1"; payloadSha256: string; envelope: ProjectPersistenceEnvelope }
export type FileStoreFaultPhase = "before_temp_write" | "after_temp_sync_before_rename" | "after_rename_before_ack";

function sha256(value: string): string { return createHash("sha256").update(value).digest("hex"); }

/** Node/server durable adapter: exclusive writer lock plus fsync'd temp file and atomic rename. */
export class NodeAtomicProjectStore implements AtomicProjectStore {
  private readonly absoluteRoot: string;
  constructor(rootDirectory: string, private readonly fault?: (phase: FileStoreFaultPhase) => void) { this.absoluteRoot = path.resolve(rootDirectory); }

  private key(projectId: string, branchId: string): string { return sha256(`${projectId}\0${branchId}`); }
  private file(projectId: string, branchId: string): string { return path.join(this.absoluteRoot, `${this.key(projectId, branchId)}.json`); }
  private lock(projectId: string, branchId: string): string { return path.join(this.absoluteRoot, `${this.key(projectId, branchId)}.lock`); }

  async load(projectId: string, branchId: string): Promise<ProjectPersistenceEnvelope | null> {
    try {
      const stored = JSON.parse(await readFile(this.file(projectId, branchId), "utf8")) as StoredFile; if (stored.schema !== "sirkit.atomic-project-file.v1") throw new Error("FILE_SCHEMA_UNSUPPORTED");
      const payload = canonicalJson(stored.envelope); if (sha256(payload) !== stored.payloadSha256) throw new Error("FILE_SHA256_MISMATCH"); const errors = validatePersistenceEnvelope(stored.envelope); if (errors.length) throw new Error(`ENVELOPE_INTEGRITY_FAILED:${errors.join(",")}`); return structuredClone(stored.envelope);
    } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  }

  async initialize(project: CanonicalProjectState, revision: ProjectRevision, buildId: string): Promise<ProjectPersistenceEnvelope> {
    const existing = await this.load(project.projectId, project.branchId); if (existing) return existing; const envelope = createPersistenceEnvelope({ project, revision, transactionLog: [], buildId }); await this.writeLocked(envelope, true); return structuredClone(envelope);
  }

  async commit(input: { expectedHeadSequence: number; project: CanonicalProjectState; revision: ProjectRevision; record: DurableTransactionRecord; buildId: string }): Promise<ProjectPersistenceEnvelope> {
    await mkdir(this.absoluteRoot, { recursive: true }); const lockPath = this.lock(input.project.projectId, input.project.branchId); const lock = await open(lockPath, "wx").catch((error: NodeJS.ErrnoException) => { if (error.code === "EEXIST") throw new Error("PROJECT_WRITER_LOCKED"); throw error; });
    try {
      const current = await this.load(input.project.projectId, input.project.branchId); if (!current) throw new Error("PROJECT_NOT_INITIALIZED");
      if (current.transactionLog.some((record) => record.transaction.clientOperationId === input.record.transaction.clientOperationId)) return current;
      if (current.snapshotRevision.headSequence !== input.expectedHeadSequence) throw new Error(`STORE_HEAD_MISMATCH:${current.snapshotRevision.headSequence}`);
      const envelope = createPersistenceEnvelope({ project: input.project, revision: input.revision, transactionLog: [...current.transactionLog, input.record], buildId: input.buildId, migrationHistory: current.migrationHistory }); await this.writeAtomic(envelope); return structuredClone(envelope);
    } finally { await lock.close(); await rm(lockPath, { force: true }); }
  }

  private async writeLocked(envelope: ProjectPersistenceEnvelope, createOnly: boolean): Promise<void> {
    await mkdir(this.absoluteRoot, { recursive: true }); const lockPath = this.lock(envelope.projectId, envelope.branchId); const lock = await open(lockPath, "wx");
    try { if (createOnly && await this.load(envelope.projectId, envelope.branchId)) return; await this.writeAtomic(envelope); } finally { await lock.close(); await rm(lockPath, { force: true }); }
  }

  private async writeAtomic(envelope: ProjectPersistenceEnvelope): Promise<void> {
    const target = this.file(envelope.projectId, envelope.branchId); const temporary = path.join(this.absoluteRoot, `${path.basename(target)}.${randomUUID()}.tmp`); this.fault?.("before_temp_write");
    const payload = canonicalJson(envelope); const stored: StoredFile = { schema: "sirkit.atomic-project-file.v1", payloadSha256: sha256(payload), envelope }; const handle = await open(temporary, "wx");
    try { await handle.writeFile(`${canonicalJson(stored)}\n`, "utf8"); await handle.sync(); } finally { await handle.close(); }
    try { this.fault?.("after_temp_sync_before_rename"); await rename(temporary, target); this.fault?.("after_rename_before_ack"); } catch (error) { await rm(temporary, { force: true }); throw error; }
  }

  async backup(projectId: string, branchId: string): Promise<ProjectPersistenceEnvelope> { const value = await this.load(projectId, branchId); if (!value) throw new Error("PROJECT_NOT_FOUND"); return value; }
  async restore(envelope: ProjectPersistenceEnvelope): Promise<ProjectPersistenceEnvelope> { const errors = validatePersistenceEnvelope(envelope); if (errors.length) throw new Error(`RESTORE_INTEGRITY_FAILED:${errors.join(",")}`); await this.writeLocked(envelope, false); return structuredClone(envelope); }
}
