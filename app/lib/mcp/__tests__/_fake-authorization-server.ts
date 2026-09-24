/**
 * [B20 A3] The in-process fake authorization world of the A3 suites, injected through the egress seam (`OutboundDeps`): one
 * URL router over the MCP endpoint (the unauthenticated probe and the authorized MCP requests), its protected-resource
 * metadata, the pinned issuer's metadata and its token endpoint. No network, no DNS, no real server, no real credential:
 * every client secret, issued token and refresh token is an obvious fake of at least 16 characters assembled at run time,
 * and every PRM, AS and token document carries a planted marker that must never reach an outcome.
 */
import { mcpAuthorizationTokenProvider } from "../authorization";
import type { McpTransportDeps } from "../http-transport";
import type { McpServerRegistryEntry } from "../server-registry";
import { fixtureServer, T0 } from "./_fixtures";
import { byMethod, PUBLIC, type FakeCall, type FakeScript } from "./_fake-mcp-server";

export const ISSUER = "https://auth.example.com";
export const TOKEN_ENDPOINT = "https://auth.example.com/oauth/token";
export const CEILING: readonly string[] = Object.freeze(["docs:read", "docs:search"]);
export const CLIENT_ID_ENV = "MCP_DOCS_CLIENT_ID";
export const CLIENT_SECRET_ENV = "MCP_DOCS_CLIENT_SECRET";
export const B64_SECRET_ENV = "MCP_DOCS_B64_CLIENT_SECRET";
export const SPACE_SECRET_ENV = "MCP_DOCS_SPACE_CLIENT_SECRET";
export const SLASH_SECRET_ENV = "MCP_DOCS_SLASH_CLIENT_SECRET";
export const EXTENSION = "io.modelcontextprotocol/oauth-client-credentials";

const STEM = ["fake", "client", "secret"].join("-");
export const CLIENT_ID = `${["fake", "client", "id"].join("-")}-0001`;
/** S8: the special-character secret — a space, ':', '%' and '+' — so form encoding and Basic are both exercised */
export const CLIENT_SECRET = `${STEM} a:b%c+d-0042`;
/** unreserved characters only (form encoding leaves it unchanged), and not digits only */
export const B64_SECRET = `${STEM}-unreservedQ7x`;
/**
 * [B20 A3 review] The two secrets that tell D15's spellings apart. SPACE: unreserved characters and one space — the raw
 * secret is no b64token (the space), its form encoding (the space as '+') IS one, so only the form-encoded check can refuse a
 * token that carries it. SLASH: b64token characters form encoding changes ('/' and '+') — the raw secret IS a b64token, its
 * form encoding ('%2F', '%2B') is not, so only the raw check can refuse a token that carries it.
 */
export const SPACE_SECRET = `${STEM} spacedQ7x`;
export const SLASH_SECRET = `${STEM}/slashed+Q7x`;
export const REFRESH_TOKEN = `${["fake", "refresh", "token"].join("-")}-0000000001x`;
/** planted in every PRM, AS and token field: absent from every outcome */
export const MARKER = ["zq", "planted", "marker", "7f3a"].join("-");

export const ENV: Readonly<Record<string, string>> = Object.freeze({
  [CLIENT_ID_ENV]: CLIENT_ID, [CLIENT_SECRET_ENV]: CLIENT_SECRET, [B64_SECRET_ENV]: B64_SECRET, [SPACE_SECRET_ENV]: SPACE_SECRET, [SLASH_SECRET_ENV]: SLASH_SECRET,
});

/** RFC 6749 Appendix B: application/x-www-form-urlencoded, as the client must encode the id and the secret */
export const formenc = (value: string): string => encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`).replace(/%20/g, "+");
export const basicCredential = (id: string, secret: string): string => btoa(`${formenc(id)}:${formenc(secret)}`);

const LIMITS = { requestsPerMinute: 600, maxConcurrent: 16, deadlineMs: 10_000, maxResponseBytes: 8_000_000, breaker: { failureThreshold: 3, cooldownMs: 60_000 } };

/** A client-credentials row pinned to ISSUER; `host` and `path` name its endpoint. */
export function ccRow(id: string, host: string, overrides: Partial<McpServerRegistryEntry> = {}, path = "/mcp", secretEnv = CLIENT_SECRET_ENV): McpServerRegistryEntry {
  return fixtureServer({
    id,
    canonicalUri: `https://${host}${path === "/" ? "" : path}`,
    endpoint: { host, port: null, path },
    auth: {
      mode: "client-credentials-env",
      secrets: [{ env: CLIENT_ID_ENV, role: "client-id" }, { env: secretEnv, role: "client-secret" }],
      scopes: [...CEILING],
      authorizationServer: { issuer: ISSUER, tokenEndpoint: TOKEN_ENDPOINT },
    },
    limits: { ...LIMITS },
    ...overrides,
  });
}

