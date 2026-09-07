/**
 * B16.1C §D — server-owned component/package authority for qualification.
 *
 * Every blocker code fails CLOSED; only an exact vocabulary tuple over a
 * selected, approved, verified binding whose identity matches the synced
 * footprint yields a "proven" package class. No regular expression over the
 * footprint id exists any more (pre-edit probe P5/P6).
 */
import { describe, expect, it } from "vitest";
import { packageClassFromBinding, QUALIFICATION_PACKAGE_VOCABULARY, QUALIFICATION_PACKAGE_VOCABULARY_VERSION, resolveQualificationComponentAuthority } from "../qualification-authority";
import type { ComponentPhysicalBinding } from "@/app/lib/physical-binding/types";
import type { FootprintInstance, PcbBoard } from "@/app/lib/pcb/types";
import { createEmptyBoard } from "@/app/lib/pcb/types";

const SCOPE = { tenantId: "t", projectId: "p", branchId: "main", boardId: "board:p" };

function binding(overrides: Partial<ComponentPhysicalBinding> & { componentInstanceId?: string; revisionId?: string } = {}): ComponentPhysicalBinding {
  const componentInstanceId = overrides.componentInstanceId ?? "inst-1";
  const base = {
    revisionId: overrides.revisionId ?? "binding-1:r1",
    bindingId: "binding-1",
    lifecycleState: "selected",
    approval: { state: "approved" },
    scope: { tenantId: "t", projectId: "p", branchId: "main", boardInstanceId: "board:p", componentInstanceId, hierarchyPath: ["root"], assemblyVariantIds: ["variant-default"] },
    componentIdentity: { componentInstanceId },
    footprint: { assetVersionId: "fp-v1", contentDigest: "sha256:fp", footprintName: "R_0805_2012Metric" },
    pinPadMapping: { state: "verified", mappingCertificateId: "cert-1" },
    package: { packageIdentityId: "pkg-1", packageRevisionId: "pkg-1:r1", identitySystem: "metric_imperial_explicit", canonicalName: "0805 (2012 Metric)", sourceToken: "0805", mountingTechnology: "smd", pinCount: 2 },
    exactPart: { exactPartId: "exact-1", atomicPartRevisionId: "atomic-1" },
  } as unknown as ComponentPhysicalBinding;
  return { ...base, ...overrides } as ComponentPhysicalBinding;
}

function footprint(overrides: Partial<FootprintInstance> = {}): FootprintInstance {
  return {
    id: "inst-1", ref: "R1", footprintId: "fp-v1", at: { x: 0, y: 0 }, rotationDeg: 0, side: "top", padNets: {},
    def: { libName: "Resistor_SMD", name: "R_0805_2012Metric", attributes: { smd: true, throughHole: false, excludeFromPos: false, excludeFromBom: false }, pads: [], graphics: [], bodyBBox: { minX: 0, minY: 0, maxX: 1, maxY: 1 }, models: [], rawSexpr: "" },
    syncIdentity: { componentInstanceId: "inst-1", bindingRevisionId: "binding-1:r1", footprintAssetVersionId: "fp-v1", footprintContentDigest: "sha256:fp", mappingCertificateId: "cert-1", symbolAssetVersionId: "sym-v1", syncPlanId: "plan-1" },
    ...overrides,
  } as FootprintInstance;
}

function board(...footprints: FootprintInstance[]): PcbBoard { return { ...createEmptyBoard(), footprints }; }
const repo = (...bindings: ComponentPhysicalBinding[]) => ({ listSelectedPeers: async (scope: { componentInstanceId: string }) => bindings.filter((item) => item.scope.componentInstanceId === scope.componentInstanceId) });

