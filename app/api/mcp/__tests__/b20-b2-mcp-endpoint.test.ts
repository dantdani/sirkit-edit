/**
 * [B20 B2] POST /api/mcp — the Sirkit MCP endpoint (MCP 2026-07-28, Streamable HTTP, JSON responses only), end to end
 * through the canonical wrapper `mcpBearerJsonRoute` and the JSON-RPC dispatch. Every case asserts the HTTP status as well
 * as the code. The environment is stubbed with the flag, the configured origin and a secret assembled at run time; tokens
 * are minted with the injected clock, or hand-signed; membership is the in-memory test repository.
 */
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetIdentityProviderFactory, setIdentityProviderFactory, setMembershipRepositoryFactory } from "@/app/lib/auth/identity-runtime";
import {
  MCP_TOKEN_HEADER_B64,
  MCP_TOKEN_SECRET_ENV,
  __setMcpServerClockForTests,
  createSirkitHmacVerifier,
  mintMcpAccessToken,
  resetMcpAccessTokenVerifierFactory,
  setMcpAccessTokenVerifierFactory,
} from "@/app/lib/auth/mcp-bearer";
import { membershipRevisionOf, type MembershipRole } from "@/app/lib/auth/project-membership";
import { mcpBearerJsonRoute } from "@/app/lib/auth/route-handlers";
import { policyFor, type RoutePolicy } from "@/app/lib/auth/route-policy";
import { injectMembership, injectMembershipRepository, resetInjectedIdentity } from "@/app/lib/auth/test-support";
import type { InMemoryProjectMembershipRepository, ProjectMembershipRepository } from "@/app/lib/auth/project-membership";
import { INTENTIONAL_AGENT_EXPOSED_TOOL_IDS } from "@/app/lib/engineering/agent-exposure";
import { engineeringDigest } from "@/app/lib/engineering/stable";
import { sirkitToolRegistry } from "@/app/lib/engineering/tool-catalog";
import type { ToolRegistry } from "@/app/lib/engineering/tool-registry";
import { encodeMcpNameHeader } from "@/app/lib/mcp/http-transport";
import { InMemoryDurableWorkflowRepository } from "@/app/lib/durable-workflow/repository";
import { createDurableBoardReader, readOnlyDurableWorkflow } from "@/app/lib/engineering/durable-read-bundle";
import { MCP_DISCOVER_INSTRUCTIONS } from "@/app/lib/mcp/server/protocol";
import { membershipReverifier, resetMcpReadStateForTests } from "@/app/lib/mcp/server/read-call";
import { resetMcpReadDependenciesFactory, setMcpReadDependenciesFactory } from "../read-runtime";
import { handleMcpRequest } from "@/app/lib/mcp/server/dispatch";
import { resetMcpInboundLimitsForTests } from "@/app/lib/mcp/server/inbound-limits";
import { MCP_SERVER_TRACE_SCHEMA, mcpServerTraceRing, resetMcpServerTraceSinkFactory, setMcpServerTraceSinkFactory, type McpServerRequestTrace } from "@/app/lib/mcp/server/request-trace";
import { MCP_TOOL_LISTING_SCHEMA, renderMcpToolListing } from "@/app/lib/mcp/server/tool-definitions";
import * as endpoint from "../route";

/** E14 only: a policy row the wrapper reads instead of the real one (null passes every lookup through unchanged). */
const policyOverride = vi.hoisted(() => ({ current: null as null | ((path: string, method: string) => unknown) }));
vi.mock("@/app/lib/auth/route-policy", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/app/lib/auth/route-policy")>();
  return { ...actual, policyFor: (path: string, method: string) => (policyOverride.current ? policyOverride.current(path, method) : actual.policyFor(path, method)) };
});

const { POST } = endpoint;
const ROOT = process.cwd();
const ORIGIN = "https://mcp.example.com";
const URL_MCP = `${ORIGIN}/api/mcp`;
const METADATA_URL = `${ORIGIN}/.well-known/oauth-protected-resource/api/mcp`;
const SECRET = ["b2", "fixture", "mcp", "token", "secret", "0123456789abcdef"].join("-");
const WORKER = ["b2", "fixture", "worker", "secret", "fedcba9876543210"].join("-");
const T0 = Date.UTC(2026, 8, 20, 12, 0, 0);
const USER = "user-mcp-0001";
const PROJECT = "proj-mcp";
const V = "2026-07-28";
const META = { "io.modelcontextprotocol/protocolVersion": V, "io.modelcontextprotocol/clientCapabilities": {} };
const CHALLENGE = `Bearer resource_metadata="${METADATA_URL}", scope="sirkit.mcp"`;
const CHALLENGE_INVALID_REQUEST = `${CHALLENGE}, error="invalid_request"`;
const CHALLENGE_INVALID_TOKEN = `${CHALLENGE}, error="invalid_token", error_description="The access token is invalid or expired."`;
const SUPPORTED = { supported: [V] };
const ROLE_MAP: Record<MembershipRole, string> = { viewer: "viewer", commenter: "commenter", editor: "pcb_editor", reviewer: "reviewer", admin: "project_admin" };

let now = T0;
let repo: InMemoryProjectMembershipRepository;

