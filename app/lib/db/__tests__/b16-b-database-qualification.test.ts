/**
 * B16-B item 5 (LB-4) — DB-backed tests are OPT-IN by an explicit marker.
 *
 * The defect: app/lib/pcb/__tests__/ingest-integrity.test.ts loaded .env.local
 * and gated on DATABASE_URL, so the owner's dead Supabase URL made the DEFAULT
 * deterministic suite fail with "PostgresError: (ENOTFOUND) …" — an environment
 * failure presented as a functional one. Five other DB tests each invented a
 * private env name (R03_B06_DATABASE_URL, R03_B07_…, R03_B10D_U01_…,
 * R03_B10D_RETRY02_…, R05_RC01_…). This suite pins the replacement:
 *
 *  1. truth table of `databaseQualification` / `withQualifiedDatabase`
 *     (marker missing / url missing / malformed / valid; DATABASE_URL and a
 *     .env.local-style value are ignored by construction);
 *  2. the helper itself never touches loadEnvLocal, DATABASE_URL, or a logger;
 *  3. repo-wide tripwires over app/** /__tests__ (allowlist: NONE):
 *     no test imports load-env-local; none gates on process.env.DATABASE_URL
 *     or any R0*_DATABASE_URL; none aliases another env var into DATABASE_URL;
 *  4. the seven converted DB tests import `databaseQualification`;
 *  5. the LIVE auth gate (SIRKIT_LIVE_AUTH_QUALIFICATION, B16.1B) stays a
 *     separate switch — neither gate references the other.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import {
  DB_QUALIFICATION_MARKER,
  DB_QUALIFICATION_URL,
  databaseQualification,
  withQualifiedDatabase,
} from "../test-qualification";

const ROOT = process.cwd();
const SELF = "app/lib/db/__tests__/b16-b-database-qualification.test.ts";
const HELPER = "app/lib/db/test-qualification.ts";
const LIVE_AUTH = "app/lib/auth/__tests__/b16-1b-live-qualification.test.ts";
/** Every DB-backed test in the repository (six named by the runbook + the seventh found by grep). */
const CONVERTED = [
  "app/lib/pcb/__tests__/ingest-integrity.test.ts",
  "app/lib/physical-binding/__tests__/schema-integrity.test.ts",
  "app/lib/durable-workflow/__tests__/tenant-scope.test.ts",
  "app/api/pcb-sync/__tests__/route.test.ts",
  "app/lib/assignment-queue/__tests__/revalidation.test.ts",
  "app/lib/pcb/__tests__/electrical-identity-boundary.test.ts",
  "app/components/pcb/__tests__/pcb-sync-authority.test.tsx",
] as const;

const VALID_URL = "postgres://qualification:pw@127.0.0.1:5432/sirkit_qualification";
const VALID_URL_LONG_SCHEME = "postgresql://qualification:pw@127.0.0.1:5432/sirkit_qualification";
/** Shaped like the owner's .env.local value: a pooler URL for a project that no longer resolves. */
const ENV_LOCAL_STYLE_URL = "postgresql://postgres.deadtenant:secret@aws-0-us-east-1.pooler.supabase.com:6543/postgres";

const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const posix = (path: string) => relative(ROOT, path).split(sep).join("/");

/** Every .ts/.tsx/.mts file that lives under a `__tests__` directory anywhere below app/. */
function testTreeFiles(dir: string, insideTests: boolean, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) testTreeFiles(full, insideTests || entry === "__tests__", out);
    else if (insideTests && /\.(?:ts|tsx|mts)$/.test(entry)) out.push(posix(full));
  }
  return out;
}

const TEST_FILES = testTreeFiles(join(ROOT, "app"), false).filter((file) => file !== SELF);