describe("packageClassFromBinding — closed vocabulary, exact tuples only", () => {
  it("classifies every vocabulary entry and nothing else", () => {
    expect(QUALIFICATION_PACKAGE_VOCABULARY_VERSION).toBe("sirkit.qualification-package-vocabulary.v1");
    for (const entry of QUALIFICATION_PACKAGE_VOCABULARY) {
      const pkg = { packageIdentityId: "x", packageRevisionId: "x:r1", identitySystem: entry.identitySystem, canonicalName: "canonicalName" in entry.match ? entry.match.canonicalName : `${entry.match.sourceToken} (metric)`, sourceToken: "sourceToken" in entry.match ? entry.match.sourceToken : "n/a", mountingTechnology: entry.mountingTechnology, pinCount: entry.pinCount } as NonNullable<ComponentPhysicalBinding["package"]>;
      expect(packageClassFromBinding(pkg)).toBe(entry.packageClass);
    }
    expect(QUALIFICATION_PACKAGE_VOCABULARY.some((entry) => entry.packageClass === "bga_hdi")).toBe(false);
  });
  it("refuses near-misses: wrong pin count, wrong mounting, wrong identity system, unknown name, substring names", () => {
    const soic8 = binding().package!;
    expect(packageClassFromBinding({ ...soic8, identitySystem: "manufacturer", canonicalName: "SOIC-8 3.9x4.9mm P1.27mm", sourceToken: "SOIC-8_3.9x4.9mm_P1.27mm", pinCount: 8 })).toBe("soic_tssop");
    expect(packageClassFromBinding({ ...soic8, identitySystem: "manufacturer", canonicalName: "SOIC-8 3.9x4.9mm P1.27mm", sourceToken: "x", pinCount: 7 })).toBe("unknown");
    expect(packageClassFromBinding({ ...soic8, identitySystem: "manufacturer", canonicalName: "SOIC-8 3.9x4.9mm P1.27mm", sourceToken: "x", pinCount: 8, mountingTechnology: "through_hole" })).toBe("unknown");
    expect(packageClassFromBinding({ ...soic8, identitySystem: "manufacturer", canonicalName: "SOIC-8 3.9x4.9mm P1.27mm EP", sourceToken: "x", pinCount: 8 })).toBe("unknown");
    expect(packageClassFromBinding({ ...soic8, identitySystem: "manufacturer", canonicalName: "0805 (2012 Metric)", sourceToken: "0805", pinCount: 2 })).toBe("unknown");
    expect(packageClassFromBinding({ ...soic8, sourceToken: "0805", pinCount: 3 })).toBe("unknown");
    expect(packageClassFromBinding({ ...soic8, sourceToken: "1206", pinCount: 2 })).toBe("unknown");
    expect(packageClassFromBinding({ ...soic8, identitySystem: "manufacturer", canonicalName: "PinHeader 1x02 P2.54mm Vertical", sourceToken: "x", mountingTechnology: "through_hole", pinCount: 2 })).toBe("through_hole_header");
    expect(packageClassFromBinding({ ...soic8, identitySystem: "manufacturer", canonicalName: "PinHeader 1x07 P2.54mm Vertical", sourceToken: "x", mountingTechnology: "through_hole", pinCount: 7 })).toBe("unknown");
  });
});

