// AI rule endpoint (Stage 10): valid brief, retry-on-invalid, 422 on double
// failure, mm→nm conversion, explanation length. Claude is mocked.
//
// B16.0.1: the route is now authenticated via authorizeRequest (server-derived
// identity + active project membership + same-origin CSRF). Requests carry the
// x-sirkit-* project SELECTOR headers (never authority) and a same-origin
// Origin header; identity itself resolves server-side (local_dev principal by
// default, or the injected test principal).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { injectAuthorizedPrincipal, injectIdentity, resetInjectedIdentity } from "@/app/lib/auth/test-support";

const createMock = vi.hoisted(() => vi.fn());
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: createMock };
  },
}));

import { POST } from "@/app/api/pcb/ai-rules/from-brief/route";

interface MockToolInput {
  changes: unknown[];
  explanation: string;
}
function toolResponse(input: MockToolInput, id = "tu_1") {
  return {
    content: [{ type: "tool_use", id, name: "emit_rule_delta", input }],
    stop_reason: "tool_use",
    model: "claude-test",
    usage: { input_tokens: 10, output_tokens: 5 },
  };
}

function post(body: unknown): Promise<Response> {
  return POST(
    new Request("http://localhost/api/pcb/ai-rules/from-brief", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        // B16.0.1: same-origin CSRF — Origin must match the request URL host.
        origin: "http://localhost",
        // B16.0.1: project/branch SELECTOR headers (never identity/authority).
        "x-sirkit-tenant-id": "local",
        "x-sirkit-project-id": "project-1",
        "x-sirkit-branch-id": "main",
      },
      body: JSON.stringify(body),
    }),
  );
}

const BRIEF = {
  provider: "anthropic",
  brief: "2A USB-C power board",
  board: { netNames: ["VBUS", "GND", "DP", "DN"], hasIcs: true },
};

beforeEach(() => createMock.mockReset());
afterEach(() => resetInjectedIdentity());

describe("POST /api/pcb/ai-rules/from-brief", () => {
  it("valid brief → { ok: true, delta } with a well-formed RuleDelta", async () => {
    createMock.mockResolvedValueOnce(
      toolResponse({
        changes: [{ className: "Power", trackWidthMm: 1.0, appliesTo: { kind: "namePattern", regex: "^(VBUS|5V)$" } }],
        explanation: "Widened power nets for 2 A USB-C delivery.",
      }),
    );
    const res = await post(BRIEF);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.delta.source).toBe("ai-brief");
    expect(body.delta.brief).toBe(BRIEF.brief);
    expect(typeof body.delta.id).toBe("string");
    expect(body.delta.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/); // ISO
    expect(body.delta.changes[0].appliesTo).toEqual({ kind: "namePattern", regex: "^(VBUS|5V)$" });
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it("converts trackWidthMm 1.5 → trackWidthNm 1_500_000", async () => {
    createMock.mockResolvedValueOnce(
      toolResponse({
        changes: [{ className: "Power", trackWidthMm: 1.5, appliesTo: { kind: "class", classId: "Power" } }],
        explanation: "1.5 mm on the Power class.",
      }),
    );
    const body = await (await post(BRIEF)).json();
    expect(body.ok).toBe(true);
    expect(body.delta.changes[0].trackWidthNm).toBe(1_500_000);
  });

  it("converts a manufacturable via recommendation with its trace width", async () => {
    createMock.mockResolvedValueOnce(
      toolResponse({
        changes: [{
          className: "Power",
          trackWidthMm: 1.2,
          viaSizeMm: 0.8,
          viaDrillMm: 0.4,
          appliesTo: { kind: "class", classId: "Power" },
        }],
        explanation: "Sized the power trace and layer transition together.",
      }),
    );
    const body = await (await post(BRIEF)).json();
    expect(body.ok).toBe(true);
    expect(body.delta.changes[0]).toMatchObject({
      trackWidthNm: 1_200_000,
      viaSizeNm: 800_000,
      viaDrillNm: 400_000,
    });
  });

  it("rejects an unsafe annular ring and accepts a corrected retry", async () => {
    createMock
      .mockResolvedValueOnce(toolResponse({
        changes: [{ viaSizeMm: 0.5, viaDrillMm: 0.4, appliesTo: { kind: "class", classId: "Power" } }],
        explanation: "Unsafe ring.",
      }))
      .mockResolvedValueOnce(toolResponse({
        changes: [{ viaSizeMm: 0.8, viaDrillMm: 0.4, appliesTo: { kind: "class", classId: "Power" } }],
        explanation: "Corrected annular ring.",
      }));
    const response = await post(BRIEF);
    expect(response.status).toBe(200);
    expect(createMock).toHaveBeenCalledTimes(2);
  });

  it("malformed on first try, valid on retry → 200", async () => {
    createMock
      .mockResolvedValueOnce(toolResponse({ changes: [{ appliesTo: { kind: "class" } }], explanation: "bad" })) // classId missing
      .mockResolvedValueOnce(
        toolResponse({
          changes: [{ className: "Power", appliesTo: { kind: "class", classId: "Power" } }],
          explanation: "Fixed.",
        }),
      );
    const res = await post(BRIEF);
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
    expect(createMock).toHaveBeenCalledTimes(2); // one retry
  });

  it("two failed attempts → 422 with the first validation error", async () => {
    createMock
      .mockResolvedValueOnce(toolResponse({ changes: [{ appliesTo: { kind: "nets", netIds: ["x"] } }], explanation: "bad1" }))
      .mockResolvedValueOnce(toolResponse({ changes: [{ trackWidthMm: 99, appliesTo: { kind: "class", classId: "Power" } }], explanation: "bad2" }));
    const res = await post(BRIEF);
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(typeof body.error).toBe("string");
    expect(createMock).toHaveBeenCalledTimes(2);
  });

  it("truncates an over-long explanation to ≤ 300 chars (1-2 sentences)", async () => {
    createMock.mockResolvedValueOnce(
      toolResponse({
        changes: [{ className: "Power", appliesTo: { kind: "class", classId: "Power" } }],
        explanation: "x".repeat(500),
      }),
    );
    const body = await (await post(BRIEF)).json();
    expect(body.ok).toBe(true);
    expect(body.delta.explanation.length).toBeLessThanOrEqual(300);
  });

  it("rejects a malformed request body with 400 (no model call)", async () => {
    const res = await post({ brief: "", board: { netNames: [], hasIcs: true } });
    expect(res.status).toBe(400);
    expect(createMock).not.toHaveBeenCalled();
  });

  // B16.0.1: identity is server-derived (never from x-sirkit-* headers). An
  // unauthenticated request is refused with 401 BEFORE any provider credit is
  // spent — a strictly stronger guarantee than the old header-asserted model.
  it("rejects an unauthenticated request with 401 (no model call)", async () => {
    injectIdentity(null);
    const res = await post(BRIEF);
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe("AUTH_UNAUTHENTICATED");
    expect(createMock).not.toHaveBeenCalled();
  });

  // B16.0.1: the role comes from active project MEMBERSHIP, not a header. A
  // viewer is not in the propose-route EDITORS set → 403 before the model call.
  it("refuses a viewer membership with 403 AUTH_ROLE_DENIED (no model call)", async () => {
    injectAuthorizedPrincipal({ userId: "viewer-1", tenantId: "local", projectId: "project-1", role: "viewer" });
    const res = await post(BRIEF);
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("AUTH_ROLE_DENIED");
    expect(createMock).not.toHaveBeenCalled();
  });
});
