/**
 * [B24-A2] Rotation by a previous value that only verifies (D24-4, OD-195).
 *
 * Three new names, each optional and each used for verification only: `SIRKIT_WORKFLOW_WORKER_SECRET_PREVIOUS`,
 * `KICAD_HTTP_LIBRARY_TOKEN_PREVIOUS` and `SIRKIT_MCP_TOKEN_SECRET_PREVIOUS`.
 *  - The worker bearer verifies against the current secret, or the previous one while it is set: both trimmed, both compared with
 *    `timingSafeEqualString`, no return between the two compares; a previous value alone configures nothing (null, closed);
 *    `verifyWorkerSecret` stays a nullable result (`_boundary-analysis.ts:229`).
 *  - The KiCad library answers 503 while the current token is unset, whatever the previous one is; otherwise 401 unless the token is
 *    the current or the previous value, each compared in constant time.
 *  - The MCP key: minting and the resource configuration use the current key only; verification checks the signature against the
 *    current key, then the previous one, both in constant time, and a token signed by neither is `bad_signature`. The previous key
 *    passes the same bounds as the current one, and one that fails is never used and never unconfigures the endpoint. Key separation
 *    covers the previous values: no MCP key, current or previous, may equal the worker secret or the KiCad token, current or
 *    previous. The header bytes, the refusal codes and the bounds are unchanged; the rotation window is at least one token lifetime.
 *  - No value is echoed by any refusal or response.
 *
 * Failing first on 1b2c08c: the names do not exist and a previous value is never read (page section 8). Every secret is an obvious
 * fake assembled at run time; tokens are minted with an injected clock or hand-signed with `node:crypto` as an independent oracle.
 * Nothing is written to disk and no process is started.
 */
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST as mcpEndpoint } from "@/app/api/mcp/route";
import { resetMcpReadDependenciesFactory, setMcpReadDependenciesFactory } from "@/app/api/mcp/read-runtime";
import { authorizeKicadHttpLibrary } from "@/app/lib/atomic/server-auth";
import { authorizeRequest } from "@/app/lib/auth/authorize";
import {
  MCP_BEARER_BOUNDS,
  MCP_ENDPOINT_REFUSAL_CODES,
  MCP_TOKEN_CLOCK_SKEW_S,
  MCP_TOKEN_HEADER_B64,
  MCP_TOKEN_HEADER_JSON,
  MCP_TOKEN_LIFETIME_S,
  MCP_TOKEN_MINT_REFUSALS,
  MCP_TOKEN_REFUSALS,
  MCP_TOKEN_SECRET_ENV,
  MCP_TOKEN_SECRET_PREVIOUS_ENV,
  __setMcpServerClockForTests,
  mintMcpAccessToken,
  resetMcpAccessTokenVerifierFactory,
  resolveMcpResourceConfiguration,
  verifyMcpAccessToken,
} from "@/app/lib/auth/mcp-bearer";
import { membershipRevisionOf } from "@/app/lib/auth/project-membership";
import { kicadLibraryRoute } from "@/app/lib/auth/route-handlers";
import { injectMembership, resetInjectedIdentity } from "@/app/lib/auth/test-support";
import { WORKER_SECRET_ENV, WORKER_SECRET_PREVIOUS_ENV, verifyWorkerSecret } from "@/app/lib/auth/worker-principal";
import { InMemoryDurableWorkflowRepository } from "@/app/lib/durable-workflow/repository";
import { createDurableBoardReader, readOnlyDurableWorkflow } from "@/app/lib/engineering/durable-read-bundle";
import { resetMcpInboundLimitsForTests } from "@/app/lib/mcp/server/inbound-limits";
import { membershipReverifier, resetMcpReadStateForTests } from "@/app/lib/mcp/server/read-call";
import { resetMcpServerTraceSinkFactory } from "@/app/lib/mcp/server/request-trace";

const ROOT = process.cwd();
const NEWLINE = String.fromCharCode(10);
const CR = String.fromCharCode(13);
const TAB = String.fromCharCode(9);
const read = (path: string): string => readFileSync(join(ROOT, path), "utf8").replaceAll(`${CR}${NEWLINE}`, NEWLINE);
const lines = (path: string): string[] => read(path).split(NEWLINE);
const PAGE = "artifacts/ai-control-plane-b24/edge-security.md";
type Env = Record<string, string | undefined>;

/** obvious fakes, assembled at run time; each 32 bytes or more, so each passes the MCP key bounds */
const fake = (...parts: string[]): string => ["b24", "a2", ...parts, "0123456789abcdef"].join("-");
const WORKER_NEW = fake("worker", "current");
const WORKER_OLD = fake("worker", "previous");
const KICAD_NEW = fake("kicad", "current");
const KICAD_OLD = fake("kicad", "previous");
const MCP_NEW = fake("mcp", "key", "current");
const MCP_OLD = fake("mcp", "key", "previous");
const OTHER = fake("never", "configured");
const SENTINELS = [WORKER_NEW, WORKER_OLD, KICAD_NEW, KICAD_OLD, MCP_NEW, MCP_OLD, OTHER];

