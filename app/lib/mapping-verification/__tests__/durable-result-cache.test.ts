import { describe, expect, it, vi } from "vitest";
import { ScopedMappingInvalidationTarget } from "../invalidation";
import { InMemoryMappingContextProvider } from "../providers";
import { InMemoryMappingRepository } from "../repository";
import { MappingVerificationService } from "../service";
import { InMemoryStage1MappingProjector } from "../stage1-projector";
import type { MappingContext, MappingMutationRequest, MappingVerificationRequest, MappingVerificationResult, MappingVerificationResultLookup, MappingVerificationResultStore } from "../types";
import { ACTOR, contextFixture, exactCandidate, request } from "./fixtures";

type ResultEnvelope = { result: MappingVerificationResult; context: MappingContext; request: MappingVerificationRequest };

class TestResultStore implements MappingVerificationResultStore {
  readonly entries = new Map<string, ResultEnvelope>();
  getCalls = 0;
  lastAttempt: ResultEnvelope | null = null;
  putFailure: Error | null = null;
  getFailure: Error | null = null;
  readTransform: ((value: ResultEnvelope) => ResultEnvelope) | null = null;

  async put(input: ResultEnvelope): Promise<void> {
    this.lastAttempt = structuredClone(input);
    if (this.putFailure) throw this.putFailure;
    const existing = this.entries.get(input.result.verificationId);
    if (existing && existing.result.resultDigest !== input.result.resultDigest) throw new Error("MV_VERIFICATION_ID_COLLISION");
    if (!existing) this.entries.set(input.result.verificationId, structuredClone(input));
  }

  async get(input: MappingVerificationResultLookup): Promise<ResultEnvelope | null> {
    this.getCalls += 1;
    if (this.getFailure) throw this.getFailure;
    const stored = this.entries.get(input.verificationId);
    if (stored && (stored.context.scope.tenantId !== input.tenantId || stored.context.scope.projectId !== input.projectId || stored.context.scope.branchId !== input.branchId)) return null;
    return stored ? structuredClone(this.readTransform?.(structuredClone(stored)) ?? stored) : null;
  }
}

function mutation(verificationId: string): MappingMutationRequest {
  return { requestId: "persist-1", tenantId: "tenant-1", projectId: "project-1", branchId: "main", componentInstanceId: "component-1", assemblyVariantId: "variant-default", verificationId, expectedRevision: 0, idempotencyKey: "persist-key", reason: "Persist durable mapping verification.", actorContext: ACTOR, requestedAt: "2026-07-19T14:01:00.000Z" };
}

function harness(store?: TestResultStore) {
  const context = contextFixture(), candidate = exactCandidate(context, { equivalence: true });
  const provider = new InMemoryMappingContextProvider({ contexts: [context], candidates: [candidate] });
  const repository = new InMemoryMappingRepository(), projector = new InMemoryStage1MappingProjector(), invalidation = new ScopedMappingInvalidationTarget();
  const service = new MappingVerificationService({ provider, repository, stage1Projector: projector, invalidation, ...(store ? { resultStore: store } : {}) });
  return { context, candidate, provider, repository, projector, invalidation, service, store };
}

describe("B4 durable-first verification results", () => {
  it("never exposes a result whose durable put failed", async () => {
    const store = new TestResultStore();
    store.putFailure = new Error("simulated-durable-put-failure");
    const first = harness(store), project = vi.spyOn(first.projector, "project"), invalidate = vi.spyOn(first.invalidation, "invalidate");

    await expect(first.service.verify(request(first.context, first.candidate))).rejects.toThrow("simulated-durable-put-failure");
    const verificationId = store.lastAttempt!.result.verificationId;
    store.putFailure = null;
    await expect(first.service.persistVerification(mutation(verificationId))).rejects.toThrow("MV_VERIFICATION_NOT_PERSISTABLE");
    await expect(harness(store).service.persistVerification(mutation(verificationId))).rejects.toThrow("MV_VERIFICATION_NOT_PERSISTABLE");
    expect(store.entries.size).toBe(0);
    expect(project).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("verifies the post-write durable row and supports a fresh service", async () => {
    const store = new TestResultStore(), first = harness(store);
    const verified = await first.service.verify(request(first.context, first.candidate));
    expect(store.getCalls).toBeGreaterThan(0);

    const second = harness(store);
    const committed = await second.service.persistVerification(mutation(verified.verificationId));
    expect(committed.record.verification.resultDigest).toBe(verified.resultDigest);
    expect(store.getCalls).toBeGreaterThan(2);
  });

  it("fails closed when post-write durable scope differs from the intended result", async () => {
    const store = new TestResultStore(), first = harness(store);
    store.readTransform = (value) => { value.context.scope.projectId = "project-corrupted"; return value; };

    await expect(first.service.verify(request(first.context, first.candidate))).rejects.toThrow("MV_RESULT_STORE_INTEGRITY_CONFLICT");
    expect(await first.repository.getHead({ tenantId: "tenant-1", projectId: "project-1", branchId: "main", componentInstanceId: "component-1", assemblyVariantId: "variant-default" })).toBeNull();
  });

  it("treats durable absence as absence even in the service that verified", async () => {
    const store = new TestResultStore(), first = harness(store);
    const verified = await first.service.verify(request(first.context, first.candidate));
    store.entries.delete(verified.verificationId);

    await expect(first.service.persistVerification(mutation(verified.verificationId))).rejects.toThrow("MV_VERIFICATION_NOT_PERSISTABLE");
    expect(await first.repository.getHead({ tenantId: "tenant-1", projectId: "project-1", branchId: "main", componentInstanceId: "component-1", assemblyVariantId: "variant-default" })).toBeNull();
  });

  it("reloads for mutation and rejects a corrupted durable payload", async () => {
    const store = new TestResultStore(), first = harness(store);
    const verified = await first.service.verify(request(first.context, first.candidate));
    const corrupted = store.entries.get(verified.verificationId)!;
    corrupted.result.status = "incomplete";

    await expect(first.service.persistVerification(mutation(verified.verificationId))).rejects.toThrow("MV_RESULT_DIGEST_MISMATCH");
    expect(await first.repository.getHead({ tenantId: "tenant-1", projectId: "project-1", branchId: "main", componentInstanceId: "component-1", assemblyVariantId: "variant-default" })).toBeNull();
  });

  it("rejects a corrupted stored digest and makes store omission non-authoritative", async () => {
    const store = new TestResultStore(), first = harness(store);
    const verified = await first.service.verify(request(first.context, first.candidate));
    store.entries.get(verified.verificationId)!.result.resultDigest = "mv1-corrupted";
    await expect(harness(store).service.persistVerification(mutation(verified.verificationId))).rejects.toThrow("MV_RESULT_DIGEST_MISMATCH");

    const readOnly = harness();
    const ephemeral = await readOnly.service.verify(request(readOnly.context, readOnly.candidate));
    await expect(readOnly.service.persistVerification(mutation(ephemeral.verificationId))).rejects.toThrow("MV_RESULT_STORE_UNAVAILABLE");
  });

  it("propagates a durable read outage before authoritative mutation", async () => {
    const store = new TestResultStore(), first = harness(store);
    const verified = await first.service.verify(request(first.context, first.candidate));
    store.getFailure = new Error("simulated-durable-read-failure");

    await expect(first.service.persistVerification(mutation(verified.verificationId))).rejects.toThrow("simulated-durable-read-failure");
    expect(await first.repository.getHead({ tenantId: "tenant-1", projectId: "project-1", branchId: "main", componentInstanceId: "component-1", assemblyVariantId: "variant-default" })).toBeNull();
  });
});
