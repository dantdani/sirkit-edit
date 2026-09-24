/**
 * [B20 B2] The Sirkit-issued MCP access token (OD-43): a JWS compact HS256 token whose header is pinned byte for byte, with
 * exactly eleven claims, verified in a fixed order where every bound is judged before the work it protects, against a
 * configuration that is read at call time and never returned. Tokens are hand-signed here with `node:crypto` as an
 * independent oracle; every secret is assembled at run time.
 */
import { createHmac } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  MCP_TOKEN_CLAIM_KEYS,
  MCP_TOKEN_HEADER_B64,
  MCP_TOKEN_LIFETIME_S,
  MCP_TOKEN_REFUSALS,
  MCP_TOKEN_SECRET_ENV,
  createSirkitHmacVerifier,
  mintMcpAccessToken,
  resetMcpAccessTokenVerifierFactory,
  resolveMcpAccessTokenVerifier,
  resolveMcpResourceConfiguration,
  setMcpAccessTokenVerifierFactory,
  verifyMcpAccessToken,
  type McpAccessTokenVerifier,
} from "../mcp-bearer";
import { ID_PATTERN } from "../trusted-request-context";
import { WORKER_PRINCIPAL_ID, WORKER_SECRET_ENV } from "../worker-principal";

const ROOT = process.cwd();
const ORIGIN = "https://mcp.example.com";
const RESOURCE = `${ORIGIN}/api/mcp`;
/** assembled at run time: an obvious fake, never a key-shaped literal */
const SECRET = ["b2", "fixture", "mcp", "token", "secret", "0123456789abcdef"].join("-");
const WORKER = ["b2", "fixture", "worker", "secret", "fedcba9876543210"].join("-");
const KICAD = ["b2", "fixture", "kicad", "library", "token", "00112233"].join("-");
const ENV: Record<string, string | undefined> = { [MCP_TOKEN_SECRET_ENV]: SECRET, SIRKIT_EXPECTED_ORIGIN: ORIGIN };
const T0 = Date.UTC(2026, 8, 20, 12, 0, 0);
const T0_S = T0 / 1000;
const EXPECTED = { audience: RESOURCE, issuer: ORIGIN, nowMs: T0 };
const MBR = "mbr1-0123456789abcdef";
const JTI = "AbCdEfGhIjKlMnOpQrStUv";

const b64url = (value: string | Buffer): string => Buffer.from(value).toString("base64url");
const hmac = (signingInput: string, secret = SECRET): string => createHmac("sha256", Buffer.from(secret, "utf8")).update(signingInput, "ascii").digest("base64url");
function claims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { iss: ORIGIN, aud: RESOURCE, sub: "user-mcp-0001", iat: T0_S, exp: T0_S + 3600, jti: JTI, scope: "sirkit.mcp", sirkit_tenant: "local", sirkit_project: "proj-mcp", sirkit_branch: "main", sirkit_mbr: MBR, ...overrides };
}
/** Hand-sign a payload (an object, raw JSON text or raw bytes) under a header segment. */
function handSigned(payload: Record<string, unknown> | string | Buffer, options: { header?: string; secret?: string } = {}): string {
  const header = options.header ?? MCP_TOKEN_HEADER_B64;
  const body = Buffer.isBuffer(payload) ? payload.toString("base64url") : b64url(typeof payload === "string" ? payload : JSON.stringify(payload));
  return `${header}.${body}.${hmac(`${header}.${body}`, options.secret)}`;
}
const reasonOf = (outcome: { ok: boolean; reason?: string }): string => (outcome.ok ? "ok" : outcome.reason!);
const verify = (token: unknown, expected = EXPECTED, environment = ENV): string => reasonOf(verifyMcpAccessToken(token, expected, environment));
const MINT_INPUT = { subject: "user-mcp-0001", tenantId: "local", projectId: "proj-mcp", branchId: "main", membershipRevision: MBR };
const NUL = String.fromCharCode(0);
const fixedBytes = (size: number): Buffer => Buffer.alloc(size, 7);

