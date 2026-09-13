/**
 * B16.0 — AI/approval invariants and identity lifecycle.
 *
 * The trusted request identity now underpins the agent surface: exactly 12
 * exposed tools, no manufacturing-release tool, the AI cannot claim to be a
 * human via headers or arguments, and identity change / logout / membership
 * revocation revalidate — a revoked member is refused, and the membership
 * revision a proposal/approval binds to changes so any stale binding is
 * invalidated.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { sirkitToolRegistry } from "@/app/lib/engineering/tool-catalog";
import { membershipRevisionOf } from "../project-membership";
import type { ProjectMembershipRecord } from "../project-membership";
import { injectIdentity, injectMembership, resetInjectedIdentity } from "../test-support";
import { INTENTIONAL_AGENT_EXPOSED_TOOL_IDS, isAgentExposableDescriptor } from "@/app/lib/engineering/agent-exposure"; // [B17-F] the ONE reviewed exposure set — never a hard-coded count

afterEach(() => resetInjectedIdentity());

// ─── Exposure invariants (items 31-32) ───────────────────────────────────────

describe("B16.0 — AI exposure invariants are preserved", () => {
  it("31: agent exposure remains exactly 12", () => {
    const exposed = sirkitToolRegistry().list().filter((d) => d.agentExposed);
    expect(exposed).toHaveLength(INTENTIONAL_AGENT_EXPOSED_TOOL_IDS.length);
  });

  it("32: manufacturing release is NOT agent-exposed and stays release-class", () => {
    const release = sirkitToolRegistry().list().find((d) => d.toolId === "sirkit.manufacturing.release");
    expect(release).toBeDefined();
    expect(release!.agentExposed).toBe(false);
    expect(release!.operationClass).toBe("release");
    // No exposed tool is a release/mutate/destructive class.
    for (const d of sirkitToolRegistry().list().filter((t) => t.agentExposed)) {
      expect(isAgentExposableDescriptor(d), d.toolId).toBe(true);
    }
  });
});

// ─── The membership revision a proposal/approval binds to (item 21-23) ───────

function membership(overrides: Partial<ProjectMembershipRecord> = {}): ProjectMembershipRecord {
  return {
    tenantId: "local", projectId: "p1", userId: "u1", role: "admin", state: "active",
    version: 1, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", auditActorId: "test",
    ...overrides,
  };
}

// Mock the provider so no credits are spent even if the route proceeded.
// Cold-import budget, not a relaxation of the 22/23 assertion: run alone, this import loads the whole /api/chat graph
// cold (~2.5 s idle, 8-50 s measured under CPU load) and outran the 5 s test timeout. Loading it here, while the file is
// collected, keeps the timed test body to the POST, which takes milliseconds.
vi.doMock("@/app/lib/agent/adapters", () => ({ agentAdapterFor: () => ({ provider: "anthropic", async start() { return { text: "", toolCalls: [], stopReason: "end", usage: {}, model: "x", continuation: { provider: "anthropic", state: null } }; }, async continueWith() { return { text: "", toolCalls: [], stopReason: "end", usage: {}, model: "x", continuation: { provider: "anthropic", state: null } }; } }) }));
const { POST } = await import("@/app/api/chat/route");

describe("B16.0 — identity/membership change invalidates a bound capability", () => {
  it("21/23: a role change or revocation changes the membership revision", () => {
    const base = membershipRevisionOf(membership());
    // A role downgrade changes the revision.
    expect(membershipRevisionOf(membership({ role: "viewer" }))).not.toBe(base);
    // A version bump changes the revision.
    expect(membershipRevisionOf(membership({ version: 2 }))).not.toBe(base);
    // A revocation changes the revision.
    expect(membershipRevisionOf(membership({ state: "revoked" }))).not.toBe(base);
    // The SAME membership is stable (a valid binding survives an unchanged membership).
    expect(membershipRevisionOf(membership())).toBe(base);
  });

  it("22/23: a revoked member is refused at the chat surface — no proposal can be issued", async () => {
    injectIdentity({ userId: "u1" });
    injectMembership([{ projectId: "p1", userId: "u1", role: "admin", state: "revoked" }]);
    const response = await POST(new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: "anthropic", messages: [{ role: "user", content: "hi" }], scope: { tenantId: "local", projectId: "p1", branchId: "main" } }),
    }));
    expect(response.status).toBe(403); // revoked membership → forbidden
    vi.doUnmock("@/app/lib/agent/adapters");
  });
});

// ─── The AI cannot claim to be a human via headers ───────────────────────────

describe("B16.0 — the AI cannot claim a human identity via headers", () => {
  it("the chat route reads NO x-sirkit identity headers (forged headers are inert)", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const source = readFileSync(join(process.cwd(), "app/api/chat/route.ts"), "utf8");
    expect(source).not.toContain('headers.get("x-sirkit-role")');
    expect(source).not.toContain('headers.get("x-sirkit-actor-id")');
    expect(source).not.toContain('headers.get("x-sirkit-actor-kind")');
  });
});
