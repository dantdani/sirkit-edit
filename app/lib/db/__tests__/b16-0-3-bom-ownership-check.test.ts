/**
 * B16.0.3 §D — the BOM ownership-completeness CHECK rejects partial ownership.
 *
 * B16.0.3 R4 found the B16.0.2 CHECK (`btrim(col) <> ''` only) evaluated to SQL
 * UNKNOWN for a partially-owned row (one column NULL, others set) — and
 * PostgreSQL rejects a row ONLY on FALSE, so partial ownership PASSED. The
 * fix names `col IS NOT NULL` explicitly in the second disjunct. This suite:
 *  - proves the six-value truth table under Kleene 3-valued logic for BOTH the
 *    OLD (regression) and NEW (fixed) forms;
 *  - pins schema/migration parity: both `drizzle/0028_*.sql` and
 *    `app/lib/db/schema.ts` declare the SAME named constraints in the fixed
 *    (IS NOT NULL) form on both bom_snapshots and bom_notifications.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// ── Kleene 3-valued logic model of the CHECK expressions ─────────────────────
type Bool3 = true | false | "unknown";
const and3 = (...xs: Bool3[]): Bool3 => (xs.includes(false) ? false : xs.includes("unknown") ? "unknown" : true);
const or3 = (...xs: Bool3[]): Bool3 => (xs.includes(true) ? true : xs.includes("unknown") ? "unknown" : false);
const isNull = (v: string | null): Bool3 => v === null;
const isNotNull = (v: string | null): Bool3 => v !== null;
const btrimNe = (v: string | null): Bool3 => (v === null ? "unknown" : v.trim() !== "");
/** PostgreSQL rejects a row ONLY when the CHECK predicate is FALSE. */
const postgresPasses = (predicate: Bool3): boolean => predicate !== false;

/** The B16.0.2 (regression) CHECK: btrim-only second disjunct. */
function oldCheck(t: string | null, p: string | null, b: string | null): Bool3 {
  return or3(and3(isNull(t), isNull(p), isNull(b)), and3(btrimNe(t), btrimNe(p), btrimNe(b)));
}
/** The B16.0.3 (fixed) CHECK: explicit IS NOT NULL + btrim second disjunct. */
function newCheck(t: string | null, p: string | null, b: string | null): Bool3 {
  return or3(
    and3(isNull(t), isNull(p), isNull(b)),
    and3(isNotNull(t), isNotNull(p), isNotNull(b), btrimNe(t), btrimNe(p), btrimNe(b)),
  );
}

const CASES: Array<{ name: string; row: [string | null, string | null, string | null]; ownedOrLegacy: boolean }> = [
  { name: "1 tenant NULL, others set (PARTIAL)", row: [null, "p", "main"], ownedOrLegacy: false },
  { name: "2 project NULL (PARTIAL)", row: ["local", null, "main"], ownedOrLegacy: false },
  { name: "3 branch NULL (PARTIAL)", row: ["local", "p", null], ownedOrLegacy: false },
  { name: "4 all NULL (legacy)", row: [null, null, null], ownedOrLegacy: true },
  { name: "5 all set nonblank (owned)", row: ["local", "p", "main"], ownedOrLegacy: true },
  { name: "6 all set, one blank (invalid)", row: ["local", "", "main"], ownedOrLegacy: false },
];

describe("B16.0.3 §D — the fixed CHECK rejects partial ownership (six-value truth table)", () => {
  it("the FIXED form: legacy (all NULL) and fully-owned pass; PARTIAL and blank are rejected", () => {
    for (const c of CASES) {
      const passes = postgresPasses(newCheck(...c.row));
      expect(passes, c.name).toBe(c.ownedOrLegacy);
    }
  });

  it("REGRESSION WITNESS: the OLD (btrim-only) form let the three PARTIAL rows through (UNKNOWN → passes)", () => {
    // cases 1–3 are the defect: OLD passes them, NEW rejects them.
    for (const c of CASES.slice(0, 3)) {
      expect(oldCheck(...c.row), `OLD ${c.name}`).toBe("unknown");
      expect(postgresPasses(oldCheck(...c.row)), `OLD passes ${c.name}`).toBe(true);
      expect(postgresPasses(newCheck(...c.row)), `NEW rejects ${c.name}`).toBe(false);
    }
    // cases 4–6 are unchanged between forms.
    for (const c of CASES.slice(3)) {
      expect(postgresPasses(oldCheck(...c.row)), `OLD ${c.name}`).toBe(postgresPasses(newCheck(...c.row)));
    }
  });
});

describe("B16.0.3 §D — schema/migration parity (both declare the fixed constraint)", () => {
  const ROOT = process.cwd();
  const migration = readFileSync(join(ROOT, "drizzle", "0028_bom_project_ownership.sql"), "utf8");
  const schema = readFileSync(join(ROOT, "app", "lib", "db", "schema.ts"), "utf8");

  it("migration 0028 declares BOTH named constraints in the IS NOT NULL form", () => {
    for (const table of ["bom_snapshots", "bom_notifications"]) {
      expect(migration).toContain(`ADD CONSTRAINT "${table}_ownership_complete_check"`);
    }
    // both CHECK blocks name IS NOT NULL for all three columns
    const isNotNullCount = (migration.match(/IS NOT NULL/g) ?? []).length;
    expect(isNotNullCount).toBeGreaterThanOrEqual(6); // 3 columns × 2 tables
    // the btrim guard is still present too
    expect((migration.match(/btrim\(/g) ?? []).length).toBeGreaterThanOrEqual(6);
  });

  it("schema.ts declares BOTH named constraints in the IS NOT NULL form", () => {
    for (const table of ["bom_snapshots", "bom_notifications"]) {
      expect(schema).toContain(`check("${table}_ownership_complete_check"`);
    }
    // the schema CHECK bodies include the explicit IS NOT NULL conjuncts
    expect((schema.match(/IS NOT NULL AND/g) ?? []).length).toBeGreaterThanOrEqual(4);
    expect(schema).toContain("btrim(");
  });

  it("the schema and migration constraint NAMES match exactly (db:push and the migration agree)", () => {
    for (const name of ["bom_snapshots_ownership_complete_check", "bom_notifications_ownership_complete_check"]) {
      expect(migration.includes(name), `migration ${name}`).toBe(true);
      expect(schema.includes(name), `schema ${name}`).toBe(true);
    }
  });
});