export const ccServer = ccRow("docs-cc", "mcp.example.com");
/** the same issuer and client-id variable, its own secret variable (the registry refuses a shared secret name) */
export const ccServerB64 = ccRow("docs-cc-b64", "b64.example.com", {}, "/mcp", B64_SECRET_ENV);
/** [B20 A3 review] the rows of the two secrets that isolate one D15 spelling each */
export const ccServerSpace = ccRow("docs-cc-space", "space.example.com", {}, "/mcp", SPACE_SECRET_ENV);
export const ccServerSlash = ccRow("docs-cc-slash", "slash.example.com", {}, "/mcp", SLASH_SECRET_ENV);

export type AuthKind = "probe" | "mcp" | "prm" | "as" | "token" | "other";
export interface AuthCall extends FakeCall {
  host: string;
  path: string;
  kind: AuthKind;
  /** the parsed form of a token request */
  form: URLSearchParams | null;
  signal: AbortSignal | undefined;
}
export type AuthHandler = (call: AuthCall, world: AuthWorld) => Response | Promise<Response>;
export interface AuthScript {
  probe?: AuthHandler;
  mcp?: AuthHandler;
  prm?: AuthHandler;
  as?: AuthHandler;
  token?: AuthHandler;
  other?: AuthHandler;
  resolve?: (hostname: string) => Promise<string[]>;
}
export interface AuthWorld {
  calls: AuthCall[];
  transport: typeof fetch;
  issued: string[];
  /** mints the next obvious fake access token */
  issue: () => string;
  now: number;
  deps: (extra?: Partial<McpTransportDeps>) => McpTransportDeps;
  of: (kind: AuthKind) => AuthCall[];
}

export const jsonAnswer = (value: unknown, status = 200, headers: Record<string, string> = {}): Response => new Response(typeof value === "string" ? value : JSON.stringify(value), { status, headers: { "content-type": "application/json", ...headers } });
export const plainAnswer = (body: string | null, status: number, headers: Record<string, string> = {}): Response => new Response(body, { status, headers });

/** A well-formed protected-resource metadata document for `resource`; `overrides` replace fields (undefined removes one). */
export function prmDocument(resource: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const doc: Record<string, unknown> = { resource, authorization_servers: [ISSUER], bearer_methods_supported: ["header"], scopes_supported: [...CEILING], resource_name: MARKER, resource_documentation: `https://docs.example.com/${MARKER}`, planted: MARKER, ...overrides };
  for (const key of Object.keys(doc)) if (doc[key] === undefined) delete doc[key];
  return doc;
}

/** A well-formed authorization-server metadata document; `overrides` replace fields (undefined removes one). */
export function asDocument(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const doc: Record<string, unknown> = {
    issuer: ISSUER,
    token_endpoint: TOKEN_ENDPOINT,
    grant_types_supported: ["client_credentials"],
    token_endpoint_auth_methods_supported: ["client_secret_basic"],
    authorization_endpoint: `https://auth.example.com/${MARKER}`,
    service_documentation: MARKER,
    planted: MARKER,
    ...overrides,
  };
  for (const key of Object.keys(doc)) if (doc[key] === undefined) delete doc[key];
  return doc;
}

/** A well-formed token response for `token`; `overrides` replace fields (undefined removes one). */
export function tokenDocument(token: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const doc: Record<string, unknown> = { access_token: token, token_type: "Bearer", expires_in: 3_600, refresh_token: REFRESH_TOKEN, id_token: MARKER, planted: MARKER, ...overrides };
  for (const key of Object.keys(doc)) if (doc[key] === undefined) delete doc[key];
  return doc;
}

const WELL_KNOWN_PRM = "/.well-known/oauth-protected-resource";
const TOKEN_PATH = new URL(TOKEN_ENDPOINT).pathname;

/** The path-inserted PRM URL of a canonical URI (the default challenge URL of the probe). */
export const prmUrlOf = (canonicalUri: string): string => {
  const url = new URL(canonicalUri);
  return `${url.origin}${WELL_KNOWN_PRM}${url.pathname === "/" ? "" : url.pathname}`;
};

function classify(url: URL, method: string | undefined, headers: Record<string, string>): AuthKind {
  // a token endpoint may live on another host than the issuer (OD-61): any POST to the token path is a token request
  if (url.pathname === TOKEN_PATH && method === "POST") return "token";
  if (url.origin === new URL(ISSUER).origin && url.pathname.includes("/.well-known/")) return "as";
  // every GET the client makes on another host is a protected-resource metadata request (a well-known URI or a challenge URL)
  if (method === "GET" || url.pathname.startsWith(WELL_KNOWN_PRM)) return "prm";
  if (method === "POST") return Object.keys(headers).some((name) => name.toLowerCase() === "authorization") ? "mcp" : "probe";
  return "other";
}