/** Does `text` carry `secret` in any common disguise (raw, case-folded, base64, base64url, hex, percent-encoded)? */
function carries(text: string, secret: string): boolean {
  const lower = text.toLowerCase();
  const forms = [secret, Buffer.from(secret).toString("base64"), Buffer.from(secret).toString("base64url"), Buffer.from(secret).toString("hex"), encodeURIComponent(secret)];
  return forms.some((form) => text.includes(form) || lower.includes(form.toLowerCase()));
}
const echoes = (text: string): string[] => SENTINELS.filter((secret) => carries(text, secret));

const workerRequest = (token?: string): Request => new Request("http://localhost/api/ready", { method: "GET", headers: token === undefined ? {} : { authorization: `Bearer ${token}` } });
const kicadRequest = (token?: string): Request => new Request("http://localhost/api/kicad/v1/", { headers: token === undefined ? {} : { authorization: `Token ${token}` } });

const ORIGIN = "https://mcp.example.com";
const EXPECTED = { audience: `${ORIGIN}/api/mcp`, issuer: ORIGIN, nowMs: Date.UTC(2026, 9, 6, 12, 0, 0) };
const T0 = EXPECTED.nowMs;
const MBR = "mbr1-0123456789abcdef";
const MINT_INPUT = { subject: "user-b24-a2", tenantId: "local", projectId: "proj-b24-a2", branchId: "main", membershipRevision: MBR };
const mcpEnv = (current: string | undefined, previous?: string, extra: Env = {}): Env => ({ SIRKIT_EXPECTED_ORIGIN: ORIGIN, ...(current === undefined ? {} : { [MCP_TOKEN_SECRET_ENV]: current }), ...(previous === undefined ? {} : { [MCP_TOKEN_SECRET_PREVIOUS_ENV]: previous }), ...extra });
function mintUnder(key: string, nowMs = T0): string {
  const minted = mintMcpAccessToken(MINT_INPUT, { environment: mcpEnv(key), nowMs });
  if (!minted.ok) throw new Error(`fixture: mint ${minted.reason}`);
  return minted.token;
}
/** Hand-signed with node:crypto (the independent oracle), for keys the module would never sign with. */
function handSigned(key: string): string {
  const iat = Math.floor(T0 / 1000);
  const payload = Buffer.from(JSON.stringify({ iss: ORIGIN, aud: EXPECTED.audience, sub: MINT_INPUT.subject, iat, exp: iat + 3600, jti: "AbCdEfGhIjKlMnOpQrStUv", scope: "sirkit.mcp", sirkit_tenant: "local", sirkit_project: MINT_INPUT.projectId, sirkit_branch: "main", sirkit_mbr: MBR }), "utf8").toString("base64url");
  return `${MCP_TOKEN_HEADER_B64}.${payload}.${createHmac("sha256", Buffer.from(key, "utf8")).update(`${MCP_TOKEN_HEADER_B64}.${payload}`, "ascii").digest("base64url")}`;
}
const reason = (outcome: { ok: boolean; reason?: string }): string => (outcome.ok ? "ok" : outcome.reason!);
const verify = (token: string, env: Env, nowMs = T0 + 1_000): string => reason(verifyMcpAccessToken(token, { ...EXPECTED, nowMs }, env));