function stubMcp(): void {
  vi.stubEnv("SIRKIT_MCP_ENABLED", "1");
  vi.stubEnv("SIRKIT_EXPECTED_ORIGIN", ORIGIN);
  vi.stubEnv(MCP_TOKEN_SECRET_ENV, SECRET);
  vi.stubEnv("SIRKIT_WORKFLOW_WORKER_SECRET", undefined);
  vi.stubEnv("KICAD_HTTP_LIBRARY_TOKEN", undefined);
  vi.stubEnv("SIRKIT_AUTH_MODE", undefined);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", undefined);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", undefined);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", undefined);
}
function member(role: MembershipRole = "editor", user = USER, project = PROJECT, version = 1): void {
  repo.set({ tenantId: "local", projectId: project, userId: user, role, state: "active", version, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", auditActorId: "test" });
}
async function tokenFor(user = USER, project = PROJECT, nowMs = T0): Promise<string> {
  const record = await repo.loadActiveMembership({ tenantId: "local", projectId: project, userId: user });
  if (!record) throw new Error("fixture: no membership");
  const minted = mintMcpAccessToken({ subject: user, tenantId: "local", projectId: project, branchId: "main", membershipRevision: membershipRevisionOf(record) }, { environment: process.env, nowMs });
  if (!minted.ok) throw new Error(`fixture: mint ${minted.reason}`);
  return minted.token;
}
const b64url = (value: string): string => Buffer.from(value).toString("base64url");
function handSigned(claims: Record<string, unknown>, header = MCP_TOKEN_HEADER_B64, secret = SECRET): string {
  const payload = b64url(JSON.stringify(claims));
  return `${header}.${payload}.${createHmac("sha256", Buffer.from(secret, "utf8")).update(`${header}.${payload}`, "ascii").digest("base64url")}`;
}
async function claimsFor(overrides: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const record = (await repo.loadActiveMembership({ tenantId: "local", projectId: PROJECT, userId: USER }))!;
  return { iss: ORIGIN, aud: URL_MCP, sub: USER, iat: T0 / 1000, exp: T0 / 1000 + 3600, jti: "AbCdEfGhIjKlMnOpQrStUv", scope: "sirkit.mcp", sirkit_tenant: "local", sirkit_project: PROJECT, sirkit_branch: "main", sirkit_mbr: membershipRevisionOf(record), ...overrides };
}

type Message = Record<string, unknown>;
const rpc = (method: string, params: Record<string, unknown> = {}, id: unknown = 1): Message => ({ jsonrpc: "2.0", id, method, params: { ...params, _meta: META } });
const notification = (method: string): Message => ({ jsonrpc: "2.0", method, params: { _meta: META } });

type HeaderPatch = Record<string, string | null>;
interface CallOptions { token?: string | null; headers?: HeaderPatch; body?: string | Uint8Array | ReadableStream<Uint8Array>; url?: string }
function request(message: Message | null, options: CallOptions = {}): Request {
  const method = message && typeof message.method === "string" ? message.method : "";
  const params = (message?.params ?? {}) as Record<string, unknown>;
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    "mcp-protocol-version": V,
    ...(method ? { "mcp-method": method } : {}),
    ...(method === "tools/call" && typeof params.name === "string" ? { "mcp-name": encodeMcpNameHeader(params.name) } : {}),
    ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
  };
  for (const [name, value] of Object.entries(options.headers ?? {})) {
    if (value === null) delete headers[name];
    else headers[name] = value;
  }
  const body = options.body ?? JSON.stringify(message);
  return new Request(options.url ?? URL_MCP, { method: "POST", headers, body, ...(body instanceof ReadableStream ? { duplex: "half" } : {}) } as RequestInit);
}
async function call(message: Message | null, options: CallOptions = {}): Promise<{ status: number; body: Record<string, unknown>; text: string; headers: Headers }> {
  const response = await POST(request(message, options));
  const text = await response.text();
  let body: Record<string, unknown> = {};
  try { body = text ? (JSON.parse(text) as Record<string, unknown>) : {}; } catch { body = {}; }
  return { status: response.status, body, text, headers: response.headers };
}
const errorOf = (body: Record<string, unknown>): { code: number; message: string; data?: unknown } => body.error as { code: number; message: string; data?: unknown };
function counting(counter: { pulls: number }): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({ pull(controller) { counter.pulls += 1; controller.enqueue(new TextEncoder().encode(JSON.stringify(rpc("server/discover")))); controller.close(); } }, { highWaterMark: 0 });
}
/** The served subset for a mapped project role, exactly as B1 renders it. */
function servedFor(role: string): Array<{ name: string }> {
  const registry = sirkitToolRegistry();
  return renderMcpToolListing(registry).tools.filter((tool) => registry.get(tool.name, tool._meta["dev.sirkit/toolVersion"])!.requiredRoles.includes(role as never)) as Array<{ name: string }>;
}

