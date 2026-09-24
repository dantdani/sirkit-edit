/**
 * [B20 D3] The WIRE-level proof of `/api/mcp` on the REAL Next.js server (D20-28's wire half).
 *
 * Every vitest suite calls the route handler directly, so nothing in the repository knows what Next itself answers for an
 * unexported method, what a notification really returns on the wire, or that the RFC 9728 metadata route is served at all.
 * This spec asks the running fixture server, request-level only: no browser page, no editor, no chat.
 *
 * DEC-8: the answer to an unexported GET, DELETE or OPTIONS is DERIVED AND RECORDED, never asserted as 405. The
 * 2026-07-28 Streamable HTTP specification makes 405 a SHOULD for a legacy GET or DELETE on a modern-only server and says
 * nothing at all about OPTIONS, and Next's App Router may auto-implement OPTIONS. W1-W3 assert only what is safe either
 * way and print the observed status for `mcp-server-endpoint.md` §12 to record.
 *
 * Every request states its FULL shape: `params._meta` carrying a matching `io.modelcontextprotocol/protocolVersion` and an
 * object `io.modelcontextprotocol/clientCapabilities` on every request, and `Mcp-Name` equal to `params.name` on
 * `tools/call` and ABSENT on `tools/list` / `server/discover`. A case whose shape is not stated tests the wrong refusal.
 * No `Origin` is sent unless a row says so, which the endpoint admits by design (it validates `Origin` only when present).
 *
 * The token is minted ONCE and reused: the token route's own limiter is 10 per 60 seconds.
 */
import { expect, test, type APIRequestContext } from "@playwright/test";

test.describe.configure({ mode: "serial" });

const V = "2026-07-28";
const META = { "io.modelcontextprotocol/protocolVersion": V, "io.modelcontextprotocol/clientCapabilities": {} };
const SCOPE = { tenantId: "local", projectId: "proj-d3-mcp", branchId: "main" };
const RELEASE_TOOL = "sirkit.manufacturing.release";
const REVISION_READ = "sirkit.project.canonical-revision-inspect";
const BOARD_READ = "sirkit.pcb.board-inspect";

let origin: string;
let token: string;
/** every response body and header this spec saw, for W17's whole-run sweep */
const seen: Array<{ label: string; text: string; headers: string }> = [];
/** W1..W3's derived answers, printed at the end for the endpoint page to record */
const derived: Array<{ method: string; status: number }> = [];

const selector = (): Record<string, string> => ({
  "x-sirkit-tenant-id": SCOPE.tenantId,
  "x-sirkit-project-id": SCOPE.projectId,
  "x-sirkit-branch-id": SCOPE.branchId,
});

interface Shape {
  method?: string;
  name?: string;
  args?: Record<string, unknown>;
  meta?: Record<string, unknown>;
  /** omit `id` entirely: a JSON-RPC notification */
  notification?: boolean;
  id?: number;
}
const body = (shape: Shape): Record<string, unknown> => {
  const method = shape.method ?? "tools/call";
  const params: Record<string, unknown> = { _meta: { ...META, ...(shape.meta ?? {}) } };
  if (method === "tools/call") {
    params.name = shape.name;
    params.arguments = shape.args ?? {};
  }
  return { jsonrpc: "2.0", ...(shape.notification === true ? {} : { id: shape.id ?? 1 }), method, params };
};
const headersFor = (shape: Shape, overrides: Record<string, string | null> = {}): Record<string, string> => {
  const method = shape.method ?? "tools/call";
  const built: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    "mcp-protocol-version": V,
    "mcp-method": method,
    ...(method === "tools/call" && shape.name !== undefined ? { "mcp-name": shape.name } : {}),
    ...selector(),
  };
  for (const [name, value] of Object.entries(overrides)) {
    if (value === null) delete built[name];
    else built[name] = value;
  }
  return built;
};