/** The body of the top-level function `name` in a source text (from its declaration to the next top-level line that closes it). */
function functionBody(source: string, name: string): string {
  const all = source.split(NEWLINE);
  const start = all.findIndex((line) => new RegExp(`^(?:export )?function ${name}\\(`).test(line));
  if (start < 0) return "";
  const end = all.findIndex((line, index) => index > start && line === "}");
  return all.slice(start, end + 1).join(NEWLINE);
}
/** The two compares stand in consecutive declarations before the function's one return, with no return between them. */
function twoComparesThenOneReturn(body: string, compare: string): string[] {
  const problems: string[] = [];
  const statements = body.split(NEWLINE).slice(1, -1).map((line) => line.trim()).filter((line) => line !== "" && !line.startsWith("//") && !line.startsWith("*") && !line.startsWith("/*"));
  const compares = statements.flatMap((line, index) => (line.includes(`${compare}(`) ? [index] : []));
  const returns = statements.flatMap((line, index) => (/\breturn\b/.test(line) ? [index] : []));
  if (compares.length !== 2) problems.push(`${compares.length} lines call ${compare}`);
  if (returns.length !== 1) problems.push(`${returns.length} return statements`);
  if (compares.length === 2 && returns.length === 1 && !(compares[1]! < returns[0]!)) problems.push("a compare after the return");
  if (compares.some((index) => !statements[index]!.startsWith("const "))) problems.push("a compare outside a declaration");
  return problems;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("[B24-A2] the worker secret's previous value (D24-4, OD-195)", () => {
  it("1. counterexample (red on 1b2c08c, where only the current value verified): with the previous value set, a bearer holding it verifies, as does the current one; any other value, a missing bearer and a previous value alone (current unset or blank) fail closed; both values are trimmed; the worker route answers 401 without echoing either", async () => {
    expect(WORKER_SECRET_ENV).toBe("SIRKIT_WORKFLOW_WORKER_SECRET");
    expect(WORKER_SECRET_PREVIOUS_ENV).toBe("SIRKIT_WORKFLOW_WORKER_SECRET_PREVIOUS");
    const rotating: Env = { [WORKER_SECRET_ENV]: WORKER_NEW, [WORKER_SECRET_PREVIOUS_ENV]: WORKER_OLD };
    expect(verifyWorkerSecret(workerRequest(WORKER_OLD), rotating)?.principalId).toBe("sirkit-workflow-worker");
    expect(verifyWorkerSecret(workerRequest(WORKER_NEW), rotating)?.actor.actorKind).toBe("automated_engine");
    expect(verifyWorkerSecret(workerRequest(OTHER), rotating)).toBeNull();
    expect(verifyWorkerSecret(workerRequest(), rotating)).toBeNull();
    // trimmed, both
    const padded: Env = { [WORKER_SECRET_ENV]: ` ${WORKER_NEW}${TAB}`, [WORKER_SECRET_PREVIOUS_ENV]: `  ${WORKER_OLD} ` };
    for (const token of [WORKER_NEW, WORKER_OLD]) expect(verifyWorkerSecret(workerRequest(token), padded), token.slice(0, 18)).not.toBeNull();
    // a previous value alone configures nothing
    for (const current of [undefined, "", "   "]) {
      const alone: Env = { ...(current === undefined ? {} : { [WORKER_SECRET_ENV]: current }), [WORKER_SECRET_PREVIOUS_ENV]: WORKER_OLD };
      for (const token of [WORKER_OLD, WORKER_NEW, OTHER]) expect(verifyWorkerSecret(workerRequest(token), alone), `${JSON.stringify(current)}`).toBeNull();
    }
    // without the previous value (unset or blank) only the current one verifies
    for (const previous of [undefined, "", "  "]) {
      const env: Env = { [WORKER_SECRET_ENV]: WORKER_NEW, ...(previous === undefined ? {} : { [WORKER_SECRET_PREVIOUS_ENV]: previous }) };
      expect(verifyWorkerSecret(workerRequest(WORKER_OLD), env)).toBeNull();
      expect(verifyWorkerSecret(workerRequest(WORKER_NEW), env)).not.toBeNull();
    }
    // through the boundary every worker route uses
    const allowed = await authorizeRequest(workerRequest(WORKER_OLD), { environment: rotating });
    expect(allowed.ok && allowed.kind).toBe("worker");
    const refused = await authorizeRequest(workerRequest(OTHER), { environment: rotating });
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.response.status).toBe(401);
    const text = await refused.response.text();
    expect(JSON.parse(text)).toMatchObject({ code: "AUTH_WORKER_UNAUTHENTICATED" });
    expect(echoes(text)).toEqual([]);
    expect(text).not.toMatch(/PREVIOUS|SIRKIT_WORKFLOW/);
  });

  it("2. in place: worker-principal.ts:49-55 keep their lines (only :54's compare is replaced by the helper call); the helper calls timingSafeEqualString twice, in two declarations, before its one return; verifyWorkerSecret stays a nullable result whose refusal is a bare negation (_boundary-analysis.ts:229)", () => {
    const file = lines("app/lib/auth/worker-principal.ts");
    expect(file[48]).toBe("export function verifyWorkerSecret(request: Request, environment: Record<string, string | undefined> = process.env): WorkerPrincipal | null {");
    expect(file[49]).toBe("  const configured = environment[WORKER_SECRET_ENV]?.trim();");
    expect(file[50]).toBe("  if (!configured || configured.length === 0) return null; // no worker auth configured → fail closed");
    expect(file[51]).toBe("  const presented = bearerToken(request);");
    expect(file[52]).toBe("  if (!presented) return null;");
    expect(file[53]).toMatch(/^ {2}if \(!matchesCurrentOrPreviousWorkerSecret\(presented, configured, environment\)\) return null; \/\/ \[B24-A2\] /);
    expect(file[54]).toBe("  return { principalId: WORKER_PRINCIPAL_ID, actor: workerActor() };");
    expect(file[55]).toBe("}");
    const helper = functionBody(read("app/lib/auth/worker-principal.ts"), "matchesCurrentOrPreviousWorkerSecret");
    expect(helper.length).toBeGreaterThan(0);
    expect(twoComparesThenOneReturn(helper, "timingSafeEqualString")).toEqual([]);
    expect(helper).toMatch(/\.trim\(\)/);
    expect(file.slice(56).join(NEWLINE)).toMatch(/export const WORKER_SECRET_PREVIOUS_ENV = "SIRKIT_WORKFLOW_WORKER_SECRET_PREVIOUS";/);
    expect(read("app/lib/auth/__tests__/_boundary-analysis.ts")).toContain('{ symbol: "verifyWorkerSecret", moduleSuffix: "app/lib/auth/worker-principal.ts" }, // nullable object → bare negation');
  });
});