beforeEach(() => {
  stubMcp();
  now = T0;
  __setMcpServerClockForTests(() => now);
  resetMcpInboundLimitsForTests();
  resetMcpServerTraceSinkFactory();
  repo = injectMembership([]);
  member("editor");
  // [B20 B3] the read-dependency seam: a listed read is served from an empty in-memory durable repository (never a database)
  resetMcpReadStateForTests();
  setMcpReadDependenciesFactory(() => ({ boardReader: createDurableBoardReader(readOnlyDurableWorkflow(new InMemoryDurableWorkflowRepository())), componentAuthority: () => null, membership: membershipReverifier(() => repo), now: () => now, randomBytes: (size) => new Uint8Array(size) }));
});
afterEach(() => {
  resetMcpReadDependenciesFactory();
  resetMcpReadStateForTests();
  policyOverride.current = null;
  __setMcpServerClockForTests(null);
  resetMcpAccessTokenVerifierFactory();
  resetMcpServerTraceSinkFactory();
  resetInjectedIdentity();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("[B20 B2] E1 — credentials", () => {
  it("anonymous: 401 MCP_UNAUTHENTICATED with the exact challenge and no error code, zero body pulls, membership never read", async () => {
    const load = vi.spyOn(repo, "loadActiveMembership");
    const counter = { pulls: 0 };
    const { status, body, headers } = await call(rpc("server/discover"), { body: counting(counter) });
    expect(status).toBe(401);
    expect(body).toMatchObject({ ok: false, code: "MCP_UNAUTHENTICATED" });
    expect(headers.get("www-authenticate")).toBe(CHALLENGE);
    expect(headers.get("cache-control")).toBe("no-store");
    expect(counter.pulls).toBe(0);
    expect(load).not.toHaveBeenCalled();
  });

  it("a cookie session only, and the real local_dev provider with no bearer: 401, and no verifier or identity provider is ever called", async () => {
    const verifier = createSirkitHmacVerifier();
    const verify = vi.spyOn(verifier, "verify");
    setMcpAccessTokenVerifierFactory(() => verifier);
    const identity = vi.fn(async () => ({ userId: USER, sessionId: "cookie-session", authMethod: "supabase_cookie" as const, authStrength: "aal1" as const }));
    setIdentityProviderFactory(() => ({ verify: identity }));
    const cookie = await call(rpc("server/discover"), { headers: { cookie: "sb-access-token=cookie-value" } });
    expect(cookie.status).toBe(401);
    expect(cookie.body).toMatchObject({ code: "MCP_UNAUTHENTICATED" });
    resetIdentityProviderFactory();
    const localDev = await call(rpc("server/discover"));
    expect(localDev.status).toBe(401);
    expect(verify).not.toHaveBeenCalled();
    expect(identity).not.toHaveBeenCalled();
  });

  it("Basic and Token schemes: 401 with no error code; the worker secret as Bearer: 401 invalid_token", async () => {
    for (const authorization of ["Basic dXNlcjpwYXNz", "Token abc", "Digest x"]) {
      const { status, body, headers } = await call(rpc("server/discover"), { headers: { authorization } });
      expect(status, authorization).toBe(401);
      expect(body).toMatchObject({ code: "MCP_UNAUTHENTICATED" });
      expect(headers.get("www-authenticate")).toBe(CHALLENGE);
    }
    vi.stubEnv("SIRKIT_WORKFLOW_WORKER_SECRET", WORKER);
    const worker = await call(rpc("server/discover"), { token: WORKER });
    expect(worker.status).toBe(401);
    expect(worker.body).toMatchObject({ code: "MCP_TOKEN_INVALID" });
    expect(worker.headers.get("www-authenticate")).toBe(CHALLENGE_INVALID_TOKEN);
  });

  it("malformed Bearer credentials are 400 MCP_AUTHORIZATION_MALFORMED with invalid_request", async () => {
    for (const authorization of ["Bearer", "Bearer a b", "Bearer a, Bearer b", "Bearer a;b", `Bearer ${"a".repeat(2094)}`, "Bearer é"]) {
      const { status, body, headers } = await call(rpc("server/discover"), { headers: { authorization } });
      expect(status, authorization.slice(0, 20)).toBe(400);
      expect(body).toMatchObject({ code: "MCP_AUTHORIZATION_MALFORMED" });
      expect(headers.get("www-authenticate")).toBe(CHALLENGE_INVALID_REQUEST);
    }
  });

  it("a valid token under a lower-case scheme or two spaces is served; a query string is 400 invalid_request and never echoes the token", async () => {
    const token = await tokenFor();
    expect((await call(rpc("server/discover"), { headers: { authorization: `bearer ${token}` } })).status).toBe(200);
    expect((await call(rpc("server/discover"), { headers: { authorization: `Bearer  ${token}` } })).status).toBe(200);
    for (const url of [`${URL_MCP}?access_token=${token}`, `${URL_MCP}?x=1`]) {
      const { status, body, text, headers } = await call(rpc("server/discover"), { token, url });
      expect(status).toBe(400);
      expect(body).toMatchObject({ code: "MCP_QUERY_REFUSED" });
      expect(headers.get("www-authenticate")).toBe(CHALLENGE_INVALID_REQUEST);
      expect(text.includes(token)).toBe(false);
    }
  });
});

describe("[B20 B2] E2 — hand-signed tokens", () => {
  it("another audience, project or tenant, expiry, tampering, or another algorithm is 401 invalid_token with one identical body", async () => {
    const bodies = new Set<string>();
    const bad = [
      handSigned(await claimsFor({ aud: "https://other.example.com/api/mcp" })),
      handSigned(await claimsFor({ sirkit_project: "proj-other" })),
      handSigned(await claimsFor({ sirkit_tenant: "tenant-other" })),
      handSigned(await claimsFor({ iat: T0 / 1000 - 7200, exp: T0 / 1000 - 3600 })),
      `${handSigned(await claimsFor())}x`,
      handSigned(await claimsFor(), b64url('{"alg":"none","typ":"sirkit-mcp-at+jwt"}')),
      handSigned(await claimsFor(), b64url('{"alg":"HS512","typ":"sirkit-mcp-at+jwt"}')),
      handSigned(await claimsFor(), b64url('{"alg":"RS256","typ":"sirkit-mcp-at+jwt"}')),
    ];
    for (const token of bad) {
      const { status, text, headers } = await call(rpc("server/discover"), { token });
      expect(status).toBe(401);
      expect(headers.get("www-authenticate")).toBe(CHALLENGE_INVALID_TOKEN);
      bodies.add(text);
    }
    expect(bodies.size).toBe(1);
    expect(JSON.parse([...bodies][0]!)).toEqual({ ok: false, code: "MCP_TOKEN_INVALID", error: "The access token is invalid or expired." });
    expect((await call(rpc("server/discover"), { token: handSigned(await claimsFor()) })).status).toBe(200);
  });

  it("whatever verifier ran, the wrapper re-checks its claims: another audience, a missing claim, an over-long lifetime, an expired token or a throw is 401 invalid_token", async () => {
    const record = (await repo.loadActiveMembership({ tenantId: "local", projectId: PROJECT, userId: USER }))!;
    const good = { issuer: ORIGIN, audience: URL_MCP, subject: USER, tenantId: "local", projectId: PROJECT, branchId: "main", membershipRevision: membershipRevisionOf(record), tokenId: "AbCdEfGhIjKlMnOpQrStUv", issuedAtS: T0 / 1000, expiresAtS: T0 / 1000 + 3600, scope: "sirkit.mcp" };
    const answers: unknown[] = [
      { ok: true, claims: { ...good, audience: "https://other.example.com/api/mcp" } },
      { ok: true, claims: { ...good, issuer: "https://other.example.com" } },
      { ok: true, claims: { ...good, membershipRevision: undefined } },
      { ok: true, claims: { ...good, expiresAtS: T0 / 1000 + 7200 } },
      { ok: true, claims: { ...good, issuedAtS: T0 / 1000 - 3600, expiresAtS: T0 / 1000 } },
      { ok: true, claims: { ...good, scope: "sirkit.admin" } },
      { ok: true, claims: { ...good, subject: "sirkit-workflow-worker" } },
      { ok: true },
      null,
    ];
    for (const answer of answers) {
      setMcpAccessTokenVerifierFactory(() => ({ kind: "external", verify: async () => answer as never }));
      const { status, headers } = await call(rpc("server/discover"), { token: "opaque-external-token" });
      expect(status, JSON.stringify(answer).slice(0, 80)).toBe(401);
      expect(headers.get("www-authenticate")).toBe(CHALLENGE_INVALID_TOKEN);
    }
    setMcpAccessTokenVerifierFactory(() => ({ kind: "external", verify: async () => { throw new Error("verifier down"); } }));
    expect((await call(rpc("server/discover"), { token: "opaque-external-token" })).status).toBe(401);
    setMcpAccessTokenVerifierFactory(() => ({ kind: "external", verify: async () => ({ ok: true, claims: good }) }));
    expect((await call(rpc("server/discover"), { token: "opaque-external-token" })).status).toBe(200);
  });
});

describe("[B20 B2] E3 — the membership is re-read on every call", () => {
  it("a member is served; after a version bump, a role change or revocation the same token is 401 with the invalid-token answer byte for byte (no oracle); an unavailable repository is 403 with no challenge", async () => {
    const token = await tokenFor();
    // the reference: a token another audience was issued for (E2's invalid-token answer)
    const reference = await call(rpc("server/discover"), { token: handSigned(await claimsFor({ aud: "https://other.example.com/api/mcp" })) });
    expect(reference.status).toBe(401);
    expect(JSON.parse(reference.text)).toEqual({ ok: false, code: "MCP_TOKEN_INVALID", error: "The access token is invalid or expired." });
    const sameAnswer = (label: string, answer: { status: number; text: string; headers: Headers }): void => {
      expect(answer.status, label).toBe(401);
      expect(answer.headers.get("www-authenticate"), label).toBe(CHALLENGE_INVALID_TOKEN);
      expect(answer.text, label).toBe(reference.text);
    };
    expect((await call(rpc("server/discover"), { token })).status).toBe(200);
    member("editor", USER, PROJECT, 2);
    sameAnswer("version bump", await call(rpc("server/discover"), { token }));
    member("editor");
    expect((await call(rpc("server/discover"), { token })).status).toBe(200);
    member("viewer");
    sameAnswer("role change", await call(rpc("server/discover"), { token }));
    member("editor");
    repo.set({ ...(await repo.loadActiveMembership({ tenantId: "local", projectId: PROJECT, userId: USER }))!, state: "revoked" });
    sameAnswer("revoked", await call(rpc("server/discover"), { token }));
    member("editor");
    const unavailable: ProjectMembershipRepository = { loadActiveMembership: async () => { throw new Error("database down"); } };
    injectMembershipRepository(unavailable);
    const down = await call(rpc("server/discover"), { token });
    expect(down.status).toBe(403);
    expect(down.body).toMatchObject({ code: "AUTH_MEMBERSHIP_UNAVAILABLE" });
    expect(down.headers.get("www-authenticate")).toBeNull();
    setMembershipRepositoryFactory(() => null);
    const absent = await call(rpc("server/discover"), { token });
    expect(absent.status).toBe(403);
    expect(absent.body).toMatchObject({ code: "AUTH_MEMBERSHIP_UNAVAILABLE" });
    expect(absent.headers.get("www-authenticate")).toBeNull();
  });
});

describe("[B20 B2] E4 — Origin", () => {
  it("a present Origin is validated before verification (the verifier is never called, membership untouched, no challenge); absent or equal is served", async () => {
    const token = await tokenFor();
    const verifier = createSirkitHmacVerifier();
    const verify = vi.spyOn(verifier, "verify");
    setMcpAccessTokenVerifierFactory(() => verifier);
    const load = vi.spyOn(repo, "loadActiveMembership");
    const cases: Array<[string, string]> = [["https://evil.example", "AUTH_CROSS_ORIGIN_DENIED"], ["http://mcp.example.com", "AUTH_CROSS_ORIGIN_DENIED"], ["null", "AUTH_ORIGIN_NULL"], ["not a url", "AUTH_ORIGIN_MALFORMED"], [`${ORIGIN}/`, "AUTH_ORIGIN_MALFORMED"], ["", "AUTH_ORIGIN_MALFORMED"], ["    ", "AUTH_ORIGIN_MALFORMED"]];
    for (const [origin, code] of cases) {
      const { status, body, headers } = await call(rpc("server/discover"), { token, headers: { origin } });
      expect(status, JSON.stringify(origin)).toBe(403);
      expect(body, JSON.stringify(origin)).toMatchObject({ ok: false, code });
      expect(headers.get("www-authenticate"), JSON.stringify(origin)).toBeNull();
    }
    expect(verify).not.toHaveBeenCalled();
    expect(load).not.toHaveBeenCalled();
    expect((await call(rpc("server/discover"), { token })).status).toBe(200);
    expect((await call(rpc("server/discover"), { token, headers: { origin: ORIGIN } })).status).toBe(200);
    expect(verify).toHaveBeenCalledTimes(2);
  });
});

describe("[B20 B2] E5 — transport", () => {
  it("media: text/plain and a Content-Type over 256 characters are 415 with zero pulls; an Accept over 1 024 characters or 32 ranges, or without JSON, is 406; neither carries a challenge; the exact bounds and the client's Accept are served", async () => {
    const token = await tokenFor();
    const contentTypeOf = (length: number): string => `application/json; p=${"x".repeat(length - 20)}`;
    expect([contentTypeOf(256).length, contentTypeOf(257).length]).toEqual([256, 257]);
    for (const contentType of ["text/plain", contentTypeOf(257), `application/json; ${"x".repeat(250)}`]) {
      const counter = { pulls: 0 };
      const { status, body, headers } = await call(rpc("server/discover"), { token, headers: { "content-type": contentType }, body: counting(counter) });
      expect(status, contentType.slice(0, 20)).toBe(415);
      expect(body).toMatchObject({ code: "AUTH_MEDIA_TYPE_UNSUPPORTED" });
      expect(headers.get("www-authenticate")).toBeNull();
      expect(counter.pulls).toBe(0);
    }
    expect((await call(rpc("server/discover"), { token, headers: { "content-type": contentTypeOf(256) } })).status).toBe(200);
    // Accept: 1 024 characters admitting JSON are served and 1 025 refused; 32 ranges ending in application/json are served and
    // 33 (32 others, then application/json) refused, so the range bound is judged before any range is read
    const acceptOf = (length: number): string => `application/json;p=${"x".repeat(length - 19)}`;
    expect([acceptOf(1024).length, acceptOf(1025).length]).toEqual([1024, 1025]);
    const ranges = (count: number): string => [...Array.from({ length: count - 1 }, (_, i) => `text/x${i}`), "application/json"].join(",");
    expect([ranges(32).split(",").length, ranges(33).split(",").length]).toEqual([32, 33]);
    expect(ranges(33).length).toBeLessThan(1024);
    for (const accept of ["text/html", acceptOf(1025), ranges(33), Array.from({ length: 33 }, (_, i) => `text/x${i}`).join(", "), "application/json;q=0"]) {
      const { status, body, headers } = await call(rpc("server/discover"), { token, headers: { accept } });
      expect(status, accept.slice(0, 30)).toBe(406);
      expect(body).toMatchObject({ code: "MCP_NOT_ACCEPTABLE" });
      expect(headers.get("www-authenticate")).toBeNull();
    }
    for (const accept of ["application/json, text/event-stream", "application/*", "*/*", "text/event-stream, application/json;q=0.5", acceptOf(1024), ranges(32)]) {
      expect((await call(rpc("server/discover"), { token, headers: { accept } })).status, accept.slice(0, 30)).toBe(200);
    }
    expect((await call(rpc("server/discover"), { token, headers: { accept: null } })).status).toBe(200);
  });

  it("a 65 537-byte body is 413; invalid JSON or UTF-8 is 400 -32700 with no id (MCP 2026-07-28: id is a string or a number, left out when unreadable)", async () => {
    const token = await tokenFor();
    const big = JSON.stringify({ ...rpc("server/discover"), pad: "" });
    const padded = big.replace('"pad":""', `"pad":"${"x".repeat(65_537 - big.length)}"`);
    expect(new TextEncoder().encode(padded).byteLength).toBe(65_537);
    const over = await call(rpc("server/discover"), { token, body: padded });
    expect(over.status).toBe(413);
    for (const body of ["{not json", new Uint8Array([0x7b, 0xff, 0x7d])]) {
      const { status, text } = await call(rpc("server/discover"), { token, body });
      expect(status).toBe(400);
      expect(JSON.parse(text)).toEqual({ jsonrpc: "2.0", error: { code: -32700, message: "Parse error" } });
      expect(Object.hasOwn(JSON.parse(text) as object, "id")).toBe(false);
    }
  });

  it("a batch, a response (with or without a method), jsonrpc 1.0 and ids that are null, a float, an object or 129 characters are 400 -32600, echoing only a valid id and otherwise carrying none", async () => {
    const token = await tokenFor();
    const cases: Array<[unknown, string | number | null]> = [
      [[rpc("server/discover")], null],
      [{ jsonrpc: "2.0", id: 1, result: {} }, 1],
      [{ ...rpc("server/discover"), result: {} }, 1],
      [{ ...rpc("server/discover"), jsonrpc: "1.0" }, 1],
      [rpc("server/discover", {}, null), null],
      [rpc("server/discover", {}, 1.5), null],
      [rpc("server/discover", {}, { a: 1 }), null],
      [rpc("server/discover", {}, "i".repeat(129)), null],
      ["text", null],
      [5, null],
      [null, null],
      [{ jsonrpc: "2.0", id: "req-7", method: "server/discover", error: {} }, "req-7"],
      [{ jsonrpc: "2.0", id: 1, method: "bad method" }, 1],
    ];
    for (const [message, id] of cases) {
      const { status, body } = await call(rpc("server/discover"), { token, body: JSON.stringify(message) });
      const label = JSON.stringify(message).slice(0, 40);
      expect(status, label).toBe(400);
      expect(errorOf(body)).toEqual({ code: -32600, message: "Invalid Request" });
      expect(Object.hasOwn(body, "id"), label).toBe(id !== null);
      if (id !== null) expect(body.id, label).toBe(id);
    }
  });
});

describe("[B20 B2] E6 — headers and _meta", () => {
  it("MCP-Protocol-Version: absent or over-long is 400 -32020 naming the supported versions; 2025-11-25 or garbage is 400 -32022 with supported AND requested (also without Mcp-Method); a refused notification's error carries no id", async () => {
    const token = await tokenFor();
    for (const headers of [{ "mcp-protocol-version": null }, { "mcp-protocol-version": null, "mcp-method": null }, { "mcp-protocol-version": "2".repeat(33) }] as HeaderPatch[]) {
      const { status, body } = await call(rpc("server/discover"), { token, headers });
      expect(status).toBe(400);
      expect(errorOf(body)).toEqual({ code: -32020, message: expect.any(String), data: SUPPORTED });
    }
    // the 2026-07-28 UnsupportedProtocolVersionError requires data.supported AND data.requested; only a date-shaped request is
    // echoed, so nothing else a peer wrote is repeated (S1)
    const secretShaped = ["sk", "live", "0123456789abcdefghij"].join("_");
    const unsupported: Array<[HeaderPatch, string]> = [
      [{ "mcp-protocol-version": "2025-11-25" }, "2025-11-25"],
      [{ "mcp-protocol-version": "2025-11-25", "mcp-method": null }, "2025-11-25"],
      [{ "mcp-protocol-version": "not-a-version" }, ""],
      [{ "mcp-protocol-version": secretShaped }, ""],
    ];
    for (const [headers, requested] of unsupported) {
      const { status, body, text } = await call(rpc("server/discover"), { token, headers });
      expect(status).toBe(400);
      expect(errorOf(body)).toEqual({ code: -32022, message: "Unsupported protocol version", data: { supported: [V], requested } });
      expect(body.id).toBe(1);
      expect(text.includes(secretShaped)).toBe(false);
    }
    const refused = await call(notification("notifications/cancelled"), { token, headers: { "mcp-param-region": "x" } });
    expect(refused.status).toBe(400);
    expect(refused.body).toEqual({ jsonrpc: "2.0", error: { code: -32020, message: expect.any(String) } });
    expect(Object.hasOwn(refused.body, "id")).toBe(false);
  });

  it("Mcp-Method absent or different, and any Mcp-Param-* header, are 400 -32020", async () => {
    const token = await tokenFor();
    for (const headers of [{ "mcp-method": null }, { "mcp-method": "tools/list" }, { "mcp-method": "m".repeat(129) }, { "mcp-param-region": "x" }] as HeaderPatch[]) {
      const { status, body } = await call(rpc("server/discover"), { token, headers });
      expect(status, JSON.stringify(headers).slice(0, 40)).toBe(400);
      expect(errorOf(body).code).toBe(-32020);
    }
  });

  it("_meta or clientCapabilities missing is 400 -32602; a _meta version that differs from the header is 400 -32020", async () => {
    const token = await tokenFor();
    const variants: Array<[Message, number]> = [
      [{ jsonrpc: "2.0", id: 1, method: "server/discover" }, -32602],
      [{ jsonrpc: "2.0", id: 1, method: "server/discover", params: {} }, -32602],
      [{ jsonrpc: "2.0", id: 1, method: "server/discover", params: { _meta: { "io.modelcontextprotocol/protocolVersion": V } } }, -32602],
      [{ jsonrpc: "2.0", id: 1, method: "server/discover", params: { _meta: { "io.modelcontextprotocol/clientCapabilities": {} } } }, -32602],
      [{ jsonrpc: "2.0", id: 1, method: "server/discover", params: { _meta: { ...META, "io.modelcontextprotocol/clientCapabilities": [] } } }, -32602],
      [{ jsonrpc: "2.0", id: 1, method: "server/discover", params: { _meta: [] } }, -32602],
      [{ jsonrpc: "2.0", id: 1, method: "server/discover", params: [] }, -32602],
      [{ jsonrpc: "2.0", id: 1, method: "server/discover", params: { _meta: { ...META, "io.modelcontextprotocol/protocolVersion": "2025-11-25" } } }, -32020],
    ];
    for (const [message, code] of variants) {
      const { status, body } = await call(message, { token });
      expect(status, JSON.stringify(message).slice(0, 60)).toBe(400);
      expect(errorOf(body).code).toBe(code);
    }
  });

  it("Mcp-Name: absent or wrong on tools/call, or present on tools/list, is 400 -32020; the client's base64 sentinel is accepted", async () => {
    const token = await tokenFor();
    const listed = servedFor("pcb_editor")[0]!.name;
    for (const [message, headers] of [[rpc("tools/call", { name: listed, arguments: {} }), { "mcp-name": null }], [rpc("tools/call", { name: listed, arguments: {} }), { "mcp-name": "sirkit.other" }], [rpc("tools/list"), { "mcp-name": "x" }], [rpc("server/discover"), { "mcp-name": "x" }], [rpc("tools/call", { name: listed, arguments: {} }), { "mcp-name": "=?base64?###?=" }]] as Array<[Message, Record<string, string | null>]>) {
      const { status, body } = await call(message, { token, headers });
      expect(status).toBe(400);
      expect(errorOf(body).code).toBe(-32020);
    }
    const sentinel = `=?base64?${Buffer.from(listed, "utf8").toString("base64")}?=`;
    const encoded = await call(rpc("tools/call", { name: listed, arguments: {} }), { token, headers: { "mcp-name": sentinel } });
    expect(encoded.status).toBe(200);
    const plain = await call(rpc("tools/call", { name: listed, arguments: {} }), { token });
    expect(plain.status).toBe(200);
  });

  it("an incoming Mcp-Session-Id is ignored and never echoed", async () => {
    const token = await tokenFor();
    const { status, headers, text } = await call(rpc("server/discover"), { token, headers: { "mcp-session-id": "legacy-session-42" } });
    expect(status).toBe(200);
    expect(headers.get("mcp-session-id")).toBeNull();
    expect(text).not.toContain("legacy-session-42");
  });
});

describe("[B20 B2] E7 — methods", () => {
  it("a real 2025-11-25 initialize (no MCP headers, no _meta) is 400 -32020 naming the supported versions (a modern-only server)", async () => {
    const token = await tokenFor();
    const initialize = { jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "legacy-client", version: "1.0.0" } } };
    const { status, body } = await call(initialize, { token, headers: { "mcp-protocol-version": null, "mcp-method": null } });
    expect(status).toBe(400);
    expect(errorOf(body)).toMatchObject({ code: -32020, data: SUPPORTED });
    expect(body.id).toBe(0);
  });

  it("initialize, ping, subscriptions/listen, resources/read and prompts/get (with a valid Mcp-Name) are 404 -32601 and the method is not echoed", async () => {
    const token = await tokenFor();
    for (const [method, name] of [["initialize", null], ["ping", null], ["subscriptions/listen", null], ["resources/read", "file:///x"], ["prompts/get", "p"], ["tools/destroy", null]] as Array<[string, string | null]>) {
      const { status, body, text } = await call(rpc(method, name ? { name, uri: name } : {}), { token, headers: name ? { "mcp-name": name } : {} });
      expect(status, method).toBe(404);
      expect(errorOf(body)).toEqual({ code: -32601, message: "Method not found" });
      expect(text).not.toContain(method);
    }
  });

  it("a notification is 202 with an empty body", async () => {
    const token = await tokenFor();
    const response = await POST(request(notification("notifications/cancelled"), { token }));
    expect(response.status).toBe(202);
    expect(await response.text()).toBe("");
  });

  it("server/discover answers the exact DiscoverResult with status 200", async () => {
    const token = await tokenFor();
    const { status, body, headers } = await call(rpc("server/discover", {}, "d-1"), { token });
    expect(status).toBe(200);
    expect(headers.get("content-type")).toMatch(/^application\/json/);
    expect(headers.get("cache-control")).toBe("no-store");
    expect(body).toEqual({
      jsonrpc: "2.0",
      id: "d-1",
      result: {
        resultType: "complete",
        supportedVersions: [V],
        capabilities: { tools: { listChanged: false } },
        // [B20 B3] pin move: the instructions are now the exact D-13 sentence (the durable source, the pin, data not instructions)
        instructions: MCP_DISCOVER_INSTRUCTIONS,
        ttlMs: 60_000,
        cacheScope: "public",
        _meta: { "io.modelcontextprotocol/serverInfo": { name: "sirkit", version: "0.1.0" } },
      },
    });
    expect(((body.result as Record<string, unknown>).instructions as string).length).toBeLessThanOrEqual(300);
  });

  it("tools/list for the stored roles viewer, editor and admin serves exactly B1's rendering of the subset the mapped role may use", async () => {
    const registry = sirkitToolRegistry();
    const full = renderMcpToolListing(registry);
    const seen: Record<string, string> = {};
    for (const stored of ["viewer", "editor", "admin"] as MembershipRole[]) {
      member(stored);
      const token = await tokenFor();
      const first = await call(rpc("tools/list"), { token });
      const second = await call(rpc("tools/list", {}, 2), { token });
      expect(first.status).toBe(200);
      const result = first.body.result as Record<string, unknown>;
      const role = ROLE_MAP[stored];
      const served = servedFor(role);
      expect(result.tools).toEqual(served);
      expect(served.length).toBeGreaterThan(0);
      for (const tool of result.tools as Array<{ name: string; _meta: Record<string, string> }>) {
        const descriptor = registry.get(tool.name, tool._meta["dev.sirkit/toolVersion"])!;
        expect(descriptor.requiredRoles).toContain(role);
        expect(descriptor).toMatchObject({ lifecycle: "active", callability: "callable" });
        expect(descriptor.discovery).not.toBe("internal-only");
        expect(descriptor.grantOnly).toBeUndefined();
        expect(descriptor.executionMode).toBeUndefined();
        expect(["read", "propose"]).toContain(descriptor.operationClass);
        expect(INTENTIONAL_AGENT_EXPOSED_TOOL_IDS).toContain(tool.name);
      }
      expect(result).toMatchObject({ resultType: "complete", ttlMs: 60_000, cacheScope: "private" });
      expect(Object.hasOwn(result, "nextCursor")).toBe(false);
      const meta = result._meta as Record<string, unknown>;
      expect(meta["dev.sirkit/registryDigest"]).toBe(full.registryDigest);
      expect(meta["dev.sirkit/listingDigest"]).toBe(engineeringDigest({ schema: MCP_TOOL_LISTING_SCHEMA, registryDigest: full.registryDigest, tools: served }));
      expect((second.body.result as Record<string, unknown>)._meta).toEqual(meta);
      seen[stored] = meta["dev.sirkit/listingDigest"] as string;
    }
    expect(new Set(Object.values(seen)).size).toBeGreaterThan(1);
  });

  it("a cursor is 200 -32602 (no pagination in B2)", async () => {
    const token = await tokenFor();
    for (const cursor of ["", "next", 5]) {
      const { status, body } = await call(rpc("tools/list", { cursor }), { token });
      expect(status).toBe(200);
      expect(errorOf(body).code).toBe(-32602);
    }
  });

  it("a listed tool on tools/call is the 200 isError refusal not_served, whatever the arguments", async () => {
    const token = await tokenFor();
    // [B20 B3] pin move: B3 serves the listed READS, so the not_served answer is now a listed PROPOSAL's (B4 decides those)
    const registry = sirkitToolRegistry();
    const listed = servedFor("pcb_editor").find((tool) => registry.get(tool.name)!.operationClass === "propose")!.name;
    for (const args of [{}, { anything: "x" }, undefined]) {
      const { status, body } = await call(rpc("tools/call", { name: listed, ...(args === undefined ? {} : { arguments: args }) }), { token });
      expect(status).toBe(200);
      expect(body.result).toEqual({ resultType: "complete", content: [{ type: "text", text: "This tool is listed but not yet served; nothing was done." }], isError: true, _meta: { "io.modelcontextprotocol/serverInfo": { name: "sirkit", version: "0.1.0" }, "dev.sirkit/refusal": "not_served" } });
    }
  });

  it("a role-filtered tool, a release tool, a granted mutation, a nonexistent id and non-object arguments are one identical 200 -32602 without echo", async () => {
    member("viewer");
    const token = await tokenFor();
    const registry = sirkitToolRegistry();
    const roleFiltered = renderMcpToolListing(registry).tools.find((tool) => !registry.get(tool.name)!.requiredRoles.includes("viewer"))!.name;
    const listed = servedFor("viewer")[0]!.name;
    const bodies = new Set<string>();
    for (const [name, args] of [[roleFiltered, {}], ["sirkit.manufacturing.release", {}], ["sirkit.pcb.move-footprint", {}], ["sirkit.no-such-tool", {}], [listed, "not-an-object"], [listed, [1]]] as Array<[string, unknown]>) {
      const { status, body, text } = await call(rpc("tools/call", { name, arguments: args }), { token });
      expect(status, name).toBe(200);
      expect(errorOf(body).code).toBe(-32602);
      expect(text).not.toContain(name);
      bodies.add(JSON.stringify(body));
    }
    expect(bodies.size).toBe(1);
  });
});