const defaultProbe: AuthHandler = (call) => plainAnswer(null, 401, { "www-authenticate": `Bearer resource_metadata="${prmUrlOf(call.url.split("?")[0]!)}"` });
const defaultPrm: AuthHandler = (call) => {
  const url = new URL(call.url);
  // a challenge URL elsewhere on the host serves the document of the host's `/mcp` endpoint (every fixture row's path)
  if (!url.pathname.startsWith(WELL_KNOWN_PRM)) return jsonAnswer(prmDocument(`${url.origin}/mcp`));
  const rest = url.pathname.slice(WELL_KNOWN_PRM.length);
  // the path-inserted document answers; the root one is 404 (a server on a path)
  if (rest === "") return plainAnswer("not found", 404);
  return jsonAnswer(prmDocument(`${url.origin}${rest}`));
};
const defaultAs: AuthHandler = (call) => (new URL(call.url).pathname === "/.well-known/oauth-authorization-server" ? jsonAnswer(asDocument()) : plainAnswer("not found", 404));
const defaultToken: AuthHandler = (_call, world) => jsonAnswer(tokenDocument(world.issue()));
const defaultMcp: FakeScript = byMethod({});

export function authWorld(script: AuthScript = {}): AuthWorld {
  const calls: AuthCall[] = [];
  const issued: string[] = [];
  const world: AuthWorld = {
    calls,
    issued,
    now: T0,
    issue: () => {
      const token = `${["fake", "access", "token"].join("-")}-${String(issued.length + 1).padStart(4, "0")}x`;
      issued.push(token);
      return token;
    },
    transport: async (input, init) => {
      const raw = typeof init?.body === "string" ? init.body : "";
      let body: FakeCall["body"] = {};
      try { body = JSON.parse(raw) as FakeCall["body"]; } catch { body = {}; }
      const headers = { ...((init?.headers ?? {}) as Record<string, string>) };
      const url = new URL(String(input));
      const kind = classify(url, init?.method, headers);
      const call: AuthCall = { url: String(input), httpMethod: init?.method, headers, body, raw, host: url.host, path: url.pathname, kind, form: kind === "token" ? new URLSearchParams(raw) : null, signal: init?.signal ?? undefined };
      calls.push(call);
      switch (kind) {
        case "probe": return (script.probe ?? defaultProbe)(call, world);
        case "mcp": return script.mcp ? script.mcp(call, world) : defaultMcp(call, calls.length - 1);
        case "prm": return (script.prm ?? defaultPrm)(call, world);
        case "as": return (script.as ?? defaultAs)(call, world);
        case "token": return (script.token ?? defaultToken)(call, world);
        default: return script.other ? script.other(call, world) : plainAnswer("not found", 404);
      }
    },
    deps: (extra = {}) => ({ fetch: world.transport, resolve: script.resolve ?? PUBLIC, clock: () => world.now, environment: { ...ENV }, tokenProvider: mcpAuthorizationTokenProvider, ...extra }),
    of: (kind) => calls.filter((call) => call.kind === kind),
  };
  return world;
}

/** An answer that never comes: it rejects only when the egress deadline (or a caller) aborts the request. */
export const hang = (call: AuthCall): Promise<Response> => new Promise((_resolve, reject) => {
  if (call.signal?.aborted) { reject(new Error("aborted")); return; }
  call.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
});
/** A probe answer: 401 with a bare Bearer challenge (no resource_metadata), so discovery falls back to the well-known URIs. */
export const bareProbe: AuthHandler = () => plainAnswer(null, 401, { "www-authenticate": "Bearer" });
/** A probe answer: 401 whose challenge names `url` (and `scope` when given). */
export const challengeProbe = (url: string, scope?: string): AuthHandler => () => plainAnswer(null, 401, { "www-authenticate": `Bearer resource_metadata="${url}"${scope === undefined ? "" : `, scope="${scope}"`}` });

/** Every string of the recorded traffic of one host (URL, headers and body), for a "never reached this host" assertion. */
export const trafficTo = (world: AuthWorld, host: string): string => JSON.stringify(world.calls.filter((call) => call.host === host).map((call) => ({ url: call.url, headers: call.headers, raw: call.raw })));
/** A JSON-RPC tools/list request with a fixed id. */
export const listRequest = (id: number | string = 7): { jsonrpc: "2.0"; id: number | string; method: string; params: Record<string, unknown> } => ({ jsonrpc: "2.0", id, method: "tools/list", params: {} });
