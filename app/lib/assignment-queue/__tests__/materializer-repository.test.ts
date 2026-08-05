import { describe, expect, it } from "vitest";
import { buildAssignmentSourceBundle } from "../adapters";
import { collectBlockers, materializeAssignment, validateSourceBundle } from "../materializer";
import { DurableAssignmentQueueRepository } from "../repository";
import { InMemoryDurableWorkflowRepository } from "../../durable-workflow/repository";
import { candidate, sourceBundle } from "./fixtures";

describe("assignment queue materialization and persistence", () => {
  it("uses stable technical identity independent of capture time and display refdes", () => {
    const first = sourceBundle({ capturedAt: "2026-07-19T18:00:00.000Z" }), second = sourceBundle({ capturedAt: "2026-07-19T19:00:00.000Z" });
    expect(first.sourceBundleDigest).toBe(second.sourceBundleDigest);
    expect(materializeAssignment(first).item?.itemId).toBe(materializeAssignment(second).item?.itemId);
  });

  it("does not churn item identity for a changed safe message or request metadata", () => {
    const first = sourceBundle(), changed = buildAssignmentSourceBundle({ ...first, stage1Gates: first.stage1Gates.map((gate) => ({ ...gate, message: "Localized wording changed; electrical state did not." })), capturedAt: "2026-07-19T19:00:00.000Z" });
    expect(changed.sourceBundleDigest).not.toBe(first.sourceBundleDigest);
    expect(materializeAssignment(changed).item?.itemId).toBe(materializeAssignment(first).item?.itemId);
    expect(materializeAssignment(changed).item?.primaryBlocker.safeMessage).not.toBe(materializeAssignment(first).item?.primaryBlocker.safeMessage);
  });

  it("classifies structured package, mapping, policy, and operational blockers without parsing UI text", () => {
    const packageItem = materializeAssignment(sourceBundle()).item; expect(packageItem?.category).toBe("package_missing_or_ambiguous");
    const mappingItem = materializeAssignment(sourceBundle({ gateCode: "PB_MAPPING", remediation: "mapping" })).item; expect(mappingItem?.category).toBe("mapping_required");
    const operational = buildAssignmentSourceBundle({ tenantId: "tenant-1", projectId: "project-1", branchId: "main", designId: "design-1", componentId: "component-1", componentRevision: "component-1:r1", referenceDesignator: "J1", displayName: "Connector", assemblyVariantId: "variant-default", pcbComponent: { componentInstanceId: "component-1", referenceDesignator: "J1", hierarchyPath: [], componentRevision: "r1", applicability: "applicable", resolutionStatus: "missing_result", mappingStatus: "missing", proposedOperation: "blocked", risk: "unsupported_unknown", status: "blocked_unsupported", blockers: [{ code: "PS_BOARD_FORMAT_UNSUPPORTED", severity: "blocking", blocking: true, scope: "system", stableIds: [], displayRefs: [], message: "system", remediationCategory: "board_format", evidenceRefs: [], causedBy: [], retryability: "never", helpKey: "system" }], warnings: [], resolverBlockerCodes: [], evidenceRefs: [] }, candidates: [], ownerReferences: {}, capturedAt: "2026-07-19T18:00:00.000Z" });
    const result = materializeAssignment(operational); expect(result.item).toBeNull(); expect(result.operational).toHaveLength(1);
    expect(materializeAssignment(sourceBundle({ gateCode: "PB_FUTURE_UNKNOWN", remediation: "future_owner_action" })).item?.category).toBe("unsupported_requires_escalation");
  });

  it("detects source tampering", () => { const bundle = sourceBundle(); expect(() => validateSourceBundle({ ...bundle, componentRevision: "tampered" })).toThrow("AQ_SOURCE_DIGEST_MISMATCH"); });

  it("deduplicates refresh, supersedes changed dependency items, and resolves cleared sources", async () => {
    const repository = new DurableAssignmentQueueRepository(new InMemoryDurableWorkflowRepository()), first = sourceBundle(), firstItem = materializeAssignment(first).item!;
    expect((await repository.reconcile(first, firstItem, 0)).idempotent).toBe(false); expect((await repository.reconcile(first, firstItem, 0)).idempotent).toBe(true);
    const changed = sourceBundle({ gateCode: "PB_MAPPING", remediation: "mapping" }), changedItem = materializeAssignment(changed).item!, scope = { tenantId: first.tenantId, projectId: first.projectId, branchId: first.branchId }; const reconciled = await repository.reconcile(changed, changedItem, 0); expect(reconciled.superseded).toContain(firstItem.itemId); expect((await repository.getItem(scope, firstItem.itemId))?.lifecycle).toBe("superseded");
    const clear = buildAssignmentSourceBundle({ tenantId: "tenant-1", projectId: "project-1", branchId: "main", designId: "design-1", componentId: "component-1", componentRevision: "component-1:r2", referenceDesignator: "J2", displayName: "Connector", assemblyVariantId: "variant-default", stage1Gates: [], candidates: [candidate], ownerReferences: { stage1: { setId: "set-1", expectedSetRevision: 2 } }, capturedAt: "2026-07-19T20:00:00.000Z" }); await repository.reconcile(clear, null, 0); expect((await repository.getItem(scope, changedItem.itemId))?.lifecycle).toBe("resolved");
  });

  it("paginates deterministically with bounded filters and rejects stale cursors", async () => {
    const repository = new DurableAssignmentQueueRepository(new InMemoryDurableWorkflowRepository());
    for (let index = 1; index <= 5; index += 1) { const base = sourceBundle(), bundle = buildAssignmentSourceBundle({ ...base, componentId: `component-${index}`, componentRevision: `component-${index}:r1`, referenceDesignator: `J${index}`, capturedAt: base.capturedAt }); await repository.reconcile(bundle, materializeAssignment(bundle).item, 0); }
    const scope = { tenantId: "tenant-1", projectId: "project-1", branchId: "main", assemblyVariantId: "variant-default", limit: 2 };
    const first = await repository.listItemsPage(scope), second = await repository.listItemsPage({ ...scope, cursor: first.nextCursor! });
    expect(first.items.map((item) => item.referenceDesignator)).toEqual(["J1", "J2"]);
    expect(second.items.map((item) => item.referenceDesignator)).toEqual(["J3", "J4"]);
    expect(first.totalFiltered).toBe(5);
    expect((await repository.listItemsPage({ ...scope, query: "J5" })).items).toHaveLength(1);
    await expect(repository.listItemsPage({ ...scope, cursor: "not-a-cursor" })).rejects.toThrow("AQ_CURSOR_INVALID");
  });

  it("retains all source references while deterministically choosing one primary blocker", () => { const bundle = sourceBundle(); bundle.stage1Gates.push({ ...bundle.stage1Gates[0]!, code: "PB_APPROVAL", remediationCategory: "approval", message: "Approval required" }); const rebuilt = buildAssignmentSourceBundle({ ...bundle, stage1Gates: bundle.stage1Gates, capturedAt: bundle.capturedAt }); const blockers = collectBlockers(rebuilt); expect(blockers).toHaveLength(2); expect(materializeAssignment(rebuilt).item?.sourceIssues).toHaveLength(2); });

  it("never leaks an opaque item key across project scope", async () => { const repository = new DurableAssignmentQueueRepository(new InMemoryDurableWorkflowRepository()), first = sourceBundle(), firstItem = materializeAssignment(first).item!; await repository.reconcile(first, firstItem, 0); const second = buildAssignmentSourceBundle({ ...first, tenantId: "tenant-2", projectId: "project-2", capturedAt: first.capturedAt }), materialized = materializeAssignment(second).item!, secondItem = { ...materialized, itemId: firstItem.itemId, itemDigest: "tenant-2-item-digest" }; await repository.reconcile(second, secondItem, 0); expect((await repository.getItem(first, firstItem.itemId))?.tenantId).toBe("tenant-1"); expect((await repository.getItem(second, firstItem.itemId))?.tenantId).toBe("tenant-2"); expect(await repository.getItem({ tenantId: "tenant-1", projectId: "project-2", branchId: "main" }, firstItem.itemId)).toBeNull(); });
});