describe("[B20 B2] E8 — flag and configuration", () => {
  it("the flag unset, true or padded: 404 MCP_NOT_ENABLED for every method, identity, membership and body untouched", async () => {
    const token = await tokenFor();
    const load = vi.spyOn(repo, "loadActiveMembership");
    for (const value of [undefined, "true", " 1", "yes"]) {
      vi.stubEnv("SIRKIT_MCP_ENABLED", value);
      for (const message of [rpc("server/discover"), rpc("tools/list"), rpc("tools/call", { name: "x" }), notification("n")]) {
        const counter = { pulls: 0 };
        const { status, body, headers } = await call(message, { token, body: counting(counter) });
        expect(status).toBe(404);
        expect(body).toEqual({ ok: false, code: "MCP_NOT_ENABLED", error: expect.any(String) });
        expect(headers.get("www-authenticate")).toBeNull();
        expect(counter.pulls).toBe(0);
      }
    }
    expect(load).not.toHaveBeenCalled();
  });

  it("production without Supabase configuration is 403 AUTH_PRODUCTION_NOT_CONFIGURED before verification; a missing secret or origin is 503", async () => {
    const token = await tokenFor();
    const verifier = createSirkitHmacVerifier();
    const verify = vi.spyOn(verifier, "verify");
    setMcpAccessTokenVerifierFactory(() => verifier);
    vi.stubEnv("NODE_ENV", "production");
    const blocked = await call(rpc("server/discover"), { token });
    expect(blocked.status).toBe(403);
    expect(blocked.body).toMatchObject({ code: "AUTH_PRODUCTION_NOT_CONFIGURED" });
    expect(blocked.headers.get("www-authenticate")).toBeNull();
    expect(verify).not.toHaveBeenCalled();
    vi.stubEnv("NODE_ENV", "test");
    const unconfigured: Array<{ status: number; body: Record<string, unknown>; headers: Headers }> = [];
    vi.stubEnv(MCP_TOKEN_SECRET_ENV, undefined);
    unconfigured.push(await call(rpc("server/discover"), { token }));
    vi.stubEnv(MCP_TOKEN_SECRET_ENV, SECRET);
    vi.stubEnv("SIRKIT_EXPECTED_ORIGIN", undefined);
    unconfigured.push(await call(rpc("server/discover"), { token }));
    vi.stubEnv("SIRKIT_EXPECTED_ORIGIN", ORIGIN);
    setMcpAccessTokenVerifierFactory(() => null);
    unconfigured.push(await call(rpc("server/discover"), { token }));
    for (const answer of unconfigured) {
      expect(answer).toMatchObject({ status: 503, body: { code: "MCP_NOT_CONFIGURED" } });
      expect(answer.headers.get("www-authenticate")).toBeNull();
    }
  });
});