describe("[B24-A2] the KiCad library token's previous value (D24-4, OD-195)", () => {
  it("3. counterexample (red on 1b2c08c, where only the current token passed): 503 while the current token is unset, whatever the previous one is; otherwise 401 unless the token is the current or the previous value; no answer echoes either; the wrapper route serves the previous token", async () => {
    vi.stubEnv("KICAD_HTTP_LIBRARY_TOKEN", KICAD_NEW);
    vi.stubEnv("KICAD_HTTP_LIBRARY_TOKEN_PREVIOUS", KICAD_OLD);
    expect(authorizeKicadHttpLibrary(kicadRequest(KICAD_OLD))).toBeNull();
    expect(authorizeKicadHttpLibrary(kicadRequest(KICAD_NEW))).toBeNull();
    const answers: Response[] = [];
    for (const request of [kicadRequest(OTHER), kicadRequest(), new Request("http://localhost/api/kicad/v1/", { headers: { authorization: `Bearer ${KICAD_OLD}` } }), kicadRequest(KICAD_OLD.slice(0, -1)), kicadRequest(`${KICAD_OLD}x`)]) {
      const answer = authorizeKicadHttpLibrary(request);
      expect(answer?.status).toBe(401);
      answers.push(answer!);
    }
    // the previous value alone: 503, whatever is presented
    vi.stubEnv("KICAD_HTTP_LIBRARY_TOKEN", "");
    for (const token of [KICAD_OLD, KICAD_NEW, OTHER]) {
      const answer = authorizeKicadHttpLibrary(kicadRequest(token));
      expect(answer?.status).toBe(503);
      answers.push(answer!);
    }
    vi.stubEnv("KICAD_HTTP_LIBRARY_TOKEN", undefined);
    expect(authorizeKicadHttpLibrary(kicadRequest(KICAD_OLD))?.status).toBe(503);
    // without the previous value only the current token passes
    vi.stubEnv("KICAD_HTTP_LIBRARY_TOKEN", KICAD_NEW);
    vi.stubEnv("KICAD_HTTP_LIBRARY_TOKEN_PREVIOUS", "");
    expect(authorizeKicadHttpLibrary(kicadRequest(KICAD_OLD))?.status).toBe(401);
    expect(authorizeKicadHttpLibrary(kicadRequest(KICAD_NEW))).toBeNull();
    for (const answer of answers) {
      const text = await answer.text();
      expect(["{\"error\":\"Unauthorized\"}", "{\"error\":\"KiCad HTTP library is not configured\"}"]).toContain(text);
      expect(echoes(text)).toEqual([]);
    }
    // through the wrapper every KiCad route uses (route-handlers.ts, kicadLibraryRoute)
    vi.stubEnv("KICAD_HTTP_LIBRARY_TOKEN_PREVIOUS", KICAD_OLD);
    const handler = kicadLibraryRoute({}, () => Response.json({ ok: true }));
    expect((await handler(kicadRequest(KICAD_OLD))).status).toBe(200);
    expect((await handler(kicadRequest(OTHER))).status).toBe(401);
  });

  it("4. in place: server-auth.ts:4-14 keep their lines (:12-13 compute both compares, then refuse); each compare is node:crypto's timingSafeEqual; the 503 line is unchanged", () => {
    const file = lines("app/lib/atomic/server-auth.ts");
    expect(file[3]).toBe("export function authorizeKicadHttpLibrary(request: Request): Response | null {");
    expect(file[4]).toBe("  const expected = process.env.KICAD_HTTP_LIBRARY_TOKEN;");
    expect(file[5]).toBe('  if (!expected) return Response.json({ error: "KiCad HTTP library is not configured" }, { status: 503 });');
    expect(file[8]).toBe('  if (!authorization.startsWith(prefix)) return Response.json({ error: "Unauthorized" }, { status: 401 });');
    expect(file[10]).toBe("  const a = Buffer.from(supplied);");
    expect(file[11]).toMatch(/^ {2}const current = kicadTokenMatches\(a, expected\); const previous = kicadTokenMatches\(a, process\.env\.KICAD_HTTP_LIBRARY_TOKEN_PREVIOUS\); \/\/ \[B24-A2\] /);
    expect(file[12]).toBe('  if (!current && !previous) return Response.json({ error: "Unauthorized" }, { status: 401 });');
    expect(file[13]).toBe("  return null;");
    expect(file[14]).toBe("}");
    const helper = functionBody(read("app/lib/atomic/server-auth.ts"), "kicadTokenMatches");
    expect(helper).toContain("timingSafeEqual(");
    expect(helper).not.toContain("process.env");
  });
});

