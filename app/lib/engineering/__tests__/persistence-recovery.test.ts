import { createHash } from "node:crypto";
import { mkdtemp, open, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { NodeAtomicProjectStore, type FileStoreFaultPhase } from "../node-file-store";
import { validatePersistenceEnvelope } from "../persistence";
import { EngineeringTransactionService } from "../transaction-service";
import { projectFixture, track, transaction } from "./fixtures";

const add = (id: string) => ({ operationId: `op:${id}`, schemaVersion: 1 as const, units: "nm" as const, kind: "add_track" as const, track: track(id) });

describe("Stage 10 durable atomic file persistence and recovery", () => {
  it("reopens exact state/log/head and returns the original result for duplicate retry", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "sirkit-stage10-store-")); const project = projectFixture(); const store = new NodeAtomicProjectStore(root); const service = await EngineeringTransactionService.open(project, { buildId: "test", store, serverMode: true }); const tx = transaction(project, [add("t1")]);
    expect((await service.submit(tx)).state).toBe("accepted"); const reopened = await EngineeringTransactionService.open(project, { buildId: "test", store: new NodeAtomicProjectStore(root), serverMode: true }); expect(reopened.currentRevision().headSequence).toBe(1); expect(reopened.currentProject().pcb.tracks[0].id).toBe("t1"); expect((await reopened.submit(tx)).state).toBe("duplicate"); expect(reopened.currentRevision().headSequence).toBe(1);
  });

  it.each(["before_temp_write", "after_temp_sync_before_rename"] as const)("keeps the previous head after %s", async (faultPoint) => {
    const root = await mkdtemp(path.join(tmpdir(), "sirkit-stage10-fault-")); const project = projectFixture(); let active: FileStoreFaultPhase | undefined; const store = new NodeAtomicProjectStore(root, (phase) => { if (phase === active) throw new Error(`FAULT:${phase}`); }); const service = await EngineeringTransactionService.open(project, { buildId: "test", store }); active = faultPoint;
    expect((await service.submit(transaction(project, [add("failed")]))).state).toBe("persistence_failed"); active = undefined; const reopened = await EngineeringTransactionService.open(project, { buildId: "test", store: new NodeAtomicProjectStore(root) }); expect(reopened.currentRevision().headSequence).toBe(0); expect(reopened.currentProject().pcb.tracks).toEqual([]); expect((await readdir(root)).filter((file) => file.endsWith(".tmp"))).toEqual([]);
  });

  it("recovers a durable transaction after crash between rename and acknowledgement", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "sirkit-stage10-ack-")); const project = projectFixture(); let active = false; const store = new NodeAtomicProjectStore(root, (phase) => { if (active && phase === "after_rename_before_ack") throw new Error("ACK_LOST"); }); const service = await EngineeringTransactionService.open(project, { buildId: "test", store }); active = true;
    const result = await service.submit(transaction(project, [add("durable")], { clientOperationId: "client:ack" })); expect(result.state).toBe("duplicate"); expect(service.currentRevision().headSequence).toBe(1); const reopened = await EngineeringTransactionService.open(project, { buildId: "test", store: new NodeAtomicProjectStore(root) }); expect(reopened.currentProject().pcb.tracks[0].id).toBe("durable");
  });

  it("detects corruption instead of silently resetting and supports verified backup/restore", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "sirkit-stage10-integrity-")); const restoreRoot = await mkdtemp(path.join(tmpdir(), "sirkit-stage10-restore-")); const project = projectFixture(); const store = new NodeAtomicProjectStore(root); const service = await EngineeringTransactionService.open(project, { buildId: "test", store }); await service.submit(transaction(project, [add("t1")])); const backup = await store.backup(project.projectId, project.branchId); expect(validatePersistenceEnvelope(backup)).toEqual([]);
    const restored = await new NodeAtomicProjectStore(restoreRoot).restore(backup); expect(restored.snapshotRevision.headSequence).toBe(1); expect((await new NodeAtomicProjectStore(restoreRoot).load(project.projectId, project.branchId))?.canonicalSnapshot.pcb.tracks[0].id).toBe("t1");
    const file = (await readdir(root)).find((item) => item.endsWith(".json"))!; await writeFile(path.join(root, file), `${await readFile(path.join(root, file), "utf8")}corrupt`, "utf8"); await expect(store.load(project.projectId, project.branchId)).rejects.toThrow();
  });

  it("rejects a competing local writer lock without changing canonical state", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "sirkit-stage10-lock-")); const project = projectFixture(); const store = new NodeAtomicProjectStore(root); const service = await EngineeringTransactionService.open(project, { buildId: "test", store }); const key = createHash("sha256").update(`${project.projectId}\0${project.branchId}`).digest("hex"); const lockPath = path.join(root, `${key}.lock`); const lock = await open(lockPath, "wx");
    try { expect((await service.submit(transaction(project, [add("blocked")]))).state).toBe("persistence_failed"); expect(service.currentRevision().headSequence).toBe(0); } finally { await lock.close(); await rm(lockPath, { force: true }); }
  });
});