describe("[B20 B2] E9 — the endpoint rate limit", () => {
  it("the 121st request in a window is 429 with an integer Retry-After in [1, 60] and no challenge, whichever of the member's tokens it carries; the window rolls over; another principal is unaffected", async () => {
    const token = await tokenFor();
    // a second token of the SAME member (another random jti): the limit is the member's, not the token's
    const second = await tokenFor();
    expect(second).not.toBe(token);
    member("editor", "user-mcp-0002");
    const other = await tokenFor("user-mcp-0002");
    for (let index = 0; index < 120; index += 1) expect((await call(rpc("server/discover"), { token })).status).toBe(200);
    now = T0 + 20_000;
    for (const carried of [token, second]) {
      const limited = await call(rpc("server/discover"), { token: carried });
      expect(limited.status).toBe(429);
      expect(limited.body).toMatchObject({ code: "MCP_RATE_LIMITED" });
      expect(limited.headers.get("www-authenticate")).toBeNull();
      const retry = Number(limited.headers.get("retry-after"));
      expect(Number.isInteger(retry) && retry >= 1 && retry <= 60).toBe(true);
      expect(retry).toBe(40);
    }
    expect((await call(rpc("server/discover"), { token: other })).status).toBe(200);
    now = T0 + 60_000;
    expect((await call(rpc("server/discover"), { token })).status).toBe(200);
  });
});

