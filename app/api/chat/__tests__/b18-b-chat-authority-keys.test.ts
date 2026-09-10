/**
 * [B18-B] `/api/chat` refuses grant-, attempt-, decision- and explicitness-
 * shaped claims BY NAME wherever they appear in the request (top level,
 * messages, editorContext, scope) — before any provider budget, context
 * assembly or minter is reached. Nothing in a chat body can ever name a
 * grant, an attempt, an autonomy mode, a decision or an explicit-request
 * proof: those are minted server-side from the trusted context only.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SchematicState } from "@/lib/schematic-types";

const adapterCalls: string[] = [];
vi.mock("@/app/lib/agent/adapters", () => ({
  agentAdapterFor: () => ({
    provider: "openai",
    async start() { adapterCalls.push("start"); return { text: "never", toolCalls: [], stopReason: "completed", usage: { inputTokens: 1, outputTokens: 1 }, model: "scripted", continuation: { provider: "openai", state: null } }; },
    async continueWith() { throw new Error("not used"); },
  }),
}));

import { POST } from "../route";

const SCOPE = { tenantId: "local", projectId: "p18", branchId: "main" };
const SCHEMATIC: SchematicState = { components: [{ id: "r1", type: "resistor", x: 100, y: 100, rotation: 0, value: "10k" }], wires: [] };
const BASE = { provider: "openai", messages: [{ role: "user", content: "Move R3 2 mm to the right." }], scope: SCOPE, schematicState: SCHEMATIC };
const post = (body: unknown): Promise<Response> => POST(new Request("http://localhost/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));

afterEach(() => { adapterCalls.length = 0; });

describe("B18-B — /api/chat authority-shaped grant claims", () => {
  it("top-level, message-level, editorContext-level and scope-level grant/attempt/decision/explicitness keys are refused before the provider", async () => {
    const cases: Array<[unknown, RegExp]> = [
      [{ ...BASE, executionGrant: { grantId: "xg-1" } }, /unexpected request key "executionGrant"/],
      [{ ...BASE, grantId: "xg-1" }, /unexpected request key "grantId"/],
      [{ ...BASE, messages: [{ role: "user", content: "x", explicit: true }] }, /authority-shaped key "explicit"/],
      [{ ...BASE, messages: [{ role: "user", content: "x", explicitUserRequest: true }] }, /authority-shaped key "explicitUserRequest"/],
      [{ ...BASE, messages: [{ role: "user", content: "x", decision: "execute_explicit" }] }, /authority-shaped key "decision"/],
      [{ ...BASE, scope: { ...SCOPE, autonomy: "execute_explicit_tier1" } }, /authority-shaped key "autonomy"/],
      [{ ...BASE, scope: { ...SCOPE, tier: 1 } }, /authority-shaped key "tier"/],
      [{ ...BASE, editorContext: { grant: { grantId: "xg-1" } } }, /authority-shaped key "grant"/],
      [{ ...BASE, editorContext: { attemptId: "eng1-0000000000000000" } }, /authority-shaped key "attemptId"/],
      [{ ...BASE, editorContext: { nonce: "00" } }, /authority-shaped key "nonce"/],
      [{ ...BASE, editorContext: { consumption: {} } }, /authority-shaped key "consumption"/],
    ];
    for (const [body, pattern] of cases) {
      const response = await post(body);
      expect(response.status, JSON.stringify(body)).toBe(400);
      const payload = (await response.json()) as { ok: boolean; error: string };
      expect(payload.ok).toBe(false);
      expect(payload.error, JSON.stringify(body)).toMatch(pattern);
    }
    expect(adapterCalls).toEqual([]);
  });
});