describe("[B24-A2] the MCP signing key's previous value (D24-4, OD-195)", () => {
  it("5. counterexample (red on 1b2c08c): a token signed under the old key verifies after rotation while the previous key is set, and is bad_signature without it; a token signed by neither key is bad_signature; minting and the resource configuration use the current key only; a previous key alone configures nothing", () => {
    expect(MCP_TOKEN_SECRET_PREVIOUS_ENV).toBe("SIRKIT_MCP_TOKEN_SECRET_PREVIOUS");
    const old = mintUnder(MCP_OLD);
    expect(verify(old, mcpEnv(MCP_OLD))).toBe("ok");
    expect(verify(old, mcpEnv(MCP_NEW, MCP_OLD))).toBe("ok");
    expect(verify(old, mcpEnv(MCP_NEW))).toBe("bad_signature");
    expect(verify(handSigned(OTHER), mcpEnv(MCP_NEW, MCP_OLD))).toBe("bad_signature");
    expect(verify(handSigned(MCP_OLD), mcpEnv(MCP_NEW, MCP_OLD))).toBe("ok");
    // minting under rotation signs with the current key: the token verifies with the current key alone, never with the previous alone
    const minted = mintMcpAccessToken(MINT_INPUT, { environment: mcpEnv(MCP_NEW, MCP_OLD), nowMs: T0 });
    expect(minted.ok).toBe(true);
    if (!minted.ok) return;
    expect(verify(minted.token, mcpEnv(MCP_NEW))).toBe("ok");
    expect(verify(minted.token, mcpEnv(MCP_OLD))).toBe("bad_signature");
    // the resource configuration is the current key's, the same with or without a previous key
    expect(resolveMcpResourceConfiguration(mcpEnv(MCP_NEW, MCP_OLD))).toEqual(resolveMcpResourceConfiguration(mcpEnv(MCP_NEW)));
    expect(resolveMcpResourceConfiguration(mcpEnv(MCP_NEW, MCP_OLD)).ok).toBe(true);
    // a previous key alone configures nothing: no configuration, no mint, no verification
    expect(resolveMcpResourceConfiguration(mcpEnv(undefined, MCP_OLD))).toEqual({ ok: false, code: "not_configured" });
    expect(reason(mintMcpAccessToken(MINT_INPUT, { environment: mcpEnv(undefined, MCP_OLD), nowMs: T0 }))).toBe("not_configured");
    expect(verify(old, mcpEnv(undefined, MCP_OLD))).toBe("not_configured");
    expect(verify(old, mcpEnv("", MCP_OLD))).toBe("not_configured");
  });

  it("6. the previous key passes the current key's bounds or is never used - and never unconfigures the endpoint: too short, too long, padded, or equal to the worker secret or the KiCad token (current or previous) - and the current key is refused when it equals a previous worker secret or KiCad token", () => {
    const short = ["b24", "a2", "short"].join("-");
    const long = "k".repeat(1025);
    const padded = ` ${MCP_OLD}`;
    const cases: Array<[string, string, Env]> = [
      ["too short", short, {}],
      ["too long", long, {}],
      ["padded", padded, {}],
      ["the worker secret", WORKER_NEW, { SIRKIT_WORKFLOW_WORKER_SECRET: WORKER_NEW }],
      ["the previous worker secret", WORKER_OLD, { SIRKIT_WORKFLOW_WORKER_SECRET_PREVIOUS: WORKER_OLD }],
      ["the KiCad token", KICAD_NEW, { KICAD_HTTP_LIBRARY_TOKEN: KICAD_NEW }],
      ["the previous KiCad token", KICAD_OLD, { KICAD_HTTP_LIBRARY_TOKEN_PREVIOUS: KICAD_OLD }],
    ];
    for (const [name, previous, extra] of cases) {
      const env = mcpEnv(MCP_NEW, previous, extra);
      expect(resolveMcpResourceConfiguration(env).ok, name).toBe(true);
      expect(verify(handSigned(previous), env), name).toBe("bad_signature");
      expect(verify(mintUnder(MCP_NEW), env), name).toBe("ok");
    }
    // the current key's own separation now covers the previous worker secret and the previous KiCad token
    expect(resolveMcpResourceConfiguration(mcpEnv(MCP_NEW, undefined, { SIRKIT_WORKFLOW_WORKER_SECRET_PREVIOUS: MCP_NEW }))).toEqual({ ok: false, code: "not_configured" });
    expect(resolveMcpResourceConfiguration(mcpEnv(MCP_NEW, undefined, { KICAD_HTTP_LIBRARY_TOKEN_PREVIOUS: MCP_NEW }))).toEqual({ ok: false, code: "not_configured" });
    expect(resolveMcpResourceConfiguration(mcpEnv(MCP_NEW, undefined, { SIRKIT_WORKFLOW_WORKER_SECRET_PREVIOUS: ` ${MCP_NEW} ` }))).toEqual({ ok: false, code: "not_configured" });
    // the pre-existing separation holds
    expect(resolveMcpResourceConfiguration(mcpEnv(MCP_NEW, undefined, { SIRKIT_WORKFLOW_WORKER_SECRET: MCP_NEW })).ok).toBe(false);
    expect(resolveMcpResourceConfiguration(mcpEnv(MCP_NEW, undefined, { KICAD_HTTP_LIBRARY_TOKEN: MCP_NEW })).ok).toBe(false);
  });

  it("7. the rotation window is at least one token lifetime (MCP_TOKEN_LIFETIME_S, 3600 s): a token minted under the old key just before the switch verifies until its own expiry with the previous key set, and expires then whatever the keys", () => {
    expect(MCP_TOKEN_LIFETIME_S).toBe(3600);
    const old = mintUnder(MCP_OLD, T0);
    expect(verify(old, mcpEnv(MCP_NEW, MCP_OLD), T0 + 3_599_000)).toBe("ok");
    expect(verify(old, mcpEnv(MCP_NEW, MCP_OLD), T0 + 3_600_000)).toBe("expired");
    expect(verify(old, mcpEnv(MCP_OLD), T0 + 3_600_000)).toBe("expired");
  });

  it("8. nothing else moved: the header bytes (no kid), the verification and mint refusals, the bounds and the endpoint's refusal codes are as B20 pinned them; the cited lines :14-16, :35-36, :39-40, :42, :47-48, :182-183 and B20's C19 (:302) hold; verification computes both compares before it answers, in constant time; no value is echoed", () => {
    expect(MCP_TOKEN_HEADER_JSON).toBe('{"alg":"HS256","typ":"sirkit-mcp-at+jwt"}');
    expect(Buffer.from(MCP_TOKEN_HEADER_B64, "base64url").toString("utf8")).toBe(MCP_TOKEN_HEADER_JSON);
    expect(MCP_TOKEN_HEADER_JSON).not.toContain("kid");
    expect([...MCP_TOKEN_REFUSALS]).toEqual(["clock_invalid", "not_configured", "malformed", "unsupported_algorithm", "bad_signature", "claims_invalid", "wrong_issuer", "wrong_audience", "lifetime_exceeded", "not_yet_valid", "expired"]);
    expect([...MCP_TOKEN_MINT_REFUSALS]).toEqual(["clock_invalid", "not_configured", "claims_invalid", "mint_failed"]);
    expect(Object.keys(MCP_BEARER_BOUNDS)).toEqual(["MCP_TOKEN_LIFETIME_S", "MCP_TOKEN_MAX_CHARS", "MCP_TOKEN_PAYLOAD_MAX_BYTES", "MCP_TOKEN_CLOCK_SKEW_S", "MCP_TOKEN_SECRET_MIN_BYTES", "MCP_TOKEN_SECRET_MAX_BYTES", "MCP_TOKEN_ID_BYTES", "MCP_AUTHORIZATION_MAX_CHARS", "MCP_CONTENT_TYPE_MAX_CHARS", "MCP_ACCEPT_MAX_CHARS", "MCP_ACCEPT_MAX_RANGES", "MCP_PROTOCOL_VERSION_HEADER_MAX_CHARS", "MCP_METHOD_HEADER_MAX_CHARS", "MCP_NAME_HEADER_MAX_CHARS", "MCP_ROUTE_MAX_BYTES_CEILING", "MCP_ROUTE_DEADLINE_MS_CEILING"]);
    expect(MCP_ENDPOINT_REFUSAL_CODES).toHaveLength(24);
    const file = lines("app/lib/auth/mcp-bearer.ts");
    expect(file[13]).toMatch(/^ \* {2}- The configuration is read at call time from the environment by NAME and never returned: the secret$/);
    expect(file[14]).toMatch(/^ \* {4}\(`SIRKIT_MCP_TOKEN_SECRET`, 32 to 1 024 bytes, never the worker secret or the KiCad library token\) and the origin/);
    expect(file[34]).toBe('export const MCP_TOKEN_SECRET_ENV = "SIRKIT_MCP_TOKEN_SECRET" as const;');
    expect(file[35]).toBe('const KICAD_LIBRARY_TOKEN_ENV = "KICAD_HTTP_LIBRARY_TOKEN";');
    expect(file[38]).toBe(`export const MCP_TOKEN_HEADER_JSON = '{"alg":"HS256","typ":"sirkit-mcp-at+jwt"}';`);
    expect(file[39]).toBe('export const MCP_TOKEN_HEADER_B64 = Buffer.from(MCP_TOKEN_HEADER_JSON, "utf8").toString("base64url");');
    expect(file[41]).toBe("export const MCP_TOKEN_LIFETIME_S = 3600;");
    expect(file[46]).toBe("export const MCP_TOKEN_SECRET_MIN_BYTES = 32;");
    expect(file[47]).toBe("export const MCP_TOKEN_SECRET_MAX_BYTES = 1024;");
    expect(file[181]).toBe("function secretBytesOf(environment: unknown): Buffer | null {");
    expect(file[182]).toBe("  const raw = environmentValue(environment, MCP_TOKEN_SECRET_ENV);");
    expect(file[301]).toBe('  if (nowMs >= exp * 1000) return refuse("expired");');
    // verification: the signature against the current key, then the previous one, both computed before the answer
    expect(file[275]).toMatch(/^ {2}if \(!signedByCurrentOrPreviousKey\(`\$\{header\}\.\$\{payload\}`, key, sent, environment\)\) return refuse\("bad_signature"\); \/\/ \[B24-A2\] /);
    const helper = functionBody(read("app/lib/auth/mcp-bearer.ts"), "signedByCurrentOrPreviousKey");
    expect(twoComparesThenOneReturn(helper, "timingSafeEqualString")).toEqual([]);
    // minting and the configuration call only the current key's reader
    for (const name of ["mintToken", "resolveMcpResourceConfiguration"]) {
      const body = functionBody(read("app/lib/auth/mcp-bearer.ts"), name);
      expect(body, name).toContain("secretBytesOf(environment)");
      expect(body, name).not.toMatch(/previous/i);
    }
    // no value echoed by any outcome
    const outcomes = [
      verifyMcpAccessToken(handSigned(OTHER), EXPECTED, mcpEnv(MCP_NEW, MCP_OLD)),
      verifyMcpAccessToken(mintUnder(MCP_OLD), EXPECTED, mcpEnv(MCP_NEW)),
      mintMcpAccessToken(MINT_INPUT, { environment: mcpEnv(undefined, MCP_OLD), nowMs: T0 }),
      resolveMcpResourceConfiguration(mcpEnv(MCP_NEW, MCP_OLD)),
      resolveMcpResourceConfiguration(mcpEnv(MCP_NEW, MCP_OLD, { SIRKIT_WORKFLOW_WORKER_SECRET_PREVIOUS: MCP_NEW })),
    ];
    for (const outcome of outcomes) expect(echoes(JSON.stringify(outcome))).toEqual([]);
    expect(JSON.stringify(outcomes)).not.toMatch(/PREVIOUS/);
  });
});