describe("[B20 B2] E10 — nothing hostile is echoed (S1/S2)", () => {
  it("hostile ids, methods, Mcp-Name values, _meta keys, clientInfo and cursor values never appear in a response or a trace record", async () => {
    const token = await tokenFor();
    const bidi = String.fromCharCode(0x202e);
    const secretShaped = ["sk", "live", "0123456789abcdefghijklmn"].join("_");
    const hostile = [`id-${bidi}-x`, secretShaped, `<script>${bidi}`];
    const raw: string[] = [
      JSON.stringify({ jsonrpc: "2.0", id: `${bidi}evil`, method: "server/discover", params: { _meta: META } }),
      JSON.stringify({ jsonrpc: "2.0", id: 1, method: `${secretShaped}/x`, params: { _meta: META } }),
      JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: { cursor: secretShaped, _meta: { ...META, [secretShaped]: 1, "io.modelcontextprotocol/clientInfo": { name: `${bidi}${secretShaped}`, version: "1" } } } }),
      `{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{"_meta":{"__proto__":{"polluted":"${secretShaped}"},"io.modelcontextprotocol/protocolVersion":"${V}","io.modelcontextprotocol/clientCapabilities":{}}}}`,
      JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: `${secretShaped}${bidi}`, arguments: {}, _meta: META } }),
      JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: { cursor: "c".repeat(100_000), _meta: META } }),
    ];
    for (const body of raw) {
      const parsed = (() => { try { return JSON.parse(body) as Message; } catch { return null; } })();
      const method = parsed && typeof parsed.method === "string" && parsed.method.length < 64 ? parsed.method : "tools/list";
      const name = parsed && (parsed.params as Record<string, unknown>)?.name;
      const headers: Record<string, string | null> = { "mcp-method": method.replace(/[^\x21-\x7e]/g, "?") };
      if (typeof name === "string") headers["mcp-name"] = encodeMcpNameHeader(name);
      const { text } = await call(null, { token, body, headers });
      for (const value of hostile) expect(text.includes(value), value).toBe(false);
      expect(text.includes(bidi)).toBe(false);
      expect(text.length).toBeLessThan(100_000);
    }
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    const traces = JSON.stringify(mcpServerTraceRing());
    for (const value of [...hostile, bidi, token, SECRET]) expect(traces.includes(value)).toBe(false);
  });
});

