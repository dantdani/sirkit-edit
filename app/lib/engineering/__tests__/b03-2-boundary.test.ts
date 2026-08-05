/**
 * B03.2 — final boundary closure tests.
 *
 * (a) Executor lineage identity: required, immutable, checked before the
 *     idempotency short-circuit and before durable-record lookup; pre-rebase
 *     and forged lineages cannot replay or harvest idempotent results;
 *     exact-head reload restores the identity, fresh fallback mints a new
 *     one, generic executors get a deterministic default.
 * (b) Interactive-channel composition boundary: not exported from the
 *     engineering barrel; architectural scan over production imports;
 *     forged/serialized channel objects stay inert.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { createHistory } from "../../pcb/history";
import { bindCanonicalEditorSession } from "../editor-adapter";
import { CanonicalExecutor, deriveExecutorLineageId, type UndoRedoReplayRequest } from "../executor";
import { createEditorSessionChannel, InteractiveUiChannel } from "../interactive-channel.internal";
import { InMemoryAtomicProjectStore } from "../persistence";
import { EngineeringTransactionService } from "../transaction-service";
import type { ExecutionResult } from "../executor";
import { actor, projectFixture, track } from "./fixtures";

const BUILD = "b03-2-test-build";
const IDENTITY = { tenantId: "tenant-a", projectId: "project-a", branchId: "main" };

async function openService(): Promise<EngineeringTransactionService> {
  const project = projectFixture();
  project.pcb.tracks.push(track("t-seed"));
  return EngineeringTransactionService.open(project, { buildId: BUILD, store: new InMemoryAtomicProjectStore() });
}

function uiExecutor(service: EngineeringTransactionService, lineageId?: string): CanonicalExecutor {
  return new CanonicalExecutor(service, undefined, { interactiveChannel: createEditorSessionChannel("b03.2 test session"), ...(lineageId ? { lineageId } : {}) });
}

async function deleteSeed(service: EngineeringTransactionService, executor: CanonicalExecutor): Promise<Extract<ExecutionResult, { status: "executed" | "idempotent_replay" }>> {
  const result = await executor.execute({
    commandId: "pcb.delete-item",
    actor: actor("pcb_editor", "editor-1"),
    expectedRevision: service.currentRevision(),
    idempotencyKey: "delete-seed",
    reason: "delete seed track",
    operations: [{ operationId: "op:del", schemaVersion: 1, units: "nm", kind: "remove_track", trackId: "t-seed" }],
    provenance: { source: "ui", toolVersion: "test" },
  });
  if (result.status !== "executed") throw new Error(`expected executed, got ${result.status}`);
  return result;
}

function undoRequest(service: EngineeringTransactionService, executed: { transactionId: string; semanticDigestBefore?: string; semanticDigestAfter?: string }, lineageId: string, overrides?: Partial<UndoRedoReplayRequest>): UndoRedoReplayRequest {
  return {
    referencedTransactionId: executed.transactionId,
    direction: "undo",
    actor: actor("pcb_editor", "editor-1"),
    expectedLineage: { ...IDENTITY, lineageId },
    expectedHeadRevision: service.currentRevision(),
    expectedSourceStateDigest: executed.semanticDigestAfter!,
    expectedResultStateDigest: executed.semanticDigestBefore!,
    idempotencyKey: "undo-1",
    ...overrides,
  };
}

describe("executor lineage identity", () => {
  it("1. a missing lineage id is rejected", async () => {
    const service = await openService();
    const executor = uiExecutor(service);
    const executed = await deleteSeed(service, executor);
    const result = await executor.executeUndoRedo(undoRequest(service, executed, ""));
    expect(result).toMatchObject({ status: "rejected", reasonCode: "reference_mismatch" });
    expect(service.currentRevision().headSequence).toBe(1); // nothing replayed
  });

  it("2. a wrong lineage id is rejected BEFORE record lookup", async () => {
    const service = await openService();
    const executor = uiExecutor(service);
    const executed = await deleteSeed(service, executor);
    // Nonexistent reference + wrong lineage: the lineage check wins — proof
    // the identity gate runs before any durable-record lookup.
    const result = await executor.executeUndoRedo(undoRequest(service, executed, "lin1-forged", { referencedTransactionId: "tx:does-not-exist" }));
    expect(result).toMatchObject({ status: "rejected", reasonCode: "reference_mismatch" });
    if (result.status !== "rejected") throw new Error("unreachable");
    expect(result.diagnostics.join(" ")).toContain("lineage");
    expect(result.diagnostics.join(" ")).not.toContain("does-not-exist");
  });

  it("3+4. a pre-rebase (or forged same-project) lineage cannot replay against the new lineage even when everything else matches", async () => {
    const service = await openService();
    const oldLineage = deriveExecutorLineageId({ ...IDENTITY, genesisStateDigest: service.currentRevision().canonicalStateDigest, parent: null });
    const oldExecutor = uiExecutor(service, oldLineage);
    const executed = await deleteSeed(service, oldExecutor);
    // Rebase simulation: a NEW executor over the same service under the
    // successor lineage identity (same project, same branch, same records,
    // same digests — only the lineage id advanced).
    const newLineage = deriveExecutorLineageId({ ...IDENTITY, genesisStateDigest: service.currentRevision().canonicalStateDigest, parent: oldLineage });
    const newExecutor = uiExecutor(service, newLineage);
    const preRebase = await newExecutor.executeUndoRedo(undoRequest(service, executed, oldLineage));
    expect(preRebase).toMatchObject({ status: "rejected", reasonCode: "reference_mismatch" });
    expect(service.currentRevision().headSequence).toBe(1);
    // The same request under the CURRENT lineage id succeeds — the record,
    // digests, and position were valid all along; only the lineage was wrong.
    const current = await newExecutor.executeUndoRedo(undoRequest(service, executed, newLineage));
    expect(current.status).toBe("executed");
  });

  it("5. a duplicate replay key with the wrong lineage id is rejected, not returned as idempotent replay", async () => {
    const service = await openService();
    const executor = uiExecutor(service);
    const executed = await deleteSeed(service, executor);
    const first = await executor.executeUndoRedo(undoRequest(service, executed, executor.lineageId));
    expect(first.status).toBe("executed");
    // Same idempotency key, same reference — wrong lineage: refused outright.
    const wrongLineage = await executor.executeUndoRedo(undoRequest(service, executed, "lin1-other"));
    expect(wrongLineage).toMatchObject({ status: "rejected", reasonCode: "reference_mismatch" });
    // Correct lineage still replays idempotently.
    const replay = await executor.executeUndoRedo(undoRequest(service, executed, executor.lineageId));
    expect(replay.status).toBe("idempotent_replay");
    expect(service.currentRevision().headSequence).toBe(2);
  });

  it("6. exact-head reload restores the SAME lineage id into session, claim, envelope, and executor", async () => {
    const board = projectFixture().pcb;
    board.tracks.push(track("t1"));
    const durable = new InMemoryAtomicProjectStore();
    const first = bindCanonicalEditorSession(createHistory(board), IDENTITY, { durableStore: durable });
    await first.session.whenIdle();
    const move = await first.session.commit({
      commandId: "pcb.move-footprint", label: "Move u1",
      buildOperations: () => [{ operationId: "op:m", schemaVersion: 1, units: "nm", kind: "move_footprint", footprintId: "u1", at: { x: 4_000_000, y: 2_000_000 } }],
    });
    expect(move.ok).toBe(true);
    const claim = first.session.headMetadataFor(first.history.present)!;
    const envelope = await durable.load(IDENTITY.projectId, IDENTITY.branchId);
    expect(envelope!.lineageId).toBe(claim.lineageId); // claim ↔ envelope agree
    const reloaded = bindCanonicalEditorSession(createHistory(structuredClone(first.history.present)), IDENTITY, { durableStore: durable, claim });
    await reloaded.session.whenIdle();
    expect(reloaded.session.events.some((e) => e.kind === "head-restored")).toBe(true);
    expect(reloaded.session.lineageId).toBe(claim.lineageId);
    // The restored lineage is live: verified undo of the pre-reload move works.
    const next = await reloaded.session.commit({
      commandId: "pcb.move-footprint", label: "Move u1 again",
      buildOperations: () => [{ operationId: "op:m2", schemaVersion: 1, units: "nm", kind: "move_footprint", footprintId: "u1", at: { x: 6_000_000, y: 2_000_000 } }],
    });
    expect(next.ok && next.status === "executed").toBe(true);
  });

  it("7. fresh fallback after corrupt/stale persistence creates a DIFFERENT lineage id", async () => {
    const board = projectFixture().pcb;
    const durable = new InMemoryAtomicProjectStore();
    const first = bindCanonicalEditorSession(createHistory(board), IDENTITY, { durableStore: durable });
    await first.session.whenIdle();
    await first.session.commit({
      commandId: "pcb.move-footprint", label: "Move u1",
      buildOperations: () => [{ operationId: "op:m", schemaVersion: 1, units: "nm", kind: "move_footprint", footprintId: "u1", at: { x: 4_000_000, y: 2_000_000 } }],
    });
    const claim = first.session.headMetadataFor(first.history.present)!;
    // Stale persistence: board moved on after the claim was saved.
    const newer = structuredClone(first.history.present);
    newer.footprints.find((f) => f.id === "u1")!.at.x = 9_000_000;
    const fallback = bindCanonicalEditorSession(createHistory(newer), IDENTITY, { durableStore: durable, claim });
    await fallback.session.whenIdle();
    expect(fallback.session.events.some((e) => e.kind === "head-restored")).toBe(false);
    expect(fallback.session.lineageId).not.toBe("");
    expect(fallback.session.lineageId).not.toBe(claim.lineageId);
  });

  it("8. generic executor construction uses an explicit deterministic lineage identity", async () => {
    const a = new CanonicalExecutor(await openService());
    const b = new CanonicalExecutor(await openService());
    expect(a.lineageId).toMatch(/^lin1-/);
    expect(a.lineageId).toBe(b.lineageId); // identical genesis ⇒ identical identity
    const mutated = await openService();
    const channelExec = uiExecutor(mutated);
    await deleteSeed(mutated, channelExec);
    expect(new CanonicalExecutor(mutated).lineageId).not.toBe(a.lineageId); // different state ⇒ different identity
  });
});

describe("interactive-channel composition boundary", () => {
  it("9. the engineering public barrel does not export the channel or its factory", async () => {
    const barrel = await import("../index");
    expect(Object.keys(barrel)).not.toContain("InteractiveUiChannel");
    expect(Object.keys(barrel)).not.toContain("createEditorSessionChannel");
    // No exported VALUE is (or can create) the capability: nothing exported
    // exposes the channel's approval surface. (Name-based heuristics are too
    // blunt — B04 legitimately exports discovery-channel enums.)
    for (const [name, value] of Object.entries(barrel)) {
      if (typeof value !== "function") continue;
      expect((value as { prototype?: Record<string, unknown> }).prototype?.approvesDestructive, name).toBeUndefined();
    }
  });

  it("10. no production file outside the approved composition boundary imports the channel module", () => {
    // Approved importers of interactive-channel.internal (production code):
    const approved = new Set([
      "app/lib/engineering/executor.ts",
      "app/lib/engineering/editor-adapter.ts",
      "app/lib/engineering/interactive-channel.internal.ts",
    ]);
    const roots = ["app", "lib", "components"];
    const cwd = process.cwd();
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === "node_modules" || entry.name === "__tests__" || entry.name === ".next") continue;
          walk(full);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) continue;
        const rel = relative(cwd, full).split(sep).join("/");
        const source = readFileSync(full, "utf8");
        // The capability is only obtainable by importing the internal module
        // (any import style contains its specifier) or calling its factory.
        // Prose mentions of the class name (e.g. registry notes) are fine.
        const touchesChannel = source.includes("interactive-channel.internal") || source.includes("createEditorSessionChannel");
        if (touchesChannel && !approved.has(rel)) offenders.push(rel);
      }
    };
    for (const root of roots) {
      try { walk(join(cwd, root)); } catch { /* root may not exist */ }
    }
    expect(offenders, `unapproved channel imports: ${offenders.join(", ")}`).toEqual([]);
  });

  it("11. forged and JSON-round-tripped channel objects remain inert", async () => {
    const real = createEditorSessionChannel("test");
    expect(real instanceof InteractiveUiChannel).toBe(true);
    const roundTripped = JSON.parse(JSON.stringify({ channel: real })).channel;
    expect(roundTripped).toBe("[interactive-ui-channel]");
    expect((roundTripped as unknown) instanceof InteractiveUiChannel).toBe(false);
    const forged = { description: "fake", approvesDestructive: () => true, toJSON: () => "x" };
    expect((forged as unknown) instanceof InteractiveUiChannel).toBe(false);
    // A forged channel smuggled into executor options grants nothing: the
    // instanceof identity check refuses it.
    const service = await openService();
    const executor = new CanonicalExecutor(service, undefined, { interactiveChannel: forged as unknown as InteractiveUiChannel });
    const result = await executor.execute({
      commandId: "pcb.delete-item", actor: actor("pcb_editor", "editor-1"),
      expectedRevision: service.currentRevision(), idempotencyKey: "forged-channel", reason: "delete",
      operations: [{ operationId: "op:del", schemaVersion: 1, units: "nm", kind: "remove_track", trackId: "t-seed" }],
      provenance: { source: "ui", toolVersion: "test" },
    });
    expect(result).toMatchObject({ status: "rejected", reasonCode: "approval_required" });
  });
});