describe("[B24-A2] the page edge-security.md, its secrets half", () => {
  it("9. the page states each secret's reader, rotation procedure and window, and separation rules; B23's two single-value seams recorded, not changed (the webhook secret caller-supplied and unwired; the credential header reached only past admission, no transfer descriptor); no secret manager (OD-42); a real rotation BLOCKED-LIVE-QUALIFICATION (LB-13)", () => {
    const page = read(PAGE);
    const start = page.search(new RegExp(`${NEWLINE}## 4\\. `));
    const four = page.slice(start, page.indexOf(`${NEWLINE}## `, start + 1));
    for (const name of ["SIRKIT_WORKFLOW_WORKER_SECRET", "SIRKIT_WORKFLOW_WORKER_SECRET_PREVIOUS", "KICAD_HTTP_LIBRARY_TOKEN", "KICAD_HTTP_LIBRARY_TOKEN_PREVIOUS", "SIRKIT_MCP_TOKEN_SECRET", "SIRKIT_MCP_TOKEN_SECRET_PREVIOUS"]) expect(four, name).toContain(`\`${name}\``);
    for (const fact of ["`order-contract.ts:107`", "`:295`", "`webhook-verification.ts:29-30, :74`", "`provider-egress.ts:198-201`", "`:69`", "OD-42", "3600 s", "verifies only", "never signs", "bad_signature", "BLOCKED-LIVE-QUALIFICATION", "LB-13", "b24-a2-secret-rotation", "`mcp-endpoint.spec.ts:295`"]) expect(four, fact).toContain(fact);
  });
});