describe("[B20 B2] E11 — the request trace", () => {
  it("one closed record per handled request, no token, jti or raw header; a throwing sink leaves the response unchanged", async () => {
    const token = await tokenFor();
    const records: McpServerRequestTrace[] = [];
    setMcpServerTraceSinkFactory(() => ({ record: (trace) => { records.push(trace); } }));
    await call(rpc("tools/list"), { token });
    await call(rpc("server/discover"), { token });
    await call(null, { token });
    expect(records).toHaveLength(3);
    const [listed] = records;
    expect(Object.keys(listed!).sort()).toEqual(["elapsedMs", "httpStatus", "listingDigest", "method", "outcome", "principal", "protocolVersion", "receivedAtMs", "registryDigest", "requestId", "schema", "toolId"]);
    expect(listed).toMatchObject({ schema: MCP_SERVER_TRACE_SCHEMA, method: "tools/list", outcome: "listed", httpStatus: 200, protocolVersion: V, toolId: null, receivedAtMs: T0 });
    expect(Object.keys(listed!.principal).sort()).toEqual(["authMethod", "branchId", "membershipRevision", "principalId", "projectId", "role", "tenantId", "tokenIdDigest"]);
    expect(listed!.principal).toMatchObject({ tenantId: "local", projectId: PROJECT, branchId: "main", principalId: USER, role: "pcb_editor", authMethod: "mcp_bearer" });
    expect(listed!.principal.tokenIdDigest).toMatch(/^[0-9a-f]{32}$/);
    expect(records[2]).toMatchObject({ method: "invalid", outcome: "invalid_request", httpStatus: 400 });
    const jti = (JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString("utf8")) as { jti: string }).jti;
    const text = JSON.stringify(records);
    for (const value of [token, jti, token.split(".")[2]!, "authorization", "Bearer"]) expect(text.includes(value), value).toBe(false);
    setMcpServerTraceSinkFactory(() => ({ record: () => { throw new Error("sink down"); } }));
    const withThrowingSink = await call(rpc("server/discover"), { token });
    resetMcpServerTraceSinkFactory();
    const withRing = await call(rpc("server/discover"), { token });
    expect(withThrowingSink.status).toBe(200);
    expect(withThrowingSink.text).toBe(withRing.text);
  });
});