interface Answer { status: number; json: Record<string, unknown>; text: string; headers: Record<string, string> }
async function send(context: APIRequestContext, label: string, url: string, shape: Shape, overrides: Record<string, string | null> = {}, withToken = true): Promise<Answer> {
  const headers = headersFor(shape, overrides);
  if (withToken && token) headers.authorization = `Bearer ${token}`;
  const response = await context.post(url, { headers, data: body(shape) });
  const text = await response.text();
  let json: Record<string, unknown> = {};
  try { json = text ? (JSON.parse(text) as Record<string, unknown>) : {}; } catch { json = {}; }
  const responseHeaders = response.headers();
  seen.push({ label, text, headers: JSON.stringify(responseHeaders) });
  return { status: response.status(), json, text, headers: responseHeaders };
}

const errorOf = (answer: Answer): { code?: number; message?: string; data?: unknown } => (answer.json.error as { code?: number; message?: string; data?: unknown } | undefined) ?? {};

/**
 * [B20 D review] regressions-7: ONE file-path pattern for W1-W3 and W17. A Windows path in a RAW body carries single
 * backslashes, the same path inside JSON (a stringified header map, a JSON string) carries doubled ones, and a CI path is
 * POSIX: `\\+` and the two-character classes see all three spellings. W17 proves the pattern's sight on samples first.
 */
const FILE_PATH = /[A-Za-z]:\\+|[\\\/]app[\\\/]lib[\\\/]|[\\\/]node_modules[\\\/]/;
/** DEC-8: the statuses that are safe either way for an unexported method; 200 would mean the method is SERVED (W1-W3) */
const UNEXPORTED_METHOD_STATUSES: readonly number[] = [405, 404, 204, 501];
/** keys that would mean a served MCP surface or a credential in an answer to an unexported method */
const SERVED_SURFACE_KEYS = ['"result"', '"tools"', '"supportedVersions"', '"capabilities"', '"access_token"'];

test.beforeAll(async ({ playwright, baseURL }) => {
  origin = baseURL!;
  // W8: the cookie-less local principal is the project administrator (the precedent is e2e/agent-execution.spec.ts).
  // The token is minted ONCE for the whole file and never logged, attached or interpolated into a title.
  const minter = await playwright.request.newContext({ baseURL: origin });
  try {
    const response = await minter.post("/api/mcp/token", { headers: { "content-type": "application/json", origin, ...selector() }, data: {} });
    expect(response.status(), "the MCP token route answered 200 under the fixture runtime").toBe(200);
    const payload = (await response.json()) as { ok?: boolean; access_token?: string; token_type?: string; scope?: string; resource?: string };
    expect(payload.ok).toBe(true);
    expect(payload.token_type).toBe("Bearer");
    expect(payload.scope).toBe("sirkit.mcp");
    expect(payload.resource).toBe(`${origin}/api/mcp`);
    expect(typeof payload.access_token).toBe("string");
    expect(payload.access_token!.split(".")).toHaveLength(3);
    expect(payload.access_token!.length).toBeGreaterThan(40);
    token = payload.access_token!;
  } finally {
    await minter.dispose();
  }
});

