import { describe, expect, it } from "vitest";
import { POST as compilePost } from "@/app/api/requirements/compile/route";
import { GET as capabilitiesGet } from "@/app/api/requirements/capabilities/route";
import { POST as sourcePost } from "@/app/api/requirements/sources/route";
import { EMBEDDED_LOW_VOLTAGE_PROFILE_V1 } from "../capability";
import { compileRequirementsPackage } from "../compiler";
import { validateRequirementsPersistence } from "../server-repository";
import { validateDesignRequirementsPackage } from "../validation";
import { candidate, compileInput, NOW, source } from "./fixtures";

const HEADERS = { "content-type": "application/json", "x-sirkit-tenant-id": "tenant:test", "x-sirkit-project-id": "project:test", "x-sirkit-actor-id": "owner" };

describe("CD-1 scoped API and persistence boundaries", () => {
  it("requires tenant/project/actor scope for source ingestion", async () => {
    const response = await sourcePost(new Request("http://test/api/requirements/sources", { method: "POST", body: "{}" }));
    expect(response.status).toBe(401);
  });

  it("ingests a bounded source through the scoped API", async () => {
    const body = { tenantId: "tenant:test", projectId: "project:test", sourceId: "api", sourceKind: "direct_user_statement", sourceVersion: "1", title: "API source", authorityClass: "project_owner_confirmed", mediaType: "text/plain", content: "A board requirement.", capturedAt: NOW, accessPolicy: "project_private", privacyClassification: "confidential" };
    const response = await sourcePost(new Request("http://test/api/requirements/sources", { method: "POST", headers: HEADERS, body: JSON.stringify(body) }));
    const value = await response.json() as { ok: boolean; artifact: { benchmarkUse: string; trustBoundary: string } };
    expect(response.status).toBe(201);
    expect(value.artifact).toMatchObject({ benchmarkUse: "forbidden", trustBoundary: "untrusted_evidence" });
  });

  it("rejects cross-project compile attempts", async () => {
    const response = await compilePost(new Request("http://test/api/requirements/compile", { method: "POST", headers: { ...HEADERS, "x-sirkit-project-id": "other" }, body: JSON.stringify({ input: compileInput() }) }));
    expect(response.status).toBe(403);
  });

  it("uses the server-owned capability registry", async () => {
    const artifact = source(); const input = compileInput(artifact, [candidate(artifact)]);
    input.capabilityProfiles = [{ ...EMBEDDED_LOW_VOLTAGE_PROFILE_V1, profileId: "forged", deterministicDigest: "forged" }];
    const response = await compilePost(new Request("http://test/api/requirements/compile", { method: "POST", headers: HEADERS, body: JSON.stringify({ input }) }));
    const value = await response.json() as { ok: boolean; package?: { selectedCapabilityProfileRefs: string[] } };
    expect(response.status).toBe(200);
    expect(value.ok).toBe(true);
    expect(value.package?.selectedCapabilityProfileRefs).toEqual(["embedded-low-voltage-v1@1.0.0"]);
  });

  it("publishes only versioned capability metadata without secrets", async () => {
    const response = await capabilitiesGet(); const text = await response.text();
    expect(response.status).toBe(200);
    expect(text).toContain("embedded-low-voltage-v1");
    expect(text).not.toMatch(/api[_-]?key|sk-proj/i);
  });

  it("detects package tampering before persistence", () => {
    const compiled = compileRequirementsPackage(compileInput()); if (!compiled.ok) throw new Error("compile failed");
    expect(validateDesignRequirementsPackage(compiled.package)).toBe(true);
    const tampered = structuredClone(compiled.package); tampered.status = "accepted_for_architecture_exploration";
    expect(validateDesignRequirementsPackage(tampered)).toBe(false);
  });

  it("binds persisted packages to the exact source set and capability revision", () => {
    const artifact = source(); const compiled = compileRequirementsPackage(compileInput(artifact)); if (!compiled.ok) throw new Error("compile failed");
    expect(() => validateRequirementsPersistence({ tenantId: artifact.tenantId, projectId: artifact.projectId, package: compiled.package, sources: [artifact], profile: EMBEDDED_LOW_VOLTAGE_PROFILE_V1 })).not.toThrow();
    expect(() => validateRequirementsPersistence({ tenantId: artifact.tenantId, projectId: artifact.projectId, package: compiled.package, sources: [], profile: EMBEDDED_LOW_VOLTAGE_PROFILE_V1 })).toThrow("SOURCE_SET_DIGEST_MISMATCH");
  });
});

