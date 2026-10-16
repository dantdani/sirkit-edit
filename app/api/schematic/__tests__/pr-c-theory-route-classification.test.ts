/**
 * [PR-C] The Theory route (`POST /api/schematic`) classifies its failures instead of answering a bare 500:
 *
 *  - no `submit_schematic` tool call → 500 `{ ok: false, code: "build_invalid_output", error, retryable: true }` (the
 *    historical error string "no schematic returned" is kept: the B16.0.10 parity suite pins it);
 *  - a tool input that is not an object with `components` and `connections` arrays → the same class;
 *  - a provider failure stays the normalized provider response (503) with the provider's `reason` and `retryable`;
 *  - the success body is unchanged: the raw netlist, read as-is by the Theory client.
 *
 * The real handler runs; the provider router is mocked (no provider, no database).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { injectAuthorizedPrincipal, resetInjectedIdentity } from "@/app/lib/auth/test-support";
import { LLMProviderError } from "@/app/lib/llm/errors";

const SEL = { "x-sirkit-tenant-id": "local", "x-sirkit-project-id": "proj-1", "x-sirkit-branch-id": "main" };
const generate = vi.fn();
vi.mock("@/app/lib/llm/router", () => ({ llmRouter: { generate: (...args: unknown[]) => generate(...args) } }));
vi.spyOn(console, "error").mockImplementation(() => undefined);

async function theory(body: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const { POST } = await import("@/app/api/schematic/route");
  const res = await POST(new Request("http://localhost/api/schematic", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost", ...SEL }, body: JSON.stringify(body) }));
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}
const answer = (toolCalls: Array<{ name: string; input: unknown }>) => ({ provider: "openai", model: "fake", text: "", stopReason: "tool_use", toolCalls: toolCalls.map((call, i) => ({ id: `call-${i}`, ...call })) });

beforeEach(() => { injectAuthorizedPrincipal({ userId: "editor-1", tenantId: "local", projectId: "proj-1", role: "editor" }); });
afterEach(() => { resetInjectedIdentity(); generate.mockReset(); });

describe("[PR-C] invalid model output is a named class, never a bare 500", () => {
  it("no tool call → 500 { ok: false, code: build_invalid_output, retryable: true } with the historical error string", async () => {
    generate.mockResolvedValueOnce(answer([]));
    const { status, body } = await theory({ prompt: "an RC filter", provider: "openai" });
    expect(status).toBe(500);
    expect(body).toEqual({ ok: false, code: "build_invalid_output", error: "no schematic returned", retryable: true });
  });

  it.each([
    ["a non-object input", "nope"],
    ["components that are not an array", { components: "R1", connections: [] }],
    ["no connections array", { components: [] }],
    ["a `nets` array in place of `connections`", { components: [], nets: [] }],
  ])("malformed tool input (%s) → 500 build_invalid_output", async (_label, input) => {
    generate.mockResolvedValueOnce(answer([{ name: "submit_schematic", input }]));
    const { status, body } = await theory({ prompt: "an RC filter" });
    expect(status).toBe(500);
    expect(body).toMatchObject({ ok: false, code: "build_invalid_output", retryable: true });
    expect(typeof body.error).toBe("string");
  });

  it("a valid netlist → 200 with the raw netlist body (unchanged for the Theory client)", async () => {
    const netlist = { components: [{ id: "R1", type: "resistor", value: "1k" }], connections: [], explanation: "a resistor" };
    generate.mockResolvedValueOnce(answer([{ name: "submit_schematic", input: netlist }]));
    const { status, body } = await theory({ prompt: "an RC filter" });
    expect(status).toBe(200);
    expect(body).toEqual(netlist);
  });
});

describe("[PR-C] a provider failure keeps the provider's response", () => {
  it("insufficient_quota → 503 { code: provider_unavailable, reason, retryable: false }", async () => {
    generate.mockRejectedValueOnce(new LLMProviderError("anthropic", "insufficient_quota", 400, "billing_error"));
    const { status, body } = await theory({ prompt: "an RC filter", provider: "anthropic" });
    expect(status).toBe(503);
    expect(body).toMatchObject({ ok: false, code: "provider_unavailable", provider: "anthropic", reason: "insufficient_quota", retryable: false });
  });

  it("rate_limit → 503 with retryable: true", async () => {
    generate.mockRejectedValueOnce(new LLMProviderError("openai", "rate_limit", 429, "rate_limit_exceeded"));
    const { status, body } = await theory({ prompt: "an RC filter" });
    expect(status).toBe(503);
    expect(body).toMatchObject({ ok: false, code: "provider_unavailable", reason: "rate_limit", retryable: true });
  });
});
