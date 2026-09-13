/**
 * [B19-B I2b] The cross-verify second opinion's outbound call, at the route — a fake transport, no endpoint, no token.
 *
 * `/api/schematic/cross-verify` POSTs the user's prompt, with a bearer, to the operator-configured `SCHGEN_ENDPOINT_URL`.
 * Before B19 it did that with a plain `fetch`: any redirect was followed (measured on Node 24.15 with two loopback
 * servers: to a loopback address, with the prompt re-sent, and with the bearer kept on a same-origin hop — Node does drop
 * it on a cross-origin hop), the answer was buffered whole, and a failure answered the CALLER with the endpoint's status
 * plus the first 200 bytes of whatever the final hop returned, or with the transport's own error text.
 *
 * The configured URL is operator configuration, not user input, so its host is the allowlist. Every other rule of the
 * bounded egress path still applies to it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/lib/parts-search", () => ({
  getPartsByIds: vi.fn(async () => []),
  getFullPartsByIds: vi.fn(async () => []),
  searchParts: vi.fn(async () => []),
}));
// The resolver: the configured endpoint's name resolves to a public address; `internal.example.com` resolves inward.
vi.mock("node:dns/promises", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  const lookup = vi.fn(async (hostname: string) => {
    const address = hostname === "internal.example.com" ? "10.0.0.5" : "93.184.216.34";
    return [{ address, family: 4 }];
  });
  return { ...actual, lookup, default: { ...(actual.default as object), lookup } };
});

const ENDPOINT = "https://schgen.example.com/generate";
const TOKEN = "hf_DUMMY-TOKEN-DO-NOT-LEAK-0123456789";
const PROJECT = "proj-b19-xv";
const SEL = { "x-sirkit-tenant-id": "local", "x-sirkit-project-id": PROJECT, "x-sirkit-branch-id": "main" };
const BODY = { prompt: "a 555 blinker", state: { components: [], wires: [], kicadComponents: [{ id: "c1", partId: "p1", refDes: "R1", x: 0, y: 0, rotation: 0, value: "1k" }] } };

type Call = { url: string; init: RequestInit | undefined };
let calls: Call[] = [];

function transport(answer: (call: Call) => Response | Promise<Response>): void {
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const call = { url: typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url, init };
    calls.push(call);
    return answer(call);
  });
}

let resetIdentity: (() => void) | null = null;

/** `endpoint: null` leaves the endpoint unset. */
async function callRoute(endpoint: string | null = ENDPOINT): Promise<{ status: number; text: string }> {
  if (endpoint !== null) vi.stubEnv("SCHGEN_ENDPOINT_URL", endpoint);
  vi.stubEnv("SCHGEN_ENDPOINT_TOKEN", TOKEN);
  vi.resetModules(); // the route may read its configuration when it loads
  const { POST } = await import("../cross-verify/route");
  // the identity seam from the SAME module instance the freshly loaded route uses
  const support = await import("@/app/lib/auth/test-support");
  resetIdentity = support.resetInjectedIdentity;
  support.injectAuthorizedPrincipal({ userId: "e1", tenantId: "local", projectId: PROJECT, role: "editor" });
  const res = await POST(new Request("http://localhost/api/schematic/cross-verify", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost", ...SEL },
    body: JSON.stringify(BODY),
  }));
  return { status: res.status, text: await res.text() };
}