describe("resolveQualificationComponentAuthority — fails closed on every gap", () => {
  it("proves a fully consistent selected/approved/verified binding and digests the exact tuples", async () => {
    const result = await resolveQualificationComponentAuthority({ board: board(footprint()), scope: SCOPE, bindings: repo(binding()) });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.authority.footprintQualifications).toEqual({ "fp-v1": { packageClass: "passive_smd_0603_0805", authority: "proven" } });
    expect(result.authority.tuples).toHaveLength(1);
    expect(result.authority.tuples[0]).toMatchObject({ componentInstanceId: "inst-1", bindingRevisionId: "binding-1:r1", mappingCertificateId: "cert-1", packageClass: "passive_smd_0603_0805", atomicPartRevisionId: "atomic-1" });
    expect(result.authority.digest).toMatch(/^qualification-authority-[0-9a-f]{64}$/);
    expect(result.authority.bindingRevision).toMatch(/^bindings-[0-9a-f]{64}$/);
    expect(result.authority.footprintLibraryRevision).toMatch(/^footprints-[0-9a-f]{64}$/);
    expect(result.authority.mappingRevision).toMatch(/^mappings-[0-9a-f]{64}$/);
    expect(result.authority.assemblyVariantRevision).toMatch(/^variants-[0-9a-f]{64}$/);
    // Deterministic: the same inputs digest identically; a different binding revision changes the digest.
    const again = await resolveQualificationComponentAuthority({ board: board(footprint()), scope: SCOPE, bindings: repo(binding()) });
    expect(again.ok && again.authority.digest).toBe(result.authority.digest);
    const changed = await resolveQualificationComponentAuthority({ board: board(footprint({ syncIdentity: { ...footprint().syncIdentity!, bindingRevisionId: "binding-1:r2" } })), scope: SCOPE, bindings: repo(binding({ revisionId: "binding-1:r2" })) });
    expect(changed.ok && changed.authority.digest).not.toBe(result.authority.digest);
  });

  const cases: Array<{ code: string; board: PcbBoard; bindings: ComponentPhysicalBinding[] }> = [
    { code: "QA_SYNC_IDENTITY_MISSING", board: board(footprint({ syncIdentity: undefined })), bindings: [binding()] },
    { code: "QA_BINDING_NOT_FOUND", board: board(footprint()), bindings: [] },
    { code: "QA_BINDING_NOT_FOUND", board: board(footprint()), bindings: [binding({ revisionId: "binding-1:r9" })] },
    { code: "QA_BINDING_IDENTITY_MISMATCH", board: board(footprint()), bindings: [binding({ componentIdentity: { componentInstanceId: "someone-else" } as ComponentPhysicalBinding["componentIdentity"] })] },
    { code: "QA_BINDING_NOT_SELECTED", board: board(footprint()), bindings: [binding({ lifecycleState: "candidate" } as Partial<ComponentPhysicalBinding>)] },
    { code: "QA_BINDING_NOT_APPROVED", board: board(footprint()), bindings: [binding({ approval: { state: "pending" } } as unknown as Partial<ComponentPhysicalBinding>)] },
    { code: "QA_BINDING_IDENTITY_MISMATCH", board: board(footprint()), bindings: [binding({ footprint: { ...binding().footprint!, contentDigest: "sha256:tampered" } })] },
    { code: "QA_BINDING_IDENTITY_MISMATCH", board: board(footprint()), bindings: [binding({ footprint: { ...binding().footprint!, assetVersionId: "fp-v2" } })] },
    { code: "QA_MAPPING_NOT_VERIFIED", board: board(footprint()), bindings: [binding({ pinPadMapping: { state: "candidate", mappingCertificateId: "cert-1" } } as unknown as Partial<ComponentPhysicalBinding>)] },
    { code: "QA_MAPPING_NOT_VERIFIED", board: board(footprint()), bindings: [binding({ pinPadMapping: { state: "verified", mappingCertificateId: "cert-other" } } as unknown as Partial<ComponentPhysicalBinding>)] },
    { code: "QA_PACKAGE_AUTHORITY_MISSING", board: board(footprint()), bindings: [binding({ package: undefined })] },
    { code: "QA_PACKAGE_AUTHORITY_MISSING", board: board(footprint()), bindings: [binding({ package: { ...binding().package!, mountingTechnology: "unknown" } })] },
    { code: "QA_PACKAGE_UNSUPPORTED", board: board(footprint()), bindings: [binding({ package: { ...binding().package!, sourceToken: "1206", canonicalName: "1206 (3216 Metric)" } })] },
    { code: "QA_PACKAGE_UNSUPPORTED", board: board(footprint()), bindings: [binding({ package: { ...binding().package!, identitySystem: "manufacturer", canonicalName: "BGA-64 8x8mm P1mm", sourceToken: "BGA-64", pinCount: 64 } })] },
  ];
  it.each(cases)("refuses with $code", async ({ code, board: b, bindings }) => {
    const result = await resolveQualificationComponentAuthority({ board: b, scope: SCOPE, bindings: repo(...bindings) });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.blockers.map((item) => item.code)).toContain(code);
    for (const blocker of result.blockers) { expect(blocker.message).not.toMatch(/sha256:tampered/); expect(blocker.objectIds.length).toBeGreaterThan(0); }
  });

  it("refuses conflicting package classes for one footprint asset and reads bindings only through the board scope", async () => {
    const soic = binding({ componentInstanceId: "inst-2", revisionId: "binding-2:r1", package: { ...binding().package!, identitySystem: "manufacturer", canonicalName: "SOIC-8 3.9x4.9mm P1.27mm", sourceToken: "x", pinCount: 8 } });
    (soic as { scope: { componentInstanceId: string } }).scope.componentInstanceId = "inst-2";
    const second = footprint({ id: "inst-2", ref: "U1", syncIdentity: { ...footprint().syncIdentity!, componentInstanceId: "inst-2", bindingRevisionId: "binding-2:r1" } });
    const result = await resolveQualificationComponentAuthority({ board: board(footprint(), second), scope: SCOPE, bindings: repo(binding(), soic) });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.blockers.map((item) => item.code)).toEqual(["QA_PACKAGE_CLASS_CONFLICT"]);
    const seen: Array<Record<string, unknown>> = [];
    await resolveQualificationComponentAuthority({ board: board(footprint()), scope: SCOPE, bindings: { listSelectedPeers: async (scope) => { seen.push(scope as unknown as Record<string, unknown>); return []; } } });
    expect(seen[0]).toMatchObject({ tenantId: "t", projectId: "p", branchId: "main", boardInstanceId: "board:p", componentInstanceId: "inst-1", hierarchyPath: ["root"] });
  });
});
