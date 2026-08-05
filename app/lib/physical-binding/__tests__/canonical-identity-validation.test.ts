import { describe, expect, it } from "vitest";
import { copiedComponentIdentity, nativeComponentIdentity, reconcileLegacyComponentIdentity } from "../identity";
import { canonicalPhysicalBindingJson, physicalBindingDigest } from "../stable";
import { normalizePackageBinding, validatePhysicalBinding } from "../validation";
import { exactCandidate, scope } from "./fixtures";

describe("physical binding canonicalization and stable identity", () => {
  it("is deterministic, Unicode-normalized, idempotent, order-aware only where declared, and non-mutating", () => {
    const left = { z: "e\u0301", evidenceRefs: ["b", "a"], ordered: [2, 1], nested: { b: 2, a: 1 }, absent: undefined };
    const right = { nested: { a: 1, b: 2 }, ordered: [2, 1], evidenceRefs: ["a", "b"], z: "é" };
    const before = structuredClone(left);
    expect(canonicalPhysicalBindingJson(left)).toBe(canonicalPhysicalBindingJson(right));
    expect(physicalBindingDigest(left)).toBe(physicalBindingDigest(right));
    expect(left).toEqual(before);
    expect(canonicalPhysicalBindingJson(JSON.parse(canonicalPhysicalBindingJson(left)))).toBe(canonicalPhysicalBindingJson(left));
    expect(physicalBindingDigest({ ...left, ordered: [1, 2] })).not.toBe(physicalBindingDigest(left));
  });

  it("keeps identity across refdes/display changes but allocates a new identity for copies and recreation", () => {
    const identity = nativeComponentIdentity(scope("component-stable-1"));
    const renamedDisplay = { refDes: "J99", identity };
    expect(renamedDisplay.identity.componentInstanceId).toBe("component-stable-1");
    const copied = copiedComponentIdentity(identity, "component-copy-2", "copy-op-1");
    expect(copied.componentInstanceId).not.toBe(identity.componentInstanceId);
    expect(copied.origin).toMatchObject({ kind: "copied", sourceComponentInstanceId: "component-stable-1" });
    const recreated = nativeComponentIdentity(scope("component-recreated-3"));
    expect(recreated.componentInstanceId).not.toBe(identity.componentInstanceId);
    const legacyA = reconcileLegacyComponentIdentity({ ...scope("unused"), sourceLocator: "sheet-a:J1", sourceStableId: undefined });
    const legacyB = reconcileLegacyComponentIdentity({ ...scope("unused"), sourceLocator: "sheet-a:J1", sourceStableId: undefined });
    expect(legacyA).toEqual(legacyB);
  });

  it("rejects ambiguous package aliases and distinguishes exact metric/imperial identity", () => {
    expect(() => normalizePackageBinding({ packageRevisionId: "r1", identitySystem: "project_defined", canonicalName: "0603", sourceToken: "0603", mountingTechnology: "smd", exposedPad: "absent", evidenceRefs: [] })).toThrow("PB_PACKAGE_ALIAS_AMBIGUOUS_0603");
    const imperial = normalizePackageBinding({ packageRevisionId: "r1", identitySystem: "metric_imperial_explicit", canonicalName: "0603 imperial", sourceToken: "0603", mountingTechnology: "smd", exposedPad: "absent", evidenceRefs: [] });
    const metric = normalizePackageBinding({ packageRevisionId: "r2", identitySystem: "metric_imperial_explicit", canonicalName: "0603 metric", sourceToken: "0603", mountingTechnology: "smd", exposedPad: "absent", evidenceRefs: [] });
    expect(imperial.packageIdentityId).not.toBe(metric.packageIdentityId);
  });

  it("validates canonical digests and exact mapping revision bindings", () => {
    const candidate = exactCandidate();
    expect(validatePhysicalBinding(candidate)).toEqual([]);
    const forged = structuredClone(candidate);
    forged.pinPadMapping.footprintAssetVersionId = "another-footprint";
    expect(validatePhysicalBinding(forged).map((issue) => issue.code)).toContain("PB_MAPPING_FOOTPRINT_MISMATCH");
    expect(validatePhysicalBinding({ ...candidate, recordDigest: `pb1-${"0".repeat(64)}` }).map((issue) => issue.code)).toContain("PB_RECORD_DIGEST_MISMATCH");
  });
});