/** Source forms that make a test's execution depend on a bare/legacy DATABASE_URL. */
const DATABASE_URL_GATE_FORMS: readonly RegExp[] = [
  /\.(?:runIf|skipIf)\([^)]*process\.env\.DATABASE_URL\b/,
  /(?:typeof|Boolean\(|if\s*\(|!)\s*process\.env\.DATABASE_URL\b/,
  /process\.env\.DATABASE_URL\s*(?:\?|&&|\|\||===|!==|==|!=)/,
];
const LEGACY_PRIVATE_NAME = /\bR0\d[A-Z0-9_]*_DATABASE_URL\b/;
const ENV_ALIAS_INTO_DATABASE_URL = /process\.env\.DATABASE_URL\s*=\s*process\.env\./;
const BARE_READ_INTO_BINDING = /(?:const|let|var)\s+(\w+)\s*=\s*process\.env\.DATABASE_URL\b/g;
/** Code forms only (an import clause naming the module, or a call) — prose that names the loader is not a use of it. */
const LOAD_ENV_LOCAL = /import[^;\n]*load-env-local|\bloadEnvLocal\s*\(/;

describe("B16-B item 5 — databaseQualification truth table", () => {
  it("marker absent → disabled, 'marker not set', url null (a URL alone never enables)", () => {
    expect(databaseQualification({})).toEqual({ enabled: false, url: null, reason: "marker not set" });
    expect(databaseQualification({ [DB_QUALIFICATION_URL]: VALID_URL })).toEqual({ enabled: false, url: null, reason: "marker not set" });
  });

  it("marker must be exactly \"1\" — '0', 'true', 'yes', ' 1', '' are all 'marker not set'", () => {
    for (const marker of ["0", "true", "yes", " 1", "1 ", "", "TRUE"]) {
      const decision = databaseQualification({ [DB_QUALIFICATION_MARKER]: marker, [DB_QUALIFICATION_URL]: VALID_URL });
      expect(decision, `marker=${JSON.stringify(marker)}`).toEqual({ enabled: false, url: null, reason: "marker not set" });
    }
  });

  it("marker set, url missing or empty → disabled, 'url missing'", () => {
    expect(databaseQualification({ [DB_QUALIFICATION_MARKER]: "1" })).toEqual({ enabled: false, url: null, reason: "url missing" });
    expect(databaseQualification({ [DB_QUALIFICATION_MARKER]: "1", [DB_QUALIFICATION_URL]: "" })).toEqual({ enabled: false, url: null, reason: "url missing" });
  });

  it("marker set, url not a postgres:// or postgresql:// URL → disabled, 'url malformed'", () => {
    for (const url of ["mysql://u:p@h/db", "https://example.com/db", "postgres:/one-slash", " postgres://leading-space", "u:p@h:5432/db", "postgres"]) {
      expect(databaseQualification({ [DB_QUALIFICATION_MARKER]: "1", [DB_QUALIFICATION_URL]: url }), url).toEqual({ enabled: false, url: null, reason: "url malformed" });
    }
  });

  it("marker set AND well-formed url → enabled with that exact url (both scheme spellings)", () => {
    expect(databaseQualification({ [DB_QUALIFICATION_MARKER]: "1", [DB_QUALIFICATION_URL]: VALID_URL })).toEqual({ enabled: true, url: VALID_URL, reason: "enabled" });
    expect(databaseQualification({ [DB_QUALIFICATION_MARKER]: "1", [DB_QUALIFICATION_URL]: VALID_URL_LONG_SCHEME })).toEqual({ enabled: true, url: VALID_URL_LONG_SCHEME, reason: "enabled" });
  });

  it("DATABASE_URL (a .env.local-style value) is ignored: it never enables, never substitutes, never wins", () => {
    // ambient DATABASE_URL alone
    expect(databaseQualification({ DATABASE_URL: ENV_LOCAL_STYLE_URL })).toEqual({ enabled: false, url: null, reason: "marker not set" });
    // marker present but only DATABASE_URL — must NOT fall back to it
    expect(databaseQualification({ [DB_QUALIFICATION_MARKER]: "1", DATABASE_URL: ENV_LOCAL_STYLE_URL })).toEqual({ enabled: false, url: null, reason: "url missing" });
    // both present — the qualification url wins, DATABASE_URL is not consulted
    const decision = databaseQualification({ [DB_QUALIFICATION_MARKER]: "1", [DB_QUALIFICATION_URL]: VALID_URL, DATABASE_URL: ENV_LOCAL_STYLE_URL });
    expect(decision.url).toBe(VALID_URL);
    expect(decision.url).not.toBe(ENV_LOCAL_STYLE_URL);
  });

  it("withQualifiedDatabase returns the url when enabled and throws DB_QUALIFICATION_NOT_ENABLED otherwise", () => {
    expect(withQualifiedDatabase({ [DB_QUALIFICATION_MARKER]: "1", [DB_QUALIFICATION_URL]: VALID_URL })).toBe(VALID_URL);
    expect(() => withQualifiedDatabase({})).toThrow("DB_QUALIFICATION_NOT_ENABLED");
    expect(() => withQualifiedDatabase({ [DB_QUALIFICATION_MARKER]: "1" })).toThrow("DB_QUALIFICATION_NOT_ENABLED");
    expect(() => withQualifiedDatabase({ [DB_QUALIFICATION_MARKER]: "1", [DB_QUALIFICATION_URL]: "mysql://x" })).toThrow("DB_QUALIFICATION_NOT_ENABLED");
    expect(() => withQualifiedDatabase({ DATABASE_URL: ENV_LOCAL_STYLE_URL })).toThrow("DB_QUALIFICATION_NOT_ENABLED");
  });

  it("defaults to the REAL process environment (no file is consulted)", () => {
    const prior = { marker: process.env[DB_QUALIFICATION_MARKER], url: process.env[DB_QUALIFICATION_URL] };
    try {
      process.env[DB_QUALIFICATION_MARKER] = "1";
      process.env[DB_QUALIFICATION_URL] = VALID_URL;
      expect(databaseQualification()).toEqual({ enabled: true, url: VALID_URL, reason: "enabled" });
      expect(withQualifiedDatabase()).toBe(VALID_URL);
      delete process.env[DB_QUALIFICATION_MARKER];
      expect(databaseQualification().enabled).toBe(false);
      expect(() => withQualifiedDatabase()).toThrow("DB_QUALIFICATION_NOT_ENABLED");
    } finally {
      if (prior.marker === undefined) delete process.env[DB_QUALIFICATION_MARKER]; else process.env[DB_QUALIFICATION_MARKER] = prior.marker;
      if (prior.url === undefined) delete process.env[DB_QUALIFICATION_URL]; else process.env[DB_QUALIFICATION_URL] = prior.url;
    }
  });

  it("reports this run's decision (reason only — the url is never printed)", () => {
    const decision = databaseQualification();
    console.log(`[b16-b db qualification] ${decision.enabled ? "ENABLED" : "skipped"} — ${decision.reason}`);
    expect(typeof decision.enabled).toBe("boolean");
  });
});

describe("B16-B item 5 — the helper is production-safe and blind to .env.local / DATABASE_URL", () => {
  const source = read(HELPER);
  // The header documents what the helper must NOT do, so the code-level checks
  // run on the source with comments stripped (prose may name the hazards).
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

  it("imports nothing, has no test-framework dependency, and never logs", () => {
    expect(code).not.toMatch(/\bimport\b/);
    expect(code).not.toMatch(/\brequire\(/);
    expect(code).not.toMatch(/vitest/);
    expect(code).not.toMatch(/console\./);
    expect(code).not.toMatch(/process\.stdout|process\.stderr/);
  });

  it("never calls loadEnvLocal and reads exactly the two qualification keys — never DATABASE_URL", () => {
    expect(code).not.toMatch(/loadEnvLocal|load-env-local|\.env\.local|readFileSync|node:fs/);
    expect(code).not.toMatch(/DATABASE_URL/);
    // the only env reads are `env[DB_QUALIFICATION_MARKER]` and `env[DB_QUALIFICATION_URL]`
    const reads = [...code.matchAll(/\benv\[(\w+)\]/g)].map((m) => m[1]);
    expect(reads.sort()).toEqual(["DB_QUALIFICATION_MARKER", "DB_QUALIFICATION_URL"]);
    expect(code).not.toMatch(/\benv\.\w/);
    expect(DB_QUALIFICATION_MARKER).toBe("SIRKIT_DB_QUALIFICATION");
    expect(DB_QUALIFICATION_URL).toBe("SIRKIT_DB_QUALIFICATION_URL");
  });
});

describe("B16-B item 5 — repo-wide tripwires over app/**/__tests__ (allowlist: none)", () => {
  it("walks a non-trivial test tree", () => {
    expect(TEST_FILES.length).toBeGreaterThan(100);
    for (const file of [...CONVERTED, LIVE_AUTH]) expect(TEST_FILES, file).toContain(file);
  });

  it("no test file imports load-env-local or calls loadEnvLocal", () => {
    const offenders = TEST_FILES.filter((file) => LOAD_ENV_LOCAL.test(read(file)));
    expect(offenders).toEqual([]);
  });

  it("no test file references a legacy private R0*_DATABASE_URL name", () => {
    const offenders = TEST_FILES.filter((file) => LEGACY_PRIVATE_NAME.test(read(file)));
    expect(offenders).toEqual([]);
  });

  it("no test file gates on process.env.DATABASE_URL (runIf/skipIf, typeof, Boolean, if, !, ternary, &&, ||, comparisons)", () => {
    const offenders = TEST_FILES.flatMap((file) => {
      const src = read(file);
      return DATABASE_URL_GATE_FORMS.filter((form) => form.test(src)).map((form) => `${file} :: ${form.source}`);
    });
    expect(offenders).toEqual([]);
  });

  it("no test file aliases another env var into DATABASE_URL (the R0*_DATABASE_URL pattern, generalized)", () => {
    const offenders = TEST_FILES.filter((file) => ENV_ALIAS_INTO_DATABASE_URL.test(read(file)));
    expect(offenders).toEqual([]);
  });

  it("the only bare reads of process.env.DATABASE_URL are save-for-restore bindings (prior*)", () => {
    const offenders = TEST_FILES.flatMap((file) =>
      [...read(file).matchAll(BARE_READ_INTO_BINDING)].filter((m) => !/^prior/i.test(m[1]!)).map((m) => `${file} :: ${m[1]}`),
    );
    expect(offenders).toEqual([]);
  });
});

describe("B16-B item 5 — the converted DB tests use the marker, and the LIVE auth gate stays separate", () => {
  it.each(CONVERTED)("%s imports databaseQualification from db/test-qualification and no longer reads .env.local", (file) => {
    const src = read(file);
    expect(src).toMatch(/import \{[^}]*\bdatabaseQualification\b[^}]*\} from "[^"]*db\/test-qualification";/);
    expect(src).toMatch(/databaseQualification\(\)/);
    expect(src).toMatch(/SIRKIT_DB_QUALIFICATION=1/);
    expect(src).not.toMatch(LOAD_ENV_LOCAL);
    expect(src).not.toMatch(LEGACY_PRIVATE_NAME);
    expect(src).not.toMatch(/SIRKIT_LIVE_AUTH_QUALIFICATION/);
  });

  it("ingest-integrity (the reproduced defect) is describe.runIf(q.enabled), publishes the url in beforeAll, and says so in its header", () => {
    const src = read("app/lib/pcb/__tests__/ingest-integrity.test.ts");
    expect(src).toMatch(/const q = databaseQualification\(\);/);
    expect(src).toMatch(/describe\.runIf\(q\.enabled\)\(/);
    expect(src).toMatch(/beforeAll\(\(\) => \{[\s\S]*process\.env\.DATABASE_URL = withQualifiedDatabase\(\);/);
    expect(src).not.toMatch(/describe\.skipIf/);
    expect(src).not.toMatch(/hasDb/);
    const header = src.slice(0, src.indexOf("*/"));
    expect(header).toMatch(/SIRKIT_DB_QUALIFICATION=1 SIRKIT_DB_QUALIFICATION_URL=/);
    expect(header).toMatch(/never reads \.env\.local/);
  });

  it("b16-1b-live-qualification gates on SIRKIT_LIVE_AUTH_QUALIFICATION only — not on the DB marker, and not on DATABASE_URL", () => {
    const src = read(LIVE_AUTH);
    expect(src).toMatch(/process\.env\.SIRKIT_LIVE_AUTH_QUALIFICATION === "1"/);
    expect(src).not.toMatch(/SIRKIT_DB_QUALIFICATION/);
    expect(src).not.toMatch(/db\/test-qualification/);
    expect(src).not.toMatch(/process\.env\.DATABASE_URL\b/);
    expect(src).not.toMatch(LOAD_ENV_LOCAL);
  });
});