test("W1-W3: an unexported GET, DELETE and OPTIONS on /api/mcp — the answer is DERIVED and RECORDED within DEC-8's safe set {405, 404, 204, 501}, never asserted as 405 and never admitted as 200; whatever it is, it carries no result, no served surface, no token, no stack trace and no file path, and a 204 carries no body at all", async ({ request }) => {
  for (const method of ["GET", "DELETE", "OPTIONS"] as const) {
    const response = method === "GET" ? await request.get("/api/mcp") : method === "DELETE" ? await request.delete("/api/mcp") : await request.fetch("/api/mcp", { method: "OPTIONS" });
    const text = await response.text();
    seen.push({ label: `${method} /api/mcp`, text, headers: JSON.stringify(response.headers()) });
    derived.push({ method, status: response.status() });
    // DEC-8: only what is safe either way. 405 is a SHOULD for GET and DELETE in the 2026-07-28 transport binding, and
    // OPTIONS is not mentioned at all; the App Router may auto-implement it. [B20 D review] regressions-1: 200 is NOT
    // in the set — it is the one answer that would mean the method started serving something (the measured answers are
    // GET 405, DELETE 405, OPTIONS 204, recorded on the endpoint page).
    expect(UNEXPORTED_METHOD_STATUSES, `${method} answered an unexpected status`).toContain(response.status());
    if (response.status() === 204) expect(text, `${method} answered 204 with a body`).toBe("");
    for (const key of SERVED_SURFACE_KEYS) expect(text.includes(key), `${method} carried ${key}`).toBe(false);
    expect(text.includes(token), `${method} carried the token`).toBe(false);
    expect(text.includes("at Object."), `${method} carried a stack frame`).toBe(false);
    expect(FILE_PATH.test(text), `${method} carried a file path`).toBe(false);
  }
  // recorded for mcp-server-endpoint.md §12 (UNKNOWN 3 / U2)
  console.log(`[B20 D3] unexported methods on /api/mcp: ${derived.map((entry) => `${entry.method}=${entry.status}`).join(" ")}`);
});

test("W4-W5: a foreign Origin and a null Origin are both 403 with their own closed code, and neither answer carries a JSON-RPC result", async ({ playwright }) => {
  const rows: Array<{ origin: string; code: string }> = [
    { origin: "http://evil.example", code: "AUTH_CROSS_ORIGIN_DENIED" },
    { origin: "null", code: "AUTH_ORIGIN_NULL" },
  ];
  for (const row of rows) {
    const context = await playwright.request.newContext({ baseURL: origin });
    try {
      const answer = await send(context, `origin ${row.origin}`, "/api/mcp", { name: BOARD_READ }, { origin: row.origin });
      expect(answer.status, row.origin).toBe(403);
      expect(answer.json.code, row.origin).toBe(row.code);
      expect(answer.json.result, row.origin).toBeUndefined();
    } finally {
      await context.dispose();
    }
  }
});

test("W6: no Authorization is 401 MCP_UNAUTHENTICATED with the RFC 9728 challenge naming this origin's protected-resource metadata", async ({ request }) => {
  const answer = await send(request, "no authorization", "/api/mcp", { name: BOARD_READ }, {}, false);
  expect(answer.status).toBe(401);
  expect(answer.json.code).toBe("MCP_UNAUTHENTICATED");
  expect(answer.headers["www-authenticate"] ?? "").toContain(`resource_metadata="${origin}/.well-known/oauth-protected-resource/api/mcp"`);
  expect(answer.headers["www-authenticate"] ?? "").toContain('scope="sirkit.mcp"');
});

test("W7: the RFC 9728 metadata route is SERVED on the wire — closing endpoint-page U1 — and it names this origin's resource, the one scope, the header bearer method, and NO authorization_servers (OD-43's recorded deviation)", async ({ request }) => {
  const response = await request.get("/.well-known/oauth-protected-resource/api/mcp");
  const text = await response.text();
  seen.push({ label: "well-known metadata", text, headers: JSON.stringify(response.headers()) });
  expect(response.status()).toBe(200);
  const document = JSON.parse(text) as Record<string, unknown>;
  expect(document.resource).toBe(`${origin}/api/mcp`);
  expect(document.scopes_supported).toEqual(["sirkit.mcp"]);
  expect(document.bearer_methods_supported).toEqual(["header"]);
  // the recorded deviation, pinned AS IT IS: the 2026-07-28 authorization-server-discovery page makes this field a MUST
  expect(Object.hasOwn(document, "authorization_servers")).toBe(false);
});

