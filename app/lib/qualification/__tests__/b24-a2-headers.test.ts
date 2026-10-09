/**
 * [B24-A2] Security headers on every path (D24-5, OD-196).
 *
 * `next.config.ts` keeps its one rule, `source: "/:path*"`, and sends exactly six headers built from an environment map by one pure
 * builder (`securityHeaders`, appended after the file's :14): the image directive B19-D pins, now with `frame-ancestors 'none'`, in
 * the same `Content-Security-Policy` header; `X-Frame-Options: DENY`; `X-Content-Type-Options: nosniff`; `Referrer-Policy:
 * strict-origin-when-cross-origin`; a `Permissions-Policy` that turns off five features the app never uses; and a report-only policy
 * (`default-src`, `script-src`, `connect-src`, `object-src`, `base-uri`) with no report endpoint. `Strict-Transport-Security:
 * max-age=31536000` is added only when `SIRKIT_EXPECTED_ORIGIN` normalises to https - the session cookie's `Secure` rule
 * (`session-cookies.ts:30-38`). `poweredByHeader: false`. The builder reads nothing but that one name from the map it is handed:
 * never a request, a forwarding header or `process.env` itself. The served-header proof is `e2e/security-headers.spec.ts` (the
 * lead's browser run); this suite pins that the spec's literals are the builder's.
 *
 * The builder lives in `next.config.ts`, not in `app/lib/deployment/`: a relative TypeScript import from the config file is
 * unproven under `next dev` and `next build` here (task-A2 deliverable 1's fallback; page section 1).
 * Failing first on 1b2c08c: `securityHeaders` does not exist and the one header is the image policy (page section 8). Files are read
 * as text; nothing is written to disk and no process is started.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sessionCookieOptions } from "@/app/lib/auth/session-cookies";
import { DECLARED_ENVIRONMENT_NAME_CLASSES, ENVIRONMENT_NAMES } from "@/app/lib/deployment/environment-names";
import nextConfig, { securityHeaders } from "@/next.config";

const ROOT = process.cwd();
const NEWLINE = String.fromCharCode(10);
const CR = String.fromCharCode(13);
const read = (path: string): string => readFileSync(join(ROOT, path), "utf8").replaceAll(`${CR}${NEWLINE}`, NEWLINE);
const lines = (path: string): string[] => read(path).split(NEWLINE);
const PAGE = "artifacts/ai-control-plane-b24/edge-security.md";
const SPEC = "e2e/security-headers.spec.ts";
type Env = Record<string, string | undefined>;
type Header = { key: string; value: string };

/** The six headers on every path, in order, with their exact values (OD-196; task-A2 deliverable 1). */
const EXPECTED: readonly (readonly [string, string])[] = [
  ["Content-Security-Policy", "img-src 'self' data: blob:; frame-ancestors 'none'"],
  ["X-Frame-Options", "DENY"],
  ["X-Content-Type-Options", "nosniff"],
  ["Referrer-Policy", "strict-origin-when-cross-origin"],
  ["Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()"],
  ["Content-Security-Policy-Report-Only", "default-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'"],
];
const HSTS: readonly [string, string] = ["Strict-Transport-Security", "max-age=31536000"];
const pairs = (headers: readonly Header[]): string[][] => headers.map((header) => [header.key, header.value]);

/** Every origin shape the parity case tries: well-formed, padded, re-cased, default and other ports, paths, queries, fragments,
 *  credentials, other schemes, loopback, IPv6, IDN, empty and garbage. */
const ORIGINS: readonly (string | undefined)[] = [
  undefined, "", "   ", "https://sirkit.example", "https://sirkit.example/", " https://sirkit.example ", "HTTPS://SIRKIT.EXAMPLE",
  "https://sirkit.example:443", "https://sirkit.example:443/", "https://sirkit.example:8443", "https://sirkit.example/app",
  "https://sirkit.example/?x=1", "https://sirkit.example/#top", "https://sirkit.example?", "https://sirkit.example#",
  "https://sirkit.example//", "https://user:pw@sirkit.example", "http://sirkit.example", "http://localhost:3100",
  "https://localhost:3100", "https://127.0.0.1", "https://[::1]:3000", "http://[::1]:3000", "ftp://sirkit.example",
  "sirkit.example", "https://", "https:sirkit.example", "https://xn--bcher-kva.example", ["https://b", String.fromCharCode(252), "cher.example"].join(""),
  "data:text/plain,x", "https://a.example, https://b.example", "https://sirkit.example/ ",
];

