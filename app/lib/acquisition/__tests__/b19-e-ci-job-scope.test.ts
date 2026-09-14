/**
 * [B19-E E2 review] The CI jobs run each B19 suite where its dependencies are: the prompt-to-gerber job has no database,
 * so no suite that starts a disposable PostgreSQL (PGlite) may match its vitest filters — those run in database-delivery —
 * and an explicit file entry in a job is never already covered by one of that job's directory filters.
 *
 * Vitest positional filters select every test file whose path contains the filter, so the job's filters are applied here
 * the same way to the repository's test files.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, posix, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const WORKFLOW = ".github/workflows/deterministic-manufacturing.yml";
/** an import specifier that starts the disposable PostgreSQL or PGlite (statically or dynamically, by any relative spelling) */
const POSTGRES_SPECIFIER = /(^|\/)disposable-postgres(\.ts)?$|^@electric-sql\/pglite|^drizzle-orm\/pglite/;
const IMPORT_SPECIFIER = /(?:from\s+|import\(\s*|import\s+)["']([^"']+)["']/g;

/** The positional filters of a job's `pnpm exec vitest run` step, in order. */
function jobFilters(job: string): string[] {
  const lines = readFileSync(join(ROOT, WORKFLOW), "utf8").split(/\r?\n/);
  const start = lines.indexOf(`  ${job}:`);
  expect(start, `job ${job}`).toBeGreaterThan(-1);
  const run = lines.findIndex((line, index) => index > start && /pnpm exec vitest run\s*$/.test(line));
  expect(run, `${job} runs vitest`).toBeGreaterThan(start);
  const filters: string[] = [];
  for (let index = run + 1; index < lines.length && !/--reporter/.test(lines[index]!); index += 1) {
    const filter = lines[index]!.trim();
    if (filter) filters.push(filter);
  }
  return filters;
}

function testFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) testFiles(full, out);
    else if (/\.test\.tsx?$/.test(entry)) out.push(relative(ROOT, full).split(sep).join("/"));
  }
  return out;
}

const ALL_TESTS = ["app", "lib", "components"].flatMap((root) => {
  try {
    return testFiles(join(ROOT, root));
  } catch {
    return [];
  }
});
const selected = (filters: readonly string[]): string[] => ALL_TESTS.filter((file) => filters.some((filter) => file.includes(filter)));

/**
 * [B19-E E2 follow-up] Does a suite start PostgreSQL, itself or through a test helper it imports? Relative imports are followed
 * (a shared harness is the usual way), up to a few levels; package and alias imports of production code are not.
 */