test("W9: a NOTIFICATION — tools/list with no id, with _meta and no Mcp-Name — is 202 with an empty body", async ({ request }) => {
  const headers = headersFor({ method: "tools/list", notification: true });
  headers.authorization = `Bearer ${token}`;
  const response = await request.post("/api/mcp", { headers, data: body({ method: "tools/list", notification: true }) });
  const text = await response.text();
  seen.push({ label: "notification", text, headers: JSON.stringify(response.headers()) });
  expect(response.status()).toBe(202);
  expect(text).toBe("");
});

test("W10-W11: the protocol-version header — absent is 400 -32020 naming data.supported (Sirkit's DESIGN, not a specification requirement), and an unsupported version is 400 -32022 carrying BOTH data.supported and data.requested as the 2026-07-28 schema requires", async ({ request }) => {
  const absent = await send(request, "no protocol header", "/api/mcp", { method: "tools/list" }, { "mcp-protocol-version": null });
  expect(absent.status).toBe(400);
  expect(errorOf(absent).code).toBe(-32020);
  // HeaderMismatchError requires no `data`; sending `supported` is ALLOWED, not required. This pins Sirkit's choice.
  expect((errorOf(absent).data as { supported?: unknown } | undefined)?.supported).toEqual([V]);

  const unsupported = await send(request, "unsupported version", "/api/mcp", { method: "tools/list", meta: { "io.modelcontextprotocol/protocolVersion": "1900-01-01" } }, { "mcp-protocol-version": "1900-01-01" });
  expect(unsupported.status).toBe(400);
  expect(errorOf(unsupported).code).toBe(-32022);
  const data = errorOf(unsupported).data as { supported?: unknown; requested?: unknown } | undefined;
  expect(data?.supported).toEqual([V]);
  expect(data?.requested).toBe("1900-01-01");
});

test("W12-W13: any query string is 400 MCP_QUERY_REFUSED with an invalid_request challenge, and the fixture role COOKIE without a bearer is 401 — a cookie is not a bearer", async ({ playwright }) => {
  const plain = await playwright.request.newContext({ baseURL: origin });
  try {
    const query = await send(plain, "query string", "/api/mcp?x=1", { method: "tools/list" });
    expect(query.status).toBe(400);
    expect(query.json.code).toBe("MCP_QUERY_REFUSED");
    expect(query.headers["www-authenticate"] ?? "").toContain('error="invalid_request"');
  } finally {
    await plain.dispose();
  }
  const cookied = await playwright.request.newContext({ baseURL: origin, extraHTTPHeaders: { cookie: "sirkit-fixture-role=editor" } });
  try {
    const answer = await send(cookied, "cookie only", "/api/mcp", { method: "tools/list" }, {}, false);
    expect(answer.status).toBe(401);
    expect(answer.json.result).toBeUndefined();
  } finally {
    await cookied.dispose();
  }
});

test("W14: server/discover with this origin's own Origin header, the token, _meta and NO Mcp-Name is 200 with the DiscoverResult", async ({ playwright }) => {
  const context = await playwright.request.newContext({ baseURL: origin });
  try {
    const answer = await send(context, "discover", "/api/mcp", { method: "server/discover" }, { origin });
    expect(answer.status).toBe(200);
    const result = answer.json.result as { resultType?: string; supportedVersions?: unknown; capabilities?: unknown; instructions?: unknown };
    expect(result.resultType).toBe("complete");
    expect(result.supportedVersions).toEqual([V]);
    expect(result.capabilities).toBeDefined();
    expect(typeof result.instructions).toBe("string");
  } finally {
    await context.dispose();
  }
});

