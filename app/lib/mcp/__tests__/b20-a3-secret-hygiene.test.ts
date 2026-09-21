/**
 * [B20 A3] Secret hygiene of the authorization client: no sentence carries server text, a secret, a token or a refresh
 * token; no export throws or rejects, whatever the fetch, the body, the clock, the environment, the row, the options or the
 * signal do; nothing is polluted, nothing is logged; the modules are imported only from `app/lib/mcp/` (D14: no token is
 * forwarded to any provider in A3 — A4 adds its composition root); and the boundary page states what A3 delivered.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetAdmissionControl } from "../../acquisition/admission-control";
import { collectProductionFiles, moduleImportOffenders } from "../../project/__tests__/_import-gate-helpers";
import {
  createMcpRedactionCollector, isMcpAuthorizationProvider, MCP_ACCESS_TOKEN_MAX_CHARS, MCP_AUTH_METADATA_CACHE_MAX, MCP_AUTH_METADATA_TTL_MS, MCP_AUTH_TRACE_EXCHANGES_MAX, MCP_AUTHORIZATION_BACKOFF_MS,
  MCP_AUTHORIZATION_DEFAULT_DEADLINE_MS, MCP_AUTHORIZED_POST_MAX_EXCHANGES, MCP_CALL_REDACTION_SUBJECTS_MAX, MCP_CLIENT_ID_MAX_CHARS, MCP_CLIENT_SECRET_MAX_CHARS, MCP_DROPPED_TOKENS_PER_SERVER,
  MCP_REDACTION_SUBJECTS_MAX, MCP_SCOPE_STRING_MAX_CHARS, MCP_STATE_PROBE_MIN_CHARS, MCP_TOKEN_CACHE_MAX, MCP_TOKEN_DEFAULT_LIFETIME_SECONDS, MCP_TOKEN_ERROR_BODY_MAX_BYTES, MCP_TOKEN_EXPIRY_SKEW_MS,
  MCP_TOKEN_MAX_LIFETIME_SECONDS, MCP_TOKEN_REQUESTS_PER_CALL_MAX, MCP_TOKEN_REQUESTS_PER_MINUTE, MCP_TOKEN_RESPONSE_MAX_BYTES, MCP_TOKEN_TYPE_MAX_CHARS, MCP_OAUTH_ERROR_CODES,
  MCP_AUTHORIZATION_FAILURE_CODES, mcpAuthorizationStateCarries, mcpAuthorizationStateCounts, mcpAuthorizationTokenProvider, mcpPostAuthorized, resetMcpAuthorization,
} from "../authorization";
import { MCP_REDACT_ALSO_MAX, MCP_REDACTION_SUBJECT_MAX_CHARS, resetMcpInFlight } from "../http-transport";
import {
  admitMcpResourceMetadataUrl, MCP_AUTH_METADATA_MAX_BYTES, MCP_AUTH_URL_MAX_CHARS, MCP_METADATA_LIST_ENTRY_MAX_CHARS, MCP_METADATA_LIST_MAX, MCP_PRM_AUTHORIZATION_SERVERS_MAX, MCP_PRM_SCOPES_SUPPORTED_MAX,
  mcpAuthorizationServerMetadataUrls, mcpProtectedResourceMetadataUrls,
} from "../oauth-discovery";
import { MCP_AUTHORIZATION_URL_MAX_CHARS, MCP_SCOPES_MAX, type McpServerRegistryEntry } from "../server-registry";
import { rpcResult, survivor } from "./_fake-mcp-server";
import {
  asDocument, authWorld, basicCredential, ccServer, CLIENT_ID, CLIENT_SECRET, ENV, formenc, jsonAnswer, listRequest, MARKER, plainAnswer, prmDocument, REFRESH_TOKEN, tokenDocument, type AuthScript, type AuthWorld,
} from "./_fake-authorization-server";

const send = (world: AuthWorld, server: McpServerRegistryEntry = ccServer, extra: Record<string, unknown> = {}) => mcpPostAuthorized(server, listRequest(), { purpose: "interactive", deps: world.deps(), ...extra });
const PLANTED = [MARKER, CLIENT_SECRET, formenc(CLIENT_SECRET), basicCredential(CLIENT_ID, CLIENT_SECRET), REFRESH_TOKEN];
const read = (path: string): string => readFileSync(resolve(process.cwd(), path), "utf8");
const flat = (text: string): string => text.replace(/\s+/g, " ");
const spaced = (value: number): string => String(value).replace(/\B(?=(\d{3})+(?!\d))/g, " ");

beforeEach(() => {
  resetAdmissionControl();
  resetMcpInFlight();
  resetMcpAuthorization();
  vi.stubGlobal("fetch", () => { throw new Error("the authorization client bypassed the egress boundary and called the global fetch"); });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetAdmissionControl();
  resetMcpInFlight();
  resetMcpAuthorization();
});

describe("[B20 A3] the leak matrix", () => {
  it("over the hostile rows of the A3 suites every sentence is at most 300 characters and no outcome carries planted text, the secret or a refresh token", async () => {
    const insufficient = (scope: string): Response => plainAnswer(null, 403, { "www-authenticate": `Bearer error="insufficient_scope", scope="${scope}", error_description="${MARKER}"` });
    const scenarios: Array<[string, AuthScript]> = [
      ["planted PRM text, a foreign resource", { prm: () => jsonAnswer(prmDocument(`https://${MARKER}.example.com/mcp`)) }],
      ["a PRM naming another issuer", { prm: () => jsonAnswer(prmDocument(ccServer.canonicalUri, { authorization_servers: [`https://${MARKER}.example.com`] })) }],
      ["a cross-origin challenge URL", { probe: () => plainAnswer(null, 401, { "www-authenticate": `Bearer resource_metadata="https://${MARKER}.example.net/prm"` }) }],
      ["a same-origin challenge URL that fails", { probe: () => plainAnswer(null, 401, { "www-authenticate": `Bearer resource_metadata="https://mcp.example.com/${MARKER}"` }), prm: () => { throw new Error(MARKER); } }],
      ["an AS issuer mismatch", { as: () => jsonAnswer(asDocument({ issuer: `https://${MARKER}.example.org` })) }],
      ["an AS token endpoint mismatch", { as: () => jsonAnswer(asDocument({ token_endpoint: `https://auth.example.com/${MARKER}` })) }],
      ["a redirect to a planted host", { token: () => plainAnswer(null, 302, { location: `https://${MARKER}.example.net/` }) }],
      ["an OAuth error with a planted description and the secret as error", { token: () => jsonAnswer({ error: CLIENT_SECRET, error_description: MARKER, error_uri: MARKER }, 400) }],
      ["a planted token_type", { token: (_call, world) => jsonAnswer(tokenDocument(world.issue(), { token_type: MARKER })) }],
      ["a granted scope beyond the row", { token: (_call, world) => jsonAnswer(tokenDocument(world.issue(), { scope: `docs:read ${MARKER}` })) }],
      ["a token echoing the Basic credential", { token: () => jsonAnswer(tokenDocument(basicCredential(CLIENT_ID, CLIENT_SECRET))) }],
      ["a network error carrying planted text", { token: () => { throw new Error(`${MARKER} ${CLIENT_SECRET}`); } }],
      // the transport hands a 401's challenge back as A1 parsed it: the planted scope is refused by A3 on a refresh, as a count
      ["a 401 on a cached token naming a planted scope", { mcp: (call, world) => (world.calls.filter((entry) => entry.kind === "mcp").length === 1 ? rpcResult(call, { tools: [] }) : plainAnswer(null, 401, { "www-authenticate": `Bearer error="invalid_token", scope="${MARKER}"` })) }],
      ["a 403 naming a planted scope", { mcp: () => insufficient(MARKER) }],
      ["a result echoing the issued token", { mcp: (call, world) => rpcResult(call, { tools: [], echo: `token ${world.issued.at(-1)}`, [world.issued.at(-1)!]: "as a key" }) }],
    ];
    for (const [label, script] of scenarios) {
      resetMcpAuthorization();
      const world = authWorld(script);
      let outcome = await send(world);
      if (label.includes("on a cached token")) outcome = await send(world);
      for (const token of world.issued) expect(survivor(outcome, token), `${label}: an issued token`).toBeNull();
      const message = (outcome as { message?: unknown }).message;
      if (typeof message === "string") expect(message.length, label).toBeLessThanOrEqual(300);
      const serialized = JSON.stringify(outcome);
      for (const planted of PLANTED) expect(serialized.includes(planted), `${label}: ${planted.slice(0, 12)}`).toBe(false);
      expect(mcpAuthorizationStateCarries(CLIENT_SECRET), label).toBe(false);
      expect(mcpAuthorizationStateCarries(REFRESH_TOKEN), label).toBe(false);
    }
  });
});

describe("[B20 A3] never throws, never rejects (S4)", () => {
  it("a throwing fetch, a non-Response answer, a throwing body getter, a hostile clock, a throwing environment, a throwing row, null options and a signal that cannot be listened to each settle with a closed outcome", async () => {
    const throwingBody = { status: 200, headers: new Headers({ "content-type": "application/json" }), get body(): never { throw new Error(`${MARKER} body`); } };
    const scenarios: Array<{ label: string; run: () => Promise<unknown>; code?: string; tokenRequests: number }> = [
      { label: "a throwing fetch", run: () => send(authWorld(), ccServer, { deps: { ...authWorld().deps(), fetch: () => { throw new Error(MARKER); } } }), code: "prm_unavailable", tokenRequests: 0 },
      { label: "a non-Response answer", run: () => send(authWorld(), ccServer, { deps: { ...authWorld().deps(), fetch: async () => ({}) as Response } }), code: "prm_unavailable", tokenRequests: 0 },
      { label: "a throwing body getter", run: () => send(authWorld(), ccServer, { deps: { ...authWorld().deps(), fetch: async () => throwingBody as unknown as Response } }), code: "prm_unavailable", tokenRequests: 0 },
      { label: "a clock that throws (no good tick yet)", run: () => send(authWorld(), ccServer, { deps: authWorld().deps({ clock: () => { throw new Error(MARKER); } }) }), code: "authorization_failed", tokenRequests: 0 },
      { label: "a clock that answers NaN (no good tick yet)", run: () => send(authWorld(), ccServer, { deps: authWorld().deps({ clock: () => Number.NaN }) }), code: "authorization_failed", tokenRequests: 0 },
      { label: "a clock that steps backwards on every read", run: () => { let now = Date.UTC(2026, 8, 17, 12, 0, 0); return send(authWorld(), ccServer, { deps: authWorld().deps({ clock: () => (now -= 1_000) }) }); }, tokenRequests: 1 },
      { label: "an environment whose getter throws", run: () => send(authWorld(), ccServer, { deps: authWorld().deps({ environment: new Proxy({ ...ENV }, { get: () => { throw new Error(MARKER); }, getOwnPropertyDescriptor: () => { throw new Error(MARKER); } }) }) }), code: "client_credentials_unavailable", tokenRequests: 0 },
      // [B20 A3 review] reviewed expectation change (regressions-2): a row whose auth cannot be read is no client-credentials
      // row, so it passes through to mcpPost exactly — whose provider refuses it (`token_unavailable`), nothing sent
      { label: "a row whose auth getter throws", run: () => { const row = { ...ccServer }; Object.defineProperty(row, "auth", { get: () => { throw new Error(MARKER); } }); return send(authWorld(), row); }, code: "token_unavailable", tokenRequests: 0 },
      { label: "null options", run: () => mcpPostAuthorized(ccServer, listRequest(), null as unknown as Parameters<typeof mcpPostAuthorized>[2]), tokenRequests: 0 },
      { label: "a signal whose addEventListener throws", run: () => send(authWorld(), ccServer, { signal: { aborted: false, addEventListener: () => { throw new Error(MARKER); }, removeEventListener: () => undefined } as unknown as AbortSignal }), tokenRequests: 1 },
    ];
    for (const scenario of scenarios) {
      resetMcpAuthorization();
      resetAdmissionControl();
      resetMcpInFlight();
      let outcome: unknown;
      await expect((async () => { outcome = await scenario.run(); })(), scenario.label).resolves.toBeUndefined();
      expect(outcome, scenario.label).toBeTypeOf("object");
      if (scenario.code !== undefined) expect(outcome, scenario.label).toMatchObject({ ok: false, kind: "closed", code: scenario.code });
      const message = (outcome as { message?: unknown }).message;
      if (typeof message === "string") expect(message.length, scenario.label).toBeLessThanOrEqual(300);
      expect(JSON.stringify(outcome), scenario.label).not.toContain(MARKER);
      expect(mcpAuthorizationStateCounts().inflight, scenario.label).toBe(0);
      expect(mcpAuthorizationStateCounts().tokenRequests, scenario.label).toBe(scenario.tokenRequests);
    }
  });

  it("every export answers junk with a closed value and never throws; the collector is frozen and a forged one is refused", async () => {
    const junk: unknown[] = [undefined, null, 42, "x", [], {}, new Proxy({}, { get: () => { throw new Error("trap"); } })];
    for (const value of junk) {
      expect(() => createMcpRedactionCollector(value as readonly string[])).not.toThrow();
      expect(mcpAuthorizationStateCarries(value)).toBe(false);
      expect(admitMcpResourceMetadataUrl(value as McpServerRegistryEntry, value)).toEqual({ ok: false });
      expect(mcpProtectedResourceMetadataUrls(value as McpServerRegistryEntry)).toEqual([]);
      expect(mcpAuthorizationServerMetadataUrls(value as string)).toEqual([]);
      expect(isMcpAuthorizationProvider(value)).toBe(false);
      await expect(Promise.resolve(mcpAuthorizationTokenProvider(value as McpServerRegistryEntry, ENV))).resolves.toMatchObject({ ok: false });
      expect(mcpAuthorizationTokenProvider.redactionSubjects!(value as McpServerRegistryEntry, value as Record<string, string>)).toEqual([]);
      await expect(mcpPostAuthorized(value as McpServerRegistryEntry, value as never, value as never)).resolves.toMatchObject({ ok: false });
    }
    expect(isMcpAuthorizationProvider(mcpAuthorizationTokenProvider)).toBe(true);
    const collector = createMcpRedactionCollector(Array.from({ length: 1_000 }, (_, index) => `${["fake", "seed"].join("-")}-${index}xyzw`));
    expect(collector.subjects()).toHaveLength(MCP_REDACTION_SUBJECTS_MAX);
    expect(Object.isFrozen(collector)).toBe(true);
    expect(Object.isFrozen(collector.subjects())).toBe(true);
    expect(createMcpRedactionCollector(["not a bearer!", "t".repeat(8_193), 42 as unknown as string]).subjects()).toEqual([]);
  });

  it("Object.prototype is unpolluted after hostile documents, and none of the three modules writes to the console", async () => {
    const polluting = (doc: Record<string, unknown>): string => `{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},${JSON.stringify(doc).slice(1)}`;
    const world = authWorld({
      prm: () => jsonAnswer(polluting(prmDocument(ccServer.canonicalUri))),
      as: (call) => (call.path.endsWith("oauth-authorization-server") ? jsonAnswer(polluting(asDocument())) : plainAnswer("nf", 404)),
      token: (_call, self) => jsonAnswer(polluting(tokenDocument(self.issue()))),
    });
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((method) => vi.spyOn(console, method));
    expect(await send(world)).toMatchObject({ ok: true });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.prototype).not.toHaveProperty("polluted");
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    for (const file of ["app/lib/mcp/authorization.ts", "app/lib/mcp/oauth-discovery.ts", "app/lib/mcp/request-id.ts"]) expect(read(file), file).not.toContain("console.");
  });
});

describe("[B20 A3] the import tripwire (D14)", () => {
  it("no production file outside app/lib/mcp/ imports app/lib/mcp/authorization or app/lib/mcp/oauth-discovery (matched by path, not by basename)", { timeout: 120_000 }, () => {
    const production = collectProductionFiles(process.cwd());
    // two other authorization.ts files exist; the tripwire matches the resolved path, never the basename
    expect(production.has("app/lib/engineering/authorization.ts")).toBe(true);
    expect(production.has("app/lib/pcb-sync/authorization.ts")).toBe(true);
    for (const target of ["app/lib/mcp/authorization", "app/lib/mcp/oauth-discovery"]) {
      const importers = moduleImportOffenders(production, target, new Set());
      expect(importers.filter((path) => !path.startsWith("app/lib/mcp/")), target).toEqual([]);
      expect(importers.filter((path) => path.startsWith("app/lib/mcp/server/")), `${target}: the server side`).toEqual([]);
    }
    expect(moduleImportOffenders(production, "app/lib/mcp/authorization", new Set())).toEqual(expect.arrayContaining(["app/lib/mcp/negotiation.ts", "app/lib/mcp/tool-discovery.ts", "app/lib/mcp/tool-call.ts"]));
    const injected = new Map(production);
    injected.set("app/lib/agent/evil-forward.ts", 'import { mcpPostAuthorized } from "../mcp/authorization";\nexport const x = mcpPostAuthorized;');
    expect(moduleImportOffenders(injected, "app/lib/mcp/authorization", new Set()).filter((path) => !path.startsWith("app/lib/mcp/"))).toEqual(["app/lib/agent/evil-forward.ts"]);
  });
});

describe("[B20 A3] the boundary page states what A3 delivered (S7)", () => {
  const SUITES = [
    "app/lib/mcp/__tests__/b20-a3-registry-authorization-pin.test.ts",
    "app/lib/mcp/__tests__/b20-a3-prm-discovery.test.ts",
    "app/lib/mcp/__tests__/b20-a3-as-metadata.test.ts",
    "app/lib/mcp/__tests__/b20-a3-token-request.test.ts",
    "app/lib/mcp/__tests__/b20-a3-token-cache.test.ts",
    "app/lib/mcp/__tests__/b20-a3-token-audience.test.ts",
    "app/lib/mcp/__tests__/b20-a3-authorized-post.test.ts",
    "app/lib/mcp/__tests__/b20-a3-secret-hygiene.test.ts",
    "app/lib/mcp/__tests__/b20-a3-live-reread.test.ts",
  ];
  const section = (): string => {
    const page = read("artifacts/ai-control-plane-b20/mcp-client-boundary.md");
    const at = page.indexOf("## Authorization client (A3) — CONFIRMED");
    return at < 0 ? "" : page.slice(at);
  };

  it("mcp-client-boundary.md states the case count of each A3 suite as it is, and the README their total (the lead writes the row)", () => {
    const text = section();
    expect(text.length, "the A3 section exists").toBeGreaterThan(2_000);
    let total = 0;
    for (const suite of SUITES) {
      const cases = (read(suite).match(/^\s*it\(/gm) ?? []).length;
      total += cases;
      const stated = new RegExp("`" + suite.replace(/\./g, "\\.") + "`[^0-9`]{1,5}(\\d+) cases").exec(text);
      expect(stated?.[1], suite).toBe(String(cases));
    }
    expect(text).toContain(`${total} cases in nine suites`);
    expect(read("artifacts/ai-control-plane-b20/README.md"), "the lead's README row").toContain(`${total} cases in nine suites`);
  });

  it("the A3 section names every closed code, every OAuth error code, every new file and every bound as a phrase built from its constant", () => {
    const text = flat(section());
    for (const code of MCP_AUTHORIZATION_FAILURE_CODES) expect(text, code).toContain(`\`${code}\``);
    for (const code of MCP_OAUTH_ERROR_CODES) expect(text, code).toContain(`\`${code}\``);
    for (const file of ["app/lib/mcp/authorization.ts", "app/lib/mcp/oauth-discovery.ts", "app/lib/mcp/request-id.ts", "app/lib/mcp/__tests__/_fake-authorization-server.ts"]) expect(text, file).toContain(file);
    const phrases = [
      `metadata documents of at most ${spaced(MCP_AUTH_METADATA_MAX_BYTES)} bytes`,
      `a token response of at most ${spaced(MCP_TOKEN_RESPONSE_MAX_BYTES)} bytes`,
      `an error body of at most ${spaced(MCP_TOKEN_ERROR_BODY_MAX_BYTES)} bytes`,
      `an access token of 1..${spaced(MCP_ACCESS_TOKEN_MAX_CHARS)} characters`,
      `a \`token_type\` of at most ${MCP_TOKEN_TYPE_MAX_CHARS} characters`,
      `min(\`expires_in\`, ${spaced(MCP_TOKEN_MAX_LIFETIME_SECONDS)} s)`,
      `${MCP_TOKEN_DEFAULT_LIFETIME_SECONDS} s when \`expires_in\` is absent`,
      `less a skew of ${spaced(MCP_TOKEN_EXPIRY_SKEW_MS)} ms`,
      `at most ${MCP_TOKEN_CACHE_MAX} tokens`,
      `metadata cached for ${spaced(MCP_AUTH_METADATA_TTL_MS)} ms`,
      `at most ${MCP_AUTH_METADATA_CACHE_MAX} metadata entries`,
      `${MCP_TOKEN_REQUESTS_PER_MINUTE} token requests per server per UTC minute`,
      `a backoff of ${spaced(MCP_AUTHORIZATION_BACKOFF_MS)} ms`,
      `${spaced(MCP_AUTHORIZATION_DEFAULT_DEADLINE_MS)} ms when the row's deadline is not an integer in 1 000..30 000`,
      `at most ${MCP_SCOPES_MAX} scopes`,
      `a scope string of at most ${spaced(MCP_SCOPE_STRING_MAX_CHARS)} characters`,
      `1..${MCP_PRM_AUTHORIZATION_SERVERS_MAX} authorization servers`,
      `at most ${MCP_PRM_SCOPES_SUPPORTED_MAX} \`scopes_supported\``,
      `lists of at most ${MCP_METADATA_LIST_MAX} entries of at most ${MCP_METADATA_LIST_ENTRY_MAX_CHARS} characters`,
      `URLs of at most ${spaced(MCP_AUTH_URL_MAX_CHARS)} characters`,
      `pin URLs of at most ${MCP_AUTHORIZATION_URL_MAX_CHARS} characters`,
      `a client id of 1..${MCP_CLIENT_ID_MAX_CHARS} and a secret of 1..${MCP_CLIENT_SECRET_MAX_CHARS} VSCHAR characters`,
      `at most ${MCP_REDACTION_SUBJECTS_MAX} redaction subjects`,
      `at most ${MCP_CALL_REDACTION_SUBJECTS_MAX} subjects per call`,
      // [B20 A3 review] security-2: every post reads as many `redactAlso` entries as a call's collector holds
      `at most ${MCP_REDACT_ALSO_MAX} \`redactAlso\` entries per post`,
      // [B20 A3 review] regressions-1: the transport sends no token a redaction list could not hold
      `a token over ${spaced(MCP_REDACTION_SUBJECT_MAX_CHARS)} characters is never sent`,
      `probes of at least ${MCP_STATE_PROBE_MIN_CHARS} characters`,
      `${MCP_DROPPED_TOKENS_PER_SERVER} dropped tokens per server`,
      `at most ${MCP_AUTHORIZED_POST_MAX_EXCHANGES} POSTs and ${MCP_TOKEN_REQUESTS_PER_CALL_MAX} token requests per call`,
      `at most ${MCP_AUTH_TRACE_EXCHANGES_MAX} trace exchanges`,
    ];
    for (const phrase of phrases) expect(text, phrase).toContain(phrase);
    // the lead's decisions as applied, and the two marks the A1 and A2 sections carry
    for (const decision of ["LD-1", "LD-2", "LD-3", "LD-4", "LD-5", "OD-61", "OD-62", "OD-63", "OD-64"]) expect(text, decision).toContain(decision);
    const page = flat(read("artifacts/ai-control-plane-b20/mcp-client-boundary.md"));
    expect(page.split("Closed in A3").length - 1, "the A1 and A2 limits and deferred rows are marked").toBeGreaterThanOrEqual(4);
  });
});