/** Does `text` carry `secret` in any common disguise (raw, case-folded, base64, base64url, hex, percent-encoded)? */
function carries(text: string, secret: string): boolean {
  const lower = text.toLowerCase();
  const forms = [secret, Buffer.from(secret).toString("base64"), Buffer.from(secret).toString("base64url"), Buffer.from(secret).toString("hex"), encodeURIComponent(secret)];
  return forms.some((form) => text.includes(form) || lower.includes(form.toLowerCase()));
}

afterEach(() => resetMcpAccessTokenVerifierFactory());

describe("[B20 B2] A — the token format", () => {
  it("1. the header constant decodes to the exact JSON; a minted token has three segments, the eleven claims and a 3600 s lifetime, from the configuration and the input", () => {
    expect(Buffer.from(MCP_TOKEN_HEADER_B64, "base64url").toString("utf8")).toBe('{"alg":"HS256","typ":"sirkit-mcp-at+jwt"}');
    expect([...MCP_TOKEN_CLAIM_KEYS]).toEqual(["aud", "exp", "iat", "iss", "jti", "scope", "sirkit_branch", "sirkit_mbr", "sirkit_project", "sirkit_tenant", "sub"]);
    const minted = mintMcpAccessToken(MINT_INPUT, { environment: ENV, nowMs: T0 + 400, randomBytes: fixedBytes });
    expect(minted.ok).toBe(true);
    if (!minted.ok) return;
    const segments = minted.token.split(".");
    expect(segments).toHaveLength(3);
    expect(segments[0]).toBe(MCP_TOKEN_HEADER_B64);
    const payload = JSON.parse(Buffer.from(segments[1]!, "base64url").toString("utf8")) as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual([...MCP_TOKEN_CLAIM_KEYS]);
    expect(payload).toEqual({ iss: ORIGIN, aud: RESOURCE, sub: "user-mcp-0001", iat: T0_S, exp: T0_S + MCP_TOKEN_LIFETIME_S, jti: fixedBytes(16).toString("base64url"), scope: "sirkit.mcp", sirkit_tenant: "local", sirkit_project: "proj-mcp", sirkit_branch: "main", sirkit_mbr: MBR });
    expect((payload.exp as number) - (payload.iat as number)).toBe(3600);
    expect(minted.expiresAtMs).toBe((T0_S + 3600) * 1000);
    expect(minted.claims).toMatchObject({ issuer: ORIGIN, audience: RESOURCE, subject: "user-mcp-0001", tenantId: "local", projectId: "proj-mcp", branchId: "main", membershipRevision: MBR, scope: "sirkit.mcp" });
  });

  it("2. mint then verify round-trips, and the signature equals an independent node:crypto HMAC over h.p", () => {
    const minted = mintMcpAccessToken(MINT_INPUT, { environment: ENV, nowMs: T0 });
    expect(minted.ok).toBe(true);
    if (!minted.ok) return;
    const [h, p, s] = minted.token.split(".");
    expect(s).toBe(hmac(`${h}.${p}`));
    expect(s).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const outcome = verifyMcpAccessToken(minted.token, EXPECTED, ENV);
    expect(outcome).toEqual({ ok: true, claims: minted.claims });
    expect(minted.claims.tokenId).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(verify(handSigned(claims()))).toBe("ok");
  });

  it("3. the algorithm is pinned by bytes: alg none, HS512, RS256, reordered keys, whitespace or an extra kid are unsupported_algorithm", () => {
    const headers = [
      '{"alg":"HS512","typ":"sirkit-mcp-at+jwt"}',
      '{"alg":"RS256","typ":"sirkit-mcp-at+jwt"}',
      '{"typ":"sirkit-mcp-at+jwt","alg":"HS256"}',
      '{"alg": "HS256","typ":"sirkit-mcp-at+jwt"}',
      '{"alg":"HS256","typ":"sirkit-mcp-at+jwt","kid":"k1"}',
      '{"alg":"HS256","typ":"JWT"}',
    ];
    for (const header of headers) expect(verify(handSigned(claims(), { header: b64url(header) })), header).toBe("unsupported_algorithm");
    const none = b64url('{"alg":"none","typ":"sirkit-mcp-at+jwt"}');
    expect(verify(`${none}.${b64url(JSON.stringify(claims()))}.`)).toBe("unsupported_algorithm");
  });

  it("4. tampering: a flipped payload or signature character, a swapped part, a truncated signature, or a padded or non-canonical segment is bad_signature or malformed", () => {
    const token = handSigned(claims());
    const [h, p, s] = token.split(".") as [string, string, string];
    const flip = (text: string, at: number): string => text.slice(0, at) + (text[at] === "A" ? "B" : "A") + text.slice(at + 1);
    expect(verify(`${h}.${flip(p, 5)}.${s}`)).toBe("bad_signature");
    expect(verify(`${h}.${p}.${flip(s, 10)}`)).toBe("bad_signature");
    const other = handSigned(claims({ sub: "user-mcp-0002" }));
    const [, p2, s2] = other.split(".") as [string, string, string];
    expect(verify(`${h}.${p2}.${s}`)).toBe("bad_signature");
    expect(verify(`${h}.${p}.${s2}`)).toBe("bad_signature");
    expect(verify(`${h}.${p}.${s.slice(0, 42)}`)).toBe("bad_signature");
    expect(verify(`${h}.${p}=.${s}`)).toBe("malformed");
    expect(verify(`${h}.${p}.${s}=`)).toBe("malformed");
    expect(verify(`${h}.${p}`)).toBe("malformed");
    expect(verify(`${h}.${p}.${s}.${s}`)).toBe("malformed");
    // a non-canonical base64url payload signed as written: its unused trailing bits are not zero
    const json = JSON.stringify(claims());
    let canonical = b64url(json);
    let pad = 0;
    while (canonical.length % 4 !== 2 && canonical.length % 4 !== 3) { pad += 1; canonical = b64url(json + " ".repeat(pad)); }
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    const last = alphabet.indexOf(canonical.at(-1)!);
    const nonCanonical = canonical.slice(0, -1) + alphabet[last + 1]!;
    expect(Buffer.from(nonCanonical, "base64url").toString("base64url")).not.toBe(nonCanonical);
    expect(verify(`${h}.${nonCanonical}.${hmac(`${h}.${nonCanonical}`)}`)).toBe("malformed");
  });

  it("5. audience and issuer: another origin, a trailing slash, an uppercase host or an array aud are wrong_audience; a wrong iss is wrong_issuer", () => {
    for (const aud of ["https://other.example.com/api/mcp", `${RESOURCE}/`, "https://MCP.example.com/api/mcp", [RESOURCE], `${ORIGIN}/api/mcp/token`, 5]) {
      expect(verify(handSigned(claims({ aud }))), JSON.stringify(aud)).toBe("wrong_audience");
    }
    for (const iss of ["https://other.example.com", `${ORIGIN}/`, "http://mcp.example.com", ["x"]]) {
      expect(verify(handSigned(claims({ iss }))), JSON.stringify(iss)).toBe("wrong_issuer");
    }
  });

  it("6. time: expiry, not-before skew, lifetime, integer claims and the clock", () => {
    expect(verify(handSigned(claims()), { ...EXPECTED, nowMs: (T0_S + 3600) * 1000 })).toBe("expired");
    expect(verify(handSigned(claims()), { ...EXPECTED, nowMs: (T0_S + 3601) * 1000 })).toBe("expired");
    expect(verify(handSigned(claims()), { ...EXPECTED, nowMs: (T0_S + 3600) * 1000 - 1 })).toBe("ok");
    expect(verify(handSigned(claims({ iat: T0_S + 31, exp: T0_S + 31 + 3600 })))).toBe("not_yet_valid");
    expect(verify(handSigned(claims({ iat: T0_S + 30, exp: T0_S + 30 + 3600 })))).toBe("ok");
    expect(verify(handSigned(claims({ exp: T0_S + 3601 })))).toBe("lifetime_exceeded");
    for (const bad of [1.5, -1, 0, 2 ** 53, 1e308, "1700000000", null]) {
      expect(verify(handSigned(claims({ iat: bad }))), `iat ${String(bad)}`).toBe("claims_invalid");
      expect(verify(handSigned(claims({ exp: bad }))), `exp ${String(bad)}`).toBe("claims_invalid");
    }
    expect(verify(handSigned(claims({ exp: T0_S })))).toBe("claims_invalid");
    for (const nowMs of [Number.NaN, Number.POSITIVE_INFINITY, -1, 1.5]) expect(verify(handSigned(claims()), { ...EXPECTED, nowMs }), String(nowMs)).toBe("clock_invalid");
    expect(reasonOf(mintMcpAccessToken(MINT_INPUT, { environment: ENV, nowMs: Number.NaN }))).toBe("clock_invalid");
  });

  it("7. claims: an extra or missing key, raw-JSON prototype keys, a non-object, non-UTF-8 bytes, an oversized payload, the worker principal and pattern violations are refused", () => {
    expect(verify(handSigned(claims({ extra: 1 })))).toBe("claims_invalid");
    const missing = claims();
    delete missing.sirkit_branch;
    expect(verify(handSigned(missing))).toBe("claims_invalid");
    const json = JSON.stringify(claims());
    for (const key of ["__proto__", "constructor", "prototype"]) {
      expect(verify(handSigned(json.replace('"sirkit_branch"', `"${key}"`))), key).toBe("claims_invalid");
      expect(verify(handSigned(`{"${key}":{"x":1},${json.slice(1)}`)), key).toBe("claims_invalid");
    }
    for (const raw of ["[]", "null", "5", '"text"', "true"]) expect(verify(handSigned(raw)), raw).toBe("claims_invalid");
    expect(verify(handSigned(Buffer.from([0xff, 0xfe, 0x7b, 0x7d])))).toBe("claims_invalid");
    expect(verify(handSigned(claims({ sirkit_branch: "b".repeat(100), sub: "s".repeat(100), sirkit_project: "p".repeat(100), sirkit_tenant: "t".repeat(100), iss: ORIGIN + "x".repeat(700) })))).not.toBe("ok");
    expect(verify(handSigned(`${json.slice(0, -1)}${" ".repeat(1100)}}`))).toBe("claims_invalid");
    expect(verify(handSigned(claims({ sub: WORKER_PRINCIPAL_ID })))).toBe("claims_invalid");
    for (const patch of [{ sirkit_tenant: "bad tenant!" }, { sirkit_project: "" }, { sirkit_branch: "-leading" }, { sub: "user/1" }, { sirkit_mbr: "mbr1-XYZ" }, { sirkit_mbr: "mbr2-0123456789abcdef" }, { jti: JTI.slice(1) }, { jti: `${JTI.slice(1)}!` }, { scope: "sirkit.other" }, { scope: ["sirkit.mcp"] }]) {
      expect(verify(handSigned(claims(patch))), JSON.stringify(patch)).toBe("claims_invalid");
    }
  });

  it("8. tokens of 2 049 and 5 000 000 characters are malformed, as closed outcomes", () => {
    expect(verify("a".repeat(2049))).toBe("malformed");
    expect(verify(`${MCP_TOKEN_HEADER_B64}.${"a".repeat(5_000_000)}.${"b".repeat(43)}`)).toBe("malformed");
    expect(verify("")).toBe("malformed");
  });

  it("9. configuration: a missing, short, long, padded, reused secret, or a missing, malformed, http-in-production or pathed origin, is not_configured for mint and verify", () => {
    const token = handSigned(claims());
    const cases: Array<Record<string, string | undefined>> = [
      { SIRKIT_EXPECTED_ORIGIN: ORIGIN },
      { ...ENV, [MCP_TOKEN_SECRET_ENV]: "x".repeat(31) },
      { ...ENV, [MCP_TOKEN_SECRET_ENV]: "x".repeat(1025) },
      { ...ENV, [MCP_TOKEN_SECRET_ENV]: ` ${SECRET}` },
      { ...ENV, [MCP_TOKEN_SECRET_ENV]: `${SECRET} ` },
      { ...ENV, [WORKER_SECRET_ENV]: SECRET },
      { ...ENV, [WORKER_SECRET_ENV]: ` ${SECRET} ` },
      { ...ENV, KICAD_HTTP_LIBRARY_TOKEN: SECRET },
      { [MCP_TOKEN_SECRET_ENV]: SECRET },
      { [MCP_TOKEN_SECRET_ENV]: SECRET, SIRKIT_EXPECTED_ORIGIN: "not an origin" },
      { [MCP_TOKEN_SECRET_ENV]: SECRET, SIRKIT_EXPECTED_ORIGIN: "http://mcp.example.com", NODE_ENV: "production" },
      { [MCP_TOKEN_SECRET_ENV]: SECRET, SIRKIT_EXPECTED_ORIGIN: `${ORIGIN}/app` },
      { [MCP_TOKEN_SECRET_ENV]: SECRET, SIRKIT_EXPECTED_ORIGIN: `${ORIGIN}?q=1` },
    ];
    for (const environment of cases) {
      const label = JSON.stringify(Object.keys(environment));
      expect(resolveMcpResourceConfiguration(environment), label).toEqual({ ok: false, code: "not_configured" });
      expect(reasonOf(mintMcpAccessToken(MINT_INPUT, { environment, nowMs: T0 })), label).toBe("not_configured");
      expect(verify(token, EXPECTED, environment), label).toBe("not_configured");
    }
    // a 32-byte secret and loopback http in production are configured; the secret is never part of the configuration
    const configured = resolveMcpResourceConfiguration({ [MCP_TOKEN_SECRET_ENV]: "y".repeat(32), SIRKIT_EXPECTED_ORIGIN: "http://localhost:3000", NODE_ENV: "production" });
    expect(configured).toEqual({ ok: true, issuer: "http://localhost:3000", resourceUri: "http://localhost:3000/api/mcp", resourceMetadataUrl: "http://localhost:3000/.well-known/oauth-protected-resource/api/mcp" });
    expect(resolveMcpResourceConfiguration({ ...ENV, [WORKER_SECRET_ENV]: WORKER, KICAD_HTTP_LIBRARY_TOKEN: KICAD })).toEqual({ ok: true, issuer: ORIGIN, resourceUri: RESOURCE, resourceMetadataUrl: `${ORIGIN}/.well-known/oauth-protected-resource/api/mcp` });
    expect(resolveMcpResourceConfiguration({ ...ENV, SIRKIT_EXPECTED_ORIGIN: `${ORIGIN}/` })).toMatchObject({ ok: true, issuer: ORIGIN });
    // the bounds are UTF-8 BYTES, not characters: a two-byte character counts twice
    const twoByte = String.fromCharCode(0xe9);
    const byteBounded: Array<[string, boolean]> = [
      [twoByte.repeat(16), true], // 16 characters, 32 bytes
      [`${twoByte.repeat(15)}a`, false], // 16 characters, 31 bytes
      [twoByte.repeat(512), true], // 512 characters, 1 024 bytes
      [twoByte.repeat(513), false], // 513 characters, 1 026 bytes
    ];
    for (const [secret, configured] of byteBounded) {
      const environment = { [MCP_TOKEN_SECRET_ENV]: secret, SIRKIT_EXPECTED_ORIGIN: ORIGIN };
      const label = `${secret.length} characters, ${Buffer.byteLength(secret, "utf8")} bytes`;
      expect(resolveMcpResourceConfiguration(environment).ok, label).toBe(configured);
      expect(reasonOf(mintMcpAccessToken(MINT_INPUT, { environment, nowMs: T0 })), label).toBe(configured ? "ok" : "not_configured");
    }
  });

  it("10. a token signed with the worker secret is bad_signature", () => {
    expect(verify(handSigned(claims(), { secret: WORKER }), EXPECTED, { ...ENV, [WORKER_SECRET_ENV]: WORKER })).toBe("bad_signature");
  });

  it("11. S4: forty hostile inputs never throw or reject", async () => {
    const hostileTokens: unknown[] = [undefined, null, 0, 1, Number.NaN, {}, [], ["a.b.c"], Symbol("t"), () => "x", "...", "a..b", "..", ".a.b", "a.b.", [NUL, NUL, NUL].join("."), "é.é.é", "a b.c.d", `${MCP_TOKEN_HEADER_B64}..${"a".repeat(43)}`, `${MCP_TOKEN_HEADER_B64}.e30.${"a".repeat(43)}`];
    const hostileExpected: unknown[] = [undefined, null, {}, { audience: RESOURCE }, { audience: 5, issuer: ORIGIN, nowMs: T0 }, { audience: RESOURCE, issuer: null, nowMs: T0 }, { audience: RESOURCE, issuer: ORIGIN, nowMs: "now" }, "x", [], { get audience(): string { throw new Error("hostile"); } }];
    const hostileEnvironments: unknown[] = [undefined, null, {}, { [MCP_TOKEN_SECRET_ENV]: 5 }, { get [MCP_TOKEN_SECRET_ENV](): string { throw new Error("hostile"); } }, { [MCP_TOKEN_SECRET_ENV]: SECRET, SIRKIT_EXPECTED_ORIGIN: {} }, new Proxy({}, { get() { throw new Error("hostile"); } }), "env", [], { [MCP_TOKEN_SECRET_ENV]: NUL.repeat(40), SIRKIT_EXPECTED_ORIGIN: ORIGIN }];
    let count = 0;
    for (const token of hostileTokens) { expect(() => verifyMcpAccessToken(token, EXPECTED, ENV)).not.toThrow(); count += 1; }
    for (const expected of hostileExpected) { expect(() => verifyMcpAccessToken(handSigned(claims()), expected as never, ENV)).not.toThrow(); count += 1; }
    for (const environment of hostileEnvironments) {
      expect(() => verifyMcpAccessToken(handSigned(claims()), EXPECTED, environment as never)).not.toThrow();
      expect(() => resolveMcpResourceConfiguration(environment as never)).not.toThrow();
      expect(() => mintMcpAccessToken(MINT_INPUT, { environment: environment as never, nowMs: T0 })).not.toThrow();
      count += 1;
    }
    expect(count).toBe(40);
    for (const input of [null, {}, { ...MINT_INPUT, subject: 5 }, { ...MINT_INPUT, membershipRevision: "x" }, { ...MINT_INPUT, subject: WORKER_PRINCIPAL_ID }]) {
      expect(() => mintMcpAccessToken(input as never, { environment: ENV, nowMs: T0 })).not.toThrow();
      expect(reasonOf(mintMcpAccessToken(input as never, { environment: ENV, nowMs: T0 }))).toBe("claims_invalid");
    }
    expect(() => mintMcpAccessToken(MINT_INPUT, { environment: ENV, nowMs: T0, randomBytes: () => { throw new Error("no entropy"); } })).not.toThrow();
    expect(reasonOf(mintMcpAccessToken(MINT_INPUT, { environment: ENV, nowMs: T0, randomBytes: () => Buffer.alloc(3) }))).toBe("mint_failed");
    await expect(createSirkitHmacVerifier(ENV).verify(Symbol("x") as never, EXPECTED)).resolves.toEqual({ ok: false, reason: "malformed" });
  });

  it("12. S2: no outcome of cases 3 to 11 carries the secret or the token, in any disguise", () => {
    const token = handSigned(claims({ exp: T0_S + 7200 }));
    const outcomes = [
      verifyMcpAccessToken(token, EXPECTED, ENV),
      verifyMcpAccessToken(token, EXPECTED, { SIRKIT_EXPECTED_ORIGIN: ORIGIN }),
      verifyMcpAccessToken(`${token}x`, EXPECTED, ENV),
      verifyMcpAccessToken(token.replace(/.$/, "A"), EXPECTED, ENV),
      verifyMcpAccessToken(handSigned(claims(), { secret: WORKER }), EXPECTED, { ...ENV, [WORKER_SECRET_ENV]: WORKER }),
      mintMcpAccessToken(MINT_INPUT, { environment: { ...ENV, KICAD_HTTP_LIBRARY_TOKEN: SECRET }, nowMs: T0 }),
      resolveMcpResourceConfiguration(ENV),
    ];
    for (const outcome of outcomes) {
      const text = JSON.stringify(outcome);
      expect(carries(text, SECRET)).toBe(false);
      expect(text.includes(token)).toBe(false);
      expect(text.includes(token.split(".")[2]!)).toBe(false);
    }
    for (const reason of outcomes.map((outcome) => ("reason" in outcome ? outcome.reason : "ok"))) expect([...MCP_TOKEN_REFUSALS, "ok"]).toContain(reason);
  });

  it("13. the verifier seam: an injected verifier is returned; a throwing factory answers null; the default is the Sirkit HMAC verifier", () => {
    expect(resolveMcpAccessTokenVerifier(ENV)?.kind).toBe("sirkit-hmac");
    const fake: McpAccessTokenVerifier = { kind: "external", verify: async () => ({ ok: false, reason: "malformed" }) };
    setMcpAccessTokenVerifierFactory(() => fake);
    expect(resolveMcpAccessTokenVerifier(ENV)).toBe(fake);
    setMcpAccessTokenVerifierFactory(() => { throw new Error("broken factory"); });
    expect(resolveMcpAccessTokenVerifier(ENV)).toBeNull();
    resetMcpAccessTokenVerifierFactory();
    expect(resolveMcpAccessTokenVerifier(ENV)?.kind).toBe("sirkit-hmac");
  });

  it("14. .env.example names SIRKIT_MCP_TOKEN_SECRET as a commented, empty assignment, with its bounds", () => {
    const example = readFileSync(join(ROOT, ".env.example"), "utf8");
    expect(example).toMatch(/^# SIRKIT_MCP_TOKEN_SECRET=$/m);
    expect(example).not.toMatch(/^SIRKIT_MCP_TOKEN_SECRET=/m);
    expect(example).toMatch(/32.{0,4}1 ?024 bytes/);
  });

  it("15. ID_PATTERN is the one exported from trusted-request-context.ts: no second copy under app/lib/auth or app/lib/mcp", () => {
    expect(ID_PATTERN.test("proj-mcp")).toBe(true);
    const bearer = readFileSync(join(ROOT, "app", "lib", "auth", "mcp-bearer.ts"), "utf8");
    expect(bearer).toMatch(/import \{[^}]*\bID_PATTERN\b[^}]*\} from "\.\/trusted-request-context";/);
    const literal = ID_PATTERN.source;
    const copies: string[] = [];
    const scan = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (entry === "__tests__") continue;
        if (statSync(full).isDirectory()) scan(full);
        else if (entry.endsWith(".ts") && readFileSync(full, "utf8").includes(literal)) copies.push(full.replaceAll("\\", "/").split("/app/lib/")[1]!);
      }
    };
    scan(join(ROOT, "app", "lib", "auth"));
    scan(join(ROOT, "app", "lib", "mcp"));
    expect(copies).toEqual(["auth/trusted-request-context.ts"]);
  });
});
