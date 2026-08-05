import { describe, expect, it } from "vitest";
import { ASSIGNMENT_API_MAX_BYTES, assignmentApiScope, scopedAssignmentJson } from "../_scope";

const baseHeaders = { "content-type": "application/json", "x-sirkit-tenant-id": "tenant-1", "x-sirkit-project-id": "project-1", "x-sirkit-branch-id": "main", "x-sirkit-actor-id": "reviewer-1", "x-sirkit-role": "reviewer", "x-sirkit-session-id": "session-1" };
function request(body: unknown = {}, headers: Record<string, string> = {}): Request { return new Request("http://localhost/api/assignment-queue", { method: "POST", headers: { ...baseHeaders, ...headers }, body: JSON.stringify(body) }); }

describe("assignment queue API boundary", () => {
  it("requires bounded safe scope and rejects cross-origin or invalid actor claims", async () => {
    expect(assignmentApiScope(new Request("http://localhost/api/assignment-queue")).ok).toBe(false);
    expect(assignmentApiScope(request({}, { "x-sirkit-project-id": "../other" })).ok).toBe(false);
    expect(assignmentApiScope(request({}, { origin: "https://attacker.example" })).ok).toBe(false);
    expect(assignmentApiScope(request({}, { "x-sirkit-actor-kind": "definitely-human" })).ok).toBe(false);
    expect(assignmentApiScope(request({}, { origin: "http://localhost", "x-sirkit-actor-kind": "human" })).ok).toBe(true);
  });

  it("rejects oversized, malformed, non-object, and authoritative mutation payloads", async () => {
    const oversized = request({}, { "content-length": String(ASSIGNMENT_API_MAX_BYTES + 1) });
    expect((await scopedAssignmentJson(oversized)).ok).toBe(false);
    const malformed = new Request("http://localhost/api/assignment-queue", { method: "POST", headers: baseHeaders, body: "{" });
    expect((await scopedAssignmentJson(malformed)).ok).toBe(false);
    expect((await scopedAssignmentJson(request([]))).ok).toBe(false);
    expect((await scopedAssignmentJson(request({ board: {} }))).ok).toBe(false);
  });

  it("uses authenticated scope rather than body scope", async () => {
    const parsed = await scopedAssignmentJson(request({ operation: "preview", tenantId: "attacker" }));
    expect(parsed.ok && parsed.scope.tenantId).toBe("tenant-1");
  });
});