// ── [B24-A2 review, 2026-10-06] the review round: coverage-7 / tests-6 proven against a deliberate breakage of the route wrapper
// (restored by hash); security-4 red on the records the review read ──

describe("[B24-A2 review, 2026-10-06] rotation through the MCP endpoint, and after a leak", () => {
  it("10. coverage-7, tests-6: POST /api/mcp under rotation, through the canonical wrapper - a token signed under the previous key is served, as is one under the current key; one signed by neither key, or by a previous key out of bounds, is 401 MCP_TOKEN_INVALID with the invalid-token challenge and the endpoint's one body; no body or header carries a sentinel or a _PREVIOUS name", async () => {
    const PROJECT = "proj-b24-a2";
    const USER = "user-b24-a2";
    const V = "2026-07-28";
    vi.stubEnv("SIRKIT_MCP_ENABLED", "1");
    vi.stubEnv("SIRKIT_EXPECTED_ORIGIN", ORIGIN);
    vi.stubEnv(MCP_TOKEN_SECRET_ENV, MCP_NEW);
    vi.stubEnv(MCP_TOKEN_SECRET_PREVIOUS_ENV, MCP_OLD);
    for (const name of ["SIRKIT_WORKFLOW_WORKER_SECRET", "SIRKIT_WORKFLOW_WORKER_SECRET_PREVIOUS", "KICAD_HTTP_LIBRARY_TOKEN", "KICAD_HTTP_LIBRARY_TOKEN_PREVIOUS", "SIRKIT_AUTH_MODE", "SIRKIT_DEPLOYMENT_ENV", "SIRKIT_MCP_DISABLED_SERVERS", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY"]) vi.stubEnv(name, undefined);
    const now = T0 + 1_000;
    __setMcpServerClockForTests(() => now);
    resetMcpInboundLimitsForTests();
    resetMcpServerTraceSinkFactory();
    resetMcpAccessTokenVerifierFactory();
    resetMcpReadStateForTests();
    const repo = injectMembership([{ projectId: PROJECT, userId: USER, role: "editor" }]);
    setMcpReadDependenciesFactory(() => ({ boardReader: createDurableBoardReader(readOnlyDurableWorkflow(new InMemoryDurableWorkflowRepository())), componentAuthority: () => null, membership: membershipReverifier(() => repo), now: () => now, randomBytes: (size) => new Uint8Array(size) }));
    try {
      const membership = await repo.loadActiveMembership({ tenantId: "local", projectId: PROJECT, userId: USER });
      expect(membership).not.toBeNull();
      const mbr = membershipRevisionOf(membership!);
      const minted = (key: string): string => {
        const outcome = mintMcpAccessToken({ subject: USER, tenantId: "local", projectId: PROJECT, branchId: "main", membershipRevision: mbr }, { environment: mcpEnv(key), nowMs: T0 });
        if (!outcome.ok) throw new Error(`fixture: mint ${outcome.reason}`);
        return outcome.token;
      };
      const signed = (key: string): string => {
        const iat = Math.floor(T0 / 1000);
        const payload = Buffer.from(JSON.stringify({ iss: ORIGIN, aud: EXPECTED.audience, sub: USER, iat, exp: iat + 3600, jti: "AbCdEfGhIjKlMnOpQrStUv", scope: "sirkit.mcp", sirkit_tenant: "local", sirkit_project: PROJECT, sirkit_branch: "main", sirkit_mbr: mbr }), "utf8").toString("base64url");
        return `${MCP_TOKEN_HEADER_B64}.${payload}.${createHmac("sha256", Buffer.from(key, "utf8")).update(`${MCP_TOKEN_HEADER_B64}.${payload}`, "ascii").digest("base64url")}`;
      };
      const discover = async (token: string): Promise<{ status: number; text: string; headers: string; challenge: string | null }> => {
        const response = await mcpEndpoint(new Request(`${ORIGIN}/api/mcp`, {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": V, "mcp-method": "server/discover", authorization: `Bearer ${token}` },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "server/discover", params: { _meta: { "io.modelcontextprotocol/protocolVersion": V, "io.modelcontextprotocol/clientCapabilities": {} } } }),
        }));
        return { status: response.status, text: await response.text(), headers: [...response.headers].map(([name, value]) => `${name}: ${value}`).join(NEWLINE), challenge: response.headers.get("www-authenticate") };
      };
      const answers: Array<{ text: string; headers: string }> = [];
      const old = await discover(minted(MCP_OLD));
      expect(old.status, old.text.slice(0, 120)).toBe(200);
      const current = await discover(minted(MCP_NEW));
      expect(current.status).toBe(200);
      answers.push(old, current);
      const challenge = `Bearer resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/api/mcp", scope="sirkit.mcp", error="invalid_token", error_description="The access token is invalid or expired."`;
      const refusedBody = { ok: false, code: "MCP_TOKEN_INVALID", error: "The access token is invalid or expired." };
      const neither = await discover(signed(OTHER));
      expect(neither.status).toBe(401);
      expect(JSON.parse(neither.text)).toEqual(refusedBody);
      expect(neither.challenge).toBe(challenge);
      answers.push(neither);
      // a previous key out of bounds is never used: a token it signed is refused, the current key's still served
      const short = ["b24", "a2", "short"].join("-");
      vi.stubEnv(MCP_TOKEN_SECRET_PREVIOUS_ENV, short);
      const outOfBounds = await discover(signed(short));
      expect(outOfBounds.status).toBe(401);
      expect(JSON.parse(outOfBounds.text)).toEqual(refusedBody);
      expect(outOfBounds.challenge).toBe(challenge);
      const stillServed = await discover(minted(MCP_NEW));
      expect(stillServed.status).toBe(200);
      answers.push(outOfBounds, stillServed);
      for (const answer of answers) {
        expect(echoes(`${answer.text}${NEWLINE}${answer.headers}`)).toEqual([]);
        expect(`${answer.text}${NEWLINE}${answer.headers}`).not.toMatch(/PREVIOUS/);
        expect(`${answer.text}${NEWLINE}${answer.headers}`).not.toContain(short);
      }
    } finally {
      __setMcpServerClockForTests(null);
      resetMcpAccessTokenVerifierFactory();
      resetMcpServerTraceSinkFactory();
      resetMcpReadDependenciesFactory();
      resetMcpReadStateForTests();
      resetInjectedIdentity();
    }
  });

  it("11. security-4 (red on the records the review read): a suspected leak is rotated with no previous value - the leaked value is never put in a _PREVIOUS name; the current value is replaced and every holder updated at once, the outage accepted; a planned rotation keeps the previous value at most seven days, the MCP key at least one token lifetime plus the clock skew (3,630 s); .env.example and the page's section 4 both say so, and the page records that nothing reports a set previous value", () => {
    expect(MCP_TOKEN_LIFETIME_S + MCP_TOKEN_CLOCK_SKEW_S).toBe(3630);
    const example = lines(".env.example");
    const start = example.findIndex((line) => line.startsWith("# Rotation, verification only"));
    const end = example.indexOf("# SIRKIT_WORKFLOW_WORKER_SECRET_PREVIOUS=");
    expect(start).toBeGreaterThan(93);
    const block = example.slice(start, end).join(" ");
    const page = read(PAGE);
    const at = page.search(new RegExp(`${NEWLINE}## 4\\. `));
    const four = page.slice(at, page.indexOf(`${NEWLINE}## `, at + 1)).replace(/\s+/g, " ");
    for (const [where, text] of [[".env.example", block], ["page section 4", four]] as const) {
      expect(text, where).toMatch(/suspected leak/i);
      expect(text, where).toMatch(/never put (?:a|the) leaked value in (?:a|the) _PREVIOUS name/i);
      expect(text, where).toMatch(/outage/i);
      expect(text, where).toContain("seven days");
      expect(text, where).toContain("3,630 s");
    }
    expect(four).toMatch(/nothing reports whether a _PREVIOUS value is set/i);
  });
});