beforeEach(() => {
  calls = [];
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  resetIdentity?.();
  resetIdentity = null;
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function redirectMode(call: Call): RequestRedirect | undefined {
  return call.init?.redirect;
}

describe("[B19-B I2b] the second opinion never follows the endpoint somewhere else", () => {
  it("a redirect is refused, not followed: one request, made with redirects under the caller's control", async () => {
    transport(() => new Response(null, { status: 307, headers: { location: "http://127.0.0.1:9/steal" } }));
    const { status, text } = await callRoute();
    expect(calls).toHaveLength(1);
    expect(redirectMode(calls[0]!), "the transport must never follow a redirect by itself").toBe("manual");
    expect(status).toBe(502);
    for (const leaked of ["127.0.0.1", "steal"]) expect(text).not.toContain(leaked);
    expect(JSON.parse(text)).toMatchObject({ ok: false, error: "Second-opinion generation failed: the endpoint answered with a redirect, and redirects are refused." });
  });

  it.each([
    ["cloud metadata over HTTP", "http://169.254.169.254/latest/meta-data"],
    ["a loopback address", "https://127.0.0.1/generate"],
    ["an IPv6 loopback address", "https://[::1]/generate"],
    ["a name that resolves inward", "https://internal.example.com/generate"],
    ["plain HTTP", "http://schgen.example.com/generate"],
  ])("an endpoint configured as %s is refused before any request is made", async (_label, endpoint) => {
    transport(() => new Response(JSON.stringify({ code: "never" }), { status: 200, headers: { "content-type": "application/json" } }));
    const { status, text } = await callRoute(endpoint);
    expect(calls, "no byte may leave for a non-permitted endpoint").toHaveLength(0);
    expect(status).toBe(502);
    expect(JSON.parse(text)).toMatchObject({ ok: false, error: "Second-opinion generation failed: the configured endpoint is not permitted: it must be an HTTPS address on the public internet." });
  });
});

describe("[B19-B I2b] a failure is reported, never repeated", () => {
  it("the endpoint's own error body never reaches the caller; its status may", async () => {
    transport(() => new Response("INTERNAL-ONLY: instance credentials would be here", { status: 500, headers: { "content-type": "text/plain" } }));
    const { status, text } = await callRoute();
    expect(status).toBe(502);
    expect(text).not.toContain("INTERNAL-ONLY");
    expect(JSON.parse(text)).toMatchObject({ ok: false, error: "Second-opinion generation failed: the endpoint answered with an error (HTTP 500)." });
  });

  it("the transport's own error text never reaches the caller, and neither does the token", async () => {
    transport(() => { throw new Error(`connect ECONNREFUSED 10.1.2.3:443 while sending Authorization: Bearer ${TOKEN}`); });
    const { status, text } = await callRoute();
    expect(status).toBe(502);
    for (const leaked of ["ECONNREFUSED", "10.1.2.3", TOKEN, "hf_"]) expect(text).not.toContain(leaked);
    expect(JSON.parse(text)).toMatchObject({ ok: false, error: "Second-opinion generation failed: the endpoint could not be reached." });
  });

  it("nothing the route logs carries the token", async () => {
    transport(() => { throw new Error(`socket hang up; Authorization: Bearer ${TOKEN}`); });
    await callRoute();
    const logged = vi.mocked(console.error).mock.calls.map((args) => args.map(String).join(" ")).join("\n");
    expect(logged).not.toContain(TOKEN);
  });
});

describe("[B19-B I2b] the answer is bounded", () => {
  it("an oversized answer is refused rather than buffered", async () => {
    const huge = JSON.stringify({ code: "x".repeat(2_000_000) });
    transport(() => new Response(huge, { status: 200, headers: { "content-type": "application/json" } }));
    const { status, text } = await callRoute();
    expect(status).toBe(502);
    expect(JSON.parse(text)).toMatchObject({ ok: false, error: "Second-opinion generation failed: the endpoint's answer was not usable." });
  });
});

describe("[B19-B I2b] the working path is unchanged", () => {
  it("the bearer goes to the configured endpoint only, as a header, and a usable answer is compared", async () => {
    const code = 'add_schematic_symbol("R1", "Device:R")\nadd_schematic_symbol("R2", "Device:R")\nconnect_pins("R1", "1", "R2", "1")\n';
    transport(() => new Response(JSON.stringify({ code }), { status: 200, headers: { "content-type": "application/json" } }));
    const { status, text } = await callRoute();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(ENDPOINT);
    expect(new Headers(calls[0]!.init?.headers).get("authorization")).toBe(`Bearer ${TOKEN}`);
    expect(JSON.parse(String(calls[0]!.init?.body))).toMatchObject({ inputs: BODY.prompt, prompt: BODY.prompt });
    expect(status).toBe(200);
    expect(JSON.parse(text)).toMatchObject({ ok: true, available: true });
  });

  it("unconfigured stays available:false with no request", async () => {
    transport(() => new Response("{}", { status: 200 }));
    const { status, text } = await callRoute(null);
    expect(calls).toHaveLength(0);
    expect(status).toBe(200);
    expect(JSON.parse(text)).toMatchObject({ ok: true, available: false });
  });
});