describe("[B20 B2] E14 — the wrapper's remaining refusals", () => {
  it("an unmapped stored role is 403 AUTH_ROLE_UNMAPPED; a path with no policy is 500 AUTH_POLICY_MISSING; none carries a challenge or reaches the dispatch", async () => {
    member("owner" as MembershipRole);
    const token = await tokenFor();
    const before = mcpServerTraceRing().length;
    const unmapped = await call(rpc("server/discover"), { token });
    expect(unmapped.status).toBe(403);
    expect(unmapped.body).toEqual({ ok: false, code: "AUTH_ROLE_UNMAPPED", error: expect.any(String) });
    expect(unmapped.headers.get("www-authenticate")).toBeNull();
    member("editor");
    const editorToken = await tokenFor();
    const missing = await call(rpc("server/discover"), { token: editorToken, url: `${ORIGIN}/api/mcp/evil` });
    expect(missing.status).toBe(500);
    expect(missing.body).toEqual({ ok: false, code: "AUTH_POLICY_MISSING", error: expect.any(String) });
    expect(missing.headers.get("www-authenticate")).toBeNull();
    expect(mcpServerTraceRing()).toHaveLength(before);
    expect((await call(rpc("server/discover"), { token: editorToken })).status).toBe(200);
  });

  it("the policy's role gate runs after the membership: a role the row does not permit is 403 AUTH_ROLE_DENIED, a capability the delegated actor lacks is 403 AUTH_CAPABILITY_DENIED", async () => {
    const token = await tokenFor();
    const real = policyFor("/api/mcp", "POST")!;
    expect(real.permittedRoles).toContain("pcb_editor");
    const rows: Array<[RoutePolicy, string]> = [
      [{ ...real, permittedRoles: ["viewer"] }, "AUTH_ROLE_DENIED"],
      [{ ...real, requiredCapability: "edit_placement" }, "AUTH_CAPABILITY_DENIED"],
    ];
    const before = mcpServerTraceRing().length;
    for (const [row, code] of rows) {
      policyOverride.current = (path, method) => (path === "/api/mcp" && method === "POST" ? row : null);
      const { status, body, headers } = await call(rpc("server/discover"), { token });
      expect(status, code).toBe(403);
      expect(body, code).toEqual({ ok: false, code, error: expect.any(String) });
      expect(headers.get("www-authenticate"), code).toBeNull();
    }
    expect(mcpServerTraceRing()).toHaveLength(before);
    policyOverride.current = null;
    expect((await call(rpc("server/discover"), { token })).status).toBe(200);
  });
});

describe("[B20 B2] E15 — anything thrown is the JSON-RPC internal error (S4)", () => {
  it("a throw inside the dispatch is 500 -32603 echoing the readable id, and is traced as internal_error", async () => {
    const token = await tokenFor();
    const down = (): never => { throw new Error("registry down"); };
    const throwing = { list: down, get: down, digest: down } as unknown as ToolRegistry;
    const route = mcpBearerJsonRoute({ maxBytes: 65_536 }, (input) => handleMcpRequest(input, { registry: throwing }));
    const records: McpServerRequestTrace[] = [];
    setMcpServerTraceSinkFactory(() => ({ record: (trace) => { records.push(trace); } }));
    const response = await route(request(rpc("tools/list", {}, 7), { token }));
    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("www-authenticate")).toBeNull();
    expect(await response.json()).toEqual({ jsonrpc: "2.0", id: 7, error: { code: -32603, message: "Internal error" } });
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ method: "tools/list", outcome: "internal_error", httpStatus: 500, toolId: null, protocolVersion: "", registryDigest: "", listingDigest: null });
    // server/discover never touches the registry, so it is still served
    expect((await route(request(rpc("server/discover"), { token }))).status).toBe(200);
  });

  it("a handler that throws or rejects is 500 -32603 from the wrapper, echoing the id only when it is readable", async () => {
    const token = await tokenFor();
    const handlers = [() => { throw new Error("handler down"); }, async () => { throw new Error("handler down"); }];
    for (const handler of handlers) {
      const route = mcpBearerJsonRoute({ maxBytes: 65_536 }, handler as never);
      const readable = await route(request(rpc("server/discover", {}, "w-1"), { token }));
      expect(readable.status).toBe(500);
      expect(await readable.json()).toEqual({ jsonrpc: "2.0", id: "w-1", error: { code: -32603, message: "Internal error" } });
      const unreadable = await route(request(rpc("server/discover", {}, null), { token }));
      expect(unreadable.status).toBe(500);
      const body = (await unreadable.json()) as Record<string, unknown>;
      expect(body).toEqual({ jsonrpc: "2.0", error: { code: -32603, message: "Internal error" } });
      expect(Object.hasOwn(body, "id")).toBe(false);
    }
  });
});

describe("[B20 B2] E12/E13 — exports and the page", () => {
  it("the module exports POST and runtime only; GET and DELETE on /api/mcp have no policy", () => {
    expect(Object.keys(endpoint).sort()).toEqual(["POST", "runtime"]);
    expect(endpoint.runtime).toBe("nodejs");
    expect(policyFor("/api/mcp", "GET")).toBeNull();
    expect(policyFor("/api/mcp", "DELETE")).toBeNull();
  });

  it("mcp-server-endpoint.md states each B2 suite's case count and names every closed code and bound", async () => {
    const page = readFileSync(join(ROOT, "artifacts", "ai-control-plane-b20", "mcp-server-endpoint.md"), "utf8");
    const suites = [
      "app/lib/auth/__tests__/b20-b2-mcp-access-token.test.ts",
      "app/lib/auth/__tests__/b20-b2-mcp-route-policy.test.ts",
      "app/lib/auth/__tests__/b20-b2-route-tree.test.ts",
      "app/lib/auth/__tests__/b20-b2-route-matrices-pinned.test.ts",
      "app/api/mcp/__tests__/b20-b2-mcp-endpoint.test.ts",
      "app/api/mcp/__tests__/b20-b2-mcp-token-route.test.ts",
      "app/api/mcp/__tests__/b20-b2-protected-resource-metadata.test.ts",
      "app/api/mcp/__tests__/b20-b2-own-client-interop.test.ts",
      "app/lib/mcp/server/__tests__/b20-b2-server-protocol.test.ts",
      "app/lib/mcp/server/__tests__/b20-b2-import-gates.test.ts",
    ];
    for (const suite of suites) {
      const cases = (readFileSync(join(ROOT, suite), "utf8").match(/^\s*it\(/gm) ?? []).length;
      expect(cases, suite).toBeGreaterThan(0);
      expect(page, suite).toContain(`| \`${suite}\` | ${cases} |`);
    }
    const { MCP_ENDPOINT_REFUSAL_CODES, MCP_TOKEN_REFUSALS, MCP_BEARER_BOUNDS } = await import("@/app/lib/auth/mcp-bearer");
    const { MCP_TOKEN_ROUTE_CODES } = await import("@/app/lib/mcp/server/token-issuance");
    const { MCP_JSON_RPC_ERROR_CODES } = await import("@/app/lib/mcp/server/protocol");
    const { MCP_SERVER_TRACE_OUTCOMES } = await import("@/app/lib/mcp/server/request-trace");
    const { MCP_TOKEN_ROUTE_LIMIT, MCP_ENDPOINT_LIMIT } = await import("@/app/lib/mcp/server/inbound-limits");
    for (const code of [...MCP_ENDPOINT_REFUSAL_CODES, ...MCP_TOKEN_REFUSALS, ...MCP_TOKEN_ROUTE_CODES, ...MCP_SERVER_TRACE_OUTCOMES]) expect(page, code).toContain(`\`${code}\``);
    for (const code of Object.values(MCP_JSON_RPC_ERROR_CODES)) expect(page, String(code)).toContain(`\`${code}\``);
    for (const [name, value] of Object.entries(MCP_BEARER_BOUNDS)) expect(page, name).toContain(`\`${name}\` = ${value}`);
    expect(page).toContain(`${MCP_TOKEN_ROUTE_LIMIT.limit} per ${MCP_TOKEN_ROUTE_LIMIT.windowMs / 1000} s`);
    expect(page).toContain(`${MCP_ENDPOINT_LIMIT.limit} per ${MCP_ENDPOINT_LIMIT.windowMs / 1000} s`);
  });
});