test("W15a-W15b: the hidden release tool on the wire — a matching Mcp-Name gives 200 -32602 \"Unknown tool or invalid arguments\" with NO data, and a header naming a different tool gives 400 -32020, both without serving anything", async ({ request }) => {
  const refused = await send(request, "release tool", "/api/mcp", { name: RELEASE_TOOL });
  expect(refused.status).toBe(200);
  expect(errorOf(refused).code).toBe(-32602);
  expect(errorOf(refused).message).toBe("Unknown tool or invalid arguments");
  expect(Object.hasOwn(errorOf(refused), "data")).toBe(false);
  expect(refused.json.result).toBeUndefined();

  for (const pair of [{ bodyName: RELEASE_TOOL, header: BOARD_READ }, { bodyName: BOARD_READ, header: RELEASE_TOOL }]) {
    const mismatch = await send(request, `header ${pair.header}`, "/api/mcp", { name: pair.bodyName }, { "mcp-name": pair.header });
    expect(mismatch.status, pair.header).toBe(400);
    expect(errorOf(mismatch).code, pair.header).toBe(-32020);
    expect(mismatch.json.result, pair.header).toBeUndefined();
  }
});

test("W16: a SERVED read with the full shape answers a 200 tool result, so W15a's refusal is about the id and not about a malformed request", async ({ request }) => {
  // the revision read is one of the two pin-exempt reads, so it needs no `dev.sirkit/expectedRevision`
  const exempt = await send(request, "revision read", "/api/mcp", { name: REVISION_READ });
  expect(exempt.status).toBe(200);
  const result = exempt.json.result as { resultType?: string; content?: unknown; _meta?: Record<string, unknown> } | undefined;
  expect(result, "a served read answers a tool result, never a JSON-RPC error").toBeDefined();
  expect(exempt.json.error).toBeUndefined();
  expect(result!.resultType).toBe("complete");
  expect(Array.isArray(result!.content)).toBe(true);

  // and a non-exempt read carries the read pipeline's own closed refusal, never the unknown-tool error
  const revision = String((result!._meta ?? {})["dev.sirkit/revision"] ?? "");
  const pinned = await send(request, "board read", "/api/mcp", { name: BOARD_READ, meta: revision === "" ? {} : { "dev.sirkit/expectedRevision": revision } });
  expect(pinned.status).toBe(200);
  expect(pinned.json.error).toBeUndefined();
  expect((pinned.json.result as { resultType?: string }).resultType).toBe("complete");
});

test("W17: no response of this whole run carried the token, the token secret, a stack frame or a file path — bodies AND headers, with the file-path pattern's own sight proven on a raw Windows path, a JSON-escaped one and a POSIX one first", () => {
  // the pattern can SEE what it sweeps for: without this, a regex that only matched doubled backslashes would pass a raw
  // dev error page on a Windows host (the [B20 D review] regressions-7 gap)
  const rawWindows = ["C:", "Users", "someone", "app", "lib", "mcp", "x.ts"].join(String.fromCharCode(92));
  expect(FILE_PATH.test(rawWindows)).toBe(true);
  expect(FILE_PATH.test(JSON.stringify({ path: rawWindows }))).toBe(true);
  expect(FILE_PATH.test("/home/ci/work/app/lib/mcp/x.ts")).toBe(true);
  expect(FILE_PATH.test("/home/ci/work/node_modules/next/dist/x.js")).toBe(true);
  expect(FILE_PATH.test('{"ok":false,"code":"MCP_TOKEN_INVALID"}')).toBe(false);
  expect(seen.length).toBeGreaterThanOrEqual(12);
  for (const entry of seen) {
    // the body RAW and the header map separately, so a raw single-backslash path is judged as it is, never JSON-escaped
    for (const [part, text] of [["body", entry.text], ["headers", entry.headers]] as const) {
      expect(text.includes(token), `${entry.label} ${part} carried the token`).toBe(false);
      expect(text.includes("SIRKIT_MCP_TOKEN_SECRET"), `${entry.label} ${part} named the secret variable`).toBe(false);
      expect(text.includes("e2e-mcp-token-secret"), `${entry.label} ${part} carried the secret`).toBe(false);
      expect(text.includes("at Object."), `${entry.label} ${part} carried a stack frame`).toBe(false);
      expect(FILE_PATH.test(text), `${entry.label} ${part} carried a file path`).toBe(false);
    }
  }
});
