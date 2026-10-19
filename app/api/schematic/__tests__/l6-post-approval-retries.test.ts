/**
 * [PR-L6 integration, 2026-10-19] SPEND-1 / SPEND-3 (the spend-bound review of increment 6): the automatic post-approval passes
 * (Tidy -> /api/schematic/layout-critic, Review -> /api/schematic/review) run outside the task allowance, once per approved apply. Each
 * now asks the provider for ONE attempt (`maxProviderRetries: 0`), so a pass is billed at most once and its input term is the one
 * request's bound, never six times it. Fake router (vi.mock), no credits, no database.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { injectAuthorizedPrincipal, resetInjectedIdentity } from "@/app/lib/auth/test-support";

vi.mock("@/app/lib/llm/router", () => ({ llmRouter: { generate: vi.fn() } }));
vi.mock("@/app/lib/parts-search", () => ({
  getPartsByIds: vi.fn(async () => []),
  getFullPartsByIds: vi.fn(async () => []),
  searchParts: vi.fn(async () => []),
}));
import { llmRouter } from "@/app/lib/llm/router";
import { POST as layoutCriticPost } from "../layout-critic/route";
import { POST as reviewPost } from "../review/route";

const generate = vi.mocked(llmRouter.generate);
const SEL = { "x-sirkit-tenant-id": "local", "x-sirkit-project-id": "proj-1", "x-sirkit-branch-id": "main" };
function jsonReq(path: string, body: unknown): Request {
  return new Request(`http://localhost${path}`, { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost", ...SEL }, body: JSON.stringify(body) });
}
const authed = (): void => { injectAuthorizedPrincipal({ userId: "e1", tenantId: "local", projectId: "proj-1", role: "editor" }); };
afterEach(() => { resetInjectedIdentity(); generate.mockReset(); });

describe("[PR-L6 integration] the post-approval passes ask for one billed attempt", () => {
  it("Tidy (layout-critic) sends maxProviderRetries 0", async () => {
    authed();
    generate.mockResolvedValue({ provider: "anthropic", model: "m", text: "", toolCalls: [{ id: "t", name: "report_layout_issues", input: { groups: [], summary: "s" } }] });
    const state = { components: [], wires: [], kicadComponents: [{ id: "c1", partId: "p1", refDes: "R1", x: 0, y: 0, rotation: 0, value: "1k" }] };
    const res = await layoutCriticPost(jsonReq("/api/schematic/layout-critic", { state, image: "data:image/png;base64,aGk=", provider: "anthropic" }));
    expect(res.status).toBe(200);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate.mock.calls[0]![0].maxProviderRetries).toBe(0);
  });

  it("Review sends maxProviderRetries 0", async () => {
    authed();
    generate.mockResolvedValue({ provider: "anthropic", model: "m", text: "", toolCalls: [{ id: "t", name: "report_findings", input: { findings: [], summary: "s" } }] });
    const res = await reviewPost(jsonReq("/api/schematic/review", { components: [{ refDes: "R1" }], nets: [], floatingPins: [], provider: "anthropic" }));
    expect(res.status).toBe(200);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate.mock.calls[0]![0].maxProviderRetries).toBe(0);
  });
});