export function startsPostgresVia(file: string, read: (file: string) => string | null, depth = 4, seen = new Set<string>()): boolean {
  if (seen.has(file)) return false;
  seen.add(file);
  const source = read(file);
  if (source === null) return false;
  for (const match of source.matchAll(IMPORT_SPECIFIER)) {
    const specifier = match[1]!;
    if (POSTGRES_SPECIFIER.test(specifier)) return true;
    if (depth > 0 && specifier.startsWith(".")) {
      const base = posix.normalize(posix.join(posix.dirname(file), specifier));
      for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`]) {
        if (read(candidate) !== null) {
          if (startsPostgresVia(candidate, read, depth - 1, seen)) return true;
          break;
        }
      }
    }
  }
  return false;
}

const fileCache = new Map<string, string | null>();
const readRepoFile = (file: string): string | null => {
  if (!fileCache.has(file)) {
    try {
      fileCache.set(file, statSync(join(ROOT, file)).isFile() ? readFileSync(join(ROOT, file), "utf8") : null);
    } catch {
      fileCache.set(file, null);
    }
  }
  return fileCache.get(file)!;
};
const startsPostgres = (file: string): boolean => startsPostgresVia(file, readRepoFile);

describe("[B19-E E2 review] CI job scope", () => {
  it("the no-database prompt-to-gerber job selects no suite that starts PGlite; the B19 PGlite suites run in database-delivery", () => {
    const promptToGerber = selected(jobFilters("prompt-to-gerber"));
    expect(promptToGerber.length).toBeGreaterThan(100);
    expect(promptToGerber.filter(startsPostgres)).toEqual([]);
    const databaseDelivery = selected(jobFilters("database-delivery"));
    const b19Postgres = ALL_TESTS.filter((file) => /\/b19-/.test(file) && startsPostgres(file));
    expect(b19Postgres).toEqual(expect.arrayContaining(["app/lib/distributors/__tests__/b19-offer-retention.test.ts", "app/lib/distributors/__tests__/b19-e-external-search-retention.test.ts"]));
    expect(b19Postgres.filter((file) => !databaseDelivery.includes(file))).toEqual([]);
  }, 60_000);

  it("[B19-E E2 follow-up] the detector finds PostgreSQL started through a relative import or a shared test harness, and nothing else", () => {
    // specifiers assembled at runtime, so this file's own source never reads as starting PostgreSQL
    const DISPOSABLE = ["disposable", "postgres"].join("-");
    const PGLITE = ["@electric-sql", "pglite"].join("/");
    const files: Record<string, string> = {
      "app/lib/db/__tests__/direct.test.ts": `import { disposablePostgres } from "../${DISPOSABLE}";`,
      "app/lib/acquisition/__tests__/via-harness.test.ts": `import { withDb } from "../../distributors/__tests__/_pg-harness";`,
      "app/lib/distributors/__tests__/_pg-harness.ts": `export { disposablePostgres as withDb } from "../../db/${DISPOSABLE}";`,
      "app/lib/acquisition/__tests__/dynamic.test.ts": `const pg = await import("${PGLITE}");`,
      "app/lib/acquisition/__tests__/plain.test.ts": `import { searchExternalCandidates } from "../external-search";\nimport { x } from "./helper";`,
      "app/lib/acquisition/__tests__/helper.ts": `export const x = "${DISPOSABLE} is only a word here";`,
      "app/lib/acquisition/external-search.ts": `import { SOURCE_REGISTRY } from "./source-registry";`,
    };
    const read = (file: string): string | null => files[file] ?? null;
    expect(startsPostgresVia("app/lib/db/__tests__/direct.test.ts", read)).toBe(true);
    expect(startsPostgresVia("app/lib/acquisition/__tests__/via-harness.test.ts", read)).toBe(true);
    expect(startsPostgresVia("app/lib/acquisition/__tests__/dynamic.test.ts", read)).toBe(true);
    expect(startsPostgresVia("app/lib/acquisition/__tests__/plain.test.ts", read)).toBe(false);
  });

  it("[B19-E E3 review] every B19 suite runs in CI: a PGlite suite in database-delivery, every other one in prompt-to-gerber", () => {
    const promptToGerber = selected(jobFilters("prompt-to-gerber"));
    const databaseDelivery = selected(jobFilters("database-delivery"));
    const b19 = ALL_TESTS.filter((file) => /\/b19-/.test(file));
    expect(b19).toEqual(expect.arrayContaining(["app/lib/atomic/__tests__/b19-e-publication-integrity.test.ts", "app/lib/atomic/__tests__/b19-e-atomic-publication-durable.test.ts", "app/lib/atomic/__tests__/b19-e-atomic-revision-loaders.test.ts"]));
    // [B19-E E4] the publication review suites: two start PGlite, the rest (a shared fixture harness included) do not
    expect(["app/lib/atomic/__tests__/b19-e-publication-review-durable.test.ts", "app/lib/atomic/__tests__/b19-e-publication-fake-vendors.test.ts"].every(startsPostgres)).toBe(true);
    expect(["app/lib/atomic/__tests__/b19-e-publication-review.test.ts", "app/lib/atomic/__tests__/b19-e-publication-boundaries.test.ts", "app/api/components/__tests__/b19-e-atomic-publication-route.test.ts", "app/components/parts/__tests__/b19-e-atomic-publication-panel.test.tsx"].some(startsPostgres)).toBe(false);
    // [B19-E E5] lifecycle and binding: the durable withdrawal, rebind and B14 suite starts PGlite; the rest do not (the rebind
    // route suite is under app/api/physical-bindings/__tests__, which prompt-to-gerber selects by directory)
    expect(startsPostgres("app/lib/physical-binding/__tests__/b19-e-successor-b14-durable.test.ts")).toBe(true);
    expect(["app/api/components/__tests__/b19-e-revision-status-route.test.ts", "app/api/components/__tests__/b19-e-withdraw-revision-route.test.ts", "app/api/physical-bindings/__tests__/b19-e-successor-rebind.test.ts", "app/lib/engineering/__tests__/b19-e-authority-catalog-status.test.ts", "app/components/pcb/__tests__/b19-e-component-review-successor.test.tsx"].some(startsPostgres)).toBe(false);
    expect(b19.filter((file) => !(startsPostgres(file) ? databaseDelivery : promptToGerber).includes(file))).toEqual([]);
  }, 60_000);

  it("no explicit test file in prompt-to-gerber is already selected by one of its directory filters", () => {
    const filters = jobFilters("prompt-to-gerber");
    const redundant = filters.filter((filter) => /\.test\.tsx?$/.test(filter) && filters.some((other) => other !== filter && filter.includes(other)));
    expect(redundant).toEqual([]);
  });
});