/** Code with every comment removed (line breaks kept); strings and template literals kept. */
function code(text: string): string {
  let out = "";
  let state: "code" | "line" | "block" | "'" | '"' | "`" = "code";
  for (let index = 0; index < text.length; index += 1) {
    const c = text[index]!;
    const next = text[index + 1] ?? "";
    if (state === "code") {
      if (c === "/" && next === "/") { state = "line"; index += 1; continue; }
      if (c === "/" && next === "*") { state = "block"; index += 1; continue; }
      if (c === "'" || c === '"' || c === "`") state = c;
      out += c;
    } else if (state === "line") {
      if (c === NEWLINE) { state = "code"; out += c; }
    } else if (state === "block") {
      if (c === "*" && next === "/") { state = "code"; index += 1; } else if (c === NEWLINE) out += c;
    } else {
      if (c === String.fromCharCode(92)) { out += c + next; index += 1; continue; }
      if (c === state || (c === NEWLINE && state !== "`")) state = "code";
      out += c;
    }
  }
  return out;
}
const SOURCE = /\.(?:tsx?|mts|mjs|cjs|js)$/;
function sources(dir: string): string[] {
  return readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return entry.name === "__tests__" || entry.name === "node_modules" || entry.name.startsWith(".") ? [] : sources(path);
    return SOURCE.test(entry.name) && !/\.(?:test|spec)\.[a-z]+$/.test(entry.name) ? [path] : [];
  });
}
const section = (page: string, number: number): string => {
  const start = page.search(new RegExp(`${NEWLINE}## ${number}\\. `));
  const next = page.indexOf(`${NEWLINE}## `, start + 1);
  return start < 0 ? "" : page.slice(start, next < 0 ? undefined : next);
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("[B24-A2] the security headers (D24-5, OD-196)", () => {
  it("1. counterexample (red on 1b2c08c, where the one header was the image policy): headers() keeps its one rule on /:path* and sends exactly the six headers with their exact values when no https origin is configured; the image directive B19-D pins is unchanged; poweredByHeader is false; allowedDevOrigins is unchanged", async () => {
    vi.stubEnv("SIRKIT_EXPECTED_ORIGIN", "");
    const config = nextConfig as { headers?: () => Promise<Array<{ source: string; headers: Header[] }>>; poweredByHeader?: boolean; allowedDevOrigins?: string[] };
    expect(typeof securityHeaders).toBe("function");
    const rules = await config.headers!();
    expect(rules.map((rule) => rule.source)).toEqual(["/:path*"]);
    expect(pairs(rules[0]!.headers)).toEqual(EXPECTED.map((pair) => [...pair]));
    expect(pairs(securityHeaders({}))).toEqual(EXPECTED.map((pair) => [...pair]));
    // one Content-Security-Policy, the image directive first and unchanged (b19-d-chat-markdown.test.tsx:70-77)
    expect(rules[0]!.headers.filter((header) => header.key.toLowerCase() === "content-security-policy")).toHaveLength(1);
    expect(rules[0]!.headers[0]!.value.startsWith("img-src 'self' data: blob:;")).toBe(true);
    expect(config.poweredByHeader).toBe(false);
    expect(config.allowedDevOrigins).toEqual(["172.20.20.20"]);
    // every key once; no report endpoint (a report-uri or report-to would need a route, which this increment adds none of)
    const keys = securityHeaders({ SIRKIT_EXPECTED_ORIGIN: "https://sirkit.example" }).map((header) => header.key.toLowerCase());
    expect(new Set(keys).size).toBe(keys.length);
    for (const header of securityHeaders({ SIRKIT_EXPECTED_ORIGIN: "https://sirkit.example" })) expect(header.value, header.key).not.toMatch(/report-uri|report-to/);
  });

  it("2. HSTS is max-age=31536000 exactly (no includeSubDomains, no preload) and present exactly when SIRKIT_EXPECTED_ORIGIN normalises to https - for every origin shape, the session cookie's Secure flag (session-cookies.ts:30-38) and the builder agree", () => {
    let present = 0;
    for (const origin of ORIGINS) {
      const env: Env = origin === undefined ? {} : { SIRKIT_EXPECTED_ORIGIN: origin };
      const headers = securityHeaders(env);
      const hsts = headers.filter((header) => header.key === HSTS[0]);
      const secure = sessionCookieOptions(env).secure;
      expect(hsts.length, JSON.stringify(origin)).toBe(secure ? 1 : 0);
      expect(pairs(headers.filter((header) => header.key !== HSTS[0])), JSON.stringify(origin)).toEqual(EXPECTED.map((pair) => [...pair]));
      if (secure) {
        present += 1;
        expect(hsts[0]!.value).toBe(HSTS[1]);
        expect(headers[headers.length - 1]!.key).toBe(HSTS[0]);
      }
    }
    expect(present).toBeGreaterThanOrEqual(8);
    expect(securityHeaders({ SIRKIT_EXPECTED_ORIGIN: "https://sirkit.example" }).find((header) => header.key === HSTS[0])?.value).toBe("max-age=31536000");
    expect(securityHeaders({ SIRKIT_EXPECTED_ORIGIN: "http://localhost:3100" }).some((header) => header.key === HSTS[0])).toBe(false);
  });

  it("3. the builder is pure: it reads SIRKIT_EXPECTED_ORIGIN and nothing else from the map it is handed, never process.env, a request or a forwarding header; headers() hands it process.env", () => {
    const reads: string[] = [];
    const target: Env = { SIRKIT_EXPECTED_ORIGIN: "https://sirkit.example", NODE_ENV: "production", HOST: "evil.example" };
    const env = new Proxy(target, { get: (object, key) => { reads.push(String(key)); return Reflect.get(object, key); } });
    expect(securityHeaders(env).some((header) => header.key === HSTS[0])).toBe(true);
    expect([...new Set(reads)]).toEqual(["SIRKIT_EXPECTED_ORIGIN"]);
    // process.env is never read inside: an https origin in the process does not reach a builder handed an empty map
    vi.stubEnv("SIRKIT_EXPECTED_ORIGIN", "https://sirkit.example");
    expect(securityHeaders({}).some((header) => header.key === HSTS[0])).toBe(false);
    // the appended builder's code (comments removed) names no request, header read, forwarding header or process
    const appended = code(lines("next.config.ts").slice(14).join(NEWLINE));
    expect(appended).toMatch(/export function securityHeaders\(/);
    expect(appended).not.toMatch(/\bprocess\b|\brequest\b|\bRequest\b|forwarded|x-forwarded|\bheaders\(\)|\bcookies\(/i);
    // the config imports nothing at run time: its one import is erased (type only), so the config loader needs no module resolution
    const imports = code(read("next.config.ts")).split(NEWLINE).filter((line) => /^\s*import\b/.test(line));
    expect(imports).toEqual(['import type { NextConfig } from "next";']);
  });

  it("4. next.config.ts keeps its 14-line head in place: :1 the type import, :6 allowedDevOrigins with poweredByHeader appended, :7-8 the comment with the dated B24-A2 note at the end of :8, :9-11 the one rule with the builder call replacing :10's array, :12-14; the builder is appended after :14", () => {
    const config = lines("next.config.ts");
    expect(config[0]).toBe('import type { NextConfig } from "next";');
    expect(config[1]).toBe("");
    expect(config[2]).toBe("const nextConfig: NextConfig = {");
    expect(config[5]).toMatch(/^ {2}allowedDevOrigins: \["172\.20\.20\.20"\], poweredByHeader: false, \/\/ \[B24-A2\] /);
    expect(config[6]).toMatch(/^ {2}\/\/ \[B19-D I5c row 02\] images may come only from Sirkit itself/);
    expect(config[7]).toMatch(/^ {2}\/\/ imported project names\. Only the image directive is set; every other resource type keeps its current behaviour\. \[B24-A2, 2026-10-06\] /);
    expect(config[8]).toBe("  async headers() {");
    expect(config[9]).toBe('    return [{ source: "/:path*", headers: securityHeaders(process.env) }];');
    expect(config[10]).toBe("  },");
    expect(config[11]).toBe("};");
    expect(config[12]).toBe("");
    expect(config[13]).toBe("export default nextConfig;");
    expect(config.slice(14).join(NEWLINE)).toMatch(/\[B24-A2\]/);
  });

  it("5. the served-header spec keeps its two tests (:12-21) and asserts the builder's exact values on /, /api/ai/runtime, /favicon.ico (outside proxy.ts's matcher) and /api/health; X-Powered-By and HSTS absent on its http origin (playwright.config.ts); the framing case; the report-only violations attached, asserted on nothing", () => {
    const spec = lines(SPEC);
    expect(spec[11]).toBe('test("the page response carries the image source policy", async ({ page }) => {');
    expect(spec[12]).toBe('  const response = await page.goto("/");');
    expect(spec[17]).toBe('test("an API response carries it too", async ({ request }) => {');
    expect(spec[19]).toBe('  expect(response.headers()["content-security-policy"] ?? "").toContain(POLICY);');
    expect(spec[20]).toBe("});");
    const text = read(SPEC);
    // the spec's literals are exactly the builder's (http origin: no HSTS), header names lower-cased as Playwright reports them
    const literal = /const SECURITY_HEADERS[^=]*= \[([\s\S]*?)\n\];/.exec(text)?.[1] ?? "";
    const specPairs = [...literal.matchAll(/\["([a-z-]+)", "([^"]+)"\]/g)].map((match) => [match[1], match[2]]);
    expect(specPairs).toEqual(securityHeaders({ SIRKIT_EXPECTED_ORIGIN: "http://localhost:3100" }).map((header) => [header.key.toLowerCase(), header.value]));
    expect(text).toContain('const SECURITY_HEADER_PATHS = ["/", "/api/ai/runtime", "/favicon.ico", "/api/health"] as const;');
    expect(text).toContain('expect(headers["x-powered-by"], `${path} x-powered-by`).toBeUndefined();');
    expect(text).toContain('expect(headers["strict-transport-security"], `${path} strict-transport-security`).toBeUndefined();');
    expect(read("playwright.config.ts")).toContain("SIRKIT_EXPECTED_ORIGIN: `http://localhost:${PORT}`,");
    // /favicon.ico is outside the proxy's matcher, so the header rule (not the proxy) is what serves its headers there
    expect(read("proxy.ts")).toContain("favicon.ico|");
    // the framing case: an about:blank page frames /, and no Sirkit document arrives in the frame
    expect(text).toMatch(/test\("\[B24-A2\] framing: /);
    expect(text).toContain('await page.goto("about:blank");');
    expect(text).toMatch(/expect\(frame\?\.url\(\) \?\? ""\)\.not\.toBe\(target\);/);
    for (const surface of ["Tier 1 grant card", "Tier 2 dialogs", "ProviderExchangePanel"]) expect(text, surface).toContain(surface);
    // the report-only violations: attached to the result, asserted on nothing
    const reportOnly = text.slice(text.indexOf('test("[B24-A2] report-only:'));
    expect(reportOnly.length).toBeGreaterThan(100);
    expect(reportOnly).toContain("testInfo.attach(");
    expect(reportOnly.slice(0, reportOnly.indexOf(NEWLINE + "});"))).not.toMatch(/\bexpect\(/);
  });

  it("6. the report-only and permissions directives break nothing the app uses: no production source asks for the camera, the microphone, geolocation, payment or USB, and no browser-side module imports @supabase (connect-src 'self')", () => {
    const files = ["app", "components", "lib"].flatMap((dir) => sources(dir));
    expect(files.length).toBeGreaterThan(500);
    const offenders: string[] = [];
    for (const file of files) {
      const text = code(read(file));
      if (/getUserMedia|mediaDevices|navigator\.geolocation|PaymentRequest|navigator\.usb|requestDevice\(/.test(text)) offenders.push(`${file}: a permissions feature`);
      const client = /^\s*["']use client["']/m.test(text) || file.startsWith("app/components/") || file.startsWith("components/");
      if (client && /from\s+["']@supabase\//.test(text)) offenders.push(`${file}: a browser-side Supabase import`);
    }
    expect(offenders).toEqual([]);
  });
});

describe("[B24-A2] the page edge-security.md, its header half", () => {
  it("7. the page states each header with its value, why and where it is proven (unit, the dev browser run, production-smoke; the real edge BLOCKED under LB-13), X-Powered-By before and after, the build-time HSTS reading as INFERRED, allowedDevOrigins as dev-server only, and why the builder sits in next.config.ts", () => {
    const page = read(PAGE);
    expect(page.startsWith("# B24-A2 - ")).toBe(true);
    for (const label of ["CONFIRMED", "INFERRED", "PROPOSED", "RECORDED", "UNKNOWN", "BLOCKED-LIVE-QUALIFICATION"]) expect(page, label).toContain(`**${label}**`);
    const one = section(page, 1);
    for (const [key, value] of [...EXPECTED, HSTS]) {
      expect(one, key).toContain(`\`${key}\``);
      expect(one, value).toContain(`\`${value}\``);
    }
    for (const fact of ["`poweredByHeader: false`", "X-Powered-By", "`allowedDevOrigins`", "dev-server only", "LB-13", "production-smoke", "b24-a2-headers", "e2e/security-headers.spec.ts", "routes manifest", "fallback"]) expect(one, fact).toContain(fact);
    expect(one).toMatch(/\*\*INFERRED\*\*[^\n]*(?:\n[^\n#]*){0,3}routes manifest/);
    expect(one).toMatch(/before[^\n]*X-Powered-By|X-Powered-By[^\n]*before/i);
  });

  it("8. the page's sections are in order; every citation of section 14 is on the line it names, numbered in order; every suite row of section 10 carries its real it( count", () => {
    const page = read(PAGE);
    const titles = [...page.matchAll(/^## (\d+)\. /gm)].map((match) => Number(match[1]));
    expect(titles).toEqual(Array.from({ length: 16 }, (_, index) => index)); // [B24-A2F, 2026-10-09] reviewed pin move, 15 -> 16: section 15 (the history-only allowlist entries) appended at the end of the page
    const citations = [...section(page, 14).matchAll(/^\| (C\d+) \| `([^`]+)` \| (\d+) \| `(.+)` \|$/gm)];
    expect(citations.length).toBeGreaterThanOrEqual(25);
    expect(citations.map((row) => row[1])).toEqual(citations.map((_, index) => `C${index + 1}`));
    const stale = citations.filter((row) => !(lines(row[2]!)[Number(row[3]) - 1] ?? "").includes(row[4]!.replaceAll("\\|", "|"))).map((row) => `${row[1]} ${row[2]}:${row[3]}`);
    expect(stale).toEqual([]);
    const suites = [...section(page, 10).matchAll(/^\| `(app\/[^`]+\.test\.ts)` \| (\d+) \|$/gm)];
    expect(suites.map((row) => row[1])).toEqual(["headers", "origin-allowlist", "secret-rotation", "env-names", "secret-scan"].map((name) => `app/lib/qualification/__tests__/b24-a2-${name}.test.ts`));
    for (const row of suites) expect((read(row[1]!).match(/^\s*it\(/gm) ?? []).length, row[1]).toBe(Number(row[2]));
  });
});

// ── [B24-A2 review, 2026-10-06] the review round: tests-5 proven against deliberate breakages of the workflow (restored by hash);
// coverage-2, coverage-3 and coverage-4 red on the page the review read ──

const WORKFLOW = ".github/workflows/deterministic-manufacturing.yml";
const BS = String.fromCharCode(92);
const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, (match) => `${BS}${match}`);
/** A top-level job's lines in the workflow, from its header to the line before the next job's. */
function workflowJob(name: string): string[] {
  const all = lines(WORKFLOW);
  const start = all.indexOf(`  ${name}:`);
  const end = all.findIndex((line, index) => index > start && /^ {2}[a-z][a-z0-9-]*:$/.test(line));
  return start < 0 ? [] : all.slice(start, end < 0 ? undefined : end);
}
/** The gates section 10 records, each a row `| \`<gate>\` | <result> | exit <n> |` (task-A2 "Gates"; the browser and production-mode
 *  runs are the lead's and are listed apart). */
const RECORDED_GATES = [
  "app/lib/qualification/__tests__",
  "app/lib/auth/__tests__",
  "app/api/__tests__",
  "app/api/mcp/__tests__",
  "app/lib/mcp",
  "app/lib/atomic/__tests__/kicad-http-route.test.ts",
  "app/lib/atomic/__tests__/b19-e-atomic-revision-loaders.test.ts",
  "app/components/chat/__tests__/b19-d-chat-markdown.test.tsx",
  "app/lib/project/__tests__/b14-4-ast-import-gates.test.ts",
  "app/lib/acquisition/__tests__/b19-e-ci-job-scope.test.ts",
  "app/lib/agent/orchestration/__tests__",
  "app/lib/computation/__tests__",
  "app/lib/manufacturing-providers/__tests__",
  "tsc",
  "eslint",
  "generate-action-toolability-matrix",
  "generate-agent-artifacts",
  "generate-b17-control-inventory",
  "scan tree",
  "scan --staged",
  "scan --history 57c3b29..HEAD",
] as const;

describe("[B24-A2 review, 2026-10-06] production-smoke's probes and the page's records", () => {
  it("9. tests-5: production-smoke's header probes are pinned by content - the loop's paths are the spec's four, `/` first; each expected line is the builder's header for the job's http origin, lower-cased `name: value`; a missing or different header exits 1; X-Powered-By and Strict-Transport-Security each exit 1; the build step sets no SIRKIT_EXPECTED_ORIGIN", () => {
    const job = workflowJob("production-smoke");
    const loop = job.filter((line) => /^ {10}for path in /.test(line));
    expect(loop).toHaveLength(1);
    const paths = loop[0]!.trim().replace(/^for path in /, "").replace(/; do$/, "").split(" ");
    const specPaths = [.../const SECURITY_HEADER_PATHS = \[([^\]]*)\]/.exec(read(SPEC))![1]!.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
    expect(paths[0]).toBe("/");
    expect([...paths].sort()).toEqual([...specPaths].sort());
    const expectedLines = job.filter((line) => /^ {12}for expected in /.test(line));
    expect(expectedLines).toHaveLength(1);
    const quoted = [...expectedLines[0]!.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
    expect(quoted).toEqual(securityHeaders({ SIRKIT_EXPECTED_ORIGIN: "http://localhost:3200" }).map((header) => `${header.key.toLowerCase()}: ${header.value}`));
    const from = job.indexOf(loop[0]!);
    const body = job.slice(from, job.findIndex((line, index) => index > from && line === "          done")).join(NEWLINE);
    for (const line of [
      '            curl -s -o /dev/null -D headers.txt "$SMOKE_ORIGIN$path"',
      `            tr -d '${BS}r' < headers.txt | sed -E 's/^([A-Za-z-]+):/${BS}L${BS}1:/' > headers.lf`,
      '              grep -qxF "$expected" headers.lf || { echo "$path: a security header is missing or different: ${expected%%:*}"; exit 1; }',
      `            if grep -qi '^x-powered-by:' headers.lf; then echo "$path sends x-powered-by"; exit 1; fi`,
      `            if grep -qi '^strict-transport-security:' headers.lf; then echo "$path sends strict-transport-security on an http origin"; exit 1; fi`,
    ]) expect(body.split(NEWLINE), line).toContain(line);
    // the build step sets no origin, so HSTS is absent by the build-time reading; the origin is set for next start only
    const build = job.slice(job.findIndex((line) => line.includes("- name: next build")), job.findIndex((line) => line.includes("- name: next start")));
    expect(build.length).toBeGreaterThan(3);
    expect(build.join(NEWLINE)).not.toContain("SIRKIT_EXPECTED_ORIGIN");
    expect(job.join(NEWLINE)).toMatch(/^ {10}SIRKIT_EXPECTED_ORIGIN: http:\/\/localhost:3200$/m);
  });

  it("10. coverage-4 (red on the page the review read): the page says what the workflow does - section 7 names every path production-smoke probes, `/` included, and section 1's HSTS row says the build sets no SIRKIT_EXPECTED_ORIGIN (an http origin is set for next start only), never an http origin at build time", () => {
    const page = read(PAGE);
    const loop = workflowJob("production-smoke").find((line) => /^ {10}for path in /.test(line))!;
    const paths = loop.trim().replace(/^for path in /, "").replace(/; do$/, "").split(" ");
    const seven = section(page, 7);
    const smoke = seven.slice(seven.indexOf("**`production-smoke`**"));
    for (const path of paths) expect(smoke, path).toContain(`\`${path}\``);
    const hsts = section(page, 1).split(NEWLINE).find((line) => line.startsWith("| `Strict-Transport-Security` |")) ?? "";
    expect(hsts).not.toMatch(/http origin at build time/);
    expect(hsts).toMatch(/builds with no `SIRKIT_EXPECTED_ORIGIN`/);
  });

  it("11. coverage-2 (red on the page the review read): section 13 holds every reserved text in full - the three dated closure clauses, the OD-195 and OD-196 headings as applied (OD-195's narrowing old -> new with every undeclared name by class), the OD-224 heading for A2's own choices, the OD-30 amendment, the LB-13 note, the README row, the ledger paragraph, the PROGRAM_STATE.json line naming B24-A3, the section-10 line for Lead notes 1-7, the browser and production-mode runs and the case-16 STOP with its proposed move", () => {
    const lead = section(read(PAGE), 13);
    expect(lead.length).toBeGreaterThan(10_000);
    for (const [defect, blocked] of [["D24-4", "(LB-13)"], ["D24-5", "(LB-13)"], ["D24-6", "(LB-1, LB-13)"]] as const) {
      const clause = lead.split(NEWLINE).filter((line) => line.startsWith(`- [B24-A2, 2026-10-06] ${defect}: `));
      expect(clause, defect).toHaveLength(1);
      expect(clause[0], defect).toContain(blocked);
    }
    for (const od of ["OD-195", "OD-196", "OD-224"]) expect(lead, od).toMatch(new RegExp(`^### ${od} (?:—|-) [^${NEWLINE}]*\\(B24-A2, 2026-10-06\\)$`, "m"));
    const block = (heading: string): string => {
      const start = lead.indexOf(`${NEWLINE}### ${heading}`);
      const next = lead.indexOf(`${NEWLINE}### `, start + 1);
      return start < 0 ? "" : lead.slice(start, next < 0 ? undefined : next);
    };
    const od195 = block("OD-195 ");
    for (const fact of ["every name the code reads", "every name of a declared class", "_PREVIOUS", "OD-42"]) expect(od195, fact).toContain(fact);
    for (const row of ENVIRONMENT_NAMES.filter((candidate) => !(DECLARED_ENVIRONMENT_NAME_CLASSES as readonly string[]).includes(candidate.class))) expect(od195, row.name).toContain(`\`${row.name}\``);
    const od224 = block("OD-224 ");
    for (const fact of ["max-age=31536000", "Permissions-Policy", "Report-Only", "build-time", "kind -> class", "_PREVIOUS", "4 MiB", "allowlist", "`<commit>:<path>`", "run time", "`secret-scan`", "b24-a2-", "NUL byte", "connection-string-password", "seven days", "nothing scanned"]) expect(od224, fact).toContain(fact);
    for (const heading of ["OD-30 ", "The LB-13 note", "The README row", "The PROGRAM_STATE.json line", "The section-10 line", "The browser and production-mode runs", "The case-16 STOP"]) expect(block(heading).length, heading).toBeGreaterThan(200);
    expect(block("OD-30 ")).toMatch(/^- \[B24-A2, 2026-10-06\] /m);
    expect(block("The LB-13 note")).toMatch(/^- \[B24-A2, 2026-10-06\] /m);
    expect(block("The README row")).toMatch(/^\| B24-A2 headers, origins, secrets /m);
    // the ledger paragraph carries its own `### B24-A2 - ` heading (the ledger's form), so it runs to the next record's heading
    const ledger = lead.slice(lead.indexOf(`${NEWLINE}### The ledger paragraph`), lead.indexOf(`${NEWLINE}### The PROGRAM_STATE.json line`));
    expect(ledger.length).toBeGreaterThan(1_000);
    expect(ledger).toMatch(/^### B24-A2 - /m);
    expect(ledger).toMatch(/^- Review round \(2026-10-06\): /m);
    expect(block("The PROGRAM_STATE.json line")).toContain("B24-A3");
    expect(block("The section-10 line")).toMatch(/^- \[B24-A2, 2026-10-06\] B24-A2 landed [^\n]*Lead notes 1-7/m);
    expect(block("The case-16 STOP")).toContain("b24-a1-environment-profile");
  });

  it("12. coverage-3 (red on the page the review read): section 10 records every gate run - each gate of the task's list with its result and exit code, the three scan runs, tsc, eslint and the generators - so every CONFIRMED of section 6 that cites section 10 finds a run there", () => {
    const ten = section(read(PAGE), 10);
    for (const gate of RECORDED_GATES) expect(ten, gate).toMatch(new RegExp(`^\\| \`${escapeRegExp(gate)}\` \\| [^${NEWLINE}]+ \\| exit \\d+ \\|$`, "m"));
    const six = section(read(PAGE), 6);
    expect(six).toMatch(/section 10/);
  });

  it("13. [B24-A2F review, 2026-10-09] section 15 is checked as section 14 is, every problem listed in one run: its citations continue section 14's numbering and each sits on the line it names (security-2); the helper range it cites in secret-scan.ts runs from the dated header comment to the file's last line, the helper's closing brace (correctness-2, security-4); the design judgement that a history-only entry is not a second way to allowlist a real secret sits in the INFERRED paragraph and under no CONFIRMED (security-3)", () => {
    const page = read(PAGE);
    const row = /^\| (C\d+) \| `([^`]+)` \| (\d+) \| `(.+)` \|$/gm;
    const fourteen = [...section(page, 14).matchAll(row)];
    const fifteen = section(page, 15);
    const citations = [...fifteen.matchAll(row)];
    const problems: string[] = [];
    if (citations.length < 7) problems.push(`section 15 holds ${citations.length} citations`);
    citations.forEach((cited, index) => { if (cited[1] !== `C${fourteen.length + index + 1}`) problems.push(`${cited[1]} out of order (C${fourteen.length + index + 1} expected)`); });
    for (const cited of citations) if (!(lines(cited[2]!)[Number(cited[3]) - 1] ?? "").includes(cited[4]!.replaceAll("\\|", "|"))) problems.push(`${cited[1]} ${cited[2]}:${cited[3]} does not hold its anchor`);
    // the helper range: the dated header comment through the file's last line (the trailing line break makes one empty element)
    const range = /declared at the end of `secret-scan\.ts` \(`:(\d+)-(\d+)`/.exec(fifteen);
    const scanner = lines("app/lib/deployment/secret-scan.ts");
    const last = scanner.length - (scanner[scanner.length - 1] === "" ? 1 : 0);
    if (range === null) problems.push("section 15 cites no helper range in secret-scan.ts");
    else {
      if (!(scanner[Number(range[1]) - 1] ?? "").startsWith("// ── [B24-A2F, 2026-10-09] The history-only allowlist entries")) problems.push(`secret-scan.ts:${range[1]} is not the dated header comment`);
      if (Number(range[2]) !== last || scanner[last - 1] !== "}") problems.push(`secret-scan.ts:${range[2]} is not the file's last line, the helper's closing brace (:${last})`);
    }
    // the design judgement: in the paragraph labelled INFERRED, in no paragraph carrying a CONFIRMED (the page wraps its prose, so a paragraph is read with its line breaks as spaces)
    const judgement = fifteen.split(`${NEWLINE}${NEWLINE}`).filter((paragraph) => paragraph.replaceAll(NEWLINE, " ").includes("not a second way to allowlist a real secret"));
    if (judgement.length !== 1) problems.push(`the judgement sits in ${judgement.length} paragraphs`);
    for (const paragraph of judgement) {
      if (!paragraph.startsWith("**What stays open** (**INFERRED**)")) problems.push("the judgement sits outside the INFERRED paragraph");
      if (paragraph.includes("**CONFIRMED**")) problems.push("the judgement's paragraph carries a CONFIRMED");
    }
    expect(problems).toEqual([]);
  });
});
